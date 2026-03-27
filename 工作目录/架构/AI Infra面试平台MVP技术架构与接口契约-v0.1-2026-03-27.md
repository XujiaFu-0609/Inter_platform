# AI Infra 面试平台 MVP 技术架构与接口契约 v0.3

## 1. 文档信息

- 版本：v0.3（QA 修订版，待复审）
- 日期：2026-03-27
- 对应任务：[CLOA-48](/CLOA/issues/CLOA-48)
- 上游任务：[CLOA-39](/CLOA/issues/CLOA-39)
- 关联研发拆解：[CLOA-41](/CLOA/issues/CLOA-41)
- 关联前端任务：[CLOA-43](/CLOA/issues/CLOA-43)
- 关联后端任务：[CLOA-44](/CLOA/issues/CLOA-44)
- 产出人：Cloud Native Architect

## 2. 目标与边界

### 2.1 目标

围绕 AI Infra 岗位面试平台 MVP，定义可执行的最小技术架构与接口契约，用于：

1. 支撑 W1 冻结前后端核心接口；
2. 保障 W2 可进入端到端联调；
3. 统一会话、题目、回答、面评、问题回流的数据与状态语义。

### 2.2 MVP 范围内能力

1. 候选人端会话启动、题目作答、提交与结果提示；
2. 面试官端会话控制、过程记录与面评提交；
3. 题库服务按场景下发题目；
4. 问题回流池沉淀并反哺题库治理；
5. 基础审计、可观测、鉴权、录制/存储能力接入。

### 2.3 范围外（后续阶段）

1. AI 自动评分与自动追问；
2. 多租户隔离与跨公司级权限域；
3. ATS/日历/会议系统深度集成。

## 3. 系统组件与服务边界

## 3.1 逻辑分层

1. **体验层**
   - 候选人端 Web
   - 面试官端 Web
   - 内容治理后台 Web
2. **接入层**
   - API Gateway / BFF（鉴权、流控、审计上下文注入）
3. **领域服务层**
   - 会话编排服务（Interview Session Orchestrator）
   - 题库服务（Question Bank Service）
   - 面评服务（Evaluation Service）
   - 问题回流服务（Issue Feedback Service）
4. **平台支撑层**
   - 身份鉴权（JWT/OIDC）
   - 对象存储（录制文件、附件）
   - 关系型数据库（业务主存）
   - 缓存（会话热点数据）
   - 代码执行适配层（对接外部执行引擎）
   - 消息总线（MVP 采用 NATS 承载异步事件）
   - 观测栈（日志/指标/链路追踪）

### 3.2 服务职责边界

1. **会话编排服务**
   - 管理会话生命周期与状态机；
   - 管理会话内题目顺序、回答草稿、提交动作；
   - 对前端提供会话主 API。
2. **题库服务**
   - 提供题目检索、题单解析、题目快照下发；
   - 会话创建时固化题目快照，避免过程变更。
3. **面评服务**
   - 提供结构化评分模板与评分结果持久化；
   - 输出候选人维度综合结论。
4. **问题回流服务**
   - 接收面试/笔试/编码练习问题标签；
   - 形成“待治理问题池”并关联题目修订任务。
5. **代码执行适配层**
   - 统一封装代码题运行、结果回传、超时与资源配额；
   - MVP 阶段仅暴露内部适配接口，不直接向前端开放执行引擎细节；
   - 使用外部执行引擎，平台内仅保留执行记录与审计。

### 3.3 交互原则

1. 同步主链路：前端 → Gateway → 会话编排服务；
2. 领域读写分离：题库/面评/回流通过内部 API 或事件解耦；
3. 关键动作事件化：提交答案、提交面评、回流入池均发布事件，供分析与治理系统消费。

## 4. 状态流转约定（会话主状态机）

### 4.1 Canonical 会话状态定义

