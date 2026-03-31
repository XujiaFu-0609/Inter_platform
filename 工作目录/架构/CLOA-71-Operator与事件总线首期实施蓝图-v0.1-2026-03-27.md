# CLOA-71 Operator 与事件总线首期实施蓝图 v0.1

## 1. 文档信息

- 日期：2026-03-27
- 对应任务：[CLOA-71](/CLOA/issues/CLOA-71)
- 父任务：[CLOA-61](/CLOA/issues/CLOA-61)
- 关联基线：[CLOA-65](/CLOA/issues/CLOA-65)、[CLOA-67](/CLOA/issues/CLOA-67)、[CLOA-68](/CLOA/issues/CLOA-68)
- 产出角色：Cloud Native Architect

## 2. 目标与适用范围

本蓝图将已批准的架构决策收敛为可执行的首期交付方案，覆盖：

1. `InterviewPlatform` Operator 工程与模块布局；
2. Backend / Operator / Ops 的 ownership 边界；
3. 首期实施顺序与阶段退出条件；
4. 事件总线与可观测性落地约束（JetStream、DLQ、兼容位）；
5. 对齐 QA/CTO 双门禁的交付要求。

范围说明：本蓝图不重复展开 CRD 边界正文，CRD 语义以 [CLOA-65](/CLOA/issues/CLOA-65) 为准。

## 3. 首期 Repo / Module 布局建议

建议采用 mono-repo 下双主模块结构：`go-backend`（业务面）+ `operator`（控制面）。

```text
cloud_native/
├── go-backend/                          # 业务服务（Go）
│   ├── cmd/api/main.go
│   ├── internal/
│   │   ├── interview/                   # 会话状态机与领域逻辑
│   │   ├── events/                      # 事件发布/消费适配（NATS/JetStream）
│   │   ├── observability/               # requestId/traceId/eventId 注入
│   │   └── transport/http/              # REST handlers
│   └── api/openapi/
├── operator/                            # InterviewPlatform 控制器（Go + Kubebuilder）
│   ├── api/v1alpha1/                    # CRD types + defaults + validation tags
│   ├── internal/controller/             # Reconciler 实现
│   ├── internal/renderer/               # Deployment/Service/... 期望资源渲染
│   ├── config/
│   │   ├── crd/bases/
│   │   ├── rbac/
│   │   ├── manager/
│   │   └── samples/
│   ├── charts/interview-platform-operator/  # Helm chart（operator 自身）
│   └── test/e2e/
├── deploy/
│   ├── helm/interview-platform/         # 业务工作负载 chart（由 Operator/Helm 共用值模型）
│   ├── environments/{dev,stage,prod}/
│   └── runbooks/
└── docs/architecture/
    ├── decision-records/
    └── tracing-event-schema/
```

### 3.1 结构约束

1. `operator/api/v1alpha1` 仅定义平台资源声明，不引入业务会话字段；
2. `go-backend/internal/interview` 保留会话状态机，不下沉 Operator；
3. `events` 模块暴露总线接口而非绑定具体实现，便于未来扩展 Kafka 适配；
4. `deploy/environments` 与 `operator/config/samples` 使用统一 values 键名，避免参数漂移。

## 4. Ownership Matrix（Backend / Operator / Ops）

| 领域 | Backend Engineer | Operator（Cloud Native Architect） | Senior Cloud Native Operations Engineer |
| --- | --- | --- | --- |
| CRD `spec/status` 演进 | 提供业务配置需求输入 | **主责**：API types、默认化、校验、兼容策略 | 审核可运维性与多环境约束 |
| Deployment/Service/ConfigMap 收敛 | 定义服务运行参数 | **主责**：reconcile 渲染/应用逻辑 | 提供集群基线、准入策略 |
| Secret/Ingress/HPA/PDB 收敛 | 提供配置消费与探针约束 | **主责**：受管资源模板与状态回写 | **主责**：密钥来源、Ingress/Gateway、HPA 指标接线 |
| 面试会话状态机 | **主责**：会话流转、幂等、补偿 | 不承接，仅消费运行参数 | 提供运行观测与告警 |
| 事件 schema 与发布 | **主责**：事件 payload、版本、幂等键 | 定义接口约束与兼容位 | 定义保留期、容量阈值与告警 |
| JetStream / DLQ 治理 | 业务域分类与重放规则 | 提供 CRD 可配置项与默认值 | **主责**：JetStream 持久化、DLQ 隔离与回放 runbook |
| 可观测性（requestId/traceId/eventId） | **主责**：应用日志/trace 注入 | **主责**：控制器 metrics/events | **主责**：看板、告警、采样与成本归集 |

