import type { RequestMessage, ResponseMessage, ResponseDataMap } from "./protocol";

const DEFAULT_TIMEOUT_MS = 4000;

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export async function sendMessageWithTimeout<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  onTimeout?: () => void | Promise<void>
): Promise<ResponseMessage<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        void onTimeout?.();
      } finally {
        reject(new RequestTimeoutError(timeoutMs));
      }
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(message, (response: ResponseMessage<T>) => {
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export async function sendRequest<T extends keyof ResponseDataMap>(
  message: RequestMessage,
  timeoutMs?: number,
  onTimeout?: () => void | Promise<void>
): Promise<ResponseDataMap[T]> {
  const response = await sendMessageWithTimeout<T>(
    message,
    timeoutMs,
    onTimeout
  );
  if (!response.ok) {
    const failure = response as Extract<ResponseMessage<T>, { ok: false }>;
    throw new Error(failure.error || "Request failed");
  }
  return response.data;
}
