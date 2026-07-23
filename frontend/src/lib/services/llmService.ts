import type {
  Conversation,
  LlmConfig,
  Message,
  ThinkHandlingPolicy,
} from "../types";
import { getConversationCaptureFreshnessAt } from "../conversations/timestamps";
import { logger } from "../utils/logger";
import {
  getEffectiveModelId,
  getLlmAccessMode,
  getProxyRouteUrl,
} from "./llmConfig";
import { parseJsonObjectFromText } from "./insightSchemas";
import { getLlmModelProfile } from "./llmModelProfile";

const SYSTEM_PROMPT = "You are a careful technical summarization assistant.";
const STRICT_JSON_SYSTEM_PROMPT =
  "Output must be a valid JSON object only. Do not include Markdown, code fences, or explanatory text outside JSON.";

export type ModelScopeMode = "plain_text" | "json_mode" | "prompt_json";
export type InferenceRoute = "proxy" | "modelscope";
export type LlmDiagnosticCode =
  | "proxy_upstream_auth_invalid"
  | "proxy_server_missing_upstream_key"
  | "proxy_service_token_invalid"
  | "proxy_origin_forbidden"
  | "modelscope_byok_auth_invalid"
  | "llm_request_failed_generic";
export type StreamExecutionStage =
  | "stable_non_stream"
  | "candidate_stream"
  | "fallback_non_stream";

export interface LlmDiagnostic {
  code: LlmDiagnosticCode;
  route: InferenceRoute;
  status: number | null;
  requestId: string | null;
  rawMessage: string;
  userMessage: string;
  technicalSummary: string;
}

interface StreamDecision {
  stage: StreamExecutionStage;
  reason: string;
}

const ENABLE_CANDIDATE_REASONING_STREAM_ROLLOUT = false;

export interface CallModelScopeOptions {
  responseFormat?: "json_object";
  systemPrompt?: string;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface InferenceUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface ProxyTokenMetrics {
  requestedMaxTokens: number | null;
  effectiveMaxTokens: number | null;
  proxyMaxTokensLimit: number | null;
}

export interface ModelScopeCallResult {
  content: string;
  mode: ModelScopeMode;
  streamStage: StreamExecutionStage;
  streamReason: string;
  contentSource?: "content" | "reasoning_content";
  finishReason?: string | null;
  usage?: InferenceUsage | null;
  proxyTokenMetrics?: ProxyTokenMetrics | null;
}

export interface InferenceCallResult extends ModelScopeCallResult {
  rawContent: string;
  route: InferenceRoute;
  streamRequested: boolean;
}

type ModelScopeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ModelScopeResponse = {
  choices?: Array<{
    message?: { content?: unknown; reasoning_content?: unknown };
    delta?: { content?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
    finishReason?: unknown;
    stop_reason?: unknown;
    stopReason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    promptTokens?: unknown;
    input_tokens?: unknown;
    inputTokens?: unknown;
    completion_tokens?: unknown;
    completionTokens?: unknown;
    output_tokens?: unknown;
    outputTokens?: unknown;
    total_tokens?: unknown;
    totalTokens?: unknown;
  };
};

interface ParsedLlmErrorPayload {
  rawText: string;
  message: string;
  requestId: string | null;
}

export class LlmRequestError extends Error {
  readonly diagnostic: LlmDiagnostic;

  constructor(diagnostic: LlmDiagnostic) {
    super(`${diagnostic.userMessage} ${diagnostic.technicalSummary}`.trim());
    this.name = "LlmRequestError";
    this.diagnostic = diagnostic;
  }
}

function ensureModelScopeConfig(config: LlmConfig): void {
  if (!config.baseUrl) {
    throw new Error("LLM_CONFIG_MISSING:BASE_URL");
  }
  if (!config.apiKey) {
    throw new Error("LLM_CONFIG_MISSING:API_KEY");
  }
  if (!getEffectiveModelId(config)) {
    throw new Error("LLM_CONFIG_MISSING:MODEL_ID");
  }
}

function ensureProxyConfig(config: LlmConfig): void {
  if (!config.proxyBaseUrl?.trim() && !config.proxyUrl?.trim()) {
    throw new Error("LLM_CONFIG_MISSING:PROXY_BASE_URL");
  }
  if (!getEffectiveModelId(config)) {
    throw new Error("LLM_CONFIG_MISSING:MODEL_ID");
  }
}

function toText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const value = (item as { text?: unknown }).text;
          return typeof value === "string" ? value : "";
        }
        return "";
      })
      .filter(Boolean);
    return parts.join(" | ");
  }
  return "";
}

