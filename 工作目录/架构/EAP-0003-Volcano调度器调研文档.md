# EAP-0003 Volcano 调度器调研文档（修订版）

日期：2026-03-26  
责任人：Cloud Native Architect  
状态：待评审

## 1. 调研目标与结论摘要

### 1.1 目标

围绕 Cloud_Native 项目对 AI/大数据批处理作业的调度诉求，评估 Volcano 在 Kubernetes 上的可行性、演进收益、落地风险与实施路径，形成可执行交付。

### 1.2 结论摘要

1. Volcano 适合承载需要 Gang Scheduling（整组调度）与队列治理的批任务场景，可显著降低“部分 Pod 抢占资源导致整作业卡死”的概率。
2. 对本项目，建议先以“单队列 + 示例作业 + 观测指标”最小闭环试点，再分阶段启用抢占/回收等高级策略。
3. 当前脚本与清单可支撑开发环境验证（未执行，仅整理），需在准生产前补齐版本基线、观测、回滚和安全配置。

## 2. 调研范围与版本基线

### 2.1 本次调研覆盖

1. Volcano 组件架构与调度流程。
2. Queue / PodGroup / VolcanoJob 等关键对象。
3. 与原生 kube-scheduler 的能力边界对比。
4. Cloud_Native 的落地方案、风险与实施计划。
5. 既有部署脚本整理与静态检查（不执行）。

### 2.2 版本与外部信息基线

截至 2026-03-26，本次文档引用的公开信息基线如下：

1. Volcano GitHub Releases 显示 `v1.14.1` 为 Latest（2026-02-14）。
2. Volcano 官方文档（Actions / Queue Resource Management）页面更新日期为 2025-01-24。
3. Volcano 2025 安全审计报告由 Ada Logics 执行，审计时间为 2025 年 3-4 月。

参考链接：

- https://github.com/volcano-sh/volcano/releases
- https://volcano.sh/en/docs/actions/
- https://volcano.sh/en/docs/queue_resource_management/
- https://volcano.sh/reports/Ada-Logics-Volcano-Security-Audit-2025.pdf

## 3. 为什么是 Volcano

Volcano 是 Kubernetes 原生批调度系统，面向 AI/ML/HPC/大数据等并行作业场景。在标准调度之上，重点补齐以下能力：

1. Gang Scheduling：基于 PodGroup 与最小可运行约束，控制作业“整组就绪后再放行”。
2. Queue 治理：多租户资源隔离、优先级控制、资源借用/回收/抢占。
3. 调度动作流水线：`enqueue -> allocate -> (preempt/reclaim) -> backfill`。
4. 与 Spark/Flink/Ray/MPI 等生态配合能力较成熟，适配批处理与训练任务。

## 4. 核心架构

### 4.1 组件

1. `volcano-scheduler`：执行调度动作与插件链，输出绑定决策。
2. `volcano-controllers`：处理 Queue/PodGroup/VolcanoJob 等 CRD 的控制循环。
3. `volcano-admission`：准入阶段做校验与默认化，减少无效提交。
4. `vcctl`：CLI 管理入口（可选）。

### 4.2 架构图

架构图见：`工作目录/架构/EAP-0003-Volcano调度器架构图.md`

## 5. 关键对象与调度语义

### 5.1 Queue（队列）

Queue 是多租户治理核心对象，主要字段与语义：

1. `capability`：队列资源使用上限。
2. `deserved`：应得资源份额（资源紧张时用于回收决策）。
3. `guarantee`：保底资源（仅本队列可用）。
4. `reclaimable`：是否允许被其他队列回收资源。

队列策略要点：

1. 建议满足 `guarantee <= deserved <= capability`。
2. 不宜一次性把 capability 配置为总资源上限，避免“高峰抢占放大”。
3. 对生产关键任务，建议独立高优先级队列并限制跨队列回收范围。

### 5.2 PodGroup（组调度对象）

PodGroup 描述一组强关联 Pod 的最小运行条件：

1. `minMember/minAvailable` 控制最小可启动副本门槛。
2. 只有满足门槛并通过 enqueue 后，控制器才会创建/推进对应 Pod。
3. 适合 MPI、分布式训练、分布式推理等“同起同停”场景。

### 5.3 VolcanoJob

`batch.volcano.sh` 的 Job 对象可表达多 task 角色、生命周期策略、重试与清理策略，适合批处理与训练编排。对 Cloud_Native 的价值：

1. 统一表达多角色任务（worker/ps/launcher 等）。
2. 配合 Queue 与 Gang 形成“提交即受控”的执行路径。
3. 与运维治理（配额、审计、可观测）协同更清晰。

## 6. 调度流程拆解（面向实施）

### 6.1 Enqueue

1. 核验作业是否满足最小资源要求。
2. 满足条件后将 PodGroup 状态推进至 Inqueue。
3. Inqueue 是控制器创建 Pod 的前置条件。

