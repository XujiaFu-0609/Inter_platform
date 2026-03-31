# CLOA-79 控制面 CRD 与运行基线 v0.2

日期：2026-03-31（Asia/Shanghai）  
责任角色：Backend Engineer  
关联任务：[CLOA-76](/CLOA/issues/CLOA-76)、[CLOA-82](/CLOA/issues/CLOA-82)

## v0.2 增量摘要（相对 2026-03-28 最小回稿包）

1. 补齐正式工作目录落盘路径，形成可审计版本化文档。  
2. 将“CRD 状态口径”扩展到“可执行后端实现方案”，覆盖 PostgreSQL/Redis/Kafka。  
3. 固化幂等、重试、异常处理与 DLQ 回放约束，并对齐 Spark/Flink/Volcano（不依赖 YARN）。  
4. 给出可量化性能目标（P95 延迟、吞吐、资源占用）与验收方法。

## [实现方案]

### 1. 总体架构（Control Plane + Data Plane）

- **Control Plane（Operator）**：`operator-sdk + controller-runtime` 管理 `InterviewPlatform` 与 `InterviewPipeline` 两类 CRD。  
- **Data Plane（Go 服务）**：提供 OpenAPI + 内部 gRPC；业务真相源在 PostgreSQL。  
- **中间件职责**：
  - PostgreSQL：会话、答案、评测、幂等记录、Outbox。
  - Redis：幂等预占、热点缓存、分布式锁。
  - Kafka：事件发布、异步评测任务、Retry/DLQ。
- **大数据联动**：Spark/Flink 仅通过 Kafka 消费任务事件，调度层使用 Volcano Queue/PodGroup，不接入 YARN。

### 2. CRD 与 Reconciler 边界

#### 2.1 `InterviewPlatform`（平台运行面）

- 管理 API Deployment、Service、ConfigMap、Secret 引用、HPA、PDB。  
- 状态字段统一输出：`status.phase`、`status.conditions[]`、`status.observedGeneration`。

#### 2.2 `InterviewPipeline`（任务与总线面）

- 管理 Kafka Topic 参数、消费组副本、Spark/Flink 模板与 Volcano 队列绑定。  
- 固化字段：`spec.engine.type`（`spark|flink`）、`spec.scheduler.type=volcano`、`spec.scheduler.queue`。

#### 2.3 Reconciler 关键流程

1. 校验引用依赖（Secret/Topic/Queue）。  
2. 对齐期望资源并应用（幂等 apply）。  
3. 回写条件：`Ready/Degraded/Failed`。  
4. 触发事件与指标上报（reconcile latency、error count、drift count）。

### 3. 核心业务机制

#### 3.1 幂等

- 写接口强制 `Idempotency-Key`（Header），`scope = <api>:<sessionId>`。  
- Redis `SET NX EX` 预占（30s），PostgreSQL `idempotency_records` 唯一键最终兜底。  
- 同 key + 同 payload：返回首个响应快照；同 key + 不同 payload：返回 `409 STATE_CONFLICT`。

#### 3.2 重试与回放

- Producer：`acks=all`，指数退避 `100ms/300ms/900ms`，最多 3 次。  
- Consumer：失败进入 `retry` topic，超阈值（默认 16 次）转 `dlq` topic。  
- 回放幂等键：`<eventType>:<sessionId>:<eventId>`，保障“至少一次投递、效果一次”。

#### 3.3 异常处理

- 标准错误码：`VALIDATION_ERROR`、`STATE_CONFLICT`、`DEPENDENCY_UNAVAILABLE`、`INTERNAL_ERROR`。  
- 全链路三键：`requestId`、`traceId`、`eventId`（HTTP、日志、Kafka envelope 保持一致）。

### 4. 性能优化目标（量化）

以当前 M1 内存态为参考，v0.2 目标如下：

1. `POST /answers` P95：`220ms -> <=120ms`。  
2. 写路径吞吐：`~150 RPS -> >=800 RPS`（3 副本 API）。  
3. Kafka 端到端投递延迟 P95：`<=400ms`。  
4. 500 RPS 下单 Pod CPU：`~1.8 core -> <=1.1 core`；内存 `<900Mi`。

## [API与数据模型]

### 1. OpenAPI（外部契约）

保留并扩展 `backend/api/openapi/interview-v1.yaml`：

1. `POST /api/v1/interview-sessions`
2. `GET /api/v1/interview-sessions/{sessionId}`
3. `POST /api/v1/interview-sessions/{sessionId}/answers`（Header: `Idempotency-Key`）
4. `POST /api/v1/interview-sessions/{sessionId}/finalize`
5. `POST /api/v1/interview-sessions/{sessionId}/evaluations`
6. `GET /api/v1/dlq/replay-contract`

新增响应扩展：

