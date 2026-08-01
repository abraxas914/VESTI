import type { LlmConfig } from "../types";
import { getLlmAccessMode, getProxyBaseUrl } from "./llmConfig";
import { getLlmSettings } from "./llmSettingsService";
import { fetchDemoProxy, getProxyResponseMetadata } from "./proxyRequest";

const DEFAULT_DEMO_EMBEDDING_MODEL = "text-embedding-v1";
const DEFAULT_BYOK_EMBEDDING_MODEL = "text-embedding-v2";
const EMBEDDING_INDEX_SCHEMA_VERSION = "v1";

export type EmbeddingRoute = "proxy" | "byok";

export interface EmbeddingUsage {
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface EmbeddingIndexMetadata {
  provider: string;
  model: string;
  dimensions: number;
  version: string;
}

export interface EmbeddingResult extends EmbeddingIndexMetadata {
  route: EmbeddingRoute;
  vectors: number[][];
  usage?: EmbeddingUsage;
  requestId?: string;
  attempt?: number;
  fallbackReason?: string;
}

export interface EmbeddingRequestOptions {
  model?: string;
  signal?: AbortSignal;
}

interface OpenAiEmbeddingRow {
  index?: number;
  embedding?: unknown;
}

interface OpenAiEmbeddingResponse {
  model?: string;
  data?: OpenAiEmbeddingRow[];
  usage?: EmbeddingUsage;
}

interface EmbeddingServiceError extends Error {
  code: string;
  status?: number;
  route?: EmbeddingRoute;
  requestId?: string;
  providerUsed?: string;
  modelUsed?: string;
  attempt?: number;
  fallbackReason?: string;
}

function createEmbeddingError(
  code: string,
  message: string,
  route?: EmbeddingRoute,
  status?: number,
  response?: Response,
): EmbeddingServiceError {
  const metadata = response ? getProxyResponseMetadata(response) : null;
  const error = new Error(message) as EmbeddingServiceError;
  error.code = code;
  error.route = route;
  error.status = status;
  error.requestId = response?.headers.get("x-request-id") || metadata?.requestId;
  error.providerUsed = response?.headers.get("x-proxy-provider-used") || metadata?.providerUsed;
  error.modelUsed = response?.headers.get("x-proxy-model-used") || metadata?.modelUsed;
  error.attempt = metadata?.attempt;
  error.fallbackReason = response?.headers.get("x-proxy-fallback-reason") || metadata?.fallbackReason;
  return error;
}

function extractPayloadErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) {
      return nested.message.trim();
    }
  }
  return typeof record.message === "string" && record.message.trim()
    ? record.message.trim()
    : null;
}

