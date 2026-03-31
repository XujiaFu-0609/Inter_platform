# CLOA-78 Spark/Flink/Volcano 一期融合方案（D1 冻结稿）v1.0

日期：2026-03-27  
责任人：Big Data Architect  
任务：[CLOA-78](/CLOA/issues/CLOA-78)  
父任务：[CLOA-76](/CLOA/issues/CLOA-76)  
联动任务：[CLOA-82](/CLOA/issues/CLOA-82)

## [需求与假设]

1. **目标范围**：在 Kubernetes 上落地 Spark/Flink 流批一体运行面，并统一接入 Volcano 调度；禁止 YARN。
2. **场景范围**：
   - 场景 A：实时评测与运行态监控（秒级）
   - 场景 B：准实时运营指标（分钟级）
   - 场景 C：离线分析与日报（小时级/T+1）
3. **系统约束**：
   - 计算：Spark/Flink
   - 调度：Volcano（Queue/PodGroup/PriorityClass）
   - 数据与状态：Kafka + PostgreSQL + Redis
4. **协同边界**：
   - Go 服务负责平台 API 聚合（`platform/overview`、`platform/runs`）、字典校验、权限与审计。
   - Operator 负责 `StreamPipeline`/`BatchPipeline` 生命周期管理、策略注入与回滚。
5. **容量假设（一期）**：均值 `30k events/s`，峰值 `100k events/s`，消息均值 `1KB`，Kafka 保留 `7 天`。
6. **SLA 假设（一期）**：
   - 实时链路端到端 P95 `< 5s`
   - `platform/overview` 刷新周期 `10s`
   - `platform/runs` 列表刷新周期 `30s`

### 场景到引擎映射（D1 冻结）

| 产品场景 | 目标时效 | 推荐引擎 | 说明 |
| --- | --- | --- | --- |
| 实时评测事件聚合（答题/评分流水） | 秒级 | Flink | 事件时间 + 窗口聚合 + Checkpoint |
| 平台运行态总览（overview） | 10s 刷新 | Flink | 从 Kafka 运行事件流增量聚合 |
| 作业列表与详情（runs/run detail） | 30s 刷新 | Flink + Go 聚合 | Flink 汇总状态，Go 补齐元数据 |
| 报表与历史回放 | T+1/小时级 | Spark | 批量回补、复杂关联、离线导出 |

## [技术选型对比]

### 方案 A（推荐）：Flink 主实时 + Spark 主离线 + Volcano 统一调度

- 优点：
  1. Flink 在状态计算、低延迟、Exactly-once 上更稳。
  2. Spark 在离线 ETL、批回放、复杂 SQL 上成熟。
  3. 职责边界清晰，便于 SLA 分层治理。
- 缺点：双引擎运维复杂度更高。

### 方案 B：Spark 统一（Batch + Structured Streaming）+ Flink 仅补特例

- 优点：平台栈更集中，学习成本较低。
- 缺点：复杂实时状态场景（会话、CEP、长状态）能力与运维弹性弱于方案 A。

### 取舍结论

一期按**方案 A**冻结：实时与离线能力边界清晰，最符合当前 `platform/*` 秒级观测 + 离线分析并存需求。

## [平台架构设计]

### 1) 数据链路与分层

`业务日志/Operator事件/引擎运行事件 -> Kafka(ODS) -> Flink/Spark(DWD/DWS) -> PostgreSQL/Redis(ADS) -> Go API`

- ODS：原始事件（可追溯、可回放）
- DWD：标准明细（清洗、主键归一、维度补齐）
- DWS：主题汇总（分钟/小时聚合）
- ADS：应用服务层（面向 API 的查询模型）

### 2) Topic 命名与 Schema 规范（D1 冻结）

1. Topic 命名：`<domain>.<entity>.<event>.v<version>`
   - 示例：`platform.run.status-changed.v1`
2. 必填字段：`eventId,eventTime,traceId,tenantId,schemaVersion,engineType,slaTier,queueName`。
3. Key 规则：
   - 运行态事件使用 `runId` 作为 key（保证同 run 有序）。
4. Schema 演进：
   - 仅允许后向兼容新增字段；破坏性变更必须升 `v{n+1}` 新 topic。

### 3) `engineType` 冻结口径与扩展策略

- D1 可选值：`spark`、`flink`。
- 扩展策略（冻结）：
  1. 新增引擎需提交架构 RFC；
  2. 在 Go 枚举字典与 OpenAPI 同步发布；
  3. 上线前完成至少 1 条链路 PoC 与回滚预案。

### 4) `queueUtilization.*` 指标口径（D1 冻结）

| 字段 | 含义 | 计算口径 | 采样周期 |
| --- | --- | --- | --- |
| `pendingDepth` | 队列等待中的作业数 | Volcano Queue 中 Pending PodGroup 数 | 10s |
| `runningCount` | 队列运行中作业数 | Queue 中 Running PodGroup 数 | 10s |
| `capacityCpuCores` | 队列 CPU 容量上限 | Queue `capacity.cpu` 换算核数 | 60s |
| `utilizationRatio` | 队列利用率 | `runningRequestedCpu / capacityCpuCores`，范围 `[0,1+]` | 10s |

### 5) `platform/*` 最小字段集与刷新周期（给 [CLOA-82](/CLOA/issues/CLOA-82)）

1. `platform/overview` 最小字段：
   - `controlPlaneHealth,runtimeHealth,alertHealth,queueUtilization,slaBreachCount24h,generatedAt`
   - 刷新周期：`10s`
