import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildDefaultLlmSettings } from "../llmConfig";

const mocks = vi.hoisted(() => ({
  embedTextWithMetadata: vi.fn(),
  getSessionEmbeddingIndexVersion: vi.fn(),
  getLlmSettings: vi.fn(),
  generateConversationSummary: vi.fn(),
  generateWeeklyReport: vi.fn(),
  callInference: vi.fn(),
  vectorRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../db/schema", () => {
  let nextId = 100;
  const vectors = {
    where: (_field: string) => ({
      equals: (conversationId: number) => ({
        and: (predicate: (row: Record<string, unknown>) => boolean) => ({
          toArray: async () =>
            mocks.vectorRows.filter(
              (row) => row.conversation_id === conversationId && predicate(row)
            ),
          first: async () =>
            mocks.vectorRows.find(
              (row) => row.conversation_id === conversationId && predicate(row)
            ),
          delete: async () => {
            for (let i = mocks.vectorRows.length - 1; i >= 0; i -= 1) {
              const row = mocks.vectorRows[i];
              if (row.conversation_id === conversationId && predicate(row)) {
                mocks.vectorRows.splice(i, 1);
              }
            }
          },
        }),
      }),
    }),
    add: async (row: Record<string, unknown>) => {
      row.id = nextId;
      nextId += 1;
      mocks.vectorRows.push(row);
      return row.id;
    },
  };
  return {
    db: {
      vectors,
      transaction: async (_mode: string, _table: unknown, fn: () => Promise<void>) => fn(),
    },
  };
});

vi.mock("../../db/repository", () => ({
  addExploreMessage: vi.fn(),
  createExploreSession: vi.fn(),
  getExploreMessages: vi.fn(),
  getSummary: vi.fn(),
  getWeeklyReport: vi.fn(),
  listConversationsByRange: vi.fn(),
  updateExploreSession: vi.fn(),
}));

vi.mock("../embeddingService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../embeddingService")>();
  return {
    ...actual,
    embedTextWithMetadata: mocks.embedTextWithMetadata,
    getSessionEmbeddingIndexVersion: mocks.getSessionEmbeddingIndexVersion,
  };
});

vi.mock("../insightGenerationService", () => ({
  generateConversationSummary: mocks.generateConversationSummary,
  generateWeeklyReport: mocks.generateWeeklyReport,
}));

vi.mock("../llmService", () => ({ callInference: mocks.callInference }));

vi.mock("../llmSettingsService", () => ({ getLlmSettings: mocks.getLlmSettings }));

vi.mock("../languageSettingsService", () => ({
  getLanguageSettings: async () => ({ locale: "en" }),
}));

import { buildEmbeddingIndexVersion } from "../embeddingService";
import { ensureVectorForConversation, hashText } from "../searchService";

// The demo gateway swapped its embedding model: v1 (1536d) → v4 (1024d).
const OLD_EMBEDDING_METADATA = {
  provider: "dashscope",
  model: "text-embedding-v1",
  dimensions: 1536,
};
const CURRENT_EMBEDDING_METADATA = {
  provider: "dashscope",
  model: "text-embedding-v4",
  dimensions: 1024,
};

function oldVersion(): string {
  return buildEmbeddingIndexVersion(
    "proxy",
    OLD_EMBEDDING_METADATA.provider,
    OLD_EMBEDDING_METADATA.model,
    OLD_EMBEDDING_METADATA.dimensions
  );
}

function currentVersion(): string {
  return buildEmbeddingIndexVersion(
    "proxy",
    CURRENT_EMBEDDING_METADATA.provider,
    CURRENT_EMBEDDING_METADATA.model,
    CURRENT_EMBEDDING_METADATA.dimensions
  );
}

async function seedStoredVector(
  conversationId: number,
  text: string,
  metadata: typeof CURRENT_EMBEDDING_METADATA,
  version: string
) {
  mocks.vectorRows.push({
    id: conversationId,
    conversation_id: conversationId,
    text_hash: await hashText(text),
    embedding: new Float32Array(metadata.dimensions),
    embedding_provider: metadata.provider,
    embedding_model: metadata.model,
    embedding_dimensions: metadata.dimensions,
    index_version: version,
  });
}