function extractContent(data: ModelScopeResponse): string {
  const choice = data.choices?.[0];
  const direct = toText(choice?.message?.content);
  if (direct.trim()) {
    return direct.trim();
  }
  const delta = toText(choice?.delta?.content);
  if (delta.trim()) {
    return delta.trim();
  }
  return "";
}

function hasReasoningContent(data: ModelScopeResponse): boolean {
  const choice = data.choices?.[0];
  const messageReasoning = toText(choice?.message?.reasoning_content);
  if (messageReasoning.trim()) {
    return true;
  }
  const deltaReasoning = toText(choice?.delta?.reasoning_content);
  return deltaReasoning.trim().length > 0;
}

function extractReasoningContent(data: ModelScopeResponse): string {
  const choice = data.choices?.[0];
  const messageReasoning = toText(choice?.message?.reasoning_content);
  if (messageReasoning.trim()) {
    return messageReasoning.trim();
  }
  const deltaReasoning = toText(choice?.delta?.reasoning_content);
  if (deltaReasoning.trim()) {
    return deltaReasoning.trim();
  }
  return "";
}

function recoverJsonContentFromReasoning(data: ModelScopeResponse): string {
  const reasoning = extractReasoningContent(data);
  if (!reasoning) {
    return "";
  }
  try {
    const parsed = parseJsonObjectFromText(reasoning);
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
    return "";
  } catch {
    return "";
  }
}

function collapseErrorText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function routeLabel(route: InferenceRoute): string {
  return route === "proxy" ? "Proxy chat" : "ModelScope direct";
}

function buildTechnicalSummary(
  route: InferenceRoute,
  status: number | null,
  requestId: string | null
): string {
  const parts = [`Route: ${routeLabel(route)}`];
  if (typeof status === "number") {
    parts.push(`HTTP ${status}`);
  }
  parts.push(`Request: ${requestId || "unknown"}`);
  return parts.join(" | ");
}

function extractRequestIdFromPayload(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    request_id?: unknown;
    requestId?: unknown;
    error?: { request_id?: unknown; requestId?: unknown };
  };
  if (typeof candidate.error?.request_id === "string") return candidate.error.request_id;
  if (typeof candidate.error?.requestId === "string") return candidate.error.requestId;
  if (typeof candidate.request_id === "string") return candidate.request_id;
  if (typeof candidate.requestId === "string") return candidate.requestId;
  return null;
}

function extractMessageFromPayload(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const candidate = value as {
    message?: unknown;
    detail?: unknown;
    error?: string | { message?: unknown };
  };
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.detail === "string") return candidate.detail;
  if (typeof candidate.error === "string") return candidate.error;
  if (candidate.error && typeof candidate.error === "object") {
    const nestedMessage = candidate.error.message;
    if (typeof nestedMessage === "string") return nestedMessage;
  }
  return "";
}

function extractFinishReason(data: ModelScopeResponse): string | null {
  const choice = data.choices?.[0];
  return (
    toNullableString(choice?.finish_reason) ||
    toNullableString(choice?.finishReason) ||
    toNullableString(choice?.stop_reason) ||
    toNullableString(choice?.stopReason)
  );
}

