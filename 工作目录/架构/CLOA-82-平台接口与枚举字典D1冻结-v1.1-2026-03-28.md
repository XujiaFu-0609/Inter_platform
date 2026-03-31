# CLOA-82 平台接口与枚举字典 D1 冻结稿 v1.1

日期：2026-03-28  
责任人：Backend Engineer  
任务： [CLOA-82](/CLOA/issues/CLOA-82)  
父任务： [CLOA-76](/CLOA/issues/CLOA-76)  
联动任务： [CLOA-78](/CLOA/issues/CLOA-78)、[CLOA-79](/CLOA/issues/CLOA-79)

D1 冻结时点：**2026-03-28 12:00（Asia/Shanghai）**

## [时限澄清]

1. 原任务描述截止时间为：**2026-03-28 12:00（Asia/Shanghai）**。
2. 2026-03-27 评论线程新增“`deadline今天`”指令。
3. 本稿按“今天（2026-03-27）优先交付”执行，先保证 `platform/*` DTO、枚举字典、字段来源矩阵可评审可落地。
4. 截至 2026-03-28 13:27（Asia/Shanghai），已收到依赖侧可并版输入：`CLOA-78=done`、`CLOA-79=in_review`（评论 [c25a21d2](/CLOA/issues/CLOA-79#comment-c25a21d2-93c9-4a45-94e0-d81b0af2cc65) 提供最小回稿包），本稿据此发布 v1.1 并申请转 `in_review`。

## [实现方案]

1. **架构路径**
   - 运行面：`Go API + PostgreSQL + Redis + Kafka`。
   - 控制面：`InterviewPlatform/InterviewPipeline CRD + controller-runtime Reconciler`。
   - 计算面：Spark/Flink 作业运行于 Kubernetes，调度依赖 Volcano（不依赖 YARN）。
2. **`platform/*` 聚合责任划分**
   - API 层统一返回 DTO（`PlatformOverview/Run/RunDetail/Alert`），仅做聚合与标准化，不承载引擎特定复杂诊断。
   - Operator 提供平台控制态（CRD status、reconcile 健康）；Spark/Flink/Volcano 提供运行原始态。
3. **可靠性基线**
   - 幂等：写接口（如 `POST /api/v1/platform/alerts/{alertId}/ack`）强制 `Idempotency-Key`，Redis `SETNX` + PostgreSQL 唯一键兜底。
   - 重试：Kafka producer `acks=all` + 指数退避（100ms/300ms/900ms，最多 3 次）；consumer 失败先重试 topic，再入 DLQ。
   - 观测：统一 `requestId/traceId/eventId`，Grafana 深链参数由后端生成，前端禁止硬编码。
4. **性能量化目标（D3 前达成）**
   - `GET /platform/overview`：P95 `< 180ms`（缓存命中），P99 `< 350ms`。
   - `GET /platform/runs`：1000 行分页查询 P95 `< 280ms`。
   - `GET /platform/runs/{runId}`：P95 `< 220ms`。
   - `GET /platform/alerts`：P95 `< 250ms`。
   - 吞吐目标：平台查询聚合总体 `>= 800 RPS`（2 副本 API Pod，4C8G 节点基线）。

## [API与数据模型]

### 1) OpenAPI 冻结（v1）

```yaml
openapi: 3.0.3
info:
  title: Platform API
  version: v1
paths:
  /api/v1/platform/overview:
    get:
      summary: Get platform overview
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PlatformOverview'
  /api/v1/platform/runs:
    get:
      summary: List platform runs
      parameters:
        - in: query
          name: engineType
          schema: { $ref: '#/components/schemas/EngineType' }
        - in: query
          name: runStatus
          schema: { $ref: '#/components/schemas/RunStatus' }
        - in: query
          name: slaTier
          schema: { $ref: '#/components/schemas/SlaTier' }
        - in: query
          name: queueName
          schema: { type: string }
        - in: query
          name: page
          schema: { type: integer, minimum: 1, default: 1 }
        - in: query
          name: pageSize
          schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/PlatformRun' }
                  total: { type: integer }
  /api/v1/platform/runs/{runId}:
    get:
      summary: Get run detail
      parameters:
        - in: path
          name: runId
          required: true
          schema: { type: string }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PlatformRunDetail'
        '404': { description: not found }
  /api/v1/platform/alerts:
    get:
      summary: List alerts
      parameters:
        - in: query
          name: alertSeverity
          schema: { $ref: '#/components/schemas/AlertSeverity' }
        - in: query
          name: runStatus
          schema: { $ref: '#/components/schemas/RunStatus' }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/PlatformAlert' }
                  total: { type: integer }
  /api/v1/platform/alerts/{alertId}/ack:
    post:
      summary: Ack alert
      parameters:
        - in: header
          name: Idempotency-Key
          required: true
          schema: { type: string }
        - in: path
          name: alertId
          required: true
          schema: { type: string }
      responses:
        '200': { description: acked }
        '409': { description: idempotency conflict }
components:
  schemas:
    EngineType:
      type: string
      enum: [spark, flink]
    RunStatus:
      type: string
      enum: [pending, running, succeeded, failed, cancelling, cancelled]
    AlertSeverity:
      type: string
      enum: [p0, p1, p2, p3]
    SlaTier:
      type: string
      enum: [gold, silver, bronze]
    GrafanaLink:
      type: object
      required: [grafanaDashboardUid, grafanaPanelId, grafanaFrom, grafanaTo]
      properties:
        grafanaDashboardUid: { type: string }
        grafanaPanelId: { type: integer }
        grafanaFrom: { type: string, description: epoch ms }
        grafanaTo: { type: string, description: epoch ms }
        grafanaVars:
          type: object
          additionalProperties: { type: string }
    PlatformOverview:
      type: object
      required: [controlPlaneHealth, runtimeHealth, alertHealth, queueUtilization, slaBreachCount24h, generatedAt]
      properties:
        controlPlaneHealth: { type: string, enum: [healthy, degraded, down] }
        runtimeHealth: { type: string, enum: [healthy, degraded, down] }
        alertHealth: { type: string, enum: [healthy, degraded, down] }
        queueUtilization:
          type: array
          items:
            type: object
            properties:
              queueName: { type: string }
              pendingDepth: { type: integer }
              runningCount: { type: integer }
              utilizationRatio: { type: number, format: double }
              slaTier: { $ref: '#/components/schemas/SlaTier' }
        slaBreachCount24h: { type: integer }
        generatedAt: { type: string, format: date-time }
    PlatformRun:
      type: object
      required: [runId, engineType, runStatus, queueName, slaTier, startTime]
      properties:
        runId: { type: string }
        engineType: { $ref: '#/components/schemas/EngineType' }
        pipelineId: { type: string }
        queueName: { type: string }
        runStatus: { $ref: '#/components/schemas/RunStatus' }
        slaTier: { $ref: '#/components/schemas/SlaTier' }
        owner: { type: string }
        retryCount: { type: integer }
        checkpointLagMs: { type: integer, nullable: true }
        stageProgress: { type: number, format: double, nullable: true }
        startTime: { type: string, format: date-time }
        endTime: { type: string, format: date-time, nullable: true }
        durationMs: { type: integer, nullable: true }
        grafana: { $ref: '#/components/schemas/GrafanaLink' }
    PlatformRunDetail:
      allOf:
        - $ref: '#/components/schemas/PlatformRun'
        - type: object
          properties:
            failureCode: { type: string, nullable: true }
            failureReason: { type: string, nullable: true }
            events:
              type: array
              items:
                type: object
                properties:
                  eventTime: { type: string, format: date-time }
                  eventType: { type: string }
                  message: { type: string }
    PlatformAlert:
      type: object
      required: [alertId, alertSeverity, alertStatus, sourceType, sourceId, triggeredAt]
      properties:
        alertId: { type: string }
        alertSeverity: { $ref: '#/components/schemas/AlertSeverity' }
        alertStatus: { type: string, enum: [open, acked, resolved] }
        sourceType: { type: string, enum: [run, operator, infra] }
        sourceId: { type: string }
        relatedRunId: { type: string, nullable: true }
        summary: { type: string }
        labels:
          type: object
          additionalProperties: { type: string }
        triggeredAt: { type: string, format: date-time }
        ackedAt: { type: string, format: date-time, nullable: true }
        resolvedAt: { type: string, format: date-time, nullable: true }
        grafana: { $ref: '#/components/schemas/GrafanaLink' }
```

### 2) 领域模型（冻结）

1. `PlatformRunAggregate`
   - 主键：`runId`
   - 核心字段：`engineType/runStatus/slaTier/queueName`
   - 扩展字段：`checkpointLagMs(Flink)`、`stageProgress(Spark)`（非通用字段可空）。
2. `PlatformAlertAggregate`
   - 主键：`alertId`
   - 生命周期：`open -> acked -> resolved`。
3. `PlatformOverviewSnapshot`
   - 聚合窗口：近 5 分钟运行态 + 24 小时告警/SLA 统计。
4. `GrafanaDeepLink`
   - 统一由后端拼装：`dashboardUid + panelId + from/to + vars`。

### 3) 字段权威来源矩阵（冻结）

| 字段/对象 | 权威来源 | 采集方式 | API 层职责 |
| --- | --- | --- | --- |
| `engineType` | 后端字典（受 CLOA-78 输入约束） | 配置+校验 | 统一枚举输出 |
| `runStatus` | 引擎原始态（Spark/Flink）+ 映射规则 | Kafka 事件/查询接口 | 标准化为统一状态 |
| `alertSeverity` | 告警规则中心（Operator/Ops） | 告警流 | 透传+标准化 |
| `slaTier` | Volcano 队列策略（CLOA-78） | 队列配置快照 | 关联 run/queue |
| `controlPlaneHealth` | Operator CRD status（CLOA-79） | K8s API watch | 聚合健康态 |
| `runtimeHealth` | Spark/Flink 运行统计 | 指标与事件 | 汇总展示 |
| `alertHealth` | 告警生命周期统计 | Alert store | 汇总展示 |
| `grafana*` | 后端统一构造规则 | 配置模板 + 对象参数 | 生成深链对象 |

### 4) CTO 四问对照（联动 [CLOA-78](/CLOA/issues/CLOA-78) / [CLOA-79](/CLOA/issues/CLOA-79)）

> 说明（2026-03-28 v1.1）：`CLOA-78` 已 `done`，`CLOA-79` 已在评论 [c25a21d2](/CLOA/issues/CLOA-79#comment-c25a21d2-93c9-4a45-94e0-d81b0af2cc65) 回传“判定优先级 + CRD->DTO 映射 + 阈值窗口 + 拓扑快照”，本节完成并版落章。

| 字段/对象 | 1) 字段权威来源 | 2) 后端聚合输出 | 3) Operator/CRD 来源 | 4) Spark/Flink/Volcano 原始运行态 |
| --- | --- | --- | --- | --- |
| `engineType` | 后端枚举字典（受 [CLOA-78](/CLOA/issues/CLOA-78) 约束） | 统一对外枚举 + 参数校验 | 无直接来源 | Spark/Flink 作业类型标记 |
| `runStatus` | 引擎状态事实 + 后端映射规则 | 归一化为 `pending/running/...` | 可用于补充 `degraded` 信号，不覆盖事实态 | Spark/Flink Job 状态、Volcano PodGroup 调度阶段 |
| `slaTier` | Volcano 队列策略（[CLOA-78](/CLOA/issues/CLOA-78)） | 与 run/queue 关联后输出 | 可从 CRD spec/status 读取绑定关系 | Volcano Queue/PodGroup 优先级与配额 |
| `controlPlaneHealth` | CRD `status.conditions`（[CLOA-79](/CLOA/issues/CLOA-79)） | 聚合为 `healthy/degraded/down` | `InterviewPlatform` / `InterviewPipeline` 状态条件 | 无直接来源 |
| `runtimeHealth` | 引擎运行指标与事件 | 近 5 分钟窗口汇总健康度 | Controller 可上报平台级降级信号 | Spark/Flink 指标、失败率、重试率、checkpoint lag |
| `queueUtilization.*` | Volcano 队列真实占用 | 统一输出 `pending/running/utilizationRatio` | 可透出 queue binding 异常 | Queue 深度、并发占用、资源水位 |
| `alertSeverity` | 告警规则中心（控制面+运维） | 标准化并用于筛选/统计 | Operator 事件可直接产出告警 | 引擎/基础设施事件触发原始告警 |
| `grafana*` | 后端深链模板规则 | 生成统一深链对象 | 可附加 CRD 维度变量 | 可附加作业、队列、命名空间变量 |

