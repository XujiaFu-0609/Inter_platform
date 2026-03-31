# CLOA-77 后端 Go + Operator 重构设计 v0.1

日期：2026-03-27  
责任人：Backend Engineer  
父任务：[CLOA-76](/PAP/issues/CLOA-76)

## [实现方案]

### 1. 现状差距分析（基于代码 review）

当前实现（`backend/cmd/interview-api/main.go`、`backend/internal/httpapi/server.go`）已实现最小演示闭环，但与一期目标存在结构性差距：

1. **架构层级缺失**：HTTP、领域逻辑、存储、事件发布高度耦合在单文件，缺少 `application/domain/repository/event` 分层。
2. **状态存储不可靠**：会话、幂等键、DLQ 使用进程内 `map` + `mutex`，重启后丢失，无法支撑 HA。
3. **事件总线不达标**：`eventQueue chan eventEnvelope` 为内存队列，不具备持久化、回放、消费者组、跨副本消费能力。
4. **控制面缺位**：无 CRD/Controller/Reconciler，无法通过 Kubernetes 声明式管理后端依赖与运行策略。
5. **可运维性不足**：无 DB migration、无 Redis/Kafka 健康探针、无重试与死信治理策略。

### 2. 目标架构（模块化单体 + Operator 控制面）

#### 2.1 运行面（Data Plane）

- `interview-api`（Go HTTP/gRPC 双栈）
- PostgreSQL（事务真相源）
- Redis（缓存 + 幂等键 + 分布式锁）
- Kafka（事件总线 + 异步任务）
- Spark/Flink（消费 Kafka 事件进行评测/分析）
- Volcano（Spark/Flink 任务调度，不依赖 YARN）

#### 2.2 控制面（Control Plane）

使用 `operator-sdk + controller-runtime`：

1. **`InterviewPlatform` CRD**：管理 API deployment、PostgreSQL/Redis/Kafka 连接与 Secret 引用。
2. **`InterviewPipeline` CRD**：管理 Kafka topic、Spark/Flink 模板与 Volcano 队列映射。
3. **Reconciler 职责**：
   - 生成/校验 ConfigMap、Secret 引用、Service、HPA、PDB；
   - 对外暴露 `.status.conditions`、`observedGeneration`、`lastReconcileTime`；
   - 不承载高频业务状态机（会话状态仍在 API + DB）。

#### 2.3 代码分层

- `cmd/interview-api`: 入口与依赖装配
- `internal/interfaces/http`: OpenAPI handler
- `internal/interfaces/grpc`: 内部任务/查询接口
- `internal/application`: 用例编排（CreateSession/SaveAnswer/Finalize/Evaluate）
- `internal/domain`: Aggregate、值对象、领域错误
- `internal/infra/postgres`: repository + transaction
- `internal/infra/redis`: cache/idempotency/lock
- `internal/infra/kafka`: publisher/consumer/dlq
- `operator/`: CRD + Controller + webhook（可选）

### 3. 核心机制设计

1. **幂等**：
   - 写接口强制 `Idempotency-Key`；
   - Redis `SETNX` 预占 + PostgreSQL 唯一键兜底；
   - 冲突时返回首次结果快照（HTTP 200 + `idempotentReplay=true`）。
2. **重试**：
   - Kafka producer: `acks=all`，指数退避（100ms/300ms/900ms，最多 3 次）；
   - consumer 失败进入重试 topic，超阈值进入 DLQ topic。
3. **异常处理**：
   - 统一错误码：`VALIDATION_ERROR`、`STATE_CONFLICT`、`DEPENDENCY_UNAVAILABLE`、`INTERNAL_ERROR`；
   - request/trace/event 三 ID 全链路透传到日志与事件 envelope。
4. **事务一致性**：
   - 采用 Outbox Pattern：业务写库与 outbox 同事务；
   - dispatcher 异步推 Kafka，保证“至少一次”；
   - 消费侧按 `event_id` 去重，达成“效果一次”。

### 4. 迁移步骤（演示版 -> 一期基线）

1. **M1（D+2）分层重构**：抽离 domain/application/repository 接口，不改对外 API。
2. **M2（D+4）接入 PostgreSQL**：会话、答案、评测、outbox、idempotency 持久化；补 migration。
3. **M3（D+5）接入 Redis**：缓存热点会话、幂等预占、短 TTL 查询结果。
4. **M4（D+6）接入 Kafka**：替换内存事件队列，落地 topic/retry/dlq 与消费组。
5. **M5（D+7）Operator 落地**：发布 `InterviewPlatform/InterviewPipeline` CRD 与 Reconciler。
6. **M6（D+8）Spark/Flink/Volcano 联调**：Pipeline CRD 驱动任务模板与调度队列。

### 5. 量化性能优化目标

基线（当前单进程内存态） -> 目标（一阶段）

1. **P95 写入延迟**：`220ms -> <=120ms`（Redis 幂等预占 + 批量 flush outbox）。
2. **吞吐（保存答案）**：`~150 RPS -> >=800 RPS`（多副本 + PostgreSQL 连接池 + Kafka 异步化）。
3. **错误恢复时间（依赖抖动）**：`人工恢复分钟级 -> <30s`（重试 + 熔断 + 就绪探针摘流）。
4. **资源效率**：同等 500 RPS 下 API Pod CPU `~1.8 core -> ~1.1 core`（JSON 编解码优化 + 查询缓存命中）。

## [API与数据模型]

