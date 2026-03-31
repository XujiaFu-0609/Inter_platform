# CLOA-83 后端 M1 骨架重构实施清单 v0.1

日期：2026-03-27  
责任人：CTO  
对应任务：CLOA-83  
父任务：CLOA-76

## 1. 目标

本清单只解决一件事：让当前 `backend/` 从“单核心文件演示实现”进入“可继续演进的模块化单体骨架”，不在本轮引入 PostgreSQL / Redis / Kafka 的真实接入实现。

## 2. 本轮范围（M1）

### 2.1 必做

1. 保持现有对外 API 路径不变。
2. 保持 `backend/cmd/interview-api/main.go` 仍可启动。
3. 将 `backend/internal/httpapi/server.go` 从单文件拆出明确分层。
4. 建立最小骨架目录：
   - `backend/internal/domain`
   - `backend/internal/application`
   - `backend/internal/interfaces/httpapi`

### 2.2 本轮不做

1. 不要求本轮接入 PostgreSQL。
2. 不要求本轮接入 Redis。
3. 不要求本轮接入 Kafka。
4. 不要求本轮落 Operator 代码。

## 3. 建议文件改动清单

### 3.1 入口保持

1. 保留 `backend/cmd/interview-api/main.go`
2. 仅调整 import 与依赖装配方式，避免改动对外运行命令

### 3.2 HTTP 层拆分

建议将 `backend/internal/httpapi/server.go` 拆为：

1. `backend/internal/interfaces/httpapi/server.go`
   - 服务启动与路由装配
2. `backend/internal/interfaces/httpapi/handlers.go`
   - `createSession`
   - `getSession`
   - `listQuestions`
   - `listAnswers`
   - `saveAnswer`
   - `finalize`
   - `submitEvaluation`
   - `resultSummary`
3. `backend/internal/interfaces/httpapi/middleware.go`
   - `requestId/traceId` 注入
   - 日志与响应封装
4. `backend/internal/interfaces/httpapi/dto.go`
   - HTTP request/response DTO

### 3.3 Application 层

新增：

1. `backend/internal/application/session_service.go`
   - 面向 handler 暴露用例接口
2. `backend/internal/application/contracts.go`
   - 定义 repository / event publisher / fixture provider 等接口

### 3.4 Domain 层

新增：

1. `backend/internal/domain/session.go`
   - `SessionRecord`、状态字段、最小状态迁移约束
2. `backend/internal/domain/answer.go`
   - `AnswerRecord`
3. `backend/internal/domain/event.go`
   - `EventEnvelope`

## 4. 最小落地策略

1. 现阶段允许 repository 仍然先用内存实现，但必须被抽到接口后面。
2. 现阶段允许 fixture 仍然来自 `data/demo-fixtures.json`，但读取逻辑从 HTTP 层剥离。
3. 现阶段允许 event queue 仍是内存实现，但必须通过 `EventPublisher` 接口隔离。

## 5. DoD 判定

满足以下四项即可认为 `CLOA-83` 的 M1 达标：

1. `backend/internal/httpapi/server.go` 不再承载全部核心逻辑；
2. 新增的 `domain/application/interfaces` 目录已落文件；
3. `go test ./...` 至少在当前改动范围可运行；
4. 评论中回贴：
   - 实际改动文件列表
   - 运行/验证命令
   - 当前未完成项与风险

## 6. 风险提示

1. 本轮不要为了“拆干净”而过度重构，避免打断可运行主链路。
2. 本轮目标是“可继续演进”，不是“一步到位生产架构”。
3. 如果拆分过程中影响现有 smoke 路径，应优先保证兼容，再逐步抽象。
