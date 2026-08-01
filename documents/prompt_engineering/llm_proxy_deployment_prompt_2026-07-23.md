# Vesti LLM 代理部署审计与执行 Prompt

审计日期：2026-07-23

这份文档可直接交给负责 `vesti-gate` / LLM 代理项目的 agent。不要把本文中的仓库路径理解成代理项目一定存在于当前仓库；当前工作区没有已部署 `vesti-gate` 的源码，只有客户端和旧的 `proxy-local` 参考实现。

## 一、当前状态（已从代码确认）

### 客户端想要的新链路

- 浏览器扩展默认 Demo 网关：`https://vesti-gate.vercel.app/api`
- Chat：`POST /api/chat`
- Embeddings：`POST /api/embeddings`
- 默认 Chat 模型：`qwen-plus`
- UI 展示的备用模型：`qwen-turbo`
- 默认 BYOK 上游：`https://dashscope.aliyuncs.com/compatible-mode/v1/`
- 默认输出参数：`temperature=0.3`、`max_tokens=1600`、非流式
- Demo 请求携带 `x-vesti-service-token`

对应代码：

- `frontend/src/lib/services/llmConfig.ts`
- `frontend/src/lib/services/llmService.ts`
- `frontend/src/lib/services/embeddingService.ts`
- `frontend/src/sidepanel/pages/SettingsPage.tsx`
- 桌面端：`../VESTI-APP/src/main/settingsService.ts`、`agentService.ts`、`embeddingService.ts`

### 旧链路

仓库中的 `proxy-local/server.mjs` 仍是旧实现：

- Chat 上游：ModelScope `https://api-inference.modelscope.cn/v1/chat/completions`
- 主模型：`moonshotai/Kimi-K2.5`
- 备用模型：`stepfun-ai/Step-3.5-Flash`
- Embeddings 上游：DashScope `/compatible-mode/v1/embeddings`
- 只在网络错误、超时、429、5xx 时重试一次

### 关键不一致和风险

1. 当前工作区没有 `vesti-gate` 的 Vercel 代理源码。2026-07-09 的提交只修改了客户端配置，并把本地代理项目目录加入忽略清单；不能把 `proxy-local/server.mjs` 当作已部署线上实现。
2. `proxy-local/server.mjs` 的 Chat 白名单不含 `qwen-plus` / `qwen-turbo`。客户端即使发送 `qwen-plus`，旧代理也会静默改成 Kimi 主模型，所以“界面显示 qwen-plus”不等于“实际上调用了 qwen-plus”。
3. `DEFAULT_BACKUP_MODEL=qwen-turbo` 目前主要用于 UI 展示；客户端不会自己在 `qwen-plus` 失败后调用 `qwen-turbo`。真正的主备切换必须由代理实现。
4. 浏览器扩展 manifest 当前只声明了 `https://vesti-proxy.vercel.app/*`，没有 `https://vesti-gate.vercel.app/*`。即使新网关部署正确，扩展也可能因 host permission 无法访问。代理部署完成后必须同步客户端权限并重新打包验证。
5. Demo service token 被编译进浏览器扩展和桌面端，它只能作为简单的滥用门槛，不能视为秘密或用户身份认证。生产代理仍需要服务端限流、额度、请求大小限制和日志脱敏。
6. 浏览器端 LLM `fetch` 没有显式超时；超时预算必须由网关可靠兜住。桌面端总请求超时为 90 秒。
7. 扩展的 embedding 当前无论 Demo/BYOK 都走代理；新网关不能只部署 Chat。
8. 桌面端默认 embedding 模型字符串是 `text-embedding-3-small`，但 Demo 网关上游是 DashScope。网关应对白名单外的 embedding 模型明确报错或映射到服务端配置模型，不能把不兼容模型原样转发。
9. `text-embedding-v2` 为 1536 维；官方当前更推荐 `text-embedding-v4`，其默认维度为 1024。不能在没有向量版本字段和全量重建索引的情况下原地切换，否则历史向量将与新向量维度/空间不兼容。
10. 旧 RFC 仍描述 Kimi/Step 为主链路，已落后于当前客户端代码，不应作为部署真相。

