# CLOA-80 前端 API 对齐与平台可视化草图

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-80](/CLOA/issues/CLOA-80)
- 父任务：[CLOA-76](/CLOA/issues/CLOA-76)
- 关联基线：[CLOA-57](/CLOA/issues/CLOA-57)、[CLOA-71](/CLOA/issues/CLOA-71)
- 参考文档：`工作目录/计划/EAP-0008-研发一期复盘与一期执行计划-v0.1-2026-03-27.md`

## 2. 输出摘要（对齐 DoD）

1. **API 对齐差距**：候选人链路已对齐 canonical API，但平台态/运行态/告警态缺少专属聚合接口与字段标准。
2. **页面草图**：给出平台总览、作业运行、告警中心三类页面 IA 与交互路径。
3. **字段建议**：给出 Spark/Flink/Volcano/Grafana 对齐字段与前端 DTO 建议。
4. **Grafana 边界说明**：业务前端承载“决策入口 + 汇总态”，深度时序分析与日志排障跳转 Grafana。

---

[页面与交互拆解]

## 3. 信息架构（IA）与用户流程

### 3.1 页面 IA（一期）

1. `/platform/overview` 平台总览
   - 平台健康（控制面、作业面、告警面）
   - Spark/Flink 当前运行态摘要
   - 今日告警统计与升级事件入口
2. `/platform/runs` 作业运行页
   - 批流任务列表（引擎、队列、SLA、当前状态）
   - 支持按 `engine/queue/sla/owner/status` 过滤
3. `/platform/runs/:runId` 作业详情页
   - 运行时间线、最近事件、失败原因、重试记录
   - 指向 Grafana Dashboard/Panel 的深链入口
4. `/platform/alerts` 告警中心页
   - 告警列表、等级、状态（open/acked/resolved）
   - 批量确认、跳转关联 run 与 Grafana

### 3.2 核心用户流

1. **值班工程师流**
   - 进入总览 → 发现 `prod-realtime` 告警升高 → 点进告警中心 → 打开关联 run → 跳 Grafana 看时序细节。
2. **研发排障流**
   - 进入作业运行页 → 筛选 Flink + failed → 查看 run 详情失败事件 → 走 Grafana/Loki 深挖。
3. **管理视角流**
   - 进入总览 → 看队列容量与 SLA 达标 → 导出当日健康摘要（后续迭代）。

### 3.3 页面草图（低保真）

1. **平台总览**
   - 顶部筛选条：时间范围 / 环境 / 队列
   - 第一行：健康卡（Control Plane、Runtime、Alerts）
   - 第二行：Spark/Flink 运行态卡片（running/pending/failed）
   - 第三行：告警趋势 + Top 失败任务
2. **运行页**
   - 左侧筛选面板（engine/queue/sla/owner）
   - 右侧运行表格（状态灯、耗时、积压、重试、操作）
3. **告警页**
   - 告警分级统计条（P0/P1/P2）
   - 告警列表（来源、影响、触发时间、恢复时间、关联 run）

---

[组件与状态设计]

## 4. 组件边界与状态流

### 4.1 组件拆分

1. `PlatformShell`：统一布局、全局筛选、租户/环境上下文。
2. `OverviewHealthCards`：平台健康汇总卡。
3. `EngineRuntimePanel`：Spark/Flink 运行态卡片与趋势摘要。
4. `RunTable`：作业列表、分页、排序、批量操作。
5. `RunDetailTimeline`：单 run 生命周期与事件流。
6. `AlertCenterTable`：告警中心列表与处置动作。
7. `GrafanaJumpButton`：封装深链规则与权限校验。

### 4.2 前端状态分层

1. **路由级状态**：筛选参数、分页、排序（URL query 持久化）。
2. **领域状态（store）**
   - `platformOverviewState`
   - `runListState`
   - `runDetailState`
   - `alertState`
3. **UI 状态**：loading/skeleton/empty/error/retrying。
4. **会话态**：沿用现有 `interviewSessionApi`，与平台态 store 解耦。

### 4.3 状态机（运行/告警）

1. 运行态：`pending -> running -> succeeded | failed | cancelled`
2. 告警态：`open -> acked -> resolved`
3. 页面请求态：`idle -> loading -> success | error`（error 支持指数退避重试）

## 5. API 映射与差距分析

### 5.1 已对齐（当前仓库）

1. 候选人链路已统一到 `/api/v1/interview-sessions`。
2. 前端通过 `interviewSessionApi` 集中封装，避免直接耦合 Node fallback 行为。

### 5.2 差距（CLOA-80 重点）

1. 缺少平台总览 API（健康、容量、SLA 达标率）。
2. 缺少运行列表 API（批流任务统一抽象与过滤）。
3. 缺少告警中心 API（告警生命周期与处置动作）。
4. 缺少 Grafana 深链字段（dashboard uid/panel id/time range）。
5. 缺少前端可稳定消费的统一枚举（engine/status/slaTier/severity）。

