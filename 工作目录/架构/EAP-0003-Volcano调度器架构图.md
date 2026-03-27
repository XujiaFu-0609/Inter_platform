# EAP-0003 Volcano 调度器架构图

日期：2026-03-26

```mermaid
flowchart TB
    U[业务提交作业\nVolcanoJob/PodGroup] --> APISERVER[Kubernetes API Server]
    APISERVER --> ADM[volcano-admission\n准入校验]
    ADM --> ETCD[(etcd)]

    ETCD --> CTRL[volcano-controllers\nQueue/PodGroup/Job 控制循环]
    ETCD --> SCH[volcano-scheduler\nActions + Plugins]

    CTRL --> PG[PodGroup 状态推进\nPending -> Inqueue]
    SCH --> Q[Queue 治理\ncapability/deserved/guarantee]
    SCH --> ACT[调度动作\nenqueue/allocate/preempt/reclaim/backfill]

    ACT --> NODESEL[节点选择与绑定]
    NODESEL --> N1[Node A]
    NODESEL --> N2[Node B]
    NODESEL --> N3[Node C]

    Q --> MON[监控与治理\n等待时长/抢占次数/完成时长]
    PG --> MON
```

## 组件说明

1. `volcano-admission`：在资源进入集群前进行校验，降低无效作业进入概率。
2. `volcano-controllers`：推进 Queue/PodGroup/VolcanoJob 等对象状态。
3. `volcano-scheduler`：根据动作链与插件链完成队列准入、节点打分、绑定与资源治理。
4. Queue 与 PodGroup 共同决定“谁能进队”和“何时整组启动”。

