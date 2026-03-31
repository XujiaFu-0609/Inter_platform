# AI Infra 面试平台 Go 后端与 Operator 实施约束 v0.1

## 1. 文档信息

- 日期：2026-03-27
- 对应任务：[CLOA-61](/CLOA/issues/CLOA-61)
- 关联基线：[CLOA-48](/CLOA/issues/CLOA-48)、[CLOA-57](/CLOA/issues/CLOA-57)、[CLOA-60](/CLOA/issues/CLOA-60)
- 适用范围：Cloud_Native 项目内后端研发、部署、测试与代码评审
- 产出人：CTO

## 2. 背景与目标

当前仓库已具备一版可运行的最小演示实现，可证明主链路存在、请求可返回 `requestId`，但该实现仍是演示基线，不是后续正式技术路线。

从 2026-03-27 起，Cloud_Native 项目进入统一技术约束阶段，后续研发按以下三条强约束推进：

1. **后端统一使用 Go**，不再新增 Node.js 作为正式后端实现；
2. **研发采用云原生交付思路**，部署与平台编排优先向 Kubernetes + Operator 模式靠拢；
3. **所有代码产出必须经过 CTO 评审**，未经 CTO 明确评审通过，不得视为完成。

## 3. 强制技术约束

### 3.1 后端语言与工程约束

1. 正式后端实现统一使用 **Go 1.22+**；
2. 对外 API 继续沿用 [CLOA-48](/CLOA/issues/CLOA-48) 冻结的 REST 口径，不因语言切换而改动 canonical 路径；
3. Go 后端优先采用**模块化单体**，但内部必须按清晰领域边界拆分：
   - 会话编排；
   - 题目下发；
   - 回答记录与结果汇总；
   - 审计与可观测；
4. 所有 mutating 接口必须支持 `requestId`，并预留 `traceId` 贯穿日志与链路追踪；
5. 现有 Node 演示实现仅作为过渡证据保留，不再承载正式后端新增能力。

### 3.2 云原生与 Operator 约束

1. 交付目标不是“能跑一个 Go 服务”就结束，而是形成可持续演进的 Kubernetes 交付基线；
2. Operator 的职责优先放在**平台资源编排与配置收敛**，不是把业务状态机直接搬进控制器；
3. 第一阶段推荐定义一个平台级 CRD，例如 `InterviewPlatform`，由 Operator 负责：
   - Deployment / Service / ConfigMap / Secret 关联资源收敛；
   - 环境级配置版本管理；
   - 伸缩、健康检查、回滚与观测接入的统一模板；
4. 业务会话状态机仍由 Go 服务负责，避免把高频业务流程错误地下沉到 K8s 控制面；
5. 本期若时间不足，可先完成 CRD 与 reconcile 框架设计 + 本地 kind/minikube 演练，不强求一步到位实现完整生产级 Operator。

### 3.3 代码评审与交付门禁

1. 所有代码任务完成后，必须在对应任务评论中回贴：
   - 代码路径；
   - 启动/验证命令；
   - 风险与未完成项；
2. 所有代码任务在关闭前，必须由 CTO 明确评审；
3. QA 可以先做功能与回归验证，但 **QA 通过不等于 CTO 架构评审通过**；
4. 如实现偏离本文件约束，必须先在任务评论中说明原因并等待 CTO 决策。

## 4. 分阶段落地策略

### 4.1 Phase 1：Go 最小主链路替换

目标：用 Go 补齐与当前演示版等价的最小后端能力。

必达项：

1. 提供 Go 服务目录与可运行入口；
2. 覆盖 `interview-sessions`、`questions`、`answers`、`finalize`、`result-summary` 最小闭环；
3. 响应与日志保留 `requestId`，并补齐 `traceId`；
4. 提供最小 smoke 证据，证明 Go 路径可跑通。

### 4.2 Phase 2：Kubernetes 部署基线

目标：把 Go 服务以标准 Kubernetes 方式部署。

必达项：

1. 提供 Deployment / Service / ConfigMap / Secret / Ingress 或等效清单；
2. 给出本地集群启动与验证流程；
3. 接入最小探针、资源限制、日志采集约定；
4. 与现有演示证据路径对齐，补一份 k8s 部署验证证据。

### 4.3 Phase 3：Operator 雏形

目标：用 Operator 管理平台部署配置，而不是手工散落 YAML。

必达项：

1. 定义 `InterviewPlatform` CRD 字段草案；
2. 说明 reconcile 范围、状态字段与回滚策略；
3. 给出后续是否扩展到执行引擎/沙箱运行时的判断边界；
4. 明确哪些仍保留 Helm/YAML，哪些交给 Operator 接管。

## 5. 角色分工

1. **Backend Engineer**
   - 负责 Go 服务 skeleton、API 主链路与日志链路；
2. **Frontend Engineer**
   - 负责前端继续对齐 canonical API，不耦合 Node 演示实现细节；
3. **Cloud Native Architect**
   - 负责 Operator 边界、CRD 设计与平台分层；
4. **Senior Cloud Native Operations Engineer**
   - 负责 Kubernetes 部署、运行手册、环境变量与观测接入；
5. **QA Lead**
   - 负责 Go 路径与 k8s 路径的验收清单、回归策略与证据模板；
   - 首版双路径验收清单见：`工作目录/架构/CLOA-67-Go与K8s双路径QA验收清单-v0.1-2026-03-27.md`；
6. **Big Data Architect**
   - 负责从事件总线、链路观测、容量与成本角度评审平台方案；
7. **CTO**
   - 负责统一架构口径、代码评审与阶段性收口。

## 6. 当前判定

1. 当前 `app/server.js` 可继续作为演示兜底，不立即删除；
2. 但后续不得继续把 Node 路径视为正式后端主线；
3. 所有新增后端能力、部署脚本、控制器设计，默认以 Go + Kubernetes + Operator 约束推进；
4. 若出现“为了赶时间继续堆 Node 逻辑”的情况，视为偏离架构约束，需要 CTO 单独豁免。

## 7. 下一步执行要求

1. 立即拆分并指派 Go 后端、Kubernetes、Operator、前端对齐、QA 验证、平台评审任务；
2. 所有子任务必须回链 [CLOA-61](/CLOA/issues/CLOA-61)；
3. 所有代码类子任务在评论中 @CTO 请求评审后，方可申请关闭；
4. 当 Go 最小主链路与 k8s 部署证据齐备后，再由 CTO 决定是否关闭 [CLOA-61](/CLOA/issues/CLOA-61)。
