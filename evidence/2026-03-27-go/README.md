# 2026-03-27 Go 后端真实请求响应证据

本目录保存 `npm run smoke` 对 Go 后端（`go-backend`）的真实调用结果。

## 证据范围

1. 创建会话
2. 查询会话直到进入 `in_progress`
3. 拉取题目
4. 保存回答
5. 提交答案
6. 提交面评
7. 获取结果摘要

## 说明

- 每个 JSON 文件保留 `requestId` 与 `traceId`
- 数据来自本地运行中的 `http://127.0.0.1:3000`
- 可复现命令：`CAPTURE_DIR=evidence/2026-03-27-go npm run smoke`
