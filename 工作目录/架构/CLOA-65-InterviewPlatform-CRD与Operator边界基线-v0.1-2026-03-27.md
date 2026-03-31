# CLOA-65 InterviewPlatform CRD 与 Operator 边界基线 v0.1

## 1. 文档信息

- 日期：2026-03-27
- 对应任务：[CLOA-65](/CLOA/issues/CLOA-65)
- 父任务：[CLOA-61](/CLOA/issues/CLOA-61)
- 约束依据：`工作目录/架构/AI Infra面试平台Go后端与Operator实施约束-v0.1-2026-03-27.md`
- 产出角色：Cloud Native Architect

## 2. 目标与边界

本基线用于明确：

1. `InterviewPlatform` CRD 的平台级声明式模型；
2. Operator 首期负责的资源收敛范围；
3. 仍保留在 Go 业务服务内的状态与职责；
4. reconcile 与升级回滚策略；
5. 面向后续执行引擎/运行时扩展时，哪些能力可扩展进控制面，哪些必须留在业务面。

原则：**Operator 管平台资源与交付一致性，不承接候选人面试会话状态机。**

## 3. InterviewPlatform CRD 字段草案

### 3.1 API 定义

- Group: `platform.cloudnative.ai`
- Version: `v1alpha1`
- Kind: `InterviewPlatform`
- Scope: `Namespaced`

### 3.2 `spec` 字段草案

```yaml
apiVersion: platform.cloudnative.ai/v1alpha1
kind: InterviewPlatform
metadata:
  name: interview-platform-prod
  namespace: ai-interview
spec:
  version: "1.0.0"
  image:
    repository: registry.local/interview-api
    tag: "v1.0.0"
    pullPolicy: IfNotPresent
  replicas: 3

  runtime:
    port: 8080
    health:
      livenessPath: /healthz
      readinessPath: /readyz
    gracefulShutdownSeconds: 30

  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2"
      memory: "2Gi"

  service:
    type: ClusterIP
    port: 80
    targetPort: 8080

  ingress:
    enabled: true
    className: nginx
    host: interview.example.com
    tlsSecretRef: interview-tls
    annotations:
      nginx.ingress.kubernetes.io/proxy-body-size: "2m"

  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
    targetCPUUtilizationPercentage: 70

  config:
    envFromConfigMap:
      - interview-platform-config
    envFromSecret:
      - interview-platform-secret
    inline:
      LOG_LEVEL: info
      REQUEST_ID_HEADER: X-Request-Id

  rollout:
    strategy: RollingUpdate
    maxUnavailable: 0
    maxSurge: 1
    canary:
      enabled: false
      steps: []

  observability:
    metrics:
      enabled: true
      path: /metrics
    tracing:
      enabled: true
      provider: otel

  policy:
    pdb:
      enabled: true
      minAvailable: 2
    networkPolicy:
      enabled: true
      allowNamespaces:
        - ingress-nginx
        - observability
```

### 3.3 `status` 字段草案

```yaml
status:
  phase: Ready # Pending | Progressing | Ready | Degraded | Failed
  observedGeneration: 12
  conditions:
    - type: Reconciled
      status: "True"
      reason: ApplySucceeded
      message: All managed resources are in desired state
      lastTransitionTime: "2026-03-27T10:30:00Z"
    - type: Available
      status: "True"
      reason: MinimumReplicasAvailable
      message: Deployment has minimum availability
  endpoints:
    service: interview-platform.ai-interview.svc.cluster.local
    ingress: https://interview.example.com
  managedResources:
    deployment: interview-platform
    service: interview-platform
    configMaps:
      - interview-platform-config
    secrets:
      - interview-platform-secret
    ingress: interview-platform
    hpa: interview-platform
  release:
    currentRevision: "1.0.0"
    previousRevision: "0.9.2"
    lastSuccessfulReconcileAt: "2026-03-27T10:29:40Z"
```

## 4. Operator 资源收敛范围（首期）

### 4.1 明确纳管（Operator 主职责）

1. `Deployment`：镜像版本、探针、资源配额、滚动升级策略；
2. `Service`：服务暴露端口、selector、service 类型；
3. `ConfigMap`：平台配置键值与版本漂移收敛；
4. `Secret`：密钥引用与变更触发滚动（仅引用/挂载，不在 CRD 明文存储敏感值）；
5. `Ingress`：入口路由、TLS、网关注解模板；
6. `HorizontalPodAutoscaler`：基于 CPU（后续可扩展自定义指标）伸缩；
7. `PodDisruptionBudget`（建议首期纳管）；
8. `ServiceMonitor/PodMonitor`（若集群安装 Prometheus Operator，可选纳管）。

