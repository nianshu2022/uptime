# Cloudflare Serverless Uptime Monitor 需求分析文档

## 1. 项目概述
构建一个轻量级、零成本、高可用的网站监控系统。
*   **代码托管**：GitHub
*   **后端/核心逻辑**：Cloudflare Workers (处理定时任务、监测逻辑、API)
*   **数据存储**：Cloudflare D1 (Serverless SQLite 数据库)
*   **前端展示**：Cloudflare Pages (管理后台 & 状态页)
*   **通知渠道**：企业微信 (Enterprise WeChat)

## 2. 核心功能需求 (Functional Requirements)

### 2.1 网站状态监测 (Availability Monitor)
*   **监测频率**：默认每 5 分钟监测一次。
*   **监测方式**：发送 HTTP/HTTPS GET 请求。
*   **判定标准**：HTTP 状态码为 200-299 视为正常，其他或超时视为异常。
*   **高级验证** (可选)：支持检查响应内容中是否包含特定“关键词”，防止伪 200 状态（如服务器返回 200 但页面显示“数据库错误”）。
*   **响应时间记录**：记录每次请求的耗时（ms），用于生成趋势图。

### 2.2 故障确认与重试机制 (Retry Logic)
为避免网络抖动导致误报，需实现“三振出局”机制：
1.  **初次异常**：记录状态，不立即报警。标记需在 1 分钟后重试。
2.  **重试阶段**：
    *   Worker 每分钟运行一次，检查是否有标记为“Retrying”的任务。
    *   如果重试 1 次仍失败 -> 记录，等待下一次重试。
    *   如果重试 2 次仍失败 -> 记录，等待下一次重试。
3.  **最终报警**：如果连续 3 次监测（初次 + 2次重试）均失败，标记状态为 **DOWN**，并触发报警。
4.  **恢复通知**：当网站从 DOWN 状态变回 UP 状态时，发送“服务恢复”通知。

### 2.3 资产有效期监测 (Expiry Monitor)
*   **SSL/TLS 证书监测**：在 HTTP 请求握手阶段获取证书信息，计算剩余有效期。低于阈值（如 7 天）报警。
*   **域名到期监测**：通过 RDAP/WHOIS 接口检查域名到期时间（可选，技术复杂度稍高，建议优先实现 SSL 监测）。

### 2.4 通知系统 (Notification)
*   **渠道**：企业微信 (WeChat Work) 应用消息。
*   **消息内容**：
    *   监控对象（名称/URL）
    *   故障时间
    *   故障原因（状态码/超时/证书过期）
    *   当前重试次数

### 2.5 管理面板 (Dashboard)
*   受密码保护的管理界面。
*   功能：添加/编辑/删除监控项（URL、名称、监测频率）。
*   查看最近的监测日志和故障历史。

## 3. 系统架构与技术栈 (System Architecture)

### 3.1 架构图示
```mermaid
graph TD
    User[用户/管理员] -->|访问 Dashboard| Pages[Cloudflare Pages]
    Pages -->|API 请求| Worker[Cloudflare Worker]
    
    Cron[Cron Trigger (每1分钟)] -->|触发| Worker
    
    Worker -->|读写任务/日志| D1[(Cloudflare D1 数据库)]
    Worker -->|HTTP 请求| Target[目标网站]
    Worker -->|Webhook| WeCom[企业微信]
```

### 3.2 关键技术决策
1.  **Cron 策略**：
    *   虽然需求是“每5分钟监测一次”，但为了实现“失败后1分钟重试”，Cron Trigger 必须设置为 **每 1 分钟触发一次** (`* * * * *`)。
    *   **逻辑**：Worker 每次运行时，查询数据库，找出 `(上次检查时间 + 间隔 < 当前时间)` 或者 `(状态 == Retrying && 上次重试 + 1分钟 < 当前时间)` 的任务进行执行。

2.  **数据库设计 (D1 Schema 初稿)**

    *   **Monitors 表** (监控目标)
        *   `id`: INT (PK)
        *   `name`: TEXT (网站名称)
        *   `url`: TEXT (监控地址)
        *   `interval`: INT (默认 300秒)
        *   `status`: TEXT (UP / DOWN / RETRYING)
        *   `retry_count`: INT (当前重试次数 0-3)
        *   `last_check`: DATETIME
        *   `keyword`: TEXT (可选，关键词匹配)

    *   **Logs 表** (历史记录)
        *   `id`: INT (PK)
        *   `monitor_id`: INT
        *   `status_code`: INT
        *   `latency`: INT (ms)
        *   `created_at`: DATETIME
        *   `is_fail`: BOOLEAN

## 4. 开发路线图 (Roadmap)

### 第一阶段：核心后端 (Worker + D1)
1.  初始化 Wrangler 项目。
2.  创建 D1 数据库并编写 Schema (`monitors`, `logs`)。
3.  编写核心 Worker 逻辑：
    *   `checkSites()`: 遍历列表，发起请求。
    *   `handleRetry()`: 状态机逻辑处理（重试计数）。
    *   `sendWeChatAlert()`: 封装企业微信发送接口。
4.  配置 Cron Triggers。

### 第二阶段：API 与 前端 (Hono + React/Vue)
1.  在 Worker 中集成 Hono 框架，暴露 REST API (GET /monitors, POST /monitors)。
2.  搭建 Cloudflare Pages 前端项目。
3.  实现简单的管理界面：列表展示、新增监控、日志查看。

### 第三阶段：优化与扩展
1.  SSL 证书过期检测逻辑。
2.  公开的状态页 (Status Page)。
3.  鉴权机制 (保护管理 API)。

