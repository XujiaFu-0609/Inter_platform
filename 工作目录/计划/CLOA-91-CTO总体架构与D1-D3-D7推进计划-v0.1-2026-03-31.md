# CLOA-91 CTO总体架构与D1/D3/D7推进计划 v0.1

日期：2026-03-31（Asia/Shanghai）  
责任人：CTO  
关联任务：[CLOA-91](/CLOA/issues/CLOA-91)、[CLOA-96](/CLOA/issues/CLOA-96)  
关键依赖：[CLOA-79](/CLOA/issues/CLOA-79)、[CLOA-82](/CLOA/issues/CLOA-82)

[任务理解]

1. 目标是在排期前移的前提下，于 D1（2026-04-01）、D3（2026-04-03）、D7（2026-04-07）完成云原生数据平台一期的冻结、联调、验收闭环。  
2. 范围覆盖应用层平台 API 与前端骨架、数据层 PostgreSQL/Redis/Kafka、控制面 Operator/CRD、运行面 Spark/Flink + Volcano 调度与观测。  
3. 硬性约束不变：后端统一 Go，控制面优先 Kubernetes Operator（CRD/Controller），流批统一 Spark/Flink，并与 Volcano 集成，禁止使用 YARN。  
4. 非目标：本周不追求多租户权限体系、计费结算、复杂 AI 编排引擎、跨地域容灾；只交付首期可验收可扩展基线。  
5. 当前 D1 最大风险不是“没有方案”，而是“控制面、接口字典、流批运行口径仍未彻底收敛”，因此本计划以冻结口径与风险升级优先。  

关键假设：

1. `CLOA-79` 与 `CLOA-82` 的现有文档将作为 D1 冻结基线，不再推翻重做。  
2. Env-A（本地/Kind）与 Env-B（K8s 集成环境）在 2026-04-01 12:00 前可用。  
3. Big Data Architect、Backend Engineer、Frontend Engineer、Cloud Native Architect、QA Lead 均可按日节奏接收并执行子任务。  

[总体架构]

## 1. 应用层

- 前端：提供平台总览、运行列表、运行详情、告警视图与 Grafana 深链入口；不重复建设时序诊断能力。  
- 后端：Go API 作为统一聚合入口，承接平台态查询、写接口幂等、请求追踪与 DTO 标准化。  
- API 契约：统一 `requestId`、`traceId`、错误码、枚举字典、Grafana 深链字段，冻结 `platform/*` 与面试主链路接口。  

## 2. 数据层

- PostgreSQL：会话/任务/答案/评测/幂等记录/Outbox 真相源。  
- Redis：幂等预占、热点缓存、分布式锁、短期状态加速。  
- Kafka：事件总线、异步评测、Spark/Flink 作业触发、重试与 DLQ。  
- 数据计算：Spark 负责批处理，Flink 负责流处理，统一通过 Kafka 接入，不接 YARN。  

## 3. 控制面

- 使用 Go + `controller-runtime` 实现 Operator。  
- 核心 CRD：`InterviewPlatform`（平台运行基线）与 `InterviewPipeline`（批流任务、Topic、Queue、模板绑定）。  
- Controller 负责 Deployment/Service/ConfigMap/Secret/HPA/PDB、Kafka Topic 参数、Volcano Queue/PodGroup 绑定、状态回写。  
- 业务会话状态机保留在 Go 服务，不下沉为 Operator 主职责。  

## 4. 运行面

- Kubernetes 统一承载 API、Operator、Spark/Flink Job。  
- Volcano 统一负责 Spark/Flink 的队列、优先级、SLA 映射与抢占策略。  
- Grafana/Loki/Prometheus 提供观测；所有验收结论必须可回溯到指标、日志、事件与工件。  

[任务拆解与派工]

## Epic-1：D1 冻结口径与依赖收口（截止 2026-04-01 18:00）