function extractUsage(data: ModelScopeResponse): InferenceUsage | null {
  const usage = data.usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const promptTokens =
    toNullableNumber(usage.prompt_tokens) ??
    toNullableNumber(usage.promptTokens) ??
    toNullableNumber(usage.input_tokens) ??
    toNullableNumber(usage.inputTokens);
  const completionTokens =
    toNullableNumber(usage.completion_tokens) ??
    toNullableNumber(usage.completionTokens) ??
    toNullableNumber(usage.output_tokens) ??
    toNullableNumber(usage.outputTokens);
  const totalTokens =
    toNullableNumber(usage.total_tokens) ??
    toNullableNumber(usage.totalTokens);

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function extractProxyTokenMetrics(response: Response): ProxyTokenMetrics | null {
  const requestedMaxTokens = toNullableNumber(
    response.headers.get("x-proxy-requested-max-tokens")
  );
  const effectiveMaxTokens = toNullableNumber(
    response.headers.get("x-proxy-effective-max-tokens")
  );
  const proxyMaxTokensLimit = toNullableNumber(
    response.headers.get("x-proxy-max-tokens-limit")
  );

  if (
    requestedMaxTokens === null &&
    effectiveMaxTokens === null &&
    proxyMaxTokensLimit === null
  ) {
    return null;
  }

  return {
    requestedMaxTokens,
    effectiveMaxTokens,
    proxyMaxTokensLimit,
  };
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

async function parseErrorPayload(response: Response): Promise<ParsedLlmErrorPayload> {
  try {
    const rawText = await response.text();
    const collapsed = collapseErrorText(rawText);
    const requestIdFromHeader = response.headers.get("x-request-id");

    if (!collapsed) {
      return {
        rawText: "",
        message: "",
        requestId: requestIdFromHeader,
      };
    }

    try {
      const parsed = JSON.parse(rawText) as unknown;
      return {
        rawText,
        message: collapseErrorText(extractMessageFromPayload(parsed)) || collapsed,
        requestId: requestIdFromHeader || extractRequestIdFromPayload(parsed),
      };
    } catch {
      return {
        rawText,
        message: collapsed,
        requestId: requestIdFromHeader,
      };
    }
  } catch {
    return {
      rawText: "",
      message: "",
      requestId: response.headers.get("x-request-id"),
    };
  }
}

function normalizeLlmDiagnostic(
  route: InferenceRoute,
  status: number,
  payload: ParsedLlmErrorPayload
): LlmDiagnostic {
  const haystack = `${payload.message} ${payload.rawText}`;
  const isProxy = route === "proxy";
  let code: LlmDiagnosticCode = "llm_request_failed_generic";
  let userMessage = isProxy
    ? "Proxy chat request failed before a valid LLM response was returned."
    : "Direct ModelScope request failed before a valid LLM response was returned.";

  if (
    isProxy &&
    status === 500 &&
    /(SERVER_CONFIG_ERROR_MISSING_API_KEY|MISSING_API_KEY)/i.test(haystack)
  ) {
    code = "proxy_server_missing_upstream_key";
    userMessage =
      "Proxy chat is reachable, but its upstream ModelScope credential is not configured.";
  } else if (
    isProxy &&
    status === 401 &&
    /(SERVICE_TOKEN|x-vesti-service-token|service token)/i.test(haystack)
  ) {
    code = "proxy_service_token_invalid";
    userMessage = "Proxy rejected the service-token check before chat could run.";
  } else if (isProxy && status === 403 && /(origin|forbidden)/i.test(haystack)) {
    code = "proxy_origin_forbidden";
    userMessage = "Proxy rejected this extension origin before chat could run.";
  } else if (
    isProxy &&
    status === 401 &&
    /(valid ModelScope token|Authentication failed|Incorrect API key provided)/i.test(haystack)
  ) {
    code = "proxy_upstream_auth_invalid";
    userMessage =
      "Proxy chat reached the upstream model route, but ModelScope authentication failed.";
  } else if (!isProxy && status === 401) {
    code = "modelscope_byok_auth_invalid";
    userMessage = "Direct ModelScope chat authentication failed for the configured BYOK key.";
  }

  return {
    code,
    route,
    status,
    requestId: payload.requestId,
    rawMessage: payload.rawText || payload.message,
    userMessage,
    technicalSummary: buildTechnicalSummary(route, status, payload.requestId),
  };
}

function createLlmRequestError(
  route: InferenceRoute,
  status: number,
  payload: ParsedLlmErrorPayload
): LlmRequestError {
  return new LlmRequestError(normalizeLlmDiagnostic(route, status, payload));
}

export function getLlmDiagnostic(error: unknown): LlmDiagnostic | null {
  if (error instanceof LlmRequestError) {
    return error.diagnostic;
  }
  return null;
}

function buildPayload(
  config: LlmConfig,
  messages: ModelScopeMessage[],
  responseFormat?: "json_object",
  streamDecision: StreamDecision = {
    stage: "stable_non_stream",
    reason: "not_requested",
  }
): Record<string, unknown> {
  const modelProfile = getLlmModelProfile(getEffectiveModelId(config));

  if (streamDecision.stage === "fallback_non_stream") {
    logger.warn("llm", "Stream requested but downgraded to stable non-stream path", {
      streamMode: config.streamMode,
      reasoningPolicy: config.reasoningPolicy,
      streamReason: streamDecision.reason,
      modelId: getEffectiveModelId(config),
      modelFamily: modelProfile.modelFamily,
    });
  }

  const payload: Record<string, unknown> = {
    model: getEffectiveModelId(config),
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    messages,
  };

  if (modelProfile.thinkingParamPolicy === "force_false") {
    payload.enable_thinking = false;
  }

  // P1.5 hook: reserved for future stream/reasoning branch. Stable path keeps non-stream.
  if (streamDecision.stage === "candidate_stream") {
    payload.stream = ENABLE_CANDIDATE_REASONING_STREAM_ROLLOUT;
    logger.info("llm", "Stream candidate path captured by P1.5 hook", {
      streamReason: streamDecision.reason,
      modelId: getEffectiveModelId(config),
      modelFamily: modelProfile.modelFamily,
      streamEnabled: ENABLE_CANDIDATE_REASONING_STREAM_ROLLOUT,
    });
  }

  if (responseFormat) {
    payload.response_format = { type: responseFormat };
  }

  return payload;
}

async function requestModelScope(
  config: LlmConfig,
  messages: ModelScopeMessage[],
  responseFormat?: "json_object",
  streamDecision: StreamDecision = {
    stage: "stable_non_stream",
    reason: "not_requested",
  },
  signal?: AbortSignal
): Promise<Response> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const payload = buildPayload(config, messages, responseFormat, streamDecision);

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
}

async function requestProxyService(
  config: LlmConfig,
  messages: ModelScopeMessage[],
  responseFormat?: "json_object",
  streamDecision: StreamDecision = {
    stage: "stable_non_stream",
    reason: "not_requested",
  },
  signal?: AbortSignal
): Promise<Response> {
  const url = getProxyRouteUrl(config, "chat");
  const serviceToken = (config.proxyServiceToken || "").trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (serviceToken) {
    headers["x-vesti-service-token"] = serviceToken;
  }

  const payload = buildPayload(config, messages, responseFormat, streamDecision);

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
}

async function callProvider(
  config: LlmConfig,
  prompt: string,
  options: CallModelScopeOptions,
  route: InferenceRoute
): Promise<ModelScopeCallResult> {
  const baseSystemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
  const streamRequested = options.stream === true;
  const streamDecision = resolveStreamDecision(config, streamRequested);
  const requester =
    route === "proxy" ? requestProxyService : requestModelScope;

  const request = (
    messages: ModelScopeMessage[],
    responseFormat?: "json_object"
  ) =>
    requester(
      config,
      messages,
      responseFormat,
      streamDecision,
      options.signal
    );
  const modelProfile = getLlmModelProfile(getEffectiveModelId(config));

  const baseMessages: ModelScopeMessage[] = [
    { role: "system", content: baseSystemPrompt },
    { role: "user", content: prompt },
  ];

  const promptJsonMessages: ModelScopeMessage[] = [
    { role: "system", content: `${baseSystemPrompt}
${STRICT_JSON_SYSTEM_PROMPT}` },
    { role: "user", content: prompt },
  ];

  const recoverJsonIfAllowed = (data: ModelScopeResponse): string => {
    if (modelProfile.reasoningContentPolicy !== "json_recovery_only") {
      return "";
    }
    return recoverJsonContentFromReasoning(data);
  };

  if (options.responseFormat === "json_object") {
    const attemptPromptJson = async (): Promise<ModelScopeCallResult | null> => {
      const promptJsonResponse = await request(promptJsonMessages);
      if (!promptJsonResponse.ok) {
        const promptJsonErrorPayload = await parseErrorPayload(promptJsonResponse);
        logger.error(
          "llm",
          `${route} prompt_json request failed: ${promptJsonResponse.status}`,
          new Error(promptJsonErrorPayload.rawText || promptJsonErrorPayload.message)
        );
        throw createLlmRequestError(route, promptJsonResponse.status, promptJsonErrorPayload);
      }

      const promptJsonData = (await promptJsonResponse.json()) as ModelScopeResponse;
      const promptJsonContent = extractContent(promptJsonData);
      if (promptJsonContent.trim()) {
        return {
          content: promptJsonContent,
          mode: "prompt_json",
          streamStage: streamDecision.stage,
          streamReason: streamDecision.reason,
          contentSource: "content",
          finishReason: extractFinishReason(promptJsonData),
          usage: extractUsage(promptJsonData),
          proxyTokenMetrics: extractProxyTokenMetrics(promptJsonResponse),
        };
      }

      const recoveredPromptJson = recoverJsonIfAllowed(promptJsonData);
      if (recoveredPromptJson) {
        logger.info("llm", `${route} prompt_json recovered from reasoning_content`, {
          summary_json_recovered_from_reasoning: true,
          modelId: getEffectiveModelId(config),
          modelFamily: modelProfile.modelFamily,
        });
        return {
          content: recoveredPromptJson,
          mode: "prompt_json",
          streamStage: streamDecision.stage,
          streamReason: streamDecision.reason,
          contentSource: "reasoning_content",
          finishReason: extractFinishReason(promptJsonData),
          usage: extractUsage(promptJsonData),
          proxyTokenMetrics: extractProxyTokenMetrics(promptJsonResponse),
        };
      }

      logger.warn("llm", `${route} prompt_json returned empty content`, {
        hasReasoningContent: hasReasoningContent(promptJsonData),
        summary_json_recovered_from_reasoning: false,
        modelId: getEffectiveModelId(config),
        modelFamily: modelProfile.modelFamily,
      });
      return null;
    };

    const attemptJsonMode = async (): Promise<ModelScopeCallResult | null> => {
      const jsonResponse = await request(baseMessages, "json_object");
      if (jsonResponse.ok) {
        const data = (await jsonResponse.json()) as ModelScopeResponse;
        const jsonModeContent = extractContent(data);
        if (jsonModeContent.trim()) {
          return {
            content: jsonModeContent,
            mode: "json_mode",
            streamStage: streamDecision.stage,
            streamReason: streamDecision.reason,
            contentSource: "content",
            finishReason: extractFinishReason(data),
            usage: extractUsage(data),
            proxyTokenMetrics: extractProxyTokenMetrics(jsonResponse),
          };
        }

        const recoveredJson = recoverJsonIfAllowed(data);
        if (recoveredJson) {
          logger.info("llm", `${route} JSON recovered from reasoning_content`, {
            summary_json_recovered_from_reasoning: true,
            modelId: getEffectiveModelId(config),
            modelFamily: modelProfile.modelFamily,
          });
          return {
            content: recoveredJson,
            mode: "json_mode",
            streamStage: streamDecision.stage,
            streamReason: streamDecision.reason,
            contentSource: "reasoning_content",
            finishReason: extractFinishReason(data),
            usage: extractUsage(data),
            proxyTokenMetrics: extractProxyTokenMetrics(jsonResponse),
          };
        }

        logger.warn("llm", `${route} JSON mode returned empty content`, {
          hasReasoningContent: hasReasoningContent(data),
          summary_json_recovered_from_reasoning: false,
          modelId: getEffectiveModelId(config),
          modelFamily: modelProfile.modelFamily,
        });
        return null;
      }

      const jsonErrorPayload = await parseErrorPayload(jsonResponse);
      const shouldFallback =
        [400, 404, 415, 422].includes(jsonResponse.status) ||
        /response_format|json_object|unsupported/i.test(
          jsonErrorPayload.message || jsonErrorPayload.rawText
        );

      if (!shouldFallback) {
        logger.error(
          "llm",
          `${route} JSON request failed: ${jsonResponse.status}`,
          new Error(jsonErrorPayload.rawText || jsonErrorPayload.message)
        );
        throw createLlmRequestError(route, jsonResponse.status, jsonErrorPayload);
      }

      logger.warn("llm", `${route} JSON mode unsupported, fallback to alternate JSON path`, {
        status: jsonResponse.status,
        modelId: getEffectiveModelId(config),
        modelFamily: modelProfile.modelFamily,
      });
      return null;
    };

    const attemptOrder =
      modelProfile.responseFormatStrategy === "prompt_json_first"
        ? [attemptPromptJson, attemptJsonMode]
        : [attemptJsonMode, attemptPromptJson];

    for (const attempt of attemptOrder) {
      const result = await attempt();
      if (result) {
        return result;
      }
    }

    logger.warn("llm", `${route} JSON paths yielded no structured output, fallback to plain_text`, {
      modelId: getEffectiveModelId(config),
      modelFamily: modelProfile.modelFamily,
      responseFormatStrategy: modelProfile.responseFormatStrategy,
    });
  }

  const response = await request(baseMessages);
  if (!response.ok) {
    const errorPayload = await parseErrorPayload(response);
    logger.error(
      "llm",
      `${route} request failed: ${response.status}`,
      new Error(errorPayload.rawText || errorPayload.message)
    );
    throw createLlmRequestError(route, response.status, errorPayload);
  }

  const data = (await response.json()) as ModelScopeResponse;
  return {
    content: extractContent(data),
    mode: "plain_text",
    streamStage: streamDecision.stage,
    streamReason: streamDecision.reason,
    contentSource: "content",
    finishReason: extractFinishReason(data),
    usage: extractUsage(data),
    proxyTokenMetrics: extractProxyTokenMetrics(response),
  };
}

function resolveStreamDecision(
  config: LlmConfig,
  streamRequested: boolean
): StreamDecision {
  const modelProfile = getLlmModelProfile(getEffectiveModelId(config));

  if (!streamRequested) {
    return { stage: "stable_non_stream", reason: "not_requested" };
  }

  if (config.streamMode !== "on") {
    return { stage: "fallback_non_stream", reason: "stream_mode_off" };
  }

  if (config.reasoningPolicy === "off") {
    return { stage: "fallback_non_stream", reason: "reasoning_policy_off" };
  }

  if (modelProfile.streamProfile !== "candidate_reasoning_stream") {
    return { stage: "fallback_non_stream", reason: "model_profile_non_stream" };
  }

  if (!ENABLE_CANDIDATE_REASONING_STREAM_ROLLOUT) {
    return { stage: "candidate_stream", reason: "candidate_profile_gate_closed" };
  }

  return { stage: "candidate_stream", reason: "future_stream_rollout" };
}

function normalizeThinkHandlingPolicy(
  policy: ThinkHandlingPolicy | undefined
): ThinkHandlingPolicy {
  if (policy === "keep_debug" || policy === "keep_raw") {
    return policy;
  }
  return "strip";
}

export function stripThinkBlocks(text: string): string {
  if (!text) return "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function applyThinkPolicy(text: string, policy: ThinkHandlingPolicy): string {
  if (policy === "keep_raw") {
    return text.trim();
  }
  return stripThinkBlocks(text);
}

export function resolveLlmRoute(config: LlmConfig): InferenceRoute {
  return getLlmAccessMode(config) === "demo_proxy" ? "proxy" : "modelscope";
}

export async function callProxyService(
  config: LlmConfig,
  prompt: string,
  options: CallModelScopeOptions = {}
): Promise<ModelScopeCallResult> {
  ensureProxyConfig(config);
  return callProvider(config, prompt, options, "proxy");
}

export async function callModelScope(
  config: LlmConfig,
  prompt: string,
  options: CallModelScopeOptions = {}
): Promise<ModelScopeCallResult> {
  ensureModelScopeConfig(config);
  return callProvider(config, prompt, options, "modelscope");
}

export async function callInference(
  config: LlmConfig,
  prompt: string,
  options: CallModelScopeOptions = {}
): Promise<InferenceCallResult> {
  const route = resolveLlmRoute(config);
  const result =
    route === "proxy"
      ? await callProxyService(config, prompt, options)
      : await callModelScope(config, prompt, options);

  const policy = normalizeThinkHandlingPolicy(config.thinkHandlingPolicy);
  const rawContent = result.content;
  const content = applyThinkPolicy(rawContent, policy);

  if (policy === "keep_debug" && content !== rawContent) {
    logger.info("llm", "Think blocks stripped for user-visible output", {
      route,
      modelId: getEffectiveModelId(config),
    });
  }

  return {
    ...result,
    content: content || rawContent,
    rawContent,
    route,
    streamRequested: options.stream === true,
  };
}

function buildConversationLines(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role = msg.role === "user" ? "User" : "AI";
      return `[${role}] ${msg.content_text}`;
    })
    .join("\n");
}

