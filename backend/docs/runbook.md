# Backend Runbook（M1）

## 1. 本地运行

```bash
cd backend
go run ./cmd/interview-api
```

默认监听 `127.0.0.1:3000`。

## 2. 单元 + 集成测试

```bash
cd backend
go test ./...
```

当前 `internal/httpapi` 下测试覆盖：

- API 主链路集成流转（创建会话 → 保存回答 → finalize → evaluations → summary）
- 写接口 `idempotencyKey` 重放与冲突行为
- `x-event-id` / `requestId` / `traceId` 透传
- DLQ replay contract 输出

## 3. 迁移脚本（M2 预备）

SQL 文件：

- `backend/migrations/0001_interview_platform_init.sql`

建议执行方式（示例）：

```bash
psql "$POSTGRES_DSN" -f backend/migrations/0001_interview_platform_init.sql
```

## 4. 已知限制

- 当前运行态仍为内存存储（重启丢失会话）。
- 事件队列为进程内 channel，仅用于 M1 演示。
- Kafka/Redis/PostgreSQL 的真实依赖注入将在 M2-M4 接入。

