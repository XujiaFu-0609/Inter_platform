# Go 服务 Kubernetes 基线（CLOA-66）

本目录提供 Go 后端的最小 Kubernetes 可运行模板，覆盖：

1. Deployment
2. Service
3. ConfigMap
4. Secret
5. Ingress

## 1. 目录结构

1. `kustomization.yaml`：统一编排入口
2. `base/namespace.yaml`：命名空间
3. `base/configmap.yaml`：非敏感配置
4. `base/secret.yaml`：敏感配置占位
5. `base/deployment.yaml`：Go 服务部署定义（含探针与资源限制）
6. `base/service.yaml`：服务暴露
7. `base/ingress.yaml`：流量入口

## 2. 本地渲染与校验

在仓库根目录执行：

```bash
kubectl kustomize ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl apply --dry-run=client -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
```

## 3. kind 演练

```bash
kind create cluster --name ai-interview
kubectl apply -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl -n ai-interview-go rollout status deploy/ai-interview-go-api
kubectl -n ai-interview-go get pods,svc,ing
```

## 4. minikube 演练

```bash
minikube start --cpus=4 --memory=8192 --driver=docker
minikube addons enable ingress
kubectl apply -k ./工作目录/运维/部署模板/AI Infra面试平台/Go服务K8s基线
kubectl -n ai-interview-go rollout status deploy/ai-interview-go-api
kubectl -n ai-interview-go get pods,svc,ing
minikube service ai-interview-go-api --url -n ai-interview-go
```

## 5. 与 Operator 衔接建议

后续 `InterviewPlatform` Operator 可将本模板收敛为 CRD 参数：

1. `spec.api.image.repository/tag`
2. `spec.api.resources.requests/limits`
3. `spec.api.probes.{startup,readiness,liveness}`
4. `spec.runtime.config` 与 `spec.runtime.secretRefs`
5. `spec.network.ingress.host/className/tls`

Operator 首期只接管部署资源收敛，不承载业务会话状态机。
