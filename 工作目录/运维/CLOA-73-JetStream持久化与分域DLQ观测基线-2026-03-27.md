# CLOA-73 JetStream 持久化与分域 DLQ 观测基线

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-73](/CLOA/issues/CLOA-73)
- 来源蓝图：[CLOA-71](/CLOA/issues/CLOA-71)
- 关联评审：[CLOA-68](/CLOA/issues/CLOA-68)
- 产出人：Senior Cloud Native Operations Engineer

## 2. 本次交付范围

本次在平台侧完成以下交付：

1. JetStream 审计流持久化参数基线（retention / replicas / storage）；
2. 按业务域隔离 DLQ stream（interview / evaluation / audit）；
3. 接入事件管道健康看板与告警阈值（发布成功率、消费延迟 P95、DLQ 增速、重试次数）。

交付路径：

1. `工作目录/运维/部署模板/AI Infra面试平台/Helm/templates/nats.yaml`
2. `工作目录/运维/部署模板/AI Infra面试平台/Helm/templates/event-pipeline-observability.yaml`
3. `工作目录/运维/部署模板/AI Infra面试平台/Helm/templates/configmaps.yaml`
4. `工作目录/运维/部署模板/AI Infra面试平台/Helm/values-jetstream-baseline.yaml`

## 3. JetStream 审计流持久化参数基线

### 3.1 基线参数（建议生产）

| 项目 | 基线值 |
| --- | --- |
| 存储介质 | `file` |
| Stream 名称 | `AUDIT_EVENTS` |
| Subjects | `audit.events.>` |
| retention | `limits` |
| maxAge | `168h`（7 天） |
| maxBytes | `120GB` |
| replicas | `3` |

### 3.2 环境兼容策略

为兼容单节点开发环境，本模板会将 stream 实际副本数裁剪为：

`effectiveReplicas = min(nats.replicas, stream.replicas)`

因此本地 `nats.replicas=1` 时仍可渲染与启动；生产建议使用 `nats.replicas=3`。

## 4. 分域 DLQ stream 隔离基线

| 业务域 | Stream | Subject | retention | maxAge | maxBytes | replicas |
| --- | --- | --- | --- | --- | --- | --- |
| interview | `DLQ_INTERVIEW` | `dlq.interview.>` | `limits` | `336h` | `20GB` | `3` |
| evaluation | `DLQ_EVALUATION` | `dlq.evaluation.>` | `limits` | `336h` | `20GB` | `3` |
| audit | `DLQ_AUDIT` | `dlq.audit.>` | `limits` | `336h` | `20GB` | `3` |

说明：

1. 模板通过 `jetstream-bootstrap` Job 在安装/升级时自动执行 stream 创建或更新；
2. 应用侧可通过 `NATS_DLQ_STREAM_*` 与 `NATS_DLQ_SUBJECT_*` 环境变量进行生产者/消费者配置；
3. 该隔离策略避免跨域死信互相污染，支撑按域回放与按域告警。

## 5. 事件管道看板与告警阈值

### 5.1 看板指标（Grafana ConfigMap）

1. 发布成功率（5m）；
2. 消费延迟 P95（秒）；
3. DLQ 增速（条/分钟，按域）；
4. 重试次数（5m，按域）。

### 5.2 告警阈值（PrometheusRule）

| 指标 | Warning | Critical |
| --- | --- | --- |
| 发布成功率（5m） | `< 99%`（10m） | `< 95%`（5m） |
| 消费延迟 P95 | `> 2s`（10m） | `> 5s`（5m） |
| DLQ 增速 | `> 30 条/分钟`（10m） | `> 60 条/分钟`（5m） |
| 重试次数（5m） | `> 120`（10m） | `> 300`（5m） |

## 6. 使用方式

在环境 values 基础上叠加：

```bash
helm upgrade --install ai-interview-mvp \
  ./工作目录/运维/部署模板/AI Infra面试平台/Helm \
  --namespace ai-interview-mvp \
  -f values-prod.yaml \
  -f ./工作目录/运维/部署模板/AI Infra面试平台/Helm/values-jetstream-baseline.yaml
```

## 7. 验证与证据

建议最小验证：

```bash
helm template ai-interview-mvp ./工作目录/运维/部署模板/AI Infra面试平台/Helm
helm template ai-interview-mvp ./工作目录/运维/部署模板/AI Infra面试平台/Helm \
  -f ./工作目录/运维/部署模板/AI Infra面试平台/Helm/values-jetstream-baseline.yaml
```

证据目录：`evidence/2026-03-27-cloa-73/`

1. `helm-template-default.yaml`
2. `helm-template-jetstream-baseline.yaml`
3. `summary.txt`