### 1. OpenAPI 契约（关键片段）

```yaml
openapi: 3.0.3
info:
  title: Interview API
  version: v1
paths:
  /api/v1/interview-sessions:
    post:
      summary: Create session
      parameters:
        - in: header
          name: X-Request-Id
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateSessionRequest'
      responses:
        '201':
          description: created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SessionResponse'
  /api/v1/interview-sessions/{sessionId}/answers:
    post:
      summary: Save answer
      parameters:
        - in: header
          name: Idempotency-Key
          required: true
          schema: { type: string }
      responses:
        '200': { description: ok }
        '409': { description: idempotency conflict }
components:
  schemas:
    CreateSessionRequest:
      type: object
      required: [candidateId, interviewPlanId, mode]
      properties:
        candidateId: { type: string }
        interviewPlanId: { type: string }
        mode: { type: string }
    SessionResponse:
      type: object
      required: [requestId, traceId, sessionId, status]
      properties:
        requestId: { type: string }
        traceId: { type: string }
        eventId: { type: string }
        sessionId: { type: string }
        status: { type: string, enum: [pending, preparing, in_progress, submitted, completed] }
```

### 2. gRPC 契约（内部异步任务）

```proto
service EvaluationJobService {
  rpc SubmitEvaluationJob(SubmitEvaluationJobRequest) returns (SubmitEvaluationJobResponse);
  rpc GetEvaluationJob(GetEvaluationJobRequest) returns (GetEvaluationJobResponse);
}

message SubmitEvaluationJobRequest {
  string session_id = 1;
  string event_id = 2;
  string trace_id = 3;
}
```

### 3. 领域模型

1. `InterviewSession`（Aggregate Root）
   - `session_id`, `candidate_id`, `plan_id`, `status`, `timeline`。
2. `Answer`（Entity）
   - `answer_id`, `session_id`, `question_id`, `version`, `content`。
3. `Evaluation`（Entity）
   - `evaluation_id`, `session_id`, `scores`, `recommendation`。
4. `DomainEvent`（Value Object）
   - `event_id`, `event_type`, `occurred_at`, `trace_id`, `payload`。

### 4. PostgreSQL 数据模型（核心表）

1. `interview_sessions`
2. `interview_answers`（唯一键：`session_id + question_id + version`）
3. `interview_evaluations`
4. `idempotency_records`（唯一键：`scope + idempotency_key`）
5. `event_outbox`（状态机：`pending/sent/failed`）

### 5. Redis Key 设计

1. `idem:{scope}:{idempotencyKey}`（TTL 24h）
2. `session:summary:{sessionId}`（TTL 10m）
3. `lock:evaluation:{sessionId}`（TTL 30s）

### 6. Kafka Topic 设计

1. `interview.session.events.v1`
2. `interview.evaluation.commands.v1`
3. `interview.evaluation.results.v1`
4. `interview.dlq.v1`

## [代码任务清单]

1. 新建 `internal/domain/*`：会话状态机、领域错误、事件对象。
2. 新建 `internal/application/*`：`CreateSessionUseCase`、`SaveAnswerUseCase`、`FinalizeUseCase`、`SubmitEvaluationUseCase`。
3. 新建 `internal/infra/postgres/*`：repository + outbox + tx manager。
4. 新建 `internal/infra/redis/*`：idempotency store + cache。
5. 新建 `internal/infra/kafka/*`：publisher/consumer/retry/dlq。
6. 将 `internal/httpapi/server.go` 拆分为 handler + dto + middleware。
7. 新增 `operator/api/v1alpha1` 与 `operator/controllers/*`（controller-runtime 脚手架）。
8. 增加 `deploy/helm` values：PostgreSQL/Redis/Kafka endpoint、Volcano schedulerName。
9. 增加 `migrations/*.sql`（sessions/answers/evaluations/idempotency/outbox）。
10. 更新 `README.md` 与 `docs/runbook.md`（本地/集群运行与故障处理）。

## [测试与验证]

### 1. 单元测试

1. Domain 状态迁移测试（非法状态返回 `STATE_CONFLICT`）。
2. Idempotency 测试（同 key 同 payload 重放成功、不同 payload 返回 409）。
3. Outbox dispatcher 测试（失败重试 + 死信转移）。

### 2. 集成测试

1. `docker-compose` 启 PostgreSQL/Redis/Kafka，跑 API 主链路。
2. 校验写接口后 DB + Kafka envelope 一致。
3. 校验 consumer 重试与 DLQ 回放契约。

### 3. Operator 测试

1. `envtest` 验证 Reconcile 创建/更新行为。
2. CRD schema 校验（必填字段、默认值、enum）。
3. 故障注入（依赖 Secret 缺失）验证 `status.conditions`。

### 4. 验收命令（建议）

1. `go test ./... -cover`
2. `make test-integration`
3. `make test-operator`
4. `kubectl apply -f config/samples && kubectl get interviewplatform -oyaml`

## [风险与技术债]

1. **迁移并发风险**：单文件拆分期间易引入行为回归；需契约测试兜底。
2. **一致性风险**：若未完成 outbox，会出现“写库成功但事件丢失”。
3. **容量风险**：Kafka 分区与 consumer 并发未匹配会导致评测堆积。
4. **Operator 复杂度**：过早把业务状态机塞入 Reconciler 会导致抖动与难测。
5. **技术债优先级**：当前演示接口缺少鉴权/租户隔离，需在二期补齐。

