import {
  FALLBACK_PROXY_BASE_URL,
  buildProxyRouteUrl,
  type ProxyRoute,
} from "./llmConfig";

export const PROXY_TOTAL_TIMEOUT_MS = 90_000;
export const PROXY_PRIMARY_ATTEMPT_TIMEOUT_MS = 60_000;

export interface ProxyResponseMetadata {
  requestId?: string;
  providerUsed?: string;
  modelUsed?: string;
  attempt: number;
  fallbackReason?: string;
  endpoint: string;
}

export interface DemoProxyRequest {
  primaryBaseUrl: string;
  route: ProxyRoute;
  serviceToken?: string;
  body: string;
  signal?: AbortSignal;
  totalTimeoutMs?: number;
  primaryAttemptTimeoutMs?: number;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const responseMetadata = new WeakMap<Response, ProxyResponseMetadata>();

export function getProxyResponseMetadata(response: Response): ProxyResponseMetadata | null {
  return responseMetadata.get(response) ?? null;
}

function retryReasonForStatus(status: number): string | null {
  if (status === 429) return "http_429";
  if (status >= 500 && status <= 599) return `http_${status}`;
  return null;
}

function metadataFromResponse(
  response: Response,
  attempt: number,
  endpoint: string,
  clientFallbackReason?: string,
): ProxyResponseMetadata {
  const headerAttempt = Number(response.headers.get("x-proxy-attempt"));
  return {
    requestId: response.headers.get("x-request-id") || undefined,
    providerUsed: response.headers.get("x-proxy-provider-used") || undefined,
    modelUsed: response.headers.get("x-proxy-model-used") || undefined,
    attempt: Number.isFinite(headerAttempt) && headerAttempt > 0 ? headerAttempt : attempt,
    fallbackReason:
      response.headers.get("x-proxy-fallback-reason") || clientFallbackReason || undefined,
    endpoint,
  };
}

async function fetchAttempt(
  fetchImpl: FetchLike,
  endpoint: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  if (externalSignal?.aborted) {
    throw externalSignal.reason ?? new DOMException("Request aborted", "AbortError");
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Proxy request timed out", "TimeoutError")), timeoutMs);
  try {
    return await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Sends a Demo request to the configured primary gateway and retries the
 * legacy gateway only for network/timeout errors, HTTP 429, or HTTP 5xx.
 * The exact serialized body is reused and both attempts share one deadline.
 */
export async function fetchDemoProxy(
  request: DemoProxyRequest,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const startedAt = Date.now();
  const totalTimeoutMs = request.totalTimeoutMs ?? PROXY_TOTAL_TIMEOUT_MS;
  const primaryTimeoutMs = Math.min(
    request.primaryAttemptTimeoutMs ?? PROXY_PRIMARY_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs,
  );
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.serviceToken?.trim()) {
    headers["x-vesti-service-token"] = request.serviceToken.trim();
  }

  const primaryEndpoint = buildProxyRouteUrl(request.primaryBaseUrl, request.route);
  const fallbackEndpoint = buildProxyRouteUrl(FALLBACK_PROXY_BASE_URL, request.route);
  const canFallback = primaryEndpoint !== fallbackEndpoint;
  let fallbackReason: string | undefined;

  try {
    const primary = await fetchAttempt(
      fetchImpl,
      primaryEndpoint,
      headers,
      request.body,
      primaryTimeoutMs,
      request.signal,
    );
    const retryReason = retryReasonForStatus(primary.status);
    if (!retryReason || !canFallback) {
      responseMetadata.set(primary, metadataFromResponse(primary, 1, primaryEndpoint));
      return primary;
    }
    fallbackReason = retryReason;
    void primary.body?.cancel().catch(() => undefined);
  } catch (error) {
    if (request.signal?.aborted) throw error;
    if (!canFallback) throw error;
    fallbackReason = error instanceof DOMException && error.name === "TimeoutError"
      ? "primary_timeout"
      : "primary_network_error";
  }

  const elapsedMs = Date.now() - startedAt;
  const remainingMs = totalTimeoutMs - elapsedMs;
  if (remainingMs <= 0) {
    throw new DOMException("Proxy request timed out", "TimeoutError");
  }

  const fallback = await fetchAttempt(
    fetchImpl,
    fallbackEndpoint,
    headers,
    request.body,
    remainingMs,
    request.signal,
  );
  responseMetadata.set(
    fallback,
    metadataFromResponse(fallback, 2, fallbackEndpoint, fallbackReason),
  );
  return fallback;
}
