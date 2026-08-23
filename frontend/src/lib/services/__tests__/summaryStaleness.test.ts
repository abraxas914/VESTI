import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDefaultLlmSettings } from "../llmConfig";
import { getPrompt } from "../../prompts";

const mocks = vi.hoisted(() => ({
  getConversationById: vi.fn(),
  getSummary: vi.fn(),
  listMessages: vi.fn(),
  saveSummary: vi.fn(),
  callInference: vi.fn(),
}));

vi.mock("../../db/repository", () => ({
  getConversationById: mocks.getConversationById,
  getSummary: mocks.getSummary,
  getWeeklyReport: vi.fn(),
  listConversationsByRange: vi.fn(),
  listMessages: mocks.listMessages,
  listTopicDefinitions: vi.fn(),
  saveSummary: mocks.saveSummary,
  saveWeeklyReport: vi.fn(),
}));

vi.mock("../llmService", () => ({
  buildWeeklySourceHash: vi.fn(),
  callInference: mocks.callInference,
  sanitizeSummaryText: (text: string) => text,
  truncateForContext: (text: string) => text,
}));

vi.mock("../languageSettingsService", () => ({
  getLanguageSettings: async () => ({ locale: "en" }),
}));

vi.mock("../weeklyGrowthGenerationService", () => ({
  generateWeeklyGrowthReportV2: vi.fn(),
}));

import { generateConversationSummary } from "../insightGenerationService";

const FRESH_AT = new Date(2026, 7, 20, 12, 0, 0).getTime();
const PROMPT_VERSION = getPrompt("conversationSummary", { variant: "current" }).version;

const settings = buildDefaultLlmSettings();

const conversation = {
  id: 7,
  uuid: "conversation-7",
  platform: "ChatGPT",
  title: "Vector search design",
  snippet: "",
  url: "",
  source_created_at: FRESH_AT,
  first_captured_at: FRESH_AT,
  last_captured_at: FRESH_AT,
  created_at: FRESH_AT,
  updated_at: FRESH_AT,
  message_count: 2,
  turn_count: 1,
  is_archived: false,
  is_trash: false,
  tags: [],
  topic_id: null,
  is_starred: false,
};

const messages = [
  { id: 1, conversation_id: 7, role: "user", content_text: "How do vector indexes work?", created_at: FRESH_AT },
  { id: 2, conversation_id: 7, role: "assistant", content_text: "They map text to embeddings.", created_at: FRESH_AT },
];

function previousSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    conversationId: 7,
    content: "cached summary",
    structured: null,
    format: "plain_text",
    status: "ok",
    modelId: settings.modelId,
    promptVersion: PROMPT_VERSION,
    createdAt: FRESH_AT,
    sourceUpdatedAt: FRESH_AT,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getConversationById.mockReset();
  mocks.getConversationById.mockImplementation(async () => conversation);
  mocks.getSummary.mockReset();
  mocks.listMessages.mockReset();
  mocks.listMessages.mockImplementation(async () => messages);
  mocks.saveSummary.mockReset();
  mocks.saveSummary.mockImplementation(async (record) => ({ ...record, id: 99 }));
  // Every LLM attempt fails fast, so regeneration paths end in a fallback record.
  mocks.callInference.mockReset();
  mocks.callInference.mockRejectedValue(new Error("llm unavailable"));
});

describe("generateConversationSummary staleness gate", () => {
  it("returns the previous summary without any LLM call when the conversation is unchanged", async () => {
    const previous = previousSummary();
    mocks.getSummary.mockImplementation(async () => previous);

    const result = await generateConversationSummary(settings, 7);

    expect(result).toBe(previous);
    expect(mocks.callInference).not.toHaveBeenCalled();
    expect(mocks.saveSummary).not.toHaveBeenCalled();
  });

  it("control.force bypasses the gate and regenerates", async () => {
    mocks.getSummary.mockImplementation(async () => previousSummary());

    // The LLM attempt proves the gate was bypassed; the hard failure
    // propagates (no silent fallback on transport errors).
    await expect(
      generateConversationSummary(settings, 7, { force: true })
    ).rejects.toThrow("llm unavailable");
    expect(mocks.callInference).toHaveBeenCalled();
  });

  it("always regenerates when the previous summary is a fallback row", async () => {
    mocks.getSummary.mockImplementation(async () => previousSummary({ status: "fallback" }));

    await expect(generateConversationSummary(settings, 7)).rejects.toThrow("llm unavailable");
    expect(mocks.callInference).toHaveBeenCalled();
  });

  it("regenerates when the conversation was re-captured after the summary was stored", async () => {
    mocks.getSummary.mockImplementation(async () =>
      previousSummary({ sourceUpdatedAt: FRESH_AT - 60_000 })
    );

    await expect(generateConversationSummary(settings, 7)).rejects.toThrow("llm unavailable");
    expect(mocks.callInference).toHaveBeenCalled();
  });

  it("regenerates when the stored summary predates the current prompt version", async () => {
    mocks.getSummary.mockImplementation(async () =>
      previousSummary({ promptVersion: "v0.0.0-outdated" })
    );

    await expect(generateConversationSummary(settings, 7)).rejects.toThrow("llm unavailable");
    expect(mocks.callInference).toHaveBeenCalled();
  });
});
