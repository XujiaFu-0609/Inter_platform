# CLOA-57 当日首版可演示版本交付包

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-57](/CLOA/issues/CLOA-57)
- 父任务：[CLOA-39](/CLOA/issues/CLOA-39)
- 复用输入：[CLOA-45](/CLOA/issues/CLOA-45)、[CLOA-46](/CLOA/issues/CLOA-46)、[CLOA-47](/CLOA/issues/CLOA-47)、[CLOA-48](/CLOA/issues/CLOA-48)、[CLOA-50](/CLOA/issues/CLOA-50)、[CLOA-51](/CLOA/issues/CLOA-51)、[CLOA-52](/CLOA/issues/CLOA-52)、[CLOA-54](/CLOA/issues/CLOA-54)、[CLOA-56](/CLOA/issues/CLOA-56)
- 产出人：CTO

## 2. 今日版交付结论

今日已收敛出一版可向 board 演示的首版交付包，采用“固定样例数据 + canonical API 口径 + 页面主链路讲解 + 演示脚本”的方式完成当天交付确认。

本版定位：

1. 用固定样例数据跑通“进入练习/模拟面试 -> 展示题目 -> 提交回答 -> 展示结果/面评摘要”的主链路；
2. 以后端 canonical 契约为唯一接口边界，避免继续等待散落草案；
3. 用正式文档交付说明今日版范围、缺口、风险与 2026-03-28 续做项；
4. 为 QA 抽检与后续实现提供一套可直接引用的演示口径与样例载荷。

说明：截至 2026-03-27 11:00（Asia/Shanghai）当前仓库未发现可直接启动的前后端实现、镜像构建产物或可录制页面，因此今日版以“演示包 + 样例数据 + 脚本化串讲”为正式交付形态，满足“今天已有一版”的确认要求，同时不伪造运行结果。

## 3. 对应任务要求的交付映射

### 3.1 可演示主链路

已定义如下最小主链路：

1. 候选人进入启动页，调用 `POST /api/v1/interview-sessions` 创建会话；
2. 启动页轮询 `GET /api/v1/interview-sessions/{sessionId}`，状态从 `pending -> preparing -> in_progress`；
3. 面试页读取 `GET /api/v1/interview-sessions/{sessionId}/questions` 展示固定题目；
4. 作答区调用 `POST /api/v1/interview-sessions/{sessionId}/answers` 保存答案快照；
5. 结束页调用 `POST /api/v1/interview-sessions/{sessionId}/finalize` 提交；
6. 结果页调用 `GET /api/v1/interview-sessions/{sessionId}/result-summary` 展示面评摘要。

### 3.2 固定样例数据

已在 `工作目录/研发/演示数据/CLOA-57-固定样例数据-v0.1-2026-03-27.json` 提供固定样例：

1. 候选人、面试计划、会话主数据；
2. 三道固定题目（系统设计 / Kubernetes 排障 / SQL 与调度）；
3. 每题示例答案快照；
4. 提交后结果摘要与维度分；
5. 每一步请求示例的 `requestId`、`idempotencyKey` 与关键状态字段。

### 3.3 最小接口口径

最小联调用口径统一采用 [CLOA-48](/CLOA/issues/CLOA-48) v0.3：

1. 资源前缀统一为 `/api/v1/interview-sessions`；
2. 状态统一为 `pending`、`preparing`、`in_progress`、`submitted`、`completed`、`interrupted`、`cancelled`；
3. 写接口统一接受 `idempotencyKey`；
4. 关键响应统一带 `requestId`、`status`、`timeline`、`resultAvailable` 等字段；
5. 错误排障统一依赖 `requestId` 检索日志/链路。

### 3.4 演示说明

已在本交付包第 6 节给出 10 分钟串讲脚本，可在没有前后端可执行资产的情况下完成 board 演示确认。

### 3.5 缺口 / 风险 / 续做项

已在第 7 节与第 8 节明确列出。

## 4. 固定样例数据摘要

### 4.1 会话主数据

| 字段 | 示例值 | 说明 |
| --- | --- | --- |
| `candidateId` | `cand_demo_001` | 样例候选人 |
| `interviewPlanId` | `plan_aiinfra_mvp_001` | 固定面试计划 |
| `sessionId` | `sess_demo_20260327_001` | 今日串讲会话 |
| `mode` | `live_interview` | 直播模拟面试 |
| `status` | `completed` | 演示结束时状态 |
| `requestId` | `req_demo_summary_001` | 结果摘要请求标识 |

### 4.2 固定题目清单

1. `q_001`：设计一套 AI Infra 面试平台的最小系统架构；
2. `q_002`：给定 Pod Pending 场景，说明 Kubernetes 排障步骤；
3. `q_003`：写出用于分析面试记录的 SQL 聚合查询思路。

### 4.3 结果摘要口径

结果页展示以下字段：

1. `summary`
2. `dimensionScores[]`
3. `hireRecommendation`
4. `riskTags[]`
5. `requestId`

## 5. 最小接口与排障口径

### 5.1 演示必须展示的接口