### 5.3 建议接口（一期草案）

1. `GET /api/v1/platform/overview`
2. `GET /api/v1/platform/runs`
3. `GET /api/v1/platform/runs/{runId}`
4. `GET /api/v1/platform/alerts`
5. `POST /api/v1/platform/alerts/{alertId}/ack`

### 5.4 字段建议（前后端统一）

1. **运行对象（Run）**
   - `runId`、`engineType(spark|flink)`、`pipelineId`、`queueName`
   - `status`、`slaTier`、`startTime`、`endTime`、`durationMs`
   - `checkpointLagMs`（Flink）/`stageProgress`（Spark）
   - `retryCount`、`failureCode`、`failureReason`
2. **平台概览（Overview）**
   - `controlPlaneHealth`、`runtimeHealth`、`alertHealth`
   - `queueUtilization[]`、`pendingDepth`、`slaBreachCount24h`
3. **告警对象（Alert）**
   - `alertId`、`severity`、`status`、`sourceType`、`sourceId`
   - `triggeredAt`、`ackedAt`、`resolvedAt`
   - `relatedRunId`、`summary`、`labels[]`
4. **Grafana 深链**
   - `grafanaDashboardUid`、`grafanaPanelId`
   - `grafanaFrom`、`grafanaTo`、`grafanaVars`

### 5.5 Grafana 边界（必须明确）

1. **业务前端承载**：平台健康汇总、运行列表、告警入口、流程动作（ack/跳转）。
2. **Grafana 承载**：高粒度时序图、日志检索、链路诊断、长时间窗口容量趋势。
3. **边界原则**：前端不重复实现 Grafana 的时序分析能力，仅提供“问题发现 + 导航入口”。

---

[开发任务清单]

## 6. 研发任务拆解（Frontend）

### 6.1 P0（本期必做）

1. 新增 `platformApi` 适配层（与 `interviewSessionApi` 分离）。
2. 搭建 `overview/runs/alerts` 三页路由与骨架组件。
3. 实现加载态、空态、错误态、重试态统一组件。
4. 实现 Grafana 跳转按钮与参数拼装（不可硬编码 dashboard URL）。
5. 建立枚举映射层（状态色、文案、图标）避免散落判断。

### 6.2 P1（建议并行）

1. URL Query 与筛选状态双向同步。
2. 运行列表虚拟滚动与分页缓存。
3. 告警列表批量操作（ACK）与乐观更新。

### 6.3 P2（后续）

1. 总览页导出日报（CSV/PDF）。
2. 多环境对比视图（prod/staging）。

---

[联调与测试计划]

## 7. 联调计划

1. **契约冻结（D0）**：后端确认 `platform/*` 字段与枚举；前端锁定 DTO 与容错策略。
2. **Mock 联调（D1）**：前端先接 Mock JSON，覆盖成功/空/错三态。
3. **真实联调（D2）**：切到 Go canonical API，校验筛选、分页、状态映射。
4. **灰度验证（D3）**：引入真实告警样例，验证 Grafana 深链与权限跳转。

## 8. 测试计划

1. **单测**
   - API DTO 解析与字段容错
   - 状态枚举映射（颜色/文案/优先级）
   - Grafana URL 构造函数
2. **组件测试**
   - `RunTable` 过滤/分页/空态
   - `AlertCenterTable` ack 流程
3. **E2E（最小链路）**
   - 总览进入 → 过滤 run → 查看详情 → 跳 Grafana
   - 告警打开 → ack → 状态刷新
4. **性能基线**
   - `runs` 首屏渲染 < 2s（1000 行以内）
   - 筛选响应 < 300ms（本地缓存命中）

---

[风险与兼容性说明]

## 9. 风险与兼容性

1. **字段未冻结风险（高）**：状态枚举若频繁变更，会导致前端映射反复返工。
2. **多数据源口径风险（高）**：Spark/Flink 指标来源不一致会造成总览误判。
3. **Grafana 权限风险（中）**：前端跳转后可能因 SSO 权限不足失败，需提供兜底提示。
4. **大列表性能风险（中）**：运行列表在高基数下需分页+虚拟滚动，否则首屏抖动明显。
5. **兼容性说明（一期）**：优先桌面端 Chrome/Edge 最新两个大版本；移动端仅保证只读查看。

## 10. 下一步协作请求

1. 请 Backend Engineer 在 `platform/*` 接口返回中补齐 `grafana*` 深链字段与统一枚举。
2. 请 Cloud Native Architect 提供 `engine/status/severity/slaTier` 的权威字典。
3. 请 QA Lead 基于第 8 节补齐平台态回归用例（含告警处置链路）。
