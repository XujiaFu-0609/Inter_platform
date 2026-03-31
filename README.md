# AI Infra 面试平台最小主链路（前后端分目录）

仓库默认后端已切换为 Go（`backend/`），并基于 Go 标准库 HTTP 服务实现 `interview-sessions` canonical API 最小闭环，在响应/日志中贯穿 `requestId`、`traceId`、`eventId`。当前仓库按前后端职责拆分为两个主目录：`frontend/` 与 `backend/`。

## 目录说明

- `backend/cmd/interview-api/main.go`：Go 服务启动入口
- `backend/internal/httpapi/server.go`：路由入口与服务装配
- `backend/internal/httpapi/handlers.go`：HTTP handlers（会话/回答/评测）
- `backend/internal/httpapi/service.go`：会话领域服务（状态推进、幂等校验）
- `backend/internal/domain/interview/`：领域模型与仓储/事件核心接口（M1 基线）
- `backend/internal/application/interview/`：应用层 use case 契约（M1 基线）
- `backend/internal/interfaces/http/`：HTTP 适配层契约（M1 基线）
- `backend/api/openapi/interview-v1.yaml`：OpenAPI 契约
- `backend/api/proto/evaluation_job.proto`：内部 gRPC 契约草案
- `backend/migrations/0001_interview_platform_init.sql`：PostgreSQL 迁移脚本（M2 预备）
- `backend/docs/runbook.md`：运行与测试手册
- `frontend/server.js`：Node fallback 演示入口（历史兜底，默认 `3001`）
- `frontend/public/`：原生前端静态资源
- `frontend/public/platform-utils.js`：平台页 query/枚举/Grafana 工具函数
- `frontend/tests/platform-utils.test.mjs`：平台页基础单测
- `data/demo-fixtures.json`：固定题目与结果摘要 seed 数据
- `scripts/smoke.mjs`：主链路烟测脚本（保存 `requestId` + `traceId` + `eventId` 证据）
- `evidence/2026-03-27-go/`：Go 后端本次真实请求响应证据

## 快速启动（Go-first 默认）

要求：

- `Go >= 1.21`
- `Node.js >= 20`（仅用于运行烟测脚本）

启动 Go 后端：

```bash
npm run dev
```

服务默认监听 `http://127.0.0.1:3000`，并同时承载：

- 前端静态页面：`http://127.0.0.1:3000/`
- canonical API：`http://127.0.0.1:3000/api/v1/interview-sessions`

## 前端访问与切换说明

1. **默认 Go-first（推荐）**
   - 只启动 `npm run dev`；
   - 访问 `http://127.0.0.1:3000/`；
   - 前端同源访问 Go canonical API，不需要 `?apiBaseUrl=`。
2. **前端单独调试 + Go API（fallback）**
   - 终端 A 启动 Go：`npm run dev`（`3000`）；
   - 终端 B 启动 Node fallback：`npm run dev:node`（默认 `3001`）；
   - 访问 `http://127.0.0.1:3001/?apiBaseUrl=http://127.0.0.1:3000`，让前端继续连 Go API。
3. **本地运行时覆盖（可选）**
   - 可通过 `window.__CLOUD_NATIVE_CONFIG__.apiBaseUrl` 或 `?apiBaseUrl=` 指向其他后端；
   - 传 `?apiBaseUrl=default` 可恢复同源行为。
4. **平台页骨架（CLOA-95）**
   - 访问 `/platform/overview`、`/platform/runs`、`/platform/alerts`；
   - 默认优先调用 `/api/v1/platform/*` canonical DTO；
   - 若接口未就绪，会自动使用 mock fallback（可用 `?platformMock=off` 关闭，`?platformMock=on` 强制开启）；
   - Grafana 深链通过 `window.__CLOUD_NATIVE_CONFIG__.grafanaBaseUrl` 或 `?grafanaBaseUrl=` 注入。

## Canonical API（最小闭环）

1. `POST /api/v1/interview-sessions`
2. `GET /api/v1/interview-sessions/{sessionId}`
3. `GET /api/v1/interview-sessions/{sessionId}/questions`
4. `GET /api/v1/interview-sessions/{sessionId}/answers`
5. `POST /api/v1/interview-sessions/{sessionId}/answers`
6. `POST /api/v1/interview-sessions/{sessionId}/finalize`
7. `POST /api/v1/interview-sessions/{sessionId}/evaluations`
8. `GET /api/v1/interview-sessions/{sessionId}/result-summary`
9. `GET /api/v1/dlq/replay-contract`

## 真实证据复现

在 Go 服务运行时执行：

```bash
CAPTURE_DIR=evidence/2026-03-27-go npm run smoke
```

脚本会调用最小链路并生成 JSON 证据，记录：

- 响应状态码
- `requestId`
- `traceId`（body 与 header）
- `eventId`（body 与 `x-event-id` header，适用于写路径）
- 完整响应体

## 前端单测

```bash
npm run test:frontend
```

当前覆盖：query 归一化、Grafana 深链拼装、mock 过滤分页。

## 事件 Envelope 与回放契约（CLOA-72）

- 写路径事件统一 envelope 字段：
  - `eventId`
  - `eventType`
  - `schemaVersion`（当前 `v1alpha1`）
  - `occurredAt`
  - `requestId`
  - `traceId`
  - `sessionId`
  - `payload`
- 异步消费日志使用同一组 `requestId` / `traceId` / `eventId` 字段，支持 HTTP → publish/consume 追踪。
- DLQ replay 幂等键模板：`<eventType>:<sessionId>:<eventId>`。
- 回放约束可通过 `GET /api/v1/dlq/replay-contract` 查询。

## Node 过渡策略

- 正式后端能力新增统一落在 `backend/`；
- `npm run dev` 已提供 Go API + 前端静态承载的同源主链路；
- `frontend/server.js` 仅作为历史演示兜底，使用命令 `npm run dev:node`；
- Node 路径仅用于 fallback/调试，不再作为默认主线。

## 状态语义说明

- `finalize` 仅将会话推进到 `submitted`；
- `evaluations` 才会将会话推进到 `completed`；
- `result-summary` 只读，不再隐式修改状态，保持与 canonical 状态语义一致。

## 前端调用点与耦合梳理

- `frontend/public/app.js` 内所有会话相关请求已收敛到 `interviewSessionApi` 适配层，统一走 `/api/v1/interview-sessions` canonical API；
- 前端默认同源访问当前 Host 的 canonical API；在 fallback 场景可通过 `?apiBaseUrl=http://127.0.0.1:3000` 或 `window.__CLOUD_NATIVE_CONFIG__.apiBaseUrl` 显式切换到 Go；
- `submitted` 与 `completed` 已在结束页分开展示：`submitted` 仅提示“待面评”，只有 `completed` 才会读取并展示 `result-summary`；
- Node 演示后端仍保留 `result-summary` 会把 `submitted` 推进成 `completed` 的临时副作用，但前端已避免在 `submitted` 状态主动触发该行为。

## 当前仍为 mock / seed

- 鉴权、数据库、对象存储、消息总线未接入
- 题库与结果摘要来自 `data/demo-fixtures.json`
- 服务重启后会话数据不持久化

## 模块说明

- `backend/go.mod` 已纳入仓库，`npm run dev` 直接在 `backend/` 下执行 `go run ./cmd/interview-api`
- 当前 Go 服务仅依赖标准库，因此不会生成 `backend/go.sum`