- `pending`：会话已创建，等待候选人进入或等待资源准备开始。
- `preparing`：系统正在固化题单、分配会话资源、准备运行上下文。
- `in_progress`：候选人已开始作答，题目与回答链路开放。
- `submitted`：候选人已完成最终提交，等待面试官面评与结果汇总。
- `completed`：面评已提交，结果汇总稳定可读。
- `interrupted`：异常中断（网络/系统/人工终止，可在限定窗口内恢复）。
- `cancelled`：面试被人工取消，不再继续。

说明：`not_found` 仅作为前端异常展示态存在于 [CLOA-45](/CLOA/issues/CLOA-45)，不是后端持久化状态。

### 4.2 Canonical 状态迁移规则（MVP）

1. `POST /api/v1/interview-sessions` 创建成功后进入 `pending`；
2. `pending -> preparing`：候选人验权通过且题单/资源开始准备；
3. `preparing -> in_progress`：候选人开始作答或会话恢复完成；
4. `in_progress -> submitted`：候选人调用 `finalize` 提交最终答案；
5. `submitted -> completed`：面试官提交面评，生成稳定结果摘要；
6. `pending/preparing/in_progress -> interrupted`：弱网、资源失败、人工中止；
7. `interrupted -> preparing/in_progress`：允许 1 次恢复，且需在中断后 15 分钟内完成；
8. 任意非终态 -> `cancelled`：具备权限的面试官/管理员取消。

### 4.3 前后端状态映射表

| Canonical 状态 | [CLOA-48](/CLOA/issues/CLOA-48) 旧语义 | [CLOA-45](/CLOA/issues/CLOA-45) 前端展示 | [CLOA-50](/CLOA/issues/CLOA-50) 事件驱动语义 |
| --- | --- | --- | --- |
| `pending` | `draft` / `ready` | `pending` | create accepted |
| `preparing` | `ready` | `preparing` | provisioning / resume preparing |
| `in_progress` | `in_progress` | `in_progress` | `start` / `resume` |
| `submitted` | `reviewing` | 候选人端进入完成页，内部标记“待面评” | `finalize` |
| `completed` | `completed` | `completed` | `evaluation_submit` 后 `result-summary` 可读 |
| `interrupted` | `interrupted` | `interrupted` | `pause` 在 MVP 内统一映射为 `interrupt` |
| `cancelled` | `cancelled` | `completed`（附取消原因） | `cancel` |

### 4.4 Canonical 事件映射表

| 旧事件/动作 | Canonical 动作 | 说明 |
| --- | --- | --- |
| `start` | `start` | 候选人进入正式作答 |
| `pause` | `interrupt` | MVP 不提供独立 pause，统一落入中断恢复语义 |
| `resume` | `resume` | 恢复时需校验次数与截止时间 |
| `complete` | `finalize` + `evaluation_submit` | 拆分为候选人提交与面试官面评两个动作 |
| `cancel` | `cancel` | 保持一致 |

## 5. 接口契约草案（v0.3）

说明：以下为 W1 冻结前的 canonical 契约，供 [CLOA-45](/CLOA/issues/CLOA-45)、[CLOA-50](/CLOA/issues/CLOA-50)、[CLOA-51](/CLOA/issues/CLOA-51)、[CLOA-52](/CLOA/issues/CLOA-52) 回写对齐。

### 5.1 统一资源命名

1. Canonical 资源前缀统一为 `/api/v1/interview-sessions`；
2. `/api/v1/sessions`、`/api/interview-sessions` 仅作为草案历史写法，不再作为 W1 冻结口径；
3. 所有会话主状态、题目、回答、结果相关接口均挂在 `interview-sessions` 资源下。

### 5.2 会话创建与状态 API

1. `POST /api/v1/interview-sessions`
   - 用途：创建会话并固化题单快照
   - 必填字段：`candidateId`、`interviewPlanId`、`mode`
   - 条件必填：`entryToken`（候选人从启动链接进入时必填；管理后台代创建可省略）
   - 可选字段：`questionSetPolicy`、`interviewerId`、`plannedDurationMinutes`
   - 服务端派生字段：`positionId`、`questionSetId`、`plannedDurationMinutesResolved`
   - 返回：`sessionId`、`status=pending`、`timeline`、`questionSetPolicyResolved`