| Story | Sub-task | 责任人 | 依赖 | DoD | 截止时间 |
| --- | --- | --- | --- | --- | --- |
| S1-1 接口冻结 | 冻结 `platform/*` DTO、错误码、枚举字典、Grafana 深链字段；输出版本号与变更窗口 | Backend Engineer | [CLOA-82](/CLOA/issues/CLOA-82) | 冻结稿发布；前后端/QA 统一引用；D1 后无破坏性变更 | 2026-04-01 12:00 |
| S1-2 控制面冻结 | 冻结 `InterviewPlatform/InterviewPipeline` spec/status、conditions、回滚策略 | Cloud Native Architect | [CLOA-79](/CLOA/issues/CLOA-79) | CRD 字段表、Reconcile 边界、回滚路径齐备 | 2026-04-01 12:00 |
| S1-3 队列冻结 | 冻结 Spark/Flink × Volcano 队列/SLA/优先级矩阵与最小观测字段 | Big Data Architect | 控制面冻结 | 队列命名、SLA 映射、样例作业输入齐套 | 2026-04-01 14:00 |
| S1-4 前端适配冻结 | 按冻结 DTO 调整页面字段、筛选器、状态标签与 Grafana 跳转 | Frontend Engineer | S1-1 | 本地页面不再依赖硬编码字段；字段来源可追溯 | 2026-04-01 16:00 |
| S1-5 D1 门禁冻结 | 锁定测试矩阵、缺陷分级、升级路径、证据模板 | QA Lead | S1-1/S1-2/S1-3 | `Conditional Go/No-Go` 判定口径冻结 | 2026-04-01 18:00 |

## Epic-2：D3 联调闭环与证据化（截止 2026-04-03 18:00）

| Story | Sub-task | 责任人 | 依赖 | DoD | 截止时间 |
| --- | --- | --- | --- | --- | --- |
| S2-1 主链路联调 | 跑通 API -> Kafka -> Spark/Flink -> Volcano -> 状态回写 -> 前端展示 | Backend Engineer + Big Data Architect + Frontend Engineer | Epic-1 | 至少 1 条批任务、1 条流任务链路全通，并留存证据 | 2026-04-02 18:00 |
| S2-2 控制面联调 | 校验 CRD 下发、资源收敛、状态回写、异常回滚 | Cloud Native Architect | Epic-1 | Operator 联调通过，失败/回滚路径可演示 | 2026-04-02 18:00 |
| S2-3 观测联调 | 打通 Grafana/Loki 指标、日志、告警、深链 | Cloud Native Architect + Frontend Engineer | S2-1/S2-2 | overview/runs/detail/alerts 均能跳观测面板 | 2026-04-03 12:00 |
| S2-4 缺陷与证据闭环 | 建缺陷台账、证据包、回归集并给出 D3 结论 | QA Lead | S2-1/S2-2/S2-3 | P0=0；新增 P1<=2 且有 owner/ETA；证据完整 | 2026-04-03 18:00 |

## Epic-3：D7 验收发布与稳定性收口（截止 2026-04-07 18:00）

| Story | Sub-task | 责任人 | 依赖 | DoD | 截止时间 |
| --- | --- | --- | --- | --- | --- |
| S3-1 性能与容量 | 完成 overview/runs 压测、队列容量核验、Pod 资源基线 | Backend Engineer + Big Data Architect | Epic-2 | 达到 P95 与资源阈值，形成报告 | 2026-04-05 18:00 |
| S3-2 长稳与演练 | 4h 长稳、失败重试、DLQ 回放、控制面恢复演练 | Cloud Native Architect + QA Lead | Epic-2 | 关键演练通过，故障恢复可复现 | 2026-04-06 18:00 |
| S3-3 发布决策 | 汇总回归、风险、豁免项，输出 Go/No-Go | QA Lead + CTO | S3-1/S3-2 | P0=0、P1=0、双签完成 | 2026-04-07 18:00 |

## CTO 直接派工口径

