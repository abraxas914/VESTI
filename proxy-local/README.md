# Vesti Local Proxy (v2.0)

Local proxy for Vesti demo mode with two routes:

- `POST /api/chat`
- `POST /api/embeddings`
- `GET /api/notion/oauth/start`
- `GET /api/notion/oauth/callback`
- `GET /api/notion/oauth/session/:sessionId`

Both routes enforce:

- origin allowlist (`VESTI_ALLOWED_ORIGINS`)
- service token (`x-vesti-service-token`)

## Quick Start

1. Copy `.env.example` to `.env` and fill:
   - `MODELSCOPE_API_KEY`
   - `VESTI_SERVICE_TOKEN`
   - `NOTION_CLIENT_ID`
   - `NOTION_CLIENT_SECRET`
2. Start server:

```powershell
cd proxy-local
$env:MODELSCOPE_API_KEY="..."
$env:VESTI_SERVICE_TOKEN="..."
$env:VESTI_ALLOWED_ORIGINS="http://localhost:5173,chrome-extension://*"
pnpm run dev
```

Default base URL is:

- `http://127.0.0.1:3000/api`

Use this value as Vesti `proxyBaseUrl`.

## Frontend Mapping

- chat route: `${proxyBaseUrl}/chat`
- embeddings route: `${proxyBaseUrl}/embeddings`
- notion oauth start route: `http://127.0.0.1:3000/api/notion/oauth/start`

Set `proxyServiceToken` in Vesti settings to match `VESTI_SERVICE_TOKEN`.

## Notion OAuth Notes

- Register `NOTION_REDIRECT_URI` in your Notion public integration settings.
- `extension_redirect_uri` is supplied by `chrome.identity.getRedirectURL()` (`https://<extension-id>.chromiumapp.org/<path>`). Valid `chrome-extension://<extension-id>/<path>` callbacks remain supported; arbitrary web callbacks are rejected.
- `/api/notion/oauth/session/:sessionId` returns the exchanged token once, then expires it.

## Notes

- `/api/chat` now ships with the Kimi/Step stable line:
  - primary: `moonshotai/Kimi-K2.5`
  - backup: `stepfun-ai/Step-3.5-Flash`
  - retry only on network/timeout/429/5xx
  - default upstream timeout: `30000ms`
  - legacy DS/Qwen models remain allowed, but only legacy requests force `enable_thinking=false`
- `/api/embeddings` forwards to DashScope OpenAI-compatible embeddings endpoint.
- logs include `requestId`, route, model, upstream status, and latency.