## 5. 实施顺序（首期）

实施顺序严格按以下阶段推进：

1. skeleton；
2. Deployment / Service / ConfigMap；
3. Secret / Ingress / HPA / PDB；
4. observability hooks。

### Phase 0 — Skeleton（T+2 天）

- 交付：
  - `operator` 工程初始化（Kubebuilder）；
  - `InterviewPlatform` CRD types、controller 主循环、空渲染器接口；
  - `go-backend` 事件接口抽象 `EventBus`（不绑定 Kafka 实现）。
- 退出条件：
  - kind 环境可启动 operator manager；
  - sample CRD 可被 reconcile 并写入基本 `status.conditions`。

### Phase 1 — Deployment/Service/ConfigMap（T+4 天）

- 交付：
  - reconcile 首批受管资源；
  - `ConfigMap` 变更触发滚动发布；
  - `status.managedResources` 与 `status.release` 基础字段回写。
- 退出条件：
  - 业务 API 在集群内可达；
  - 能完成一次镜像版本滚动升级并稳定。

### Phase 2 — Secret/Ingress/HPA/PDB（T+4 天）

- 交付：
  - Secret 引用挂载、Ingress/TLS、HPA、PDB 收敛；
  - 失败条件与 `Degraded` 状态标准化。
- 退出条件：
  - secret 轮转触发零停机滚动；
  - 一次回滚演练可执行并留痕。

### Phase 3 — Observability Hooks（T+3 天）

- 交付：
  - 统一日志字段：`requestId` / `traceId` / `eventId`；
  - HTTP → publish/consume 链路 trace 贯穿；
  - 事件总线指标：发布成功率、消费延迟 P95、DLQ 增速、重试次数。
- 退出条件：
  - QA 可按任一 `requestId` 追到关联 `traceId` 与 `eventId`；
  - 事件管道看板和阈值生效。

## 6. 事件总线决策落地（承接 CLOA-68）

### 6.1 当前阶段强制策略

1. 审计事件默认写入 JetStream（持久化开启）；
2. DLQ 按业务域隔离（如 `dlq.interview`, `dlq.evaluation`, `dlq.audit`）；
3. 当前阶段不引入 Kafka 到生产链路。

### 6.2 兼容位预留（为未来 Kafka 做准备）

1. 统一事件 envelope：
   - `eventId`
   - `eventType`
   - `schemaVersion`
   - `occurredAt`
   - `requestId`
   - `traceId`
   - `sessionId`
   - `payload`
2. `go-backend/internal/events` 仅依赖 `Publisher` / `Subscriber` 接口；
3. DLQ replay 作业接口定义为总线无关契约（输入/输出不耦合 NATS SDK）；
4. schema 版本策略采用“向后兼容优先 + 弃用窗口”。

## 7. QA / CTO Gate 对齐（承接 CLOA-67）

首期交付必须同时满足：

1. Go 主链路验收通过；
2. Kubernetes 路径验收通过；
3. `requestId` / `traceId` / `eventId` 追溯性通过；
4. CTO 代码与架构评审通过。

执行规则：

- 未满足以上任一项，相关任务状态保持 `in_progress` 或 `in_review`；
- 仅当 QA 与 CTO 结论均明确通过时，方可进入 `done`。

## 8. 下游动作与依赖

### 8.1 Backend Engineer（依赖）

1. 冻结事件 envelope 与 schemaVersion 演进规则；
2. 完成 `requestId` / `traceId` / `eventId` 在 HTTP 与异步链路的注入；
3. 提供 DLQ replay 的业务幂等约束与回放策略。

### 8.2 Senior Cloud Native Operations Engineer（依赖）

1. 提供 JetStream 持久化参数基线（retention、replicas、storage）；
2. 按业务域落地 DLQ stream 与告警阈值；
3. 完成事件管道看板与成本归集指标接线。

### 8.3 CTO（评审依赖）

1. 审核并确认本蓝图作为首期执行基线；
2. 确认 Kafka 仅保留兼容位、不进入当前阶段范围；
3. 对 Phase 退出标准与双门禁规则给出最终口径。

## 9. 里程碑建议（首期两周）

1. Week 1：完成 Phase 0~1；
2. Week 2：完成 Phase 2~3 与一次端到端验收演练；
3. Week 2 末：提交 QA 验收包并发起 CTO 评审。

---

结论：以 `Operator 资源收敛 + Go 业务状态机 + JetStream 审计持久化 + DLQ 按域隔离 + 观测三键贯穿` 为首期执行主线，可在不引入 Kafka 生产依赖的前提下达成 implementation-ready 交付，并保持后续总线演进空间。
