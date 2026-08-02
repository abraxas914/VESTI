import type {
  LlmAccessMode,
  LlmConfig,
  ThinkHandlingPolicy,
} from "../types";
import {
  KIMI_K2_5_MODEL,
  LEGACY_DS14_MODEL,
  LEGACY_QWEN14_MODEL,
  STEP_3_5_FLASH_MODEL,
} from "./llmModelProfile";

// Legacy ModelScope endpoints (kept for BYOK users still on ModelScope)
export const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1/";

// Demo proxy routing. The legacy Vercel deployment remains a transport-level
// fallback only; model fallback is owned by the primary gateway.
export const PRIMARY_PROXY_BASE_URL = "https://api.ccvg1218.online/api";
export const FALLBACK_PROXY_BASE_URL = "https://vesti-gate.vercel.app/api";
export const DEFAULT_PROXY_BASE_URL = PRIMARY_PROXY_BASE_URL;
export const DEFAULT_PROXY_URL = `${DEFAULT_PROXY_BASE_URL}/chat`;
export const DEFAULT_PROXY_EMBEDDINGS_URL = `${DEFAULT_PROXY_BASE_URL}/embeddings`;

// 默认代理 service token，由 Vesti 网关校验。
// 用户无需手动填写，Demo proxy 模式开箱即用。
// token 名称保留 "kcq" 前缀仅用于历史兼容，实际对应阿里云百炼上游。
export const DEFAULT_PROXY_SERVICE_TOKEN = "vesti-kcq-default-d850d4dcd610a0e2e919eb610f42066faff1e1c57c0c047c";

// Default BYOK endpoint: 阿里云百炼（DashScope），OpenAI-compatible
export const DEFAULT_BYOK_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/";

// Default chat models for demo proxy / BYOK fallback
export const DEFAULT_STABLE_MODEL = "qwen-plus";
export const DEFAULT_BACKUP_MODEL = "qwen-turbo";

// Kept for backward compatibility with older stored configs and legacy BYOK users
export const LEGACY_KIMI_K2_5_MODEL = KIMI_K2_5_MODEL;
export const LEGACY_STEP_3_5_FLASH_MODEL = STEP_3_5_FLASH_MODEL;

// 0 = uncapped: no max_tokens is sent and the model's own default applies.
// The old 1600 default/cap silently truncated long structured answers.
export const DEFAULT_MAX_TOKENS = 0;
const LEGACY_DEFAULT_MAX_TOKENS = 800;
const LEGACY_CAPPED_DEFAULT_MAX_TOKENS = 1600;
const MAX_TOKENS_CAP = 16384;

// BYOK model whitelist: recommended models for the unified AI gateway.
// We keep legacy ModelScope / Moonshot / StepFun IDs so existing BYOK users don't break.
export const BYOK_MODEL_WHITELIST = [
  DEFAULT_STABLE_MODEL,
  DEFAULT_BACKUP_MODEL,
  "qwen-max",
  "qwen-coder-plus",
  "deepseek-v3",
  "deepseek-r1",
  LEGACY_DS14_MODEL,
  LEGACY_QWEN14_MODEL,
  "deepseek-ai/DeepSeek-V3",
  "deepseek-ai/DeepSeek-R1",
  "Qwen/Qwen3-8B",
  "Qwen/Qwen3-32B",
  "deepseek-ai/DeepSeek-V3.2",
  LEGACY_KIMI_K2_5_MODEL,
  LEGACY_STEP_3_5_FLASH_MODEL,
] as const;

// Reserved for future export-compression routing enablement after real API validation.
export const FUTURE_MODELSCOPE_EXPORT_MODEL_CANDIDATES: readonly string[] = [];
export const FUTURE_MOONSHOT_DIRECT_EXPORT_MODEL_CANDIDATES = [
  LEGACY_KIMI_K2_5_MODEL,
] as const;

export type ProxyRoute = "chat" | "embeddings";

const BYOK_MODEL_SET = new Set<string>(BYOK_MODEL_WHITELIST);

function normalizeMode(mode: LlmAccessMode | undefined): LlmAccessMode {
  return mode === "custom_byok" ? "custom_byok" : "demo_proxy";
}

export function sanitizeByokModelId(modelId: string | null | undefined): string {
  const candidate = (modelId || "").trim();
  if (!candidate) return DEFAULT_STABLE_MODEL;
  return BYOK_MODEL_SET.has(candidate) ? candidate : DEFAULT_STABLE_MODEL;
}

function normalizeThinkPolicy(
  policy: ThinkHandlingPolicy | undefined
): ThinkHandlingPolicy {
  if (policy === "keep_debug" || policy === "keep_raw") {
    return policy;
  }
  return "strip";
}

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeProxyBaseCandidate(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/(chat|embeddings)$/i, "");
    return trimSlashes(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return trimSlashes(raw).replace(/\/(chat|embeddings)$/i, "");
  }
}

function normalizeByokBaseUrl(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return DEFAULT_BYOK_BASE_URL;
  return trimSlashes(raw) + "/";
}

function normalizeMaxTokens(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_TOKENS;
  }

  const normalized = Math.max(0, Math.min(Math.floor(value), MAX_TOKENS_CAP));
  // Legacy stored defaults (800, then 1600) migrate to 0 (uncapped) — they
  // were product defaults, not user choices. Other explicit values survive.
  if (normalized === LEGACY_DEFAULT_MAX_TOKENS || normalized === LEGACY_CAPPED_DEFAULT_MAX_TOKENS) {
    return DEFAULT_MAX_TOKENS;
  }

  return normalized;
}

