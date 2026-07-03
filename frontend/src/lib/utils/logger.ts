type LogScope =
  | "observer"
  | "parser"
  | "capture"
  | "db"
  | "offscreen"
  | "background"
  | "content"
  | "service"
  | "llm"
  | "vectorize";

const DEBUG = true;
const LOG_PREFIX = "\u{1F680} [Vesti]";
const STYLE_PREFIX = "color: #00d2ff; font-weight: 700;";
const STYLE_SCOPE = "color: #8a8a8a; font-weight: 600;";
const STYLE_MSG = "color: #222;";
const STYLE_SUCCESS = "color: #1f9d55; font-weight: 700;";
const STYLE_WARN = "color: #b7791f; font-weight: 700;";
const STYLE_ERROR = "color: #c53030; font-weight: 700;";

function format(scope: LogScope, message: string) {
  return `%c${LOG_PREFIX} %c[${scope}] %c${message}`;
}

export const logger = {
  /**
   * Low-signal observability output (parser heuristics, perf-mode switches, etc.).
   *
   * Routed through `console.debug` on purpose: Chrome's `chrome://extensions`
   * "Errors" panel collects `console.warn`/`console.error` from extension
   * contexts, but NOT `console.debug`. Diagnostic heuristics such as
   * "parser captured only one role" are expected during normal use (e.g. a
   * brand-new chat with only the first user turn) and must never surface there
   * as if the extension were broken. Use `warn`/`error` only for actionable
   * failures the user or a maintainer should act on.
   */
  debug(scope: LogScope, message: string, data?: unknown) {
    if (!DEBUG) return;
    if (data !== undefined) {
      console.debug(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_MSG, data);
    } else {
      console.debug(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_MSG);
    }
  },
  info(scope: LogScope, message: string, data?: unknown) {
    if (!DEBUG) return;
    if (data !== undefined) {
      console.log(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_MSG, data);
    } else {
      console.log(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_MSG);
    }
  },
  success(scope: LogScope, message: string, data?: unknown) {
    if (!DEBUG) return;
    if (data !== undefined) {
      console.log(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_SUCCESS, data);
    } else {
      console.log(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_SUCCESS);
    }
  },
  warn(scope: LogScope, message: string, data?: unknown) {
    if (!DEBUG) return;
    if (data !== undefined) {
      console.warn(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_WARN, data);
    } else {
      console.warn(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_WARN);
    }
  },
  error(scope: LogScope, message: string, error: Error) {
    console.error(format(scope, message), STYLE_PREFIX, STYLE_SCOPE, STYLE_ERROR, error);
  },
  group(label: string, fn: () => void) {
    if (!DEBUG) return;
    console.groupCollapsed(`%c${LOG_PREFIX} %c${label}`, STYLE_PREFIX, STYLE_SCOPE);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  },
};