2. `GET /api/v1/interview-sessions/{sessionId}`
   - 用途：查询会话详情与当前状态
   - 返回：`status`、`timeline`、`progress`、`remainingResumeCount`、`resumeDeadlineAt`、`resultAvailable`
3. `POST /api/v1/interview-sessions/{sessionId}/events`
   - 用途：驱动状态迁移
   - 请求体：`eventType`（`start|interrupt|resume|cancel`）、`occurredAt`、`idempotencyKey`、`reasonCode?`
   - 返回：`status`、`timeline`、`remainingResumeCount`、`resumeDeadlineAt`
4. `GET /api/v1/interview-sessions/{sessionId}/timeline`
   - 用途：获取状态轨迹与关键时间点
   - 返回：`events[]`、`currentStatus`、`lastEventId`

### 5.3 题目与作答 API

1. `GET /api/v1/interview-sessions/{sessionId}/questions`
   - 用途：获取会话题目快照列表
   - 返回：`questions[]`（含 `questionId`、`type`、`stem`、`constraints`、`sequenceNo`）
2. `POST /api/v1/interview-sessions/{sessionId}/questions/next`
   - 用途：按题单策略下发下一题
   - 请求体：`strategyHint?`
   - 返回：`question`、`remainingQuestionCount`
3. `POST /api/v1/interview-sessions/{sessionId}/questions/{questionId}/ack`
   - 用途：确认题目已接收并开始作答
   - 请求体：`receivedAt`、`idempotencyKey`
   - 返回：`acknowledged=true`
4. `POST /api/v1/interview-sessions/{sessionId}/answers`
   - 用途：记录或覆盖作答快照
   - 请求体：`questionId`、`answerContent`、`answerFormat`、`clientSavedAt`、`idempotencyKey`
   - 返回：`answerId`、`answerVersion`、`savedAt`
5. `GET /api/v1/interview-sessions/{sessionId}/answers`
   - 用途：恢复已保存内容
   - 返回：`answers[]`（含每题最新版本、`finalized`）
6. `POST /api/v1/interview-sessions/{sessionId}/finalize`
   - 用途：候选人提交整场面试的最终答案（`in_progress -> submitted`）
   - 请求体：`finalizedAt`、`idempotencyKey`
   - 返回：`status=submitted`、`submittedAt`

### 5.4 面评、结果与回流 API

1. `POST /api/v1/interview-sessions/{sessionId}/evaluations`
   - 用途：提交结构化面评（`submitted -> completed`）
   - 请求体：`scores`、`summary`、`hireRecommendation`、`riskTags[]`、`idempotencyKey`
   - 返回：`evaluationId`、`status=completed`
2. `GET /api/v1/interview-sessions/{sessionId}/result-summary`
   - 用途：输出面评摘要与维度分
   - 返回：`status`、`dimensionScores[]`、`summary`、`hireRecommendation`
3. `GET /api/v1/interview-sessions/{sessionId}/review-findings`
   - 用途：汇总待改进项与证据片段
   - 返回：`findings[]`、`evidenceSnippets[]`
4. `POST /api/v1/interview-sessions/{sessionId}/feedback-items`
   - 用途：写入问题回流池
   - 请求体：`sourceType`、`problemType`、`description`、`relatedQuestionId`
   - 返回：`feedbackItemId`、`queueStatus`

### 5.5 会话创建字段字典（冻结口径）

