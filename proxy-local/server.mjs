import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MODELSCOPE_API_KEY = (process.env.MODELSCOPE_API_KEY || "").trim();
const VESTI_SERVICE_TOKEN = (process.env.VESTI_SERVICE_TOKEN || "").trim();
const ALLOWED_ORIGIN_RULES = (process.env.VESTI_ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const CHAT_PRIMARY_MODEL =
  (process.env.VESTI_CHAT_PRIMARY_MODEL || "").trim() ||
  "moonshotai/Kimi-K2.5";
const CHAT_BACKUP_MODEL =
  (process.env.VESTI_CHAT_BACKUP_MODEL || "").trim() || "stepfun-ai/Step-3.5-Flash";
const LEGACY_CHAT_MODELS = new Set([
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
  "Qwen/Qwen3-14B",
]);
// Model allowlist is an opt-in escape hatch, not a default. The client UI
// already curates the model list, and a gateway-side list meant every model
// change needed a redeploy — the old code even silently rewrote unknown
// models to the primary. Empty = pass any requested model through verbatim.
const ALLOWED_CHAT_MODELS = new Set(
  (process.env.VESTI_ALLOWED_CHAT_MODELS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const EMBEDDING_MODEL =
  (process.env.VESTI_EMBEDDING_MODEL || "").trim() || "text-embedding-v2";
const EMBED_BATCH_MAX = Number.parseInt(
  process.env.VESTI_EMBED_BATCH_MAX || "32",
  10
);
const EMBED_TEXT_MAX_CHARS = Number.parseInt(
  process.env.VESTI_EMBED_TEXT_MAX_CHARS || "8000",
  10
);
const UPSTREAM_TIMEOUT_MS = Number.parseInt(
  process.env.VESTI_UPSTREAM_TIMEOUT_MS || "30000",
  10
);
const NOTION_CLIENT_ID = (process.env.NOTION_CLIENT_ID || "").trim();
const NOTION_CLIENT_SECRET = (process.env.NOTION_CLIENT_SECRET || "").trim();
const NOTION_REDIRECT_URI =
  (process.env.NOTION_REDIRECT_URI || "").trim() ||
  `http://127.0.0.1:${PORT}/api/notion/oauth/callback`;
const NOTION_OAUTH_SESSION_TTL_MS = Number.parseInt(
  process.env.NOTION_OAUTH_SESSION_TTL_MS || "300000",
  10
);

const CHAT_UPSTREAM_URL = "https://api-inference.modelscope.cn/v1/chat/completions";
const EMBEDDINGS_UPSTREAM_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";
const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

const ALLOWED_CHAT_ROLES = new Set(["system", "user", "assistant"]);
const notionOAuthStateStore = new Map();
const notionOAuthSessionStore = new Map();

function nowMs() {
  return Date.now();
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

function originMatchesRule(origin, rule) {
  if (rule === "*") return true;
  if (rule === "chrome-extension://*") {
    return origin.startsWith("chrome-extension://");
  }
  if (rule.endsWith("*")) {
    return origin.startsWith(rule.slice(0, -1));
  }
  return origin === rule;
}

function resolveAllowedOrigin(origin) {
  if (!origin) return null;
  for (const rule of ALLOWED_ORIGIN_RULES) {
    if (originMatchesRule(origin, rule)) {
      return rule === "*" ? "*" : origin;
    }
  }
  return null;
}

function setCommonHeaders(res, requestId) {
  res.setHeader("x-request-id", requestId);
  res.setHeader("cache-control", "no-store");
}

function setCorsHeaders(res, origin, allowedOrigin) {
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-vesti-service-token"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "x-request-id, x-proxy-model-used, x-proxy-attempt, x-proxy-requested-max-tokens, x-proxy-effective-max-tokens, x-proxy-max-tokens-limit"
  );
}

function writeJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.end();
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) {
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("upstream_timeout"), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildErrorPayload(code, message, requestId, extras = {}) {
  return {
    error: {
      code,
      message,
      requestId,
      ...extras,
    },
  };
}

/**
 * max_tokens passes through verbatim: the proxy imposes no per-request output
 * cap of its own (the old 1600 clamp silently truncated long structured
 * answers). The field is simply omitted when the client doesn't send one.
 */
function passthroughMaxTokens(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function purgeExpiredNotionOAuthRecords() {
  const now = nowMs();
  for (const [state, record] of notionOAuthStateStore.entries()) {
    if (record.expiresAt <= now) {
      notionOAuthStateStore.delete(state);
    }
  }
  for (const [sessionId, record] of notionOAuthSessionStore.entries()) {
    if (record.expiresAt <= now) {
      notionOAuthSessionStore.delete(sessionId);
    }
  }
}

function isValidExtensionRedirectUri(value) {
  return typeof value === "string" && value.startsWith("chrome-extension://");
}

function buildNotionAuthorizeUrl(state) {
  const url = new URL(NOTION_AUTHORIZE_URL);
  url.searchParams.set("client_id", NOTION_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", NOTION_REDIRECT_URI);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeNotionAuthorizationCode(code, requestId) {
  const basicAuth = Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString("base64");
  const upstream = await fetchWithTimeout(
    NOTION_TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: NOTION_REDIRECT_URI,
      }),
    },
    UPSTREAM_TIMEOUT_MS
  );

  const payload = (await upstream.json().catch(() => null)) || {};
  if (!upstream.ok || typeof payload.access_token !== "string") {
    throw new Error(payload?.message || `NOTION_TOKEN_${upstream.status}`);
  }

  return {
    accessToken: payload.access_token,
    workspaceId: typeof payload.workspace_id === "string" ? payload.workspace_id : "",
    workspaceName: typeof payload.workspace_name === "string" ? payload.workspace_name : "",
    requestId,
  };
}

function getRequestUrl(req) {
  return new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
}

function handleNotionOAuthStart(req, res, requestId) {
  if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET || !NOTION_REDIRECT_URI) {
    writeJson(
      res,
      500,
      buildErrorPayload(
        "NOTION_OAUTH_NOT_CONFIGURED",
        "Notion OAuth is not configured on this proxy.",
        requestId
      )
    );
    return;
  }

  const requestUrl = getRequestUrl(req);
  const extensionRedirectUri = requestUrl.searchParams.get("extension_redirect_uri") || "";
  if (!isValidExtensionRedirectUri(extensionRedirectUri)) {
    writeJson(
      res,
      400,
      buildErrorPayload(
        "INVALID_EXTENSION_REDIRECT",
        "A valid chrome-extension redirect URI is required.",
        requestId
      )
    );
    return;
  }

  const state = randomUUID();
  notionOAuthStateStore.set(state, {
    extensionRedirectUri,
    expiresAt: nowMs() + NOTION_OAUTH_SESSION_TTL_MS,
  });
  redirect(res, buildNotionAuthorizeUrl(state));
}

async function handleNotionOAuthCallback(req, res, requestId) {
  const requestUrl = getRequestUrl(req);
  const state = requestUrl.searchParams.get("state") || "";
  const code = requestUrl.searchParams.get("code") || "";
  const error = requestUrl.searchParams.get("error") || "";
  const errorDescription = requestUrl.searchParams.get("error_description") || "";
  const stateRecord = notionOAuthStateStore.get(state);

  if (!stateRecord) {
    writeJson(
      res,
      400,
      buildErrorPayload("NOTION_STATE_INVALID", "OAuth state is missing or expired.", requestId)
    );
    return;
  }

  notionOAuthStateStore.delete(state);
  const redirectUrl = new URL(stateRecord.extensionRedirectUri);

  if (error) {
    redirectUrl.searchParams.set("error", errorDescription || error);
    redirect(res, redirectUrl.toString());
    return;
  }

  if (!code) {
    redirectUrl.searchParams.set("error", "Missing authorization code.");
    redirect(res, redirectUrl.toString());
    return;
  }

  try {
    const tokenPayload = await exchangeNotionAuthorizationCode(code, requestId);
    const sessionId = randomUUID();
    notionOAuthSessionStore.set(sessionId, {
      ...tokenPayload,
      expiresAt: nowMs() + NOTION_OAUTH_SESSION_TTL_MS,
    });
    redirectUrl.searchParams.set("session", sessionId);
    redirect(res, redirectUrl.toString());
  } catch (oauthError) {
    redirectUrl.searchParams.set(
      "error",
      oauthError instanceof Error ? oauthError.message : "Notion authorization failed."
    );
    redirect(res, redirectUrl.toString());
  }
}

function handleNotionOAuthSession(req, res, requestId) {
  const requestUrl = getRequestUrl(req);
  const segments = trimTrailingSlashes(requestUrl.pathname).split("/");
  const sessionId = segments[segments.length - 1] || "";
  const session = notionOAuthSessionStore.get(sessionId);

  if (!session) {
    writeJson(
      res,
      404,
      buildErrorPayload("NOTION_SESSION_NOT_FOUND", "OAuth session is missing or expired.", requestId)
    );
    return;
  }

  notionOAuthSessionStore.delete(sessionId);
  writeJson(res, 200, {
    accessToken: session.accessToken,
    workspaceId: session.workspaceId,
    workspaceName: session.workspaceName,
  });
}

function sanitizeChatPayload(body) {
  const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
  // Default-open: the requested model passes through verbatim (no silent
  // rewrite to the primary). The env allowlist, when set, clamps explicitly.
  const model = requestedModel || CHAT_PRIMARY_MODEL;
  if (ALLOWED_CHAT_MODELS.size > 0 && !ALLOWED_CHAT_MODELS.has(model)) {
    const error = new Error(`Model "${model}" is not allowed by this proxy.`);
    error.code = "UNSUPPORTED_MODEL";
    throw error;
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            ALLOWED_CHAT_ROLES.has(item.role) &&
            item.content !== undefined
        )
        .map((item) => ({
          role: item.role,
          content: item.content,
        }))
    : [];

  const payload = {
    model,
    temperature:
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? body.temperature
        : 0.3,
    messages,
  };
  const maxTokens = passthroughMaxTokens(body.max_tokens);
  if (maxTokens !== null) payload.max_tokens = maxTokens;

  if (
    body.response_format &&
    typeof body.response_format === "object" &&
    body.response_format.type === "json_object"
  ) {
    payload.response_format = { type: "json_object" };
  }

  if (LEGACY_CHAT_MODELS.has(model)) {
    payload.enable_thinking = false;
  }

  return payload;
}

async function handleChat(req, res, requestId, origin, allowedOrigin) {
  if (!MODELSCOPE_API_KEY) {
    writeJson(
      res,
      500,
      buildErrorPayload(
        "PROXY_API_KEY_MISSING",
        "MODELSCOPE_API_KEY is not configured.",
        requestId
      )
    );
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    writeJson(
      res,
      400,
      buildErrorPayload("INVALID_JSON", "Request body must be valid JSON.", requestId)
    );
    return;
  }

  let payload;
  try {
    payload = sanitizeChatPayload(body);
  } catch (error) {
    writeJson(
      res,
      400,
      buildErrorPayload(
        "UNSUPPORTED_MODEL",
        error instanceof Error ? error.message : "Unsupported model.",
        requestId
      )
    );
    return;
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    writeJson(
      res,
      400,
      buildErrorPayload("INVALID_MESSAGES", "Payload must include messages.", requestId)
    );
    return;
  }

  const startedAt = nowMs();
  const attempts = [
    { model: payload.model, attempt: 1 },
    { model: payload.model === CHAT_PRIMARY_MODEL ? CHAT_BACKUP_MODEL : CHAT_PRIMARY_MODEL, attempt: 2 },
  ];

  let finalStatus = 502;
  let finalBody = "";
  let finalModel = attempts[0].model;
  let finalAttempt = 1;

  for (const step of attempts) {
    const chatPayload = { ...payload, model: step.model };

    try {
      const upstream = await fetchWithTimeout(
        CHAT_UPSTREAM_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${MODELSCOPE_API_KEY}`,
          },
          body: JSON.stringify(chatPayload),
        },
        UPSTREAM_TIMEOUT_MS
      );

      finalStatus = upstream.status;
      finalBody = await upstream.text();
      finalModel = step.model;
      finalAttempt = step.attempt;

      if (!shouldRetryStatus(upstream.status) || step.attempt === 2) {
        break;
      }
    } catch (error) {
      finalStatus = 502;
      finalBody = JSON.stringify(
        buildErrorPayload(
          "UPSTREAM_NETWORK_ERROR",
          "Failed to reach chat upstream.",
          requestId,
          { cause: String(error) }
        )
      );
      finalModel = step.model;
      finalAttempt = step.attempt;

      if (step.attempt === 2) {
        break;
      }
    }
  }

  res.statusCode = finalStatus;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-proxy-model-used", finalModel);
  res.setHeader("x-proxy-attempt", String(finalAttempt));
  res.setHeader("x-proxy-requested-max-tokens", String(body?.max_tokens ?? ""));
  res.setHeader("x-proxy-effective-max-tokens", String(payload.max_tokens ?? ""));
  // No proxy-side max_tokens limit: requested values pass through verbatim.
  setCommonHeaders(res, requestId);
  setCorsHeaders(res, origin, allowedOrigin);
  res.end(finalBody);

  console.info(
    JSON.stringify({
      route: "/api/chat",
      requestId,
      origin: origin || null,
      upstreamStatus: finalStatus,
      model: finalModel,
      attempt: finalAttempt,
      latencyMs: nowMs() - startedAt,
    })
  );
}

function normalizeEmbeddingInput(body) {
  if (Array.isArray(body.input)) {
    return body.input.filter((item) => typeof item === "string").map((item) => item.trim());
  }
  if (typeof body.input === "string") {
    return [body.input.trim()];
  }
  return [];
}

async function handleEmbeddings(req, res, requestId, origin, allowedOrigin) {
  if (!MODELSCOPE_API_KEY) {
    writeJson(
      res,
      500,
      buildErrorPayload(
        "PROXY_API_KEY_MISSING",
        "MODELSCOPE_API_KEY is not configured.",
        requestId
      )
    );
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    writeJson(
      res,
      400,
      buildErrorPayload("INVALID_JSON", "Request body must be valid JSON.", requestId)
    );
    return;
  }

  const input = normalizeEmbeddingInput(body).filter((text) => text.length > 0);
  if (input.length === 0) {
    writeJson(
      res,
      400,
      buildErrorPayload("INVALID_INPUT", "Embedding input cannot be empty.", requestId)
    );
    return;
  }
  if (input.length > EMBED_BATCH_MAX) {
    writeJson(
      res,
      413,
      buildErrorPayload(
        "BATCH_TOO_LARGE",
        `Batch size exceeds ${EMBED_BATCH_MAX}.`,
        requestId
      )
    );
    return;
  }
  if (input.some((text) => text.length > EMBED_TEXT_MAX_CHARS)) {
    writeJson(
      res,
      422,
      buildErrorPayload(
        "TEXT_TOO_LONG",
        `Single text exceeds ${EMBED_TEXT_MAX_CHARS} characters.`,
        requestId
      )
    );
    return;
  }

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : EMBEDDING_MODEL;

  const payload = {
    model,
    input,
    encoding_format: "float",
  };

  const startedAt = nowMs();
  try {
    const upstream = await fetchWithTimeout(
      EMBEDDINGS_UPSTREAM_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MODELSCOPE_API_KEY}`,
        },
        body: JSON.stringify(payload),
      },
      UPSTREAM_TIMEOUT_MS
    );

    const responseText = await upstream.text();
    setCommonHeaders(res, requestId);
    setCorsHeaders(res, origin, allowedOrigin);

    if (!upstream.ok) {
      const detail = responseText.slice(0, 1200);
      writeJson(
        res,
        upstream.status,
        buildErrorPayload(
          "UPSTREAM_EMBEDDING_ERROR",
          "Embedding upstream request failed.",
          requestId,
          {
            upstreamStatus: upstream.status,
            detail,
          }
        )
      );
    } else {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(responseText);
    }

    console.info(
      JSON.stringify({
        route: "/api/embeddings",
        requestId,
        origin: origin || null,
        batchSize: input.length,
        model,
        upstreamStatus: upstream.status,
        latencyMs: nowMs() - startedAt,
      })
    );
  } catch (error) {
    setCommonHeaders(res, requestId);
    setCorsHeaders(res, origin, allowedOrigin);
    writeJson(
      res,
      502,
      buildErrorPayload(
        "UPSTREAM_NETWORK_ERROR",
        "Failed to reach embeddings upstream.",
        requestId,
        { cause: String(error) }
      )
    );
  }
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const method = req.method || "GET";
  const path = trimTrailingSlashes((req.url || "").split("?")[0] || "");
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowedOrigin = resolveAllowedOrigin(origin);
  purgeExpiredNotionOAuthRecords();

  setCommonHeaders(res, requestId);
  setCorsHeaders(res, origin, allowedOrigin);

  if (origin && !allowedOrigin) {
    writeJson(
      res,
      403,
      buildErrorPayload("ORIGIN_FORBIDDEN", "Origin is not allowed.", requestId)
    );
    return;
  }

  if (
    method === "OPTIONS" &&
    (path === "/api/chat" ||
      path === "/api/embeddings" ||
      path.startsWith("/api/notion/oauth"))
  ) {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET" && path === "/api/notion/oauth/start") {
    handleNotionOAuthStart(req, res, requestId);
    return;
  }

  if (method === "GET" && path === "/api/notion/oauth/callback") {
    await handleNotionOAuthCallback(req, res, requestId);
    return;
  }

  if (method === "GET" && path.startsWith("/api/notion/oauth/session/")) {
    handleNotionOAuthSession(req, res, requestId);
    return;
  }

  if (method !== "POST") {
    writeJson(
      res,
      405,
      buildErrorPayload(
        "METHOD_NOT_ALLOWED",
        "Only GET, POST, and OPTIONS are supported.",
        requestId
      )
    );
    return;
  }

  if (!VESTI_SERVICE_TOKEN) {
    writeJson(
      res,
      500,
      buildErrorPayload(
        "SERVICE_TOKEN_NOT_CONFIGURED",
        "VESTI_SERVICE_TOKEN is not configured.",
        requestId
      )
    );
    return;
  }

  const providedToken = (req.headers["x-vesti-service-token"] || "").toString().trim();
  if (!providedToken || providedToken !== VESTI_SERVICE_TOKEN) {
    writeJson(
      res,
      401,
      buildErrorPayload("UNAUTHORIZED", "Missing or invalid service token.", requestId)
    );
    return;
  }

  if (path === "/api/chat") {
    await handleChat(req, res, requestId, origin, allowedOrigin);
    return;
  }

  if (path === "/api/embeddings") {
    await handleEmbeddings(req, res, requestId, origin, allowedOrigin);
    return;
  }

  writeJson(
    res,
    404,
    buildErrorPayload("NOT_FOUND", "Route not found.", requestId)
  );
});

server.listen(PORT, () => {
  console.info(
    `[vesti-local-proxy] listening on http://127.0.0.1:${PORT} (allowed origins: ${ALLOWED_ORIGIN_RULES.join(", ") || "none"})`
  );
});