## 二、给部署 Agent 的执行 Prompt

你现在负责部署或改造 Vesti 的独立 LLM 网关项目。请先检查代理项目的现有源码、Vercel 配置和环境变量，再实施。不要只给方案；需要完成代码、测试、部署验证和回滚说明。

### 目标

把新的 DashScope OpenAI-compatible 接口设为主上游，把原 ModelScope 接口降级为跨供应商备用上游，同时保持现有客户端契约不变：

- `POST /api/chat`
- `POST /api/embeddings`
- `OPTIONS` 预检
- `x-vesti-service-token`
- OpenAI Chat Completions / Embeddings 风格请求与响应

默认建议链：

1. 主上游：DashScope，模型 `qwen-plus`
2. 跨供应商备用：ModelScope，模型默认为旧链路主模型 `moonshotai/Kimi-K2.5`

`qwen-turbo` 是同一 DashScope 供应商内的低成本候选，不是跨供应商容灾。请把它做成可配置的同供应商 secondary，但默认是否启用必须由环境变量明确控制。不要在代码、UI 和运行时分别维护三套不一致的“备用模型”定义。若最终启用三段链，顺序、最大尝试次数和最坏延迟必须在交付说明中写清楚。

### 必须使用的服务端配置

不要硬编码密钥。至少支持以下环境变量（名称可兼容旧名称，但需提供映射说明）：

```text
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VESTI_CHAT_PRIMARY_MODEL=qwen-plus
VESTI_CHAT_PRIMARY_SECONDARY_MODEL=qwen-turbo
VESTI_ENABLE_PRIMARY_SECONDARY=false

MODELSCOPE_API_KEY=
MODELSCOPE_BASE_URL=https://api-inference.modelscope.cn/v1
VESTI_CHAT_FALLBACK_MODEL=moonshotai/Kimi-K2.5

VESTI_EMBEDDING_MODEL=text-embedding-v2
VESTI_SERVICE_TOKEN=
VESTI_ALLOWED_ORIGINS=
VESTI_UPSTREAM_TIMEOUT_MS=
VESTI_TOTAL_TIMEOUT_MS=
VESTI_CHAT_MAX_TOKENS=1600
VESTI_MAX_BODY_BYTES=
VESTI_RATE_LIMIT_PER_MINUTE=
```

兼容期内，`VESTI_SERVICE_TOKEN` 必须与已发布客户端匹配，但不要在仓库、日志或交付文档中打印真实值。要明确说明：公开客户端内的静态 token 不是强认证；如需轮换，必须先设计双 token 过渡并发布新客户端。

### `/api/chat` 行为

1. 接收 `model`、`messages`、`temperature`、`max_tokens`、可选 `response_format`，仅允许 `system | user | assistant`。
2. Demo 路由的实际模型由服务端策略控制。对未知模型不要静默改写后毫无提示；应返回 400，或在响应头/日志中明确记录模型映射。
3. 默认第一次调用 DashScope：
   - `POST {DASHSCOPE_BASE_URL}/chat/completions`
   - `Authorization: Bearer ${DASHSCOPE_API_KEY}`
   - 默认模型 `qwen-plus`
4. 仅在以下可恢复错误触发备用：网络异常、上游超时、HTTP 429、HTTP 5xx。
5. 默认不要在 400/401/403/404/422 时切备用，这些通常是请求或部署配置错误；应尽快暴露，而不是被旧上游掩盖。若业务决定对鉴权失败也容灾，必须使用独立开关并产生高优先级告警。
6. 备用调用 ModelScope：
   - `POST {MODELSCOPE_BASE_URL}/chat/completions`
   - `Authorization: Bearer ${MODELSCOPE_API_KEY}`
   - 默认模型 `moonshotai/Kimi-K2.5`