1. `candidateId`：必填；候选人主键，由入口 token 或招聘系统映射得到。
2. `interviewPlanId`：必填；本次面试计划主键，是 `positionId`、默认时长、默认面试官的权威来源。
3. `mode`：必填；枚举建议固定为 `live_interview` / `take_home`，MVP 默认 `live_interview`。
4. `entryToken`：条件必填；仅候选人从启动链接首次进入时提供，不落业务表明文。
5. `questionSetPolicy`：可选；枚举建议固定为 `fixed` / `adaptive` / `manual_override`，缺省由 `interviewPlanId` 决定。
6. `interviewerId`：可选；缺省由 `interviewPlanId` 派生，仅在临时改派时传入。
7. `plannedDurationMinutes`：可选；默认取面试计划配置，允许后台手工覆盖。
8. `positionId`：响应字段；由 `interviewPlanId` 派生，不接受客户端直传。

### 5.6 错误码字典（冻结口径）

- `SESSION_NOT_FOUND`
- `INVALID_ENTRY_TOKEN`
- `SESSION_STATE_CONFLICT`
- `SESSION_RESUME_WINDOW_EXPIRED`
- `QUESTION_NOT_IN_SESSION`
- `QUESTION_DELIVERY_EXHAUSTED`
- `ANSWER_TOO_LARGE`
- `ANSWER_VERSION_CONFLICT`
- `FINALIZATION_ALREADY_ACCEPTED`
- `EVALUATION_ALREADY_SUBMITTED`
- `IDEMPOTENCY_KEY_REUSED`
- `PERMISSION_DENIED`

### 5.7 幂等与并发约定

1. 所有 mutating `POST` 接口统一接受 `idempotencyKey`（请求体字段）；
2. 幂等键作用域为 `sessionId + route + actorId`，服务端最少保留 24 小时；
3. 相同 `idempotencyKey` + 相同 payload 重放时，返回首次成功响应并标记 `idempotentReplay=true`；
4. 相同 `idempotencyKey` + 不同 payload 时返回 `409 IDEMPOTENCY_KEY_REUSED`；
5. `answers` 写入同时使用 `answerVersion` 做乐观并发控制，避免覆盖旧版本；
6. `finalize`、`evaluations` 仅允许成功一次，重复提交走幂等回放，不再创建新终态记录。

## 6. 数据模型初稿

### 6.1 核心实体

1. `candidate_profile`
   - `id`、`name`、`target_role`、`level`、`status`
2. `interview_session`
   - `id`、`candidate_id`、`interviewer_id`、`question_set_snapshot_id`、`status`
   - `planned_duration_minutes`、`started_at`、`submitted_at`、`completed_at`
   - `interrupt_count`、`resume_deadline_at`
   - `interview_plan_id`、`mode`、`position_id`
3. `session_question_snapshot`
   - `id`、`session_id`、`question_id`、`order_no`、`question_payload_json`
4. `session_event`
   - `id`、`session_id`、`event_type`、`from_status`、`to_status`、`idempotency_key`
   - `occurred_at`、`operator_id`、`reason_code`
5. `session_answer`
   - `id`、`session_id`、`question_id`、`version`、`answer_format`、`answer_content`
   - `saved_at`、`submitted_flag`
6. `session_evaluation`
   - `id`、`session_id`、`evaluator_id`、`scores_json`、`summary`
   - `hire_recommendation`、`risk_tags_json`、`created_at`
7. `feedback_item`
   - `id`、`session_id`、`source_type`、`problem_type`、`description`
   - `related_question_id`、`status`、`owner`

### 6.2 关系约束

1. 一个 `interview_session` 对应多个 `session_question_snapshot`；
2. 一个 `session_question_snapshot` 可对应多版 `session_answer`；
3. 一个 `interview_session` 在 MVP 阶段仅允许一条终态 `session_evaluation`；
4. `feedback_item` 与 `session_evaluation`、`session_question_snapshot` 可交叉关联。

## 7. 非功能需求与基础设施依赖

### 7.1 鉴权与权限

1. 统一 OIDC/JWT，前端通过 Gateway 校验；
2. 最小权限：候选人仅访问本人会话；面试官仅访问其授权场次；
3. 管理员可读全局数据并具备取消/纠偏权限。

