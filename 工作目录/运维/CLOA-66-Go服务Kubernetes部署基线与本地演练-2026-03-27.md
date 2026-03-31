# CLOA-66 Go 服务 Kubernetes 部署基线与本地演练

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-66](/CLOA/issues/CLOA-66)
- 来源任务：[CLOA-61](/CLOA/issues/CLOA-61)
- 对齐约束：`工作目录/架构/AI Infra面试平台Go后端与Operator实施约束-v0.1-2026-03-27.md`
- 产出人：Senior Cloud Native Operations Engineer

## 2. 交付清单

本次交付聚焦 Go 正式后端路线，提供最小 Kubernetes 基线与本地演练路径：

1. Go 服务最小清单（Deployment / Service / ConfigMap / Secret / Ingress）；
2. 本地 `kind` / `minikube` 演练步骤；
3. 探针、资源限制、日志与指标接入建议；
4. 与后续 `InterviewPlatform` Operator 的衔接边界。

交付路径：

1. `工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线/base/`
2. `工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线/kustomization.yaml`
3. `工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线/README.md`

## 3. 最小部署基线说明

### 3.1 Deployment

- 默认镜像：`registry.example.com/cloud-native/ai-interview-go-api:0.1.0`
- 端口：`8080`
- 健康检查：
  - `startupProbe`: `/startupz`
  - `livenessProbe`: `/healthz`
  - `readinessProbe`: `/readyz`
- 资源：
  - requests：`cpu 100m / memory 128Mi`
  - limits：`cpu 500m / memory 512Mi`

### 3.2 Service / Ingress

- `ClusterIP Service` 暴露 `80 -> 8080`
- Ingress Host：`api.interview.local`
- 默认 `ingressClassName: nginx`
- 预留 TLS 段（本地演练可先不填 secretName）

### 3.3 ConfigMap / Secret

- ConfigMap 提供业务与观测相关配置：
  - `APP_ENV`、`HTTP_PORT`
  - `REQUEST_ID_HEADER`、`TRACE_ID_HEADER`
  - `LOG_FORMAT`、`METRICS_ENABLED`
- Secret 预置敏感信息占位：
  - `DATABASE_DSN`
  - `JWT_SIGNING_KEY`
  - `OPENAI_API_KEY`

## 4. 本地演练步骤

### 4.1 kind 演练

```bash
kind create cluster --name ai-interview
kubectl apply -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl -n ai-interview-go rollout status deploy/ai-interview-go-api
kubectl -n ai-interview-go get pods,svc,ing
kubectl -n ai-interview-go logs deploy/ai-interview-go-api --tail=50
```

### 4.2 minikube 演练

```bash
minikube start --cpus=4 --memory=8192 --driver=docker
minikube addons enable ingress
kubectl apply -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl -n ai-interview-go rollout status deploy/ai-interview-go-api
kubectl -n ai-interview-go get pods,svc,ing
minikube service ai-interview-go-api --url -n ai-interview-go
```

## 5. 可观测与运行建议

1. **日志**：统一输出 JSON 到 stdout，至少包含 `requestId`、`traceId`、`sessionId`、`latencyMs`；
2. **指标**：暴露 `/metrics`，接入 Prometheus；通过 `podAnnotations` 启用抓取；
3. **健康检查**：探针路径由 Go 服务保证稳定，避免复用高成本业务接口；
4. **资源治理**：后续按压测结果调整 requests/limits，并补充 HPA 与 PDB。

## 6. 与 Operator 衔接

后续 `InterviewPlatform` Operator 建议以“收敛部署参数”为核心，不承载业务会话状态机：

1. Operator 接管：
   - 镜像版本、环境变量、Secret 引用；
   - Deployment 副本、资源、探针；
   - Service/Ingress 与域名、TLS；
2. Go 服务继续负责：
   - 面试会话状态流转；
   - 题目下发与回答记录；
   - 业务审计与结果汇总；
3. 从当前 YAML 到 CRD 字段映射建议：
   - `spec.api.image.*`
   - `spec.api.probes.*`
   - `spec.api.resources.*`
   - `spec.network.ingress.*`
   - `spec.runtime.config` 与 `spec.runtime.secretRefs`

## 7. 验证命令与证据

建议在仓库根目录执行：

```bash
kubectl kustomize ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl apply --dry-run=client -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
```

证据目录建议：`evidence/2026-03-27/k8s-go-baseline/`
