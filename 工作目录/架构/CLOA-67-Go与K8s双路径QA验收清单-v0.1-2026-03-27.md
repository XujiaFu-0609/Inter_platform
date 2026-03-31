# CLOA-67 Go/K8s 双路径 QA 验收清单 v0.1

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-67](/CLOA/issues/CLOA-67)
- 父任务：[CLOA-61](/CLOA/issues/CLOA-61)
- 关联基线：[CLOA-48](/CLOA/issues/CLOA-48)、[CLOA-61](/CLOA/issues/CLOA-61)
- 产出人：QA Lead

## 2. 验收目标与原则

本清单用于防止“Node 演示链路通过即视为正式路线通过”的偏差，强制将验收拆分为：

1. Go 后端主链路验收；
2. Kubernetes 部署路径验收；
3. `requestId` / `traceId` 可追溯性验收；
4. QA 与 CTO 双门禁验收。

验收结论必须满足：

- `Go 主链路 = 通过`；
- `Kubernetes 路径 = 通过`；
- `追溯性检查 = 通过`；
- `CTO 代码评审 = 通过`。

否则任务不得标记完成。

## 3. Go 后端主链路验收清单

> 目标：验证正式 Go 后端已对齐 [CLOA-48](/CLOA/issues/CLOA-48) canonical API 语义，且不依赖 Node 演示实现。

| 序号 | 检查项 | 验收标准 | 证据要求 |
| --- | --- | --- | --- |
| G1 | 服务实现语言 | 主服务代码与启动入口为 Go（非 Node 主路径） | 仓库路径与启动命令截图/日志 |
| G2 | 会话启动接口 | `POST /api/v1/interview-sessions` 行为与字段对齐基线 | 请求/响应样例，字段对照说明 |
| G3 | 会话详情接口 | `GET /api/v1/interview-sessions/{sessionId}` 返回状态与字段完整 | 响应样例与状态迁移说明 |
| G4 | 题目获取接口 | `GET /api/v1/interview-sessions/{sessionId}/questions` 可返回题目列表 | 接口返回样例 |
| G5 | 作答提交接口 | `POST /api/v1/interview-sessions/{sessionId}/answers` 幂等与状态更新正确 | 重复请求对比证据 |
| G6 | 会话结束接口 | `POST /api/v1/interview-sessions/{sessionId}/finalize` 正确收敛状态 | 结束前后状态证据 |
| G7 | 结果汇总接口 | `GET /api/v1/interview-sessions/{sessionId}/result-summary` 可返回结构化摘要 | 汇总响应样例 |
| G8 | 异常处理口径 | 关键错误场景返回码与错误结构一致 | 2 个以上异常场景样例 |
| G9 | Node 依赖隔离 | 验收链路不依赖 Node 服务进程作为主后端 | 进程列表/部署配置说明 |

## 4. Kubernetes 部署路径验收清单

> 目标：验证 Go 服务以 Kubernetes 标准部署方式可运行、可探测、可回滚。

| 序号 | 检查项 | 验收标准 | 证据要求 |
| --- | --- | --- | --- |
| K1 | 部署清单完整性 | 至少具备 Deployment、Service、ConfigMap、Secret（或等效） | 清单路径与版本 |
| K2 | 环境可启动 | 在 kind/minikube/目标集群可完成一次部署 | 部署命令与成功输出 |
| K3 | Pod 就绪性 | Go 服务 Pod Ready，重启策略与镜像版本可追踪 | `kubectl get pods` 证据 |
| K4 | 健康探针 | `readinessProbe` / `livenessProbe` 生效 | 探针配置片段与状态输出 |
| K5 | 配置注入 | 关键配置由 ConfigMap/Secret 注入，不写死在镜像 | 环境变量与挂载证据 |
| K6 | 服务可达性 | 集群内可访问 API，关键路由返回符合预期 | 集群内调用日志/响应 |
| K7 | 基本资源约束 | 资源 request/limit 与副本策略已配置 | Deployment 片段 |
| K8 | 回滚可执行性 | 至少验证一次版本回滚流程可执行 | 回滚命令与结果证据 |

## 5. `requestId` / `traceId` 可追溯性检查项

> 目标：保证 QA 证据、服务日志、调用链可按一次请求串联复盘。

| 序号 | 检查项 | 验收标准 | 证据要求 |
| --- | --- | --- | --- |
| T1 | 响应携带 `requestId` | 主链路所有成功响应返回 `requestId` | 3 条以上响应样例 |
| T2 | 日志落盘 `requestId` | 应用日志可按 `requestId` 检索到完整处理轨迹 | 日志检索片段 |
| T3 | `traceId` 贯穿链路 | 入口、核心处理、下游调用日志包含同一 `traceId` | 单次请求跨阶段日志证据 |
| T4 | 异常场景可追踪 | 错误日志保留 `requestId` + `traceId` | 失败样例与排障路径 |
| T5 | 证据包索引规范 | QA 证据包以 `requestId` 为主键建立索引 | 证据目录与索引示例 |

## 6. QA/CTO 双门禁说明（强制）

1. QA 通过仅表示“功能与部署路径满足验收口径”；
2. 任务进入关闭前，必须由 CTO 完成代码与架构评审；
3. 未出现 CTO 明确评审结论前，任务状态应保持 `in_review` 或 `in_progress`，不得标记 `done`；
4. 如实现偏离 [CLOA-61](/CLOA/issues/CLOA-61) 约束，须先由 CTO 明确豁免后再推进关闭。

## 7. 执行与留痕模板

每次验收回贴评论建议包含：

1. 验收范围：Go 主链路 / K8s 路径 / 追溯性；
2. 证据路径：文档、日志、命令输出；
3. 结论：通过 / 不通过；
4. 未决风险：风险描述、影响范围、责任人；
5. 审批请求：@CTO 代码评审。

## 8. 当前未决风险（首版）

1. 目前仓库主运行实现仍含 Node 演示路径，需在后续任务中用 Go 主链路实证替代；
2. Kubernetes 路径当前以文档和模板为主，需补齐真实环境运行证据；
3. `traceId` 链路贯穿能力需结合实际日志方案验证，当前仅形成口径尚未看到实测证据。