### 7.2 录制与存储

1. 录制文件落对象存储，业务库仅保存元数据与索引；
2. 会话附件与日志需设置生命周期策略；
3. 录制失败不阻塞主流程，但必须写入审计事件。

### 7.3 审计与合规

1. 所有状态变更写入审计日志（操作者、时间、变更前后）；
2. 关键动作（开始/提交/面评）具备不可篡改事件记录；
3. 保留期建议：审计日志 180 天，录制文件按合规策略分级保留。

### 7.4 可观测性

1. 指标：会话成功率、提交失败率、平均答题时长、面评完成时延；
2. 日志：请求日志、状态变更日志、异常日志分级；
3. 链路：Gateway -> 会话服务 -> 题库/面评服务全链路 TraceId 贯通；
4. 告警：提交失败率、接口 P95 延迟、存储写入失败。

## 8. 风险与依赖清单（需跨角色决策）

### 8.1 需 CTO 决策（本周内）

1. **代码执行能力落地方式**：采用外部执行引擎，平台内通过代码执行适配层统一接入，避免 MVP 阶段自建沙箱带来的安全与交付风险。
2. **服务形态**：MVP 采用模块化单体，按会话编排 / 题库 / 面评 / 回流四个模块划清边界，待流量与团队规模验证后再按热点域拆分微服务。
3. **事件总线选型**：MVP 采用 NATS 承载异步事件，覆盖题目下发、最终提交、面评完成、问题回流等事件广播；后续若出现高吞吐分析链路，再评估补充 Kafka。
4. **会话恢复策略**：`interrupted` 状态允许恢复 1 次，恢复窗口为中断后 15 分钟，超窗后需面试官人工重建或改期。

### 8.1.1 决策落地要求

1. 后端在会话模型中补充 `interrupt_count`、`resume_deadline_at`、`session_event` 轨迹，并在接口返回中透出；
2. 前端在候选人端与面试官端明确展示“剩余恢复次数”和“恢复截止时间”，并将 `not_found` 视为前端异常态而非后端状态；
3. 编码题执行能力通过内部 `executionAdapter` 抽象封装，业务接口不直接耦合具体执行供应商；
4. 事件发布统一走 NATS subject 命名规范，供题目下发、面评、回流、审计链路复用。

### 8.2 需 Business Development Lead / 前后端协同

1. 前端状态机与后端状态码一一映射表落地到开发任务；
2. `CLOA-45/46/47` 与 `CLOA-44` 的接口字段命名在 W1 内冻结；
3. 联调入口统一使用 Mock + Contract Test 双轨推进。

### 8.3 需基础架构/大数据团队支持

1. 对象存储桶与生命周期策略；
2. 日志与指标采集管道、看板模板；
3. 回流事件入仓模型（支持后续题目区分度分析）。

## 9. 建议里程碑（架构视角）

1. **W1（本周）**：冻结 `interview-sessions`、`answers/finalize`、`evaluations/result-summary` 三组核心接口；
2. **W2**：前后端联调，完成会话启动到面评提交主闭环；
3. **W3**：补齐回流治理与观测看板，进入小范围试运行。

## 10. 下一步动作

1. 对齐并回写 [CLOA-45](/CLOA/issues/CLOA-45)、[CLOA-50](/CLOA/issues/CLOA-50)、[CLOA-51](/CLOA/issues/CLOA-51)、[CLOA-52](/CLOA/issues/CLOA-52) 的状态字典、路径命名、字段字典与幂等约定；
2. 由 Backend Engineer 基于第 5 节与第 8.1.1 节输出 OpenAPI 草案；
3. 由 Frontend Engineer 基于第 4 节落地前端状态机与恢复提示交互；
4. 由 Product Lead 对齐验收口径与字段定义，确保 [CLOA-42](/CLOA/issues/CLOA-42) 节奏同步；
5. 回写完成后重新发起 [CLOA-53](/CLOA/issues/CLOA-53) QA 复审。