实施含义：

1. 能减少“资源不足时大量 Pending Pod 堆积”。
2. 但 enqueue 与 reclaim/preempt 有冲突窗口，策略组合需测试。

### 6.2 Allocate

1. 候选节点过滤（谓词类）。
2. 节点评分排序（node order/binpack/自定义插件）。
3. 满足 Gang 约束后提交绑定。

实施含义：

1. 是吞吐与性能的主要决定环节。
2. 建议先使用社区默认稳定插件，再逐步引入定制策略。

### 6.3 Preempt / Reclaim

1. `preempt`：同队列内高优先级任务抢占低优先级资源。
2. `reclaim`：跨队列回收超额资源，前提是目标队列可回收。

实施含义：

1. 需要审慎配置，避免业务抖动。
2. 关键业务与普通离线业务建议分层队列并定义不同策略。

### 6.4 Backfill

1. 对 BestEffort 等未显式资源请求任务做回填。
2. 用于提升碎片资源利用率。

实施含义：

1. 适合开发/测试环境资源榨干。
2. 生产建议有边界地启用，防止回填干扰关键作业观测。

## 7. 与原生 kube-scheduler 对比（聚焦本项目）

| 维度 | kube-scheduler | Volcano | 对 Cloud_Native 影响 |
|---|---|---|---|
| 组调度 | 弱（需额外机制） | 强（PodGroup/Gang 原生） | 分布式作业成功率提升 |
| 多租户队列治理 | 基础 | 强（Queue + reclaim/preempt） | 资源公平性与 SLA 更可控 |
| 批任务编排语义 | 基础 Job/CronJob | VolcanoJob 更强 | 复杂训练/批处理更易标准化 |
| 落地复杂度 | 低 | 中 | 需新增组件运维与策略治理 |
| 可观测改造成本 | 低 | 中 | 需补齐 Volcano 指标与事件面板 |

## 8. Cloud_Native 落地方案（建议）

### 8.1 阶段化实施

1. Phase-0（准备）：锁定 K8s/Volcano 版本矩阵、明确回滚路径。
2. Phase-1（试点）：单队列 + 单示例作业 + 最小观测（等待时长/完成时长）。
3. Phase-2（扩展）：按业务域拆分队列，启用优先级和限额。
4. Phase-3（治理）：逐步启用 preempt/reclaim，建设审计与成本报表。

### 8.2 发布门禁

1. 作业模板必须显式声明 `schedulerName: volcano`。
2. 必须声明 requests/limits，禁止无资源声明进入生产队列。
3. 必须绑定明确 queue，不允许默认队列承载关键作业。
4. 引入策略前必须通过回放压测和回滚演练。

### 8.3 观测指标建议

1. Queue 维度：排队时长、在队作业数、资源占用率。
2. PodGroup 维度：Inqueue 进入率、Gang 满足率、等待时长分位数。
3. 调度维度：调度周期耗时、绑定成功率、抢占/回收次数。
4. 作业维度：完成时长、失败率、重试次数、超时率。

## 9. 风险与缓解

### 9.1 技术风险

1. 版本兼容风险：K8s 与 Volcano 版本不匹配导致 CRD/行为差异。
2. 策略风险：抢占/回收参数不当导致核心业务抖动。
3. 运维风险：新增组件带来告警与故障排查复杂度。

### 9.2 安全与治理风险

1. 新增 admission/controller/scheduler 权限面。
2. 需关注社区安全公告与补丁窗口。
3. 参考 2025 安全审计结论，纳入基线检查与升级节奏。

### 9.3 缓解措施

1. 基线冻结：按季度升级，灰度验证后再全量。
2. 策略分级：开发先开，生产延迟启用抢占/回收。
3. 应急预案：保留“切回默认调度器”的模板与流程。
4. 权限最小化：按组件最小 RBAC 原则配置。

## 10. 本次脚本整理结果（不执行）

### 10.1 归档目录

`工作目录/运维/部署脚本/eap-0001/`

### 10.2 已整理文件

1. `create-minikube-cluster.sh`
2. `install-volcano.sh`
3. `manifests/queue.yaml`
4. `manifests/volcano-demo-job.yaml`

### 10.3 静态校验

1. 仅进行脚本可读性与语法层面检查。
2. 未执行集群创建、安装、资源下发或运行验证。

详细清单见：`工作目录/运维/部署脚本整理-2026-03-26.md`

## 11. 本次交付物清单

1. 调研文档（本文件）：`工作目录/架构/EAP-0003-Volcano调度器调研文档.md`
2. 架构图：`工作目录/架构/EAP-0003-Volcano调度器架构图.md`
3. 汇报材料（PPT）：`工作目录/架构/EAP-0003-Volcano调度器调研汇报.pptx`
4. 脚本整理清单：`工作目录/运维/部署脚本整理-2026-03-26.md`

