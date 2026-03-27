# EAP-0005 Volcano 与大数据融合架构图

日期：2026-03-26

```mermaid
flowchart TB
    SRC[数据源\nDB/日志/消息总线] --> INGEST[采集层\nCDC/ETL/Streaming]
    INGEST --> STORE[数据存储层\nS3/MinIO/HDFS]
    STORE --> META[元数据目录\nHive Metastore/Catalog]

    META --> SPARK[Spark on K8s\n离线批处理]
    META --> FLINK[Flink on K8s\n实时计算]
    META --> RAY[Ray on K8s\nAI/分布式任务]

    subgraph VOL[Volcano 调度与治理层]
      Q[Queue\nprod-realtime/prod-batch/ai-train/dev-sandbox]
      PG[PodGroup\nGang 调度]
      ACT[Actions\nenqueue/allocate/preempt/reclaim/backfill]
    end

    SPARK --> VOL
    FLINK --> VOL
    RAY --> VOL

    VOL --> K8S[Kubernetes 集群资源池\nCPU/GPU/内存]

    K8S --> OBS[可观测与治理\nPrometheus/Grafana/日志事件]
    OBS --> OPS[运维与成本治理\nSLA/容量/告警/成本]
    OPS --> CTRL[风险触发与升级机制\n阈值告警/升级路径/回滚决策]

    OPS --> BOARD[架构评审与发布门禁]
    CTRL --> BOARD
```

## 说明

1. Spark/Flink/Ray 统一通过 Volcano 调度，实现多引擎资源治理一致性。
2. Queue 承载租户与业务域隔离，PodGroup 保障分布式任务整组可运行。
3. 可观测层对排队、失败、抢占、回收等关键事件提供统一视图。
4. 风险触发与升级机制与发布门禁联动，确保命中阈值时可快速回滚。
