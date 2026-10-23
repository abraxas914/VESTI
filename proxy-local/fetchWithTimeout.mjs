export async function fetchWithTimeout(input, init, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Upstream timed out", "TimeoutError")), timeoutMs);
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
    controller.signal.removeEventListener("abort", onAbort);
  }
}