function resolveProxyBaseUrl(
  settings: Pick<LlmConfig, "proxyBaseUrl" | "proxyUrl">
): string {
  const explicit = normalizeProxyBaseCandidate(settings.proxyBaseUrl);
  if (explicit) {
    // Migrate the previously persisted built-in endpoint. The old deployment
    // is still reached automatically when the new gateway has a retryable
    // transport failure.
    return explicit === FALLBACK_PROXY_BASE_URL
      ? PRIMARY_PROXY_BASE_URL
      : explicit;
  }

  const legacy = normalizeProxyBaseCandidate(settings.proxyUrl);
  if (legacy) {
    return legacy === FALLBACK_PROXY_BASE_URL
      ? PRIMARY_PROXY_BASE_URL
      : legacy;
  }

  return DEFAULT_PROXY_BASE_URL;
}

export function buildProxyRouteUrl(baseUrl: string, route: ProxyRoute): string {
  return `${trimSlashes(baseUrl)}/${route}`;
}

export function getProxyBaseUrl(settings: Pick<LlmConfig, "proxyBaseUrl" | "proxyUrl">): string {
  return resolveProxyBaseUrl(settings);
}

export function getProxyRouteUrl(
  settings: Pick<LlmConfig, "proxyBaseUrl" | "proxyUrl">,
  route: ProxyRoute
): string {
  const baseUrl = getProxyBaseUrl(settings);
  return buildProxyRouteUrl(baseUrl, route);
}

export function needsProxySettingsBackfill(
  settings: Pick<LlmConfig, "proxyBaseUrl" | "proxyUrl">
): boolean {
  const normalizedBase = getProxyBaseUrl(settings);
  const normalizedChat = getProxyRouteUrl(settings, "chat");
  const rawBase = (settings.proxyBaseUrl || "").trim();
  const rawChat = (settings.proxyUrl || "").trim();

  return rawBase !== normalizedBase || rawChat !== normalizedChat;
}

export function buildDefaultLlmSettings(now = Date.now()): LlmConfig {
  return {
    provider: "openai_compatible",
    baseUrl: DEFAULT_BYOK_BASE_URL,
    apiKey: "",
    modelId: DEFAULT_STABLE_MODEL,
    temperature: 0.3,
    maxTokens: DEFAULT_MAX_TOKENS,
    updatedAt: now,
    mode: "demo_proxy",
    proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
    proxyUrl: DEFAULT_PROXY_URL,
    proxyServiceToken: DEFAULT_PROXY_SERVICE_TOKEN,
    gatewayLock: "openai_compatible",
    customModelId: DEFAULT_STABLE_MODEL,
    streamMode: "off",
    reasoningPolicy: "off",
    capabilitySource: "model_id_heuristic",
    thinkHandlingPolicy: "strip",
  };
}

export function normalizeLlmSettings(
  settings: LlmConfig | null | undefined
): LlmConfig {
  const fallback = buildDefaultLlmSettings();
  if (!settings) {
    return fallback;
  }

  const mode = normalizeMode(settings.mode);
  const modelId = (settings.modelId || "").trim() || DEFAULT_STABLE_MODEL;
  const byokModelId = sanitizeByokModelId(settings.customModelId || modelId);
  const proxyBaseUrl = getProxyBaseUrl(settings);
  const proxyUrl = getProxyRouteUrl({ proxyBaseUrl, proxyUrl: settings.proxyUrl }, "chat");
  const proxyServiceToken = (settings.proxyServiceToken || "").trim();
  const maxTokens = normalizeMaxTokens(settings.maxTokens);

  if (mode === "demo_proxy") {
    return {
      ...fallback,
      ...settings,
      provider: "openai_compatible",
      baseUrl: DEFAULT_BYOK_BASE_URL,
      modelId: DEFAULT_STABLE_MODEL,
      maxTokens,
      mode,
      proxyBaseUrl,
      proxyUrl,
      proxyServiceToken,
      gatewayLock: "openai_compatible",
      customModelId: DEFAULT_STABLE_MODEL,
      streamMode: settings.streamMode === "on" ? "on" : "off",
      reasoningPolicy:
        settings.reasoningPolicy === "auto" || settings.reasoningPolicy === "force"
          ? settings.reasoningPolicy
          : "off",
      capabilitySource:
        settings.capabilitySource === "provider_catalog"
          ? "provider_catalog"
          : "model_id_heuristic",
      thinkHandlingPolicy: normalizeThinkPolicy(settings.thinkHandlingPolicy),
    };
  }

  return {
    ...fallback,
    ...settings,
    provider: "openai_compatible",
    baseUrl: normalizeByokBaseUrl(settings.baseUrl),
    modelId: byokModelId,
    maxTokens,
    mode,
    proxyBaseUrl,
    proxyUrl,
    proxyServiceToken,
    gatewayLock: "openai_compatible",
    customModelId: byokModelId,
    streamMode: settings.streamMode === "on" ? "on" : "off",
    reasoningPolicy:
      settings.reasoningPolicy === "auto" || settings.reasoningPolicy === "force"
        ? settings.reasoningPolicy
        : "off",
    capabilitySource:
      settings.capabilitySource === "provider_catalog"
        ? "provider_catalog"
        : "model_id_heuristic",
    thinkHandlingPolicy: normalizeThinkPolicy(settings.thinkHandlingPolicy),
  };
}

export function getLlmAccessMode(settings: LlmConfig): LlmAccessMode {
  return normalizeMode(settings.mode);
}

export function getEffectiveModelId(settings: LlmConfig): string {
  if (normalizeMode(settings.mode) === "custom_byok") {
    return sanitizeByokModelId(settings.customModelId || settings.modelId);
  }

  return (settings.modelId || DEFAULT_STABLE_MODEL).trim() || DEFAULT_STABLE_MODEL;
}