7. 不因 200 响应的内容质量、JSON schema 不合格或空洞回答自动跨供应商重试；这些由客户端现有的 `json_mode -> prompt_json -> plain_text`/repair 逻辑处理，避免重复计费和不可预测输出。可以把空 `choices` 视为明确协议错误，但要测试并记录策略。
8. 每次请求必须有总超时预算。主上游与备用上游的分段超时之和，加上处理开销，必须小于 Vercel Function 的 `maxDuration`。不能让两个 30 秒上游超时叠加后撞上平台硬超时。
9. `max_tokens` 服务端 clamp 到 1600（允许用环境变量调整），请求体大小、消息数、单消息长度均需限制。
10. 保持非流式为稳定默认。客户端虽有 stream/reasoning 字段，但当前 rollout gate 关闭；本次不要顺便改协议。
11. 原样返回兼容的成功响应；错误统一为：

```json
{
  "error": {
    "code": "UPSTREAM_ERROR_CODE",
    "message": "safe message",
    "requestId": "uuid",
    "provider": "dashscope|modelscope",
    "upstreamStatus": 503
  }
}
```

不要向客户端泄露上游响应中的密钥、内部栈或完整敏感正文。

### `/api/embeddings` 行为

1. 继续使用 DashScope OpenAI-compatible embeddings；旧 ModelScope Chat 备用不自动扩展到 embeddings。
2. 接收 `input: string | string[]`、`model` 和可选 `encoding_format`。
3. 当前零迁移默认保留 `text-embedding-v2`，以维持 1536 维历史索引兼容。
4. 对客户端传来的 `text-embedding-3-small` 等非 DashScope 模型，采用明确的 allowlist + alias 策略：可以映射到 `VESTI_EMBEDDING_MODEL`，但必须在 `x-proxy-model-used` 中返回实际模型；也可以返回 400，不能盲转发。
5. 校验空输入、batch 大小、单文本长度和总 token/字符预算。
6. 若后续升级 `text-embedding-v4`，必须单独实施：新增 embedding model/version/dimension 元数据、建立新索引、全量重算、切换读流量、保留回滚；不要在本次部署中偷偷替换。

### CORS、安全与可观测性

1. `OPTIONS`、成功、所有 4xx/5xx 和异常分支都必须返回一致 CORS 头。
2. 允许来源必须由 `VESTI_ALLOWED_ORIGINS` 控制；生产优先使用确切的 `chrome-extension://<extension-id>`，开发环境再单独放行 localhost。
3. Electron 可能没有浏览器 Origin；不能仅依赖 Origin 鉴权。
4. 增加服务端、跨实例有效的限流/额度控制；不要依赖 serverless 实例内存 Map。
5. 日志禁止记录 Authorization、service token、完整 messages、embedding 原文和完整上游错误正文。
6. 每次调用至少记录结构化字段：
   - `requestId`
   - `route`
   - `attempt`
   - `provider`
   - `model`
   - `upstreamStatus`
   - `latencyMs`
   - `fallbackTriggered`
   - `fallbackReason`
   - token usage（上游提供时）
7. 响应头至少包含：
   - `x-request-id`
   - `x-proxy-provider-used`
   - `x-proxy-model-used`
   - `x-proxy-attempt`
   - `x-proxy-fallback-reason`（发生备用时）
   - `x-proxy-requested-max-tokens`
   - `x-proxy-effective-max-tokens`
   - `x-proxy-max-tokens-limit`
8. 增加无密钥信息的 `GET /api/health`，只报告部署版本、路由是否启用、主/备用 provider 名称和配置是否齐全，绝不返回 token/key。

### Vercel 部署要求

1. 使用 Node runtime，不使用不兼容的 Edge 行为。
2. 明确设置并验证 `maxDuration`，使其覆盖主上游 + 最多一次备用 + 网络开销。
3. 如果当前代理项目是多个 `api/*.js|ts` Serverless Functions，抽出共享的 provider adapter、错误归一化、CORS、鉴权、限流和日志模块，避免 Chat/Embeddings 各自复制一套。
4. 环境变量分别配置 Preview/Production；部署前检查旧生产变量名兼容。
5. 先部署 Preview，用真实但最小化的测试请求验收，再 promote 到 Production。

### 必须完成的测试

单元/集成测试至少覆盖：