1. **Big Data Architect**
   - 负责 `Spark/Flink/Volcano` 队列模型、样例作业、容量阈值、联调样例。  
   - 本周不得引入 YARN 兼容分支。  
2. **Backend Engineer**
   - 负责 Go API、PostgreSQL/Redis/Kafka 接入、契约冻结、聚合接口与 `requestId/traceId`。  
   - 不得变更已冻结 canonical path 与状态语义。  
3. **Frontend Engineer**
   - 负责平台总览/列表/详情/告警视图与 Grafana 深链，按冻结 DTO 实现。  
   - 不自行定义状态字典。  
4. **Cloud Native Architect**
   - 负责 CRD/Controller、部署基线、Volcano 对接、观测与回滚方案。  
   - 不将业务状态机塞入 Operator。  
5. **QA Lead**
   - 负责 D1/D3/D7 门禁、缺陷分级、证据模板、回归与验收结论。  
   - 未留证据不算完成。  

[关键路径与并行计划]

1. **关键路径**
   - `CLOA-82` 接口/枚举冻结 → 前端适配与 QA 用例冻结。  
   - `CLOA-79` CRD/运行基线冻结 → Volcano/Spark/Flink 队列映射 → 控制面联调。  
   - 双冻结完成后，才能进行 D3 全链路联调与 D7 压测/长稳。  
2. **并行计划**
   - Backend 与 Cloud Native 并行完成接口冻结、CRD 冻结。  
   - Big Data 在 D1 前基于冻结 CRD/枚举补齐队列映射与样例作业。  
   - Frontend 在 DTO 冻结后并行适配页面；QA 同步更新测试矩阵与证据模板。  
3. **CTO 今日指令**
   - 2026-04-01 12:00 前，如 `CLOA-79` 或 `CLOA-82` 任一未明确“冻结/阻塞/回滚方案”，一律升级为 `No-Go 候选`。  
   - 2026-04-01 18:00 D1 允许 `Conditional Go`，但必须满足：Owner 明确、ETA 明确、回避措施明确、证据路径明确。  

[风险与缓解]

1. **风险1：接口字典继续漂移**
   - 缓解：`CLOA-82` 在 2026-04-01 12:00 锁版本；变更改为补丁窗口，不允许破坏性调整。  
2. **风险2：控制面补件停留在文档态**
   - 缓解：`CLOA-79` 必须附样例 CR、状态快照、回滚步骤；未提供则视为未收口。  
3. **风险3：Spark/Flink/Volcano 联调输入不齐**
   - 缓解：Big Data Architect 在 D1 交付一批一流两条样例链路与队列配置；否则 D3 默认 `Conditional Go`。  
4. **风险4：证据口径不统一导致无法验收**
   - 缓解：QA 统一模板，所有任务必须绑定 `用例ID-缺陷ID-证据路径`。  
5. **风险5：性能/长稳窗口被功能联调挤占**
   - 缓解：D3 晚间锁预压测窗口，D6 锁 4h 长稳窗口，任何新需求不插队。  

[评审节奏与本周交付]

1. **每日站会**
   - 每日 10:00，检查昨日完成、今日目标、阻塞与依赖状态。  
2. **每两天技术评审**
   - 2026-04-01、2026-04-03、2026-04-05 18:30 进行技术评审，聚焦冻结项、联调结果、风险升级。  
3. **里程碑验收**
   - D1：2026-04-01 18:00，验冻结与升级路径。  
   - D3：2026-04-03 18:00，验联调与证据闭环。  
   - D7：2026-04-07 18:00，验回归、性能、长稳与 Go/No-Go。  
4. **本周交付物**
   - 冻结版接口与枚举稿；  
   - 冻结版 CRD/Controller 与运行基线；  
   - Spark/Flink/Volcano 联调样例与队列矩阵；  
   - 前端平台骨架与观测深链；  
   - D1/D3/D7 证据包、缺陷台账与验收结论。  