function buildWeeklyLines(conversations: Conversation[]): string {
  return conversations
    .map((conversation, index) => {
      return `${index + 1}. [${conversation.platform}] ${conversation.title} - ${conversation.snippet}`;
    })
    .join("\n");
}

export function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...truncated...]`;
}

export function sanitizeSummaryText(text: string): string {
  const noThink = stripThinkBlocks(text);
  return noThink
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```[\w-]*\n?/g, "").replace(/```/g, "")
    )
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildSummaryPrompt(messages: Message[], lang: "zh" | "en" = "zh"): string {
  const conversation = buildConversationLines(messages);

  if (lang === "zh") {
    return `请基于以下对话生成中文总结。\n要求：\n1) 输出严格为纯文本，不要使用 Markdown 语法（不要使用 *, #, -, 或代码块）。\n2) 输出 3-6 条简洁句子，每条单独换行。\n3) 聚焦技术决策、调试结论与可执行行动。\n\n对话内容：\n${conversation}`;
  }

  return `Summarize the conversation in plain text.\nRequirements:\n1) No Markdown syntax (no *, #, -, or code fences).\n2) 3-6 concise lines, one sentence per line.\n3) Focus on technical decisions, debugging findings, and action items.\n\nConversation:\n${conversation}`;
}

export function buildWeeklyPrompt(
  conversations: Conversation[],
  lang: "zh" | "en" = "zh"
): string {
  const items = buildWeeklyLines(conversations);

  if (lang === "zh") {
    return `请基于以下会话生成中文周报。\n要求：\n1) 输出严格为纯文本，不要使用 Markdown 语法（不要使用 *, #, -, 或代码块）。\n2) 内容分为主题、关键进展与后续行动。\n3) 每条信息单独换行，保持简洁。\n\n本周会话：\n${items}`;
  }

  return `Write a weekly report in plain text.\nRequirements:\n1) No Markdown syntax (no *, #, -, or code fences).\n2) Cover themes, progress, and next actions.\n3) Keep concise lines.\n\nWeekly conversations:\n${items}`;
}

export function buildWeeklySourceHash(
  conversations: Conversation[],
  rangeStart: number,
  rangeEnd: number
): string {
  const payload = conversations
    .map(
      (conversation) =>
        `${conversation.id}:${getConversationCaptureFreshnessAt(conversation)}`
    )
    .join("|");
  return `${rangeStart}-${rangeEnd}-${payload}`;
}