2. `platform/runs` 最小字段：
   - `runId,engineType,runStatus,queueName,slaTier,startTime,durationMs,retryCount`
   - 刷新周期：`30s`

## [流批一体与调度方案]

### 1) `slaTier` ↔ Volcano `queue/priority` 映射（D1 冻结）

| slaTier | 默认 Queue | PriorityClass | 默认策略 | 越级策略 |
| --- | --- | --- | --- | --- |
| `gold` | `realtime-high` | `pc-realtime-critical` | 保底资源，不被低优先级抢占 | 仅 SRE/值班经理可临时提升到专用高优队列，TTL 30 分钟 |
| `silver` | `batch-medium` | `pc-batch-standard` | 常规配额，允许被 gold 抢占 | 可在低峰提升到 `realtime-high`，需审批 |
| `bronze` | `adhoc-low` | `pc-adhoc-low` | 可抢占、可回收 | 禁止越级到 `gold` |

默认值：未显式声明 `slaTier` 的任务按 `silver` 处理。

### 2) Queue / PodGroup / PriorityClass 规范

1. 所有 Spark/Flink 作业必须显式声明：`schedulerName: volcano`。
2. Spark：Driver + Executors 绑定同一 PodGroup；最小成员数由 `minAvailable` 控制。
3. Flink：JobManager + TaskManagers 绑定 PodGroup，防止资源碎片导致长等待。
4. Queue 命名冻结：`realtime-high`、`batch-medium`、`adhoc-low`。

### 3) 弹性策略

1. Flink：按 `Kafka lag + CPU + checkpointDuration` 自动调并行度。
2. Spark：Dynamic Allocation（上下限绑定队列配额）。
3. Operator：根据 `slaTier` 注入默认资源档位（small/medium/large）。

### 4) 容错机制

1. Flink：Checkpoint（5s/10s）+ Savepoint 回滚。
2. Spark：失败重试（最多 3 次）+ 分区补跑。
3. Kafka：Producer `acks=all`，Consumer 重试 Topic + DLQ。
4. 下游幂等：按 `eventId` 或 `(runId,eventTime,eventType)` 去重写入 PostgreSQL/Redis。

### 5) SLA 与回滚阈值（D1 冻结）

| 指标 | 阈值 | 触发动作 |
| --- | --- | --- |
| 实时链路延迟 P95 | `> 5s` 持续 5 分钟 | 提升 Flink 并行度；无效则回滚到上版作业 |
| `realtime-high` 排队时长 P95 | `> 30s` 持续 5 分钟 | 抢占 `adhoc-low`；必要时暂停低优批任务 |
| 作业失败率（15 分钟窗） | `> 2%` | 进入降级模式，切换稳定版本 |
| Checkpoint 失败率（15 分钟窗） | `> 1%` | 回滚到最近可用 Savepoint |

## [实施计划与里程碑]

### 1) PoC 计划

- **PoC-1（W1）**：打通 `Kafka -> Flink -> PostgreSQL/Redis -> platform/overview`。
- **PoC-2（W2）**：打通 `Kafka -> Spark -> PostgreSQL` 离线报表链路。
- **PoC-3（W3）**：接入 Volcano 队列策略与 PodGroup 约束，完成压测与故障演练。
- **PoC-4（W4）**：灰度双写、指标对账、切流上线。

### 2) 容量评估（一期）

1. 日数据量（均值）：`30k/s * 1KB ≈ 2.59TB/天`。
2. Kafka 7 天逻辑量：约 `18TB`。
3. 副本因子 3 后物理量：约 `54TB`。
4. 计算资源建议（起步）：
   - Flink：`12~20` 个 TaskManager（按 lag 动态扩缩）
   - Spark：离线窗口预留 `80~120` vCPU 峰值。

### 3) 成本预估（月）

- 计算：`¥10万 ~ ¥16万`
- 存储（Kafka + PostgreSQL + Redis）：`¥6万 ~ ¥10万`
- 网络与运维：`¥2万 ~ ¥4万`
- 合计：`¥18万 ~ ¥30万/月`

### 4) 上线步骤

1. 环境基线冻结（版本、队列、字典）。
2. 双写灰度（新旧链路并行）。
3. 指标对账（延迟、失败率、口径一致性）。
4. 分业务域切流。
5. 全量切换并保留回滚窗口 24h。

## [风险与回滚方案]

1. **风险：口径漂移（`slaTier/engineType` 不一致）**  
   - 缓解：统一字典中心，发布门禁校验。  
   - 回滚：回退到上版字典与 API schema。
2. **风险：Kafka 积压导致实时 SLA 失效**  
   - 缓解：按 lag 自动扩容 + 限流。  
   - 回滚：切换到降级聚合逻辑（仅核心指标）。
3. **风险：Volcano 抢占误伤生产链路**  
   - 缓解：`realtime-high` 禁止被抢占，低优队列可回收。  
   - 回滚：恢复上版 Queue 配额与 PriorityClass。
4. **风险：PostgreSQL 热点写入**  
   - 缓解：按时间/租户分区，热点字段缓存到 Redis。  
   - 回滚：启用只读降级接口与缓存兜底。

---

## D1 最小冻结结论（给联动任务）

已冻结并可直接供 [CLOA-82](/CLOA/issues/CLOA-82) 使用：

1. `slaTier ↔ queue/priority` 映射（含默认值与越级策略）
2. `engineType` 可选值与扩展策略
3. `queueUtilization.*` 计算口径
4. `platform/overview` 与 `platform/runs` 最小字段集与刷新周期