function normalizeInput(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : [input];
  return list.map((item) => item.trim()).filter(Boolean);
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function buildEmbeddingIndexVersion(
  route: EmbeddingRoute,
  provider: string,
  model: string,
  dimensions: number,
): string {
  return [EMBEDDING_INDEX_SCHEMA_VERSION, route, provider, model, dimensions]
    .map((part) => String(part).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_"))
    .join(":");
}

function parseEmbeddingResponse(
  payload: unknown,
  route: EmbeddingRoute,
  response: Response,
  requestedModel: string,
): EmbeddingResult {
  const data = payload as OpenAiEmbeddingResponse;
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    throw createEmbeddingError(
      "EMBEDDING_EMPTY_RESULT",
      "Embedding response contains no vectors.",
      route,
      undefined,
      response,
    );
  }

  const vectors = [...data.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((row) => row.embedding)
    .filter((embedding): embedding is number[] =>
      Array.isArray(embedding) && embedding.every((value) => typeof value === "number"),
    );
  if (vectors.length !== data.data.length || vectors.length === 0) {
    throw createEmbeddingError(
      "EMBEDDING_INVALID_VECTOR",
      "Embedding response does not include numeric vectors.",
      route,
      undefined,
      response,
    );
  }

  const dimensions = vectors[0]?.length ?? 0;
  if (!dimensions || vectors.some((vector) => vector.length !== dimensions)) {
    throw createEmbeddingError(
      "EMBEDDING_DIMENSION_MISMATCH",
      "Embedding response contains inconsistent vector dimensions.",
      route,
      undefined,
      response,
    );
  }

  const proxyMetadata = getProxyResponseMetadata(response);
  const provider = response.headers.get("x-proxy-provider-used")
    || proxyMetadata?.providerUsed
    || (route === "proxy" ? "dashscope" : "byok");
  const model = response.headers.get("x-proxy-model-used")
    || proxyMetadata?.modelUsed
    || data.model
    || requestedModel;

  return {
    route,
    provider,
    model,
    dimensions,
    version: buildEmbeddingIndexVersion(route, provider, model, dimensions),
    vectors,
    usage: data.usage,
    requestId: response.headers.get("x-request-id") || proxyMetadata?.requestId,
    attempt: proxyMetadata?.attempt,
    fallbackReason: response.headers.get("x-proxy-fallback-reason") || proxyMetadata?.fallbackReason,
  };
}

async function requestEmbeddingsFromRoute(
  config: LlmConfig,
  route: EmbeddingRoute,
  input: string[],
  options: EmbeddingRequestOptions,
): Promise<EmbeddingResult> {
  const requestedModel = (options.model || DEFAULT_BYOK_EMBEDDING_MODEL).trim();
  let response: Response;

  if (route === "proxy") {
    // The gateway owns the Demo embedding model. Do not send a model field.
    const body = JSON.stringify({ input, encoding_format: "float" });
    response = await fetchDemoProxy({
      primaryBaseUrl: getProxyBaseUrl(config),
      route: "embeddings",
      serviceToken: config.proxyServiceToken,
      body,
      signal: options.signal,
    });
  } else {
    const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: requestedModel,
        input,
        encoding_format: "float",
      }),
      signal: options.signal,
    });
  }

  const payload = await readResponseJson(response);
  if (!response.ok) {
    const upstreamMessage = extractPayloadErrorMessage(payload)
      ?? `${route} embedding request failed with status ${response.status}`;
    const code = response.status === 404
      ? "EMBEDDINGS_ROUTE_MISSING"
      : response.status === 401 || response.status === 403
        ? "EMBEDDINGS_ACCESS_DENIED"
        : response.status === 429
          ? "EMBEDDINGS_RATE_LIMITED"
          : "EMBEDDING_REQUEST_FAILED";
    throw createEmbeddingError(code, upstreamMessage, route, response.status, response);
  }

  return parseEmbeddingResponse(
    payload,
    route,
    response,
    route === "proxy" ? DEFAULT_DEMO_EMBEDDING_MODEL : requestedModel,
  );
}

export async function requestEmbeddings(
  config: LlmConfig,
  input: string | string[],
  options: EmbeddingRequestOptions = {},
): Promise<EmbeddingResult> {
  const normalizedInput = normalizeInput(input);
  if (normalizedInput.length === 0) {
    throw createEmbeddingError("EMBEDDING_INPUT_EMPTY", "Embedding input cannot be empty.");
  }
  const route: EmbeddingRoute = getLlmAccessMode(config) === "custom_byok" ? "byok" : "proxy";
  return requestEmbeddingsFromRoute(config, route, normalizedInput, options);
}

async function requireLlmSettings(): Promise<LlmConfig> {
  const settings = await getLlmSettings();
  if (!settings) {
    throw createEmbeddingError("EMBEDDING_CONFIG_MISSING", "Missing LLM settings for embeddings.");
  }
  return settings;
}

export async function fetchEmbeddings(
  input: string | string[],
  options: EmbeddingRequestOptions = {},
): Promise<Float32Array[]> {
  const result = await requestEmbeddings(await requireLlmSettings(), input, options);
  return result.vectors.map((vector) => new Float32Array(vector));
}

export async function embedTextWithMetadata(text: string): Promise<{
  vector: Float32Array;
  metadata: EmbeddingIndexMetadata;
}> {
  const result = await requestEmbeddings(await requireLlmSettings(), text);
  const vector = result.vectors[0];
  if (!vector) {
    throw createEmbeddingError("EMBEDDING_EMPTY_RESULT", "Embedding response contains no vectors.");
  }
  return {
    vector: new Float32Array(vector),
    metadata: {
      provider: result.provider,
      model: result.model,
      dimensions: result.dimensions,
      version: result.version,
    },
  };
}

export async function embedText(text: string): Promise<Float32Array> {
  return (await embedTextWithMetadata(text)).vector;
}