beforeEach(() => {
  mocks.vectorRows.length = 0;
  mocks.embedTextWithMetadata.mockReset();
  mocks.embedTextWithMetadata.mockImplementation(async () => ({
    vector: new Float32Array(CURRENT_EMBEDDING_METADATA.dimensions),
    metadata: { ...CURRENT_EMBEDDING_METADATA, version: currentVersion() },
  }));
  mocks.getSessionEmbeddingIndexVersion.mockReset();
  mocks.getLlmSettings.mockReset();
  mocks.getLlmSettings.mockImplementation(async () => buildDefaultLlmSettings());
});

describe("ensureVectorForConversation cache reuse", () => {
  it("skips the network call when a stored vector matches the session-learned version", async () => {
    mocks.getSessionEmbeddingIndexVersion.mockReturnValue(currentVersion());
    await seedStoredVector(42, "unchanged conversation text", CURRENT_EMBEDDING_METADATA, currentVersion());

    const result = await ensureVectorForConversation(42, "unchanged conversation text");

    expect(mocks.getSessionEmbeddingIndexVersion).toHaveBeenCalledWith("proxy");
    expect(mocks.embedTextWithMetadata).not.toHaveBeenCalled();
    expect(result?.version).toBe(currentVersion());
    expect(mocks.vectorRows).toHaveLength(1);
  });

  it("re-embeds a stored vector from an older version after a server-side model swap", async () => {
    mocks.getSessionEmbeddingIndexVersion.mockReturnValue(currentVersion());
    await seedStoredVector(11, "same text", OLD_EMBEDDING_METADATA, oldVersion());

    const result = await ensureVectorForConversation(11, "same text");

    expect(mocks.embedTextWithMetadata).toHaveBeenCalledTimes(1);
    expect(result?.version).toBe(currentVersion());
    // The old-version row is kept for rollback; the new-version row is added.
    expect(mocks.vectorRows).toHaveLength(2);
    expect(
      mocks.vectorRows.some((row) => row.index_version === currentVersion())
    ).toBe(true);
  });

  it("embeds once to learn the version, then reuses matching rows without network", async () => {
    // Nothing learned yet this session: even a perfectly fine-looking stored
    // row cannot be trusted, so the first call embeds and learns.
    mocks.getSessionEmbeddingIndexVersion.mockReturnValue(undefined);
    await seedStoredVector(7, "some text", OLD_EMBEDDING_METADATA, oldVersion());

    const first = await ensureVectorForConversation(7, "some text");
    expect(mocks.embedTextWithMetadata).toHaveBeenCalledTimes(1);
    expect(first?.version).toBe(currentVersion());

    // The embed learned the current version; a later conversation whose stored
    // row matches it reuses with zero network calls.
    mocks.getSessionEmbeddingIndexVersion.mockReturnValue(currentVersion());
    await seedStoredVector(8, "other text", CURRENT_EMBEDDING_METADATA, currentVersion());

    const second = await ensureVectorForConversation(8, "other text");
    expect(mocks.embedTextWithMetadata).toHaveBeenCalledTimes(1);
    expect(second?.version).toBe(currentVersion());
  });

  it("re-embeds when the text changed even though a current-version row exists", async () => {
    mocks.getSessionEmbeddingIndexVersion.mockReturnValue(currentVersion());
    await seedStoredVector(9, "old text", CURRENT_EMBEDDING_METADATA, currentVersion());

    const result = await ensureVectorForConversation(9, "updated text");

    expect(mocks.embedTextWithMetadata).toHaveBeenCalledTimes(1);
    expect(result?.version).toBe(currentVersion());
    // The transaction replaces the current-version row for this conversation.
    expect(mocks.vectorRows).toHaveLength(1);
    expect(mocks.vectorRows[0].text_hash).toBe(await hashText("updated text"));
  });
});