### 4.2 暂不纳管（保留 Helm/平台基础设施层）

1. 集群级组件安装（Ingress Controller、Prometheus、cert-manager）；
2. 命名空间生命周期与多租户配额体系；
3. 云厂商外部资源（RDS、对象存储、KMS）创建本身。

## 5. 业务状态保留在 Go 服务（不下沉控制器）

以下状态和流程必须继续在 Go 业务服务维护：

1. 面试会话状态机：`pending -> preparing -> in_progress -> completed`；
2. 题目下发、答题记录、最终汇总与评分触发；
3. 候选人/面试官业务身份与权限语义；
4. 业务幂等键、重试语义、领域补偿逻辑；
5. 高基数业务事件流（会话级）与审计明细。

原因：

- 业务状态高频、细粒度、强领域语义，不适合进入 K8s 控制面；
- 控制器应保持“最终一致+资源收敛”职责，避免承担业务编排复杂度。

## 6. Reconcile 流程设计

### 6.1 主流程

1. 读取 `InterviewPlatform` 对象，校验 spec（准入/默认化）；
2. 计算期望资源清单（Deployment/Service/ConfigMap/Secret/Ingress/HPA/PDB）；
3. 按依赖顺序 apply（Config/Secret -> Deployment -> Service -> Ingress/HPA/PDB）；
4. 检查可用性（Deployment available、Service endpoints、Ingress admission）；
5. 更新 `status.conditions` 与 `status.release`；
6. 记录事件（Normal/Warning）并暴露 reconcile 指标。

### 6.2 异常处理

- 对临时错误（API 冲突、短时依赖不可用）采用指数退避重试；
- 对配置错误（字段非法、引用不存在）设置 `Degraded/Failed` 条件并事件告警；
- 使用 finalizer 清理受管资源（按“仅删除本控制器创建且带 ownerReference 的对象”规则）。

## 7. 升级与回滚策略

### 7.1 升级

1. 默认 `RollingUpdate`，`maxUnavailable=0` 保证服务连续性；
2. 配置变更（ConfigMap/Secret 引用）触发 Deployment 版本滚动；
3. 关键版本升级要求：先灰度（可选 canary），再全量。

### 7.2 回滚

1. 当新版本不可用（探针失败、错误率阈值超限）时，Operator 将 `status.phase` 标记为 `Degraded`；
2. 通过 `spec.version` 回退到 `status.release.previousRevision`；
3. 回滚后记录 `lastSuccessfulReconcileAt` 并保留失败事件用于审计。

## 8. 执行引擎/运行时扩展边界判断

### 8.1 可纳入 Operator 的扩展

1. 执行平面的基础设施声明：Worker Deployment、队列消费 Deployment；
2. 运行时资源模板：资源配额、节点亲和、容忍、优先级类；
3. 执行组件配置版本与可用性收敛。

### 8.2 不纳入 Operator 的扩展

1. 单次面试任务调度决策本身；
2. 会话级任务重试编排与业务补偿；
3. 候选人级 SLA 判定逻辑。

判定规则：**凡是“平台资源期望状态”由 Operator 管；凡是“业务流程推进与领域决策”由 Go 服务/执行引擎服务层管理。**

## 9. 首期落地建议（两周内）

1. 第 1 周：完成 CRD + Controller skeleton + Deployment/Service/ConfigMap 收敛；
2. 第 2 周：补齐 Secret/Ingress/HPA/PDB 收敛与 status 条件；
3. 同步产出 kind/minikube 演练脚本与升级/回滚演示记录；
4. 评审门禁：CTO 评审通过后再进入下一阶段实现。

## 10. 风险与待确认项

1. Secret 来源（External Secrets vs 手工注入）需平台统一；
2. Canary 需要配合 Ingress/Gateway 能力，首期可先关闭；
3. 多环境 promotion（dev/stage/prod）流程需与 CI/CD 规范联动定义。

---

结论：`InterviewPlatform` Operator 首期应聚焦“Go 后端工作负载的 Kubernetes 资源收敛与发布一致性”，不承接面试业务状态机。该边界满足当前 MVP 快速推进，也为后续执行引擎扩展留下清晰控制面/业务面分层。
