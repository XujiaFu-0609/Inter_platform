# CLOA-54 AI Infra 面试平台 MVP Kubernetes 部署方案

## 1. 文档信息

- 文档版本：v0.1
- 产出日期：2026-03-27
- 对应任务：[CLOA-54](/CLOA/issues/CLOA-54)
- 关联任务：[CLOA-40](/CLOA/issues/CLOA-40)、[CLOA-48](/CLOA/issues/CLOA-48)
- 产出人：CTO

## 2. 目标与交付范围

本次交付面向 AI Infra 面试平台 MVP 的首版集群部署，目标是：

1. 将前端、后端、数据库、鉴权能力部署到公司自有 Kubernetes 集群；
2. 产出可复用的 Helm Chart；
3. 产出可接入 KubeVela OAM 的发布清单；
4. 为基础架构团队提供统一的环境参数、域名、密钥与存储对接面。

本次交付的部署单元包括：

1. `web`：候选人端 / 面试官端 / 后台统一前端入口；
2. `api`：平台后端 API / BFF；
3. `postgres`：业务主库；
4. `redis`：会话热点缓存；
5. `nats`：异步事件总线；
6. `minio`：录制文件 / 附件对象存储；
7. `keycloak`：MVP 登录认证服务。

## 3. 交付物位置

1. Helm Chart：`工作目录/运维/部署模板/AI Infra面试平台/Helm/`
2. KubeVela OAM 示例：`工作目录/运维/部署模板/AI Infra面试平台/KubeVela/`
3. 使用说明：`工作目录/运维/部署模板/AI Infra面试平台/README.md`

## 4. 部署拓扑

### 4.1 命名空间建议

- 命名空间：`ai-interview-mvp`

### 4.2 访问入口

1. 本地联调默认入口：
   - `web`：`http://interview.localhost:18080`
   - `api`：`http://api.interview.localhost:18080`
   - `auth`：`http://auth.interview.localhost:18080`
2. 生产环境建议覆盖为正式域名，例如：
   - `web`：`https://interview.example.internal`
   - `api`：`https://api.interview.example.internal`
   - `auth`：`https://auth.interview.example.internal`

### 4.3 组件依赖关系

1. `web -> api`
2. `api -> postgres`
3. `api -> redis`
4. `api -> nats`
5. `api -> minio`
6. `web/api -> keycloak`
7. `keycloak -> postgres`

## 5. 环境参数约定

### 5.1 必填参数

1. 镜像地址与版本：
   - `web.image.repository`
   - `api.image.repository`
2. 域名：
   - `global.hosts.web`
   - `global.hosts.api`
   - `global.hosts.auth`
3. 密钥：
   - PostgreSQL root / app / keycloak 密码
   - MinIO root 账户
   - Keycloak admin 密码
   - OIDC client secret
4. 存储：
   - PostgreSQL PVC 大小
   - MinIO PVC 大小
   - `storageClass`

### 5.2 可选参数

1. `auth.mode=external`：若基础架构团队统一提供外部 OIDC，可关闭内置 Keycloak；
2. `ingress.tls.enabled=true`：若集群已接入证书控制器，可直接启用 TLS；
3. `redis.enabled=false`、`nats.enabled=false`、`minio.enabled=false`：若对应中间件由平台侧托管，可改为外部地址；
4. `global.hosts.*`：生产环境请覆盖为正式域名，本地 smoke 默认使用 `*.localhost` 配合固定端口 `18080`。

## 6. 发布顺序

推荐使用以下顺序进行发布：

1. 先准备镜像与密钥；
2. 再创建命名空间与存储类参数；
3. 执行 Helm 安装；
4. 验证 `postgres / redis / nats / minio / keycloak` 就绪；
5. 验证 `api` 对数据库、对象存储、OIDC 的连通性；
6. 启动本地 Ingress 访问助手，确认 `web / api / auth` 三个入口可在浏览器直接打开；
7. 生产环境再切换为正式域名与 TLS。

## 7. 基础架构团队协同边界

需要基础架构团队协助确认以下事项：

1. Ingress Class 名称与默认控制器；
2. TLS 证书签发方式；
3. 默认 `StorageClass`；
4. 若采用外部认证，需提供：
   - `issuer`
   - `clientId`
   - `clientSecret`
   - 回调地址白名单

## 8. 回滚策略

1. Helm 默认保留版本历史，可通过 `helm rollback` 回滚；
2. `postgres` 与 `minio` 使用持久卷，回滚前需确认数据兼容性；
3. OIDC 配置变更优先使用参数回滚，不直接删除 `keycloak` 数据卷。

## 9. 风险与后续项

### 9.1 当前风险

1. 当前仓库尚未包含实际前后端容器镜像构建产物，部署模板使用占位镜像地址；
2. `keycloak` 在 MVP 阶段以单副本部署，正式生产需结合高可用方案评估；
3. `minio` 当前为单实例最小化部署，后续可切换为平台托管对象存储。

### 9.2 后续建议

1. 增补 CI 流水线，自动打包镜像并执行 `helm lint` / `helm template`；
2. 为 `api` 增加 `readinessProbe`、`livenessProbe` 的业务路径约定；
3. 为 `web` 与 `api` 增加 HPA 与 PDB；
4. 在 Week 2 增补灰度发布与监控告警基线。