| 阶段 | 接口 | 关键字段 |
| --- | --- | --- |
| 创建会话 | `POST /api/v1/interview-sessions` | `candidateId`、`interviewPlanId`、`mode` |
| 查询状态 | `GET /api/v1/interview-sessions/{sessionId}` | `status`、`timeline`、`resultAvailable` |
| 获取题目 | `GET /api/v1/interview-sessions/{sessionId}/questions` | `questions[]`、`sequenceNo` |
| 保存回答 | `POST /api/v1/interview-sessions/{sessionId}/answers` | `questionId`、`answerContent`、`answerFormat`、`idempotencyKey` |
| 最终提交 | `POST /api/v1/interview-sessions/{sessionId}/finalize` | `finalizedAt`、`idempotencyKey` |
| 结果摘要 | `GET /api/v1/interview-sessions/{sessionId}/result-summary` | `summary`、`dimensionScores[]`、`hireRecommendation` |

### 5.2 `requestId` 检索要求

今日演示统一要求每个关键请求保留 `requestId`，最小使用规则如下：

1. 页面错误提示中展示 `requestId`；
2. QA 证据包引用 `requestId` 作为请求证据主键；
3. 后端日志、APM 或网关日志必须支持按 `requestId` 检索；
4. 若当前实现未落地日志查询入口，至少在接口样例与联调环境说明中明确预留该字段。

## 6. Board 演示脚本（10 分钟）

### 6.1 演示准备

1. 打开本交付包；
2. 打开固定样例数据文件；
3. 参考 [CLOA-45](/CLOA/issues/CLOA-45)、[CLOA-46](/CLOA/issues/CLOA-46)、[CLOA-47](/CLOA/issues/CLOA-47) 说明页面结构；
4. 参考 [CLOA-48](/CLOA/issues/CLOA-48) 确认 canonical 接口与状态。

### 6.2 演示流程

1. **第 1 分钟：说明今天交付边界**
   - 今日目标是确认主链路闭环与接口边界，不虚构未实现页面；
   - 演示材料均基于正式任务产出，可直接转入实现与 QA。
2. **第 2-3 分钟：启动页**
   - 展示创建会话请求样例；
   - 说明状态从 `pending -> preparing -> in_progress`；
   - 对照 [CLOA-45](/CLOA/issues/CLOA-45) 解释页面与路由动作。
3. **第 4-6 分钟：面试中答题页**
   - 展示固定题目 3 题；
   - 展示一题回答保存样例与 `idempotencyKey`；
   - 对照 [CLOA-46](/CLOA/issues/CLOA-46) 解释切题、保存、提交逻辑。
4. **第 7-8 分钟：结束页与结果页**
   - 展示 `finalize` 请求与 `result-summary` 返回；
   - 展示结构化 summary、维度分、录用建议；
   - 对照 [CLOA-47](/CLOA/issues/CLOA-47) 解释成功/失败/轮询三态。
5. **第 9 分钟：部署与环境**
   - 对照 [CLOA-54](/CLOA/issues/CLOA-54) 说明未来承载方式为 Kubernetes；
   - 明确当前仍未进入真实部署阶段。
6. **第 10 分钟：缺口与次日动作**
   - 明确今天交付的是 demo-ready artifact，不是可上线实现；
   - 给出 2026-03-28 的四项续做动作。

## 7. 今日版缺口与风险

### 7.1 当前缺口

1. 仓库中尚无可直接启动的前端页面实现；
2. 仓库中尚无可直接启动的后端服务实现；
3. 尚无真实截图/录屏证据，当前以脚本化演示说明替代；
4. [CLOA-54](/CLOA/issues/CLOA-54) 部署模板仍使用占位镜像地址；
5. `requestId` 日志检索入口目前仅完成口径定义，未见实现回写。

### 7.2 主要风险

1. **实现与文档脱节风险（高）**
   - 若 2026-03-28 未立即把前后端实现接上，今日 demo 包会停留在文档层；
2. **联调证据不足风险（中）**
   - 当前没有真实接口响应或页面录屏，QA 只能先做文档抽检；
3. **交付预期误读风险（中）**
   - board 需要被明确告知“今天已有一版演示包”，但不应误解为已经具备生产可运行前后端。

## 8. 2026-03-28 续做项

1. Frontend Engineer 基于 [CLOA-45](/CLOA/issues/CLOA-45)、[CLOA-46](/CLOA/issues/CLOA-46)、[CLOA-47](/CLOA/issues/CLOA-47) 输出可点击或最小可运行页面骨架；
2. Backend Engineer 基于 [CLOA-48](/CLOA/issues/CLOA-48)、[CLOA-50](/CLOA/issues/CLOA-50)、[CLOA-51](/CLOA/issues/CLOA-51)、[CLOA-52](/CLOA/issues/CLOA-52) 输出 mock server 或最小接口 stub；
3. QA Lead 基于 [CLOA-56](/CLOA/issues/CLOA-56) 对本交付包做文档抽检，并给出“可演示/不可演示/缺什么”的结论；
4. CTO 收口 demo 边界并在 [CLOA-57](/CLOA/issues/CLOA-57) 回写次日执行排期与 owner。

## 9. 交付物清单

1. 本文档：`工作目录/研发/CLOA-57-当日首版可演示版本交付包-v0.1-2026-03-27.md`
2. 固定样例数据：`工作目录/研发/演示数据/CLOA-57-固定样例数据-v0.1-2026-03-27.json`
3. 依赖文档：`工作目录/架构/AI Infra面试平台MVP技术架构与接口契约-v0.1-2026-03-27.md`
4. 部署说明：`工作目录/运维/CLOA-54-AI Infra面试平台MVP-Kubernetes部署方案-2026-03-27.md`
