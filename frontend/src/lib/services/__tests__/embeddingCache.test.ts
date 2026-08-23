import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { buildDefaultLlmSettings } from "../llmConfig";
import { fetchDemoProxy } from "../proxyRequest";
import {
  getSessionEmbeddingIndexVersion,
  requestEmbeddings,
} from "../embeddingService";

vi.mock("../proxyRequest", () => ({
  fetchDemoProxy: vi.fn(),
  getProxyResponseMetadata: () => null,
}));

const fetchDemoProxyMock = fetchDemoProxy as unknown as Mock;
const config = buildDefaultLlmSettings();

// Distinct input per test: the module-level LRU persists across tests in this
// file, and reusing an input would legitimately hit that cache.
function okEmbeddingResponse(): Response {
  return new Response(
    JSON.stringify({
      model: "text-embedding-v1",
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  fetchDemoProxyMock.mockReset();
});

describe("requestEmbeddings cache reuse", () => {
  // Runs first: asserts the not-yet-learned state before any request succeeds.
  it("learns the session index version from successful resolutions, including LRU hits", async () => {
    fetchDemoProxyMock.mockImplementation(async () => okEmbeddingResponse());

    expect(getSessionEmbeddingIndexVersion("proxy")).toBeUndefined();

    const result = await requestEmbeddings(config, "version learning input");
    expect(getSessionEmbeddingIndexVersion("proxy")).toBe(result.version);

    // LRU hit: the cached result still carries the version metadata.
    await requestEmbeddings(config, "version learning input");
    expect(getSessionEmbeddingIndexVersion("proxy")).toBe(result.version);
    expect(fetchDemoProxyMock).toHaveBeenCalledTimes(1);
  });

  it("shares a single network request across concurrent identical calls", async () => {
    fetchDemoProxyMock.mockImplementation(async () => okEmbeddingResponse());

    const [first, second] = await Promise.all([
      requestEmbeddings(config, "dedup in-flight input"),
      requestEmbeddings(config, "dedup in-flight input"),
    ]);

    expect(fetchDemoProxyMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("serves a repeated identical call from the LRU without a second request", async () => {
    fetchDemoProxyMock.mockImplementation(async () => okEmbeddingResponse());

    const first = await requestEmbeddings(config, "lru cached input");
    const second = await requestEmbeddings(config, "lru cached input");

    expect(fetchDemoProxyMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("does not cache failures: a retry hits the network again", async () => {
    fetchDemoProxyMock
      .mockRejectedValueOnce(new Error("upstream down"))
      .mockImplementation(async () => okEmbeddingResponse());

    await expect(requestEmbeddings(config, "failure input")).rejects.toThrow("upstream down");

    const result = await requestEmbeddings(config, "failure input");
    expect(fetchDemoProxyMock).toHaveBeenCalledTimes(2);
    expect(result.vectors[0]).toEqual([0.1, 0.2, 0.3]);
  });

  it("treats different inputs as different cache keys", async () => {
    fetchDemoProxyMock.mockImplementation(async () => okEmbeddingResponse());

    await requestEmbeddings(config, "distinct input a");
    await requestEmbeddings(config, "distinct input b");

    expect(fetchDemoProxyMock).toHaveBeenCalledTimes(2);
  });
});
