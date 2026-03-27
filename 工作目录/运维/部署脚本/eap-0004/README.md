# EAP-0004 运维脚本

本目录用于完成 CLOA-22：

1. 部署 Kubernetes Dashboard 并生成登录 token。
2. 调研并部署 Volcano 可视化 UI（Volcano Dashboard）。

## 文件说明

- `deploy-k8s-dashboard.sh`：启用 minikube dashboard/metrics-server，创建管理员 ServiceAccount，并输出登录 token。
- `deploy-volcano-dashboard.sh`：从 `volcano-sh/dashboard` 拉取官方部署清单并部署 Volcano Dashboard。
- `deploy-dashboard-ingress.sh`：启用 ingress 并暴露 Kubernetes Dashboard / Volcano Dashboard 的 Ingress 路由。
- `run-ingress-access.sh`：启动并保持 ingress `port-forward`，实时输出可直接访问的 Dashboard URL。
- `start-ingress-access.sh`：后台启动稳定端口（`18080`）访问通道并立即输出可打开 URL。
- `stop-ingress-access.sh`：停止后台访问通道（按 pidfile 和监听端口清理）。
- `manifests/dashboard-ingress.yaml`：两个 Dashboard 的 Ingress 资源定义。

## 使用方式

```bash
cd 工作目录/运维/部署脚本/eap-0004
bash deploy-k8s-dashboard.sh
bash deploy-volcano-dashboard.sh
bash deploy-dashboard-ingress.sh
bash start-ingress-access.sh
bash run-ingress-access.sh
bash stop-ingress-access.sh
```

如需指定 minikube profile，可设置环境变量：

```bash
PROFILE_NAME=eap-0001 bash deploy-k8s-dashboard.sh
PROFILE_NAME=eap-0001 bash deploy-volcano-dashboard.sh
PROFILE_NAME=eap-0001 bash deploy-dashboard-ingress.sh
PROFILE_NAME=eap-0001 bash start-ingress-access.sh
PROFILE_NAME=eap-0001 bash run-ingress-access.sh
PROFILE_NAME=eap-0001 bash stop-ingress-access.sh
```

## 通过 Ingress 访问（无 kubectl proxy）

推荐直接运行后台启动脚本（会自动启动稳定端口访问通道并输出 URL）：

```bash
bash start-ingress-access.sh
```

如需前台模式（便于观察日志/调试）：

```bash
bash run-ingress-access.sh
```

默认本地固定端口是 `18080`，随后直接访问：

- `http://k8s-dashboard.localhost:18080/`
- `http://volcano-dashboard.localhost:18080/`

以上域名基于 `localhost` 本地解析，按默认流程不需要修改 `/etc/hosts`，且端口稳定，不会每次变化。