- `x-control-plane-health`：`healthy|degraded|down`（来自 CRD status 聚合）。

### 2. gRPC（内部契约）

在 `backend/api/proto/evaluation_job.proto` 基础上新增：

- `rpc ReplayDlqEvent(ReplayDlqEventRequest) returns (ReplayDlqEventResponse)`
- 请求字段：`event_id`、`session_id`、`reason`、`operator`。

### 3. 领域模型

1. `InterviewSession`（聚合根）  
   - `sessionId`、`candidateId`、`planId`、`status`、`timeline`。  
2. `AnswerRecord`  
   - `answerId`、`sessionId`、`questionId`、`version`、`content`、`savedAt`。  
3. `EvaluationJob`  
   - `jobId`、`sessionId`、`status`、`engineType`、`queueName`、`attempt`。  
4. `DomainEvent`  
   - `eventId`、`eventType`、`schemaVersion`、`requestId`、`traceId`、`payload`。

### 4. 数据模型（PostgreSQL）

在既有 `0001_interview_platform_init.sql` 后新增迁移：

1. `0002_pipeline_jobs.sql`：`evaluation_jobs`。  
2. `0003_outbox_dispatch_index.sql`：补充 outbox 分发索引。  
3. `0004_kafka_consumer_offsets.sql`：消费位点持久化（可选）。

关键约束：

- `idempotency_records(scope, idempotency_key)` 唯一。  
- `event_outbox(event_id)` 唯一。  
- `interview_answers(session_id, question_id, answer_version)` 主键。

### 5. Redis Key 与 Kafka Topic

- Redis：
  - `idem:{scope}:{idempotencyKey}`（24h）
  - `session:summary:{sessionId}`（10m）
  - `lock:evaluation:{sessionId}`（30s）
- Kafka：
  - `interview.session.events.v1`
  - `interview.evaluation.commands.v1`
  - `interview.evaluation.results.v1`
  - `interview.evaluation.retry.v1`
  - `interview.evaluation.dlq.v1`

## [代码任务清单]

1. **Operator 工程**：新增 `operator/`（`api/v1alpha1`、`controllers/`、`config/samples/`）。  
2. **CRD 类型**：定义 `InterviewPlatform`、`InterviewPipeline` 的 `spec/status` 与默认值。  
3. **后端分层**：在 `backend/internal` 补齐 `application/domain/infra` 目录，替换内存实现。  
4. **PostgreSQL 接入**：实现 repository、tx manager、outbox dispatcher。  
5. **Redis 接入**：实现 idempotency store、缓存与分布式锁。  
6. **Kafka 接入**：实现 producer/consumer、retry、dlq、replay worker。  
7. **API 契约更新**：补 OpenAPI 字段与 gRPC 回放接口。  
8. **迁移脚本**：新增 `0002~0004`，并更新 `backend/docs/runbook.md` 执行步骤。  
9. **运行文档**：新增 `backend/docs/runbook-operator.md`（部署、回滚、故障定位）。

## [测试与验证]

1. **单元测试**
   - 状态机迁移与非法状态冲突。
   - 幂等重放/冲突分支。
   - outbox 重试与 DLQ 转移。
2. **集成测试（docker-compose）**
   - PostgreSQL/Redis/Kafka 启动后跑主链路。
   - 校验 DB 与 Kafka envelope 一致性。
   - 注入消费失败，验证 retry→dlq→replay。
3. **Operator 测试**
   - `envtest` 验证 reconcile create/update/delete。
   - 缺 Secret/Queue 时 `status.conditions` 正确回写 `Degraded`。
4. **性能验证**
   - 压测 10 分钟（100 并发）采集 P50/P95/P99、CPU、内存。
   - 验收阈值：`saveAnswer P95 <=120ms`、吞吐 `>=800 RPS`。
5. **建议命令**
   - `cd backend && go test ./... -cover`
   - `cd backend && make test-integration`
   - `cd operator && make test`
   - `kubectl apply -f operator/config/samples/` + `kubectl get interviewplatform,interviewpipeline -oyaml`

## [风险与技术债]

1. **跨源状态漂移（高）**：CRD `status` 与引擎运行事实存在短时不一致，需保留 30~60s 聚合窗口并在 API 上标注来源优先级。  
2. **一致性窗口（中）**：Outbox 异步分发期间存在“写库成功、事件待发”短窗；需通过补偿扫描器收敛。  
3. **容量预估偏差（中）**：Kafka 分区数与消费并发配置不当会放大延迟。  
4. **技术债（中）**：当前尚未引入多租户鉴权与细粒度 RBAC，需在下一阶段补齐。  
5. **收口结论（2026-03-31）**：CLOA-79 已具备“可评审正式文档 + 可执行任务清单 + 量化验收标准”，建议状态推进至 `in_review`，并由 CTO/QA 按 D3 联调清单验收。