## [代码任务清单]

1. 新增 `backend/api/openapi/platform-v1.yaml`，固化上述接口与枚举。
2. 新增 `backend/internal/platform/domain`：`run/alert/overview` 聚合与状态映射。
3. 新增 `backend/internal/platform/application`：`GetOverview/ListRuns/GetRunDetail/ListAlerts/AckAlert`。
4. 新增 `backend/internal/platform/infra/postgres`：运行态快照、告警读模型、枚举字典表。
5. 新增 `backend/internal/platform/infra/redis`：`overview` 缓存、幂等键存储。
6. 新增 `backend/internal/platform/infra/kafka`：run/alert 事件消费者、重试与 DLQ。
7. 新增 `backend/internal/platform/interfaces/http`：`platform/*` handlers 与请求校验。
8. 新增 Operator 映射器：读取 `InterviewPlatform.status` 与 `InterviewPipeline.status` 映射到 API DTO。
9. 新增迁移脚本：
   - `migrations/20260327_01_platform_enums.sql`
   - `migrations/20260327_02_platform_run_snapshot.sql`
   - `migrations/20260327_03_platform_alerts.sql`
   - `migrations/20260327_04_idempotency_records.sql`
10. 新增运行文档：`docs/runbook/platform-api.md`（依赖、回放、降级、Grafana 深链配置）。

