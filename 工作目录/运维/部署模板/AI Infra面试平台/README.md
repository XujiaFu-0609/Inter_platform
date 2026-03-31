# AI Infra 面试平台部署模板

本目录包含 [CLOA-54](/CLOA/issues/CLOA-54) 的首版 Kubernetes 交付物：

1. `Helm/`：主部署模板；
2. `KubeVela/`：基于 Helm Chart 的 OAM 发布示例；
3. `Go服务K8s基线/`：面向 Go 正式后端路线的最小部署基线（[CLOA-66](/CLOA/issues/CLOA-66)）；
4. `Helm/values-jetstream-baseline.yaml`：JetStream 持久化、分域 DLQ 与事件管道告警基线（[CLOA-73](/CLOA/issues/CLOA-73)）。

## 1. 使用前准备

1. 准备前端与后端容器镜像；
2. 准备集群 Ingress、StorageClass，以及生产环境所需域名与 TLS；
3. 按实际环境覆盖 `Helm/values.yaml` 中的占位参数；
4. 若使用外部认证，将 `auth.mode` 改为 `external` 并关闭内置 Keycloak。

默认交付物已切换到本地联调友好的 `*.localhost` Host，可直接配合 Ingress 控制器端口转发访问，不需要修改 `/etc/hosts`。生产环境请通过额外的 values 文件覆盖为正式域名。

## 2. Helm 部署

```bash
kubectl create namespace ai-interview-mvp
helm upgrade --install ai-interview-mvp \
  ./工作目录/运维/部署模板/AI Infra面试平台/Helm \
  --namespace ai-interview-mvp
```

如需覆盖参数，建议新增环境文件，例如：

```bash
helm upgrade --install ai-interview-mvp \
  ./工作目录/运维/部署模板/AI Infra面试平台/Helm \
  --namespace ai-interview-mvp \
  -f values-prod.yaml
```

如需启用 [CLOA-73](/CLOA/issues/CLOA-73) 的 JetStream / DLQ / 观测告警基线，可叠加：

```bash
helm upgrade --install ai-interview-mvp \
  ./工作目录/运维/部署模板/AI Infra面试平台/Helm \
  --namespace ai-interview-mvp \
  -f values-prod.yaml \
  -f ./工作目录/运维/部署模板/AI Infra面试平台/Helm/values-jetstream-baseline.yaml
```

该基线会新增：

1. NATS StatefulSet + JetStream 持久化卷；
2. 审计流 `AUDIT_EVENTS` 持久化参数与按域隔离 DLQ stream（`DLQ_INTERVIEW`/`DLQ_EVALUATION`/`DLQ_AUDIT`）；
3. 事件管道健康看板（发布成功率、消费延迟 P95、DLQ 增速、重试次数）与 `PrometheusRule` 告警阈值。

### 2.1 本地直接访问 Ingress

与 `k8s-dashboard`、`volcano` 相同，推荐把 Ingress Controller 暴露到本机固定端口 `18080`：

```bash
bash ./工作目录/运维/部署模板/AI Infra面试平台/start-local-ingress-access.sh
```

启动后默认可访问：

- `http://interview.localhost:18080/`
- `http://api.interview.localhost:18080/`
- `http://auth.interview.localhost:18080/`

如需前台模式观察日志，可执行：

```bash
bash ./工作目录/运维/部署模板/AI Infra面试平台/run-local-ingress-access.sh
```

停止后台端口转发：

```bash
bash ./工作目录/运维/部署模板/AI Infra面试平台/stop-local-ingress-access.sh
```

## 3. KubeVela 部署

`KubeVela/application.yaml` 使用 `helm` 组件类型包装同一套 Chart，适合平台侧统一发布。

使用前请先完成：

1. 将 Helm Chart 发布到内部 Helm / OCI 仓库；
2. 将 `repoUrl`、`chart`、`version`、域名、镜像与密钥改为实际值；
3. 执行：

```bash
vela up -f ./工作目录/运维/部署模板/AI Infra面试平台/KubeVela/application.yaml
```

## 4. 最低验收项

1. `web`、`api`、`postgres`、`keycloak` Pod 正常启动；
2. `api` 能成功连接 PostgreSQL；
3. `web` 能访问 `api`；
4. 浏览器可跳转到 OIDC 登录页；
5. `helm template` 输出的清单可成功应用到测试集群；
6. `http://interview.localhost:18080/`、`http://api.interview.localhost:18080/`、`http://auth.interview.localhost:18080/` 可在本机浏览器直接打开。
