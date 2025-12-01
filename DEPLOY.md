# Uptime Monitor 部署与维护指南

本指南将帮助你从零开始部署 Uptime Monitor 系统，并包含后期的维护教程。

## 一、 环境准备

1.  **Cloudflare 账号**: 用于托管 Worker, Pages 和 D1 数据库。
2.  **Node.js**: 本地开发环境需要安装 Node.js (建议 v18+)。
3.  **Git**: 用于代码版本管理。
4.  **Wrangler CLI**: Cloudflare 的命令行工具。
    ```bash
    npm install -g wrangler
    ```

## 二、 首次部署

### 1. 登录 Cloudflare
在终端中运行：
```bash
npx wrangler login
```
浏览器会弹出授权页面，点击允许。

### 2. 初始化 D1 数据库
```bash
# 创建数据库 (名字可以自定义，这里用 uptime-db)
npx wrangler d1 create uptime-db
```
执行成功后，控制台会返回一个 `database_id` (例如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)。

### 3. 配置 Worker
打开 `worker/wrangler.toml` 文件，修改以下内容：

*   **database_id**: 填入上一步生成的 ID。
*   **vars**:
    *   `DINGTALK_ACCESS_TOKEN`: 你的钉钉机器人 Token，Webhook 地址中的 Access Token 部分。
    *   `DINGTALK_SECRET`: 你的钉钉机器人加签密钥。
    *   `ADMIN_PASSWORD`: 设置你的后台管理密码。

### 4. 初始化数据库表结构
```bash
cd worker
# 执行 schema.sql (基础表结构)
npx wrangler d1 execute uptime-db --remote --file=schema.sql

# 执行迁移脚本 (补充字段)
npx wrangler d1 execute uptime-db --remote --file=migration_add_expiry.sql
npx wrangler d1 execute uptime-db --remote --file=migration_add_ua.sql
```

### 5. 部署后端 (Worker)
```bash
cd worker
npx wrangler deploy
```
部署成功后，你会获得一个 Worker 的访问地址 (例如 `https://uptime-worker.xxx.workers.dev`)。
**注意**：由于网络原因，建议绑定自定义域名（见下文“绑定域名”章节）。

### 6. 配置前端 (Pages)
1.  打开 `frontend/index.html` 和 `frontend/admin.html`。
2.  找到 `const API_BASE = '...'` 这一行。
3.  将其修改为你的 Worker 地址 (推荐使用自定义域名，如 `https://api.yourdomain.com`)。

### 7. 部署前端 (Pages)
```bash
cd frontend
# 这里的 project-name 可以自定义
npx wrangler pages deploy . --project-name uptime-monitor
```
部署成功后，你会获得一个 Pages 的访问地址 (例如 `https://uptime-monitor.pages.dev`)。

---

## 三、 绑定自定义域名 (强烈推荐)

为了保证国内访问稳定性，建议为 Worker 和 Pages 绑定自定义域名。

### 1. 绑定 Worker 域名 (API)
1.  登录 Cloudflare Dashboard。
2.  进入 **Workers & Pages** -> 选择你的 Worker (`uptime-worker`)。
3.  进入 **Settings** -> **Triggers** -> **Custom Domains**。
4.  点击 **Add Custom Domain**，输入如 `api.nianshu2022.cn`。
5.  等待生效后，记得更新前端代码里的 `API_BASE` 地址并重新部署前端。

### 2. 绑定 Pages 域名 (前端)
1.  进入 **Workers & Pages** -> 选择你的 Pages 项目 (`uptime-monitor`)。
2.  进入 **Custom Domains**。
3.  点击 **Set up a custom domain**，输入如 `uptime.nianshu2022.cn`。
4.  按照提示在 DNS 设置中添加 CNAME 记录 (如果域名在 CF 托管会自动添加)。

---

## 四、 后期维护与更新

### 1. 修改代码后如何更新？

**后端更新 (Worker)**:
```bash
cd worker
npx wrangler deploy
```
*修改后端逻辑（如监控频率、通知格式）后执行。*

**前端更新 (Pages)**:
```bash
cd frontend
npx wrangler pages deploy . --project-name uptime-monitor
```
*修改界面样式、JS 逻辑后执行。*

### 2. 数据库维护

**查看数据**:
可以通过 Cloudflare Dashboard -> D1 -> uptime-db 查看表数据。
或者使用命令行：
```bash
npx wrangler d1 execute uptime-db --remote --command="SELECT * FROM monitors"
```

**手动清理日志**:
虽然 Worker 会定期清理（如果写了清理逻辑），你也可以手动清理旧日志：
```bash
npx wrangler d1 execute uptime-db --remote --command="DELETE FROM logs WHERE created_at < datetime('now', '-30 days')"
```

### 3. 常见问题排查

*   **Q: 手机端无法加载列表？**
    *   A: 检查 `API_BASE` 是否使用了 `workers.dev` 域名。该域名在国内常被阻断，请绑定自定义域名。
*   **Q: 钉钉收不到消息？**
    *   A: 检查 `wrangler.toml` 中的 Token 和 Secret 是否正确。确保 Worker 已经重新 deploy。可以使用 `POST /test-alert` 接口测试。
*   **Q: SSL 证书显示过期或不正确？**
    *   A: 系统每日更新一次证书信息。你可以尝试在数据库中将该 monitor 的 `check_info_status` 字段置空，强行触发下一次检查更新。
*   **Q: 后台登录后没反应？**
    *   A: 检查浏览器 Console 是否有报错。如果是 401，尝试清除浏览器缓存或手动清理 SessionStorage。

---

## 五、 开发相关

### 目录结构
```
.
├── frontend/          # 前端静态资源
│   ├── index.html     # 公开状态页
│   └── admin.html     # 管理后台
├── worker/            # 后端 Worker 代码
│   ├── src/index.ts   # 核心逻辑
│   ├── schema.sql     # 数据库结构
│   └── wrangler.toml  # Worker 配置文件
├── DEPLOY.md          # 部署指南
└── REQUIREMENTS.md    # 需求文档
```