- DashScope 主调用成功，不触发备用。
- 主上游网络错误、超时、429、500 分别触发 ModelScope 备用。
- 主上游 400、401、403、404、422 默认不触发备用。
- 备用也失败时，错误含同一个 `requestId`，且能区分两次 attempt。
- 总超时不会超过函数预算。
- 未知 Chat 模型不会被无痕静默替换。
- `response_format=json_object` 正确透传。
- `max_tokens` clamp 与诊断响应头正确。
- OPTIONS、200、400、401、429、500 均有正确 CORS。
- service token 缺失/错误被拒绝。
- 日志中没有 secrets 或完整 prompt。
- embeddings 单条/批量成功；空输入、超 batch、超长、非兼容模型处理正确。
- `text-embedding-v2` 返回维度与历史索引契约一致。
- `GET /api/health` 不泄露密钥。

### 线上验收

部署后请提供脱敏后的命令与结果：

1. `/api/health` 状态。
2. `/api/chat` 正常请求，响应头显示 `dashscope + qwen-plus + attempt=1`。
3. 用测试开关或 mock 强制主上游返回 retryable error，响应头显示旧 ModelScope 备用被使用。
4. 强制主上游返回 401，验证默认不切备用。
5. `/api/embeddings` 返回向量，确认实际模型和维度。
6. 从真实浏览器扩展和桌面端各测试一次，而不只是 curl。

注意：浏览器扩展当前缺少 `https://vesti-gate.vercel.app/*` host permission。若你只负责代理仓库，请把这项作为明确的客户端阻塞项交回；未完成客户端重新打包前，不得宣称端到端上线完成。

### 交付物

- 代理源码改动和测试。
- Preview/Production 部署地址与 commit SHA。
- 所有环境变量名称清单（只列名称/是否配置，不给值）。
- 主备路由状态图和最坏延迟预算。
- 脱敏后的成功、备用、失败样例日志。
- 回滚步骤：如何在不改客户端的情况下把主路由切回旧 ModelScope。
- 客户端待办清单：host permission、UI 主备文案、模型配置来源统一、文档更新。

不要做的事：

- 不要把真实 API key/service token 写入代码、Git、日志或回答。
- 不要把 ModelScope 的免费 API 当作有 SLA 的生产主链路。
- 不要在没有重建向量索引时把 embedding v2 原地改成 v4。
- 不要只测试 200；必须验证 fallback 的触发与不触发边界。
- 不要通过静默模型替换掩盖客户端/服务端配置不一致。

## 三、模型与接口判断依据

- DashScope 的 OpenAI-compatible Chat 接口支持 Qwen、DeepSeek、Kimi 等模型；当前客户端选择 `qwen-plus` 属于兼容路线。
- `qwen-plus` 是会随服务端更新的别名；若上线要求强复现，应在通过现有 Summary/Weekly/Explore/Prompt JSON 回归后考虑固定日期版本，而不是直接追最新模型。
- 当前官方模型列表已有更新的 Qwen Plus 代际，但仓库的模型 whitelist/profile 尚未覆盖。不要在代理部署中未经评测直接切到新代际。
- ModelScope 官方说明 API-Inference 是免费体验性质、额度和并发会动态调整，不适合要求高并发或 SLA 的在线生产主链路，因此适合作为成本受控的备用，而不是唯一主服务。
- DashScope 官方当前推荐纯文本/代码 embedding 使用 `text-embedding-v4`；Vesti 仍应因历史索引兼容暂留 v2，升级另开迁移任务。

官方参考：

- https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- https://help.aliyun.com/zh/model-studio/model-pricing
- https://help.aliyun.com/zh/model-studio/embedding
- https://modelscope.cn/docs/model-service/API-Inference/intro
- https://modelscope.cn/docs/model-service/API-Inference/limits

## 四、未能在线确认的事项

本次审计尝试从当前执行环境访问 `vesti-gate.vercel.app` 和旧 `vesti-proxy.vercel.app` 的 OPTIONS 端点，但 HTTPS 连接超时，因此没有把“线上当前可用/不可用”作为事实。部署 agent 必须从可访问 Vercel 的环境重新执行线上探测，并附带脱敏证据。
