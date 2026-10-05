type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Buffer the complete response under one deadline before exposing it. */
export async function fetchBufferedWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  if (externalSignal?.aborted) throw externalSignal.reason;
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    const complete = async () => {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (!response.body) return response;
      const body = await response.arrayBuffer();
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    return await Promise.race([complete(), aborted]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