## [测试与验证]

1. **单元测试**
   - 枚举映射：引擎状态到 `runStatus` 的全覆盖测试。
   - Ack 幂等：同 key 重放返回一致响应，不同 payload 返回 409。
   - Grafana 深链：UID/panel/time 窗口拼装正确性。
2. **集成测试（PostgreSQL/Redis/Kafka）**
   - `platform/runs` 查询链路：写入事件后可在读模型查询到。
   - `platform/alerts` + `ack`：事件驱动状态变化可回读。
   - 重试与 DLQ：消费失败达到阈值进入 DLQ。
3. **Operator 联动测试**
   - `envtest` 校验 CRD status 字段到 API 聚合映射。
   - 缺失依赖（Secret/queue）时，`controlPlaneHealth` 显示 `degraded`。
4. **验收命令建议**
   - `go test ./... -cover`
   - `make test-integration-platform`
   - `make test-operator`
   - `curl /api/v1/platform/*` 契约快照对比（golden file）。
5. **性能验证（量化）**
   - 压测场景：100 并发、10 分钟稳定压测。
   - 验收阈值：overview P95 `<180ms`，runs P95 `<280ms`，CPU `<1.4 core/pod`。

## [风险与技术债]

1. **CLOA-79 已回稿但工作目录文档未落盘（中）**：已基于评论 [c25a21d2](/CLOA/issues/CLOA-79#comment-c25a21d2-93c9-4a45-94e0-d81b0af2cc65) 并版，仍需补齐 `EAP-0008-CLOA-79-控制面CRD与运行基线-D1-v0.1-2026-03-28.md` 入库，便于审计追溯。
2. **多源口径漂移（高）**：Spark/Flink 原始态与 Operator 状态可能出现短时不一致，需定义优先级与滞后窗口。
3. **告警去重规则尚需补充（中）**：同源告警合并策略不完善会导致噪声。
4. **枚举扩展治理（中）**：新增引擎类型或 SLA 档位需要版本化策略（`x-enum-version`）。
5. **技术债（中）**：当前方案以 REST 为主，内部 gRPC 查询接口尚未落地，后续可降低跨服务聚合开销。

## [联动状态快照]

更新时间：2026-03-28 13:27（Asia/Shanghai）

1. [CLOA-78](/CLOA/issues/CLOA-78)：`done`，已提交 D1 冻结稿（`工作目录/架构/CLOA-78-Spark-Flink-Volcano-一期融合方案-D1冻结-v1.0-2026-03-27.md`）。
2. 已并入 `CLOA-78` 可用结论：`slaTier ↔ queue/priority`、`engineType`、`queueUtilization.*`、`platform/overview/runs` 最小字段与刷新周期。
3. [CLOA-79](/CLOA/issues/CLOA-79)：`in_review`，已在评论 [c25a21d2](/CLOA/issues/CLOA-79#comment-c25a21d2-93c9-4a45-94e0-d81b0af2cc65) 回传最小回稿包（`controlPlaneHealth` 优先级、CRD->DTO 映射、`degraded/down` 阈值窗口、运行拓扑快照）。
4. [CLOA-82](/CLOA/issues/CLOA-82)：据此发布 v1.1 并申请由 `blocked` 转 `in_review`。
5. D1 原冻结时点为 2026-03-28 12:00（Asia/Shanghai）；本次并版发生于 13:27，按“延迟冻结回执”处理并在父任务 [CLOA-76](/CLOA/issues/CLOA-76) 留痕。

## [v1.1 收口清单]

1. 回稿窗口：**2026-03-27 23:59（Asia/Shanghai）**  
   - [CLOA-78](/CLOA/issues/CLOA-78)：已完成（`done`）。
   - [CLOA-79](/CLOA/issues/CLOA-79)：已通过评论 [c25a21d2](/CLOA/issues/CLOA-79#comment-c25a21d2-93c9-4a45-94e0-d81b0af2cc65) 回传最小回稿包（文档路径待工作目录补录）。
2. 并版窗口：已发布 `CLOA-82 v1.1`（`工作目录/架构/CLOA-82-平台接口与枚举字典D1冻结-v1.1-2026-03-28.md`）。
3. 最终时点：D1 目标冻结时点为 **2026-03-28 12:00（Asia/Shanghai）**；实际并版回执时间为 **2026-03-28 13:27（Asia/Shanghai）**（+87 分钟）。
4. 后续动作：`CLOA-82` 转 `in_review`；在父任务 [CLOA-76](/CLOA/issues/CLOA-76) 标注“延迟冻结但已收口并版”。
