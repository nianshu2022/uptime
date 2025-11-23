# 部署指南 (Deployment Guide)

本指南将协助你将 Uptime Monitor 部署到 Cloudflare Workers 和 Pages。

## 1. 准备工作

确保你已经安装了 Node.js，并且拥有 Cloudflare 账号。
在终端中安装 Wrangler (Cloudflare 的命令行工具):

```bash
npm install -g wrangler
wrangler login
```

## 2. 后端部署 (Cloudflare Workers & D1)

### 2.1 初始化依赖
进入 `worker` 目录并安装依赖：

```bash
cd worker
npm install
```

### 2.2 创建 D1 数据库
在 `worker` 目录下运行：

```bash
npx wrangler d1 create uptime-db
```

运行成功后，控制台会输出 `database_id`。
**重要**：复制这个 ID，打开 `worker/wrangler.toml` 文件，替换掉 `database_id = "..."` 这一行。

### 2.3 初始化数据库表结构
将 schema 应用到你的数据库：

```bash
npx wrangler d1 execute uptime-db --local --file=./schema.sql  # 本地测试
npx wrangler d1 execute uptime-db --remote --file=./schema.sql # 远程生产环境
```

### 2.4 配置企业微信通知 (可选)
如果你需要企业微信通知，请设置环境变量：

```bash
npx wrangler secret put WECOM_WEBHOOK_URL
```
然后根据提示输入你的企业微信 Webhook 地址。

### 2.5 部署 Worker
```bash
npx wrangler deploy
```
部署完成后，你会得到一个 URL (例如 `https://uptime-worker.你的名字.workers.dev`)。**记下这个 URL**。

## 3. 前端部署 (Cloudflare Pages)

### 3.1 修改 API 地址
打开 `frontend/index.html`，找到大约第 47 行：

```javascript
const API_BASE = 'http://localhost:8787'; 
```

将其修改为你刚才获得的 Worker URL：
```javascript
const API_BASE = 'https://uptime-worker.你的名字.workers.dev'; 
```

### 3.2 部署到 Pages
你由两种方式部署前端：

**方式 A: 使用 Wrangler 命令行 (推荐)**
在根目录下运行：
```bash
npx wrangler pages deploy frontend --project-name uptime-monitor
```

**方式 B: 连接 GitHub**
1. 将代码推送到 GitHub。
2. 在 Cloudflare Dashboard 中创建一个新的 Pages 项目。
3. 连接你的 GitHub 仓库。
4. Build settings:
   - Framework preset: None
   - Build command: (留空)
   - Build output directory: `frontend`

## 4. 验证
访问你的 Pages 域名，你应该能看到监控面板。尝试添加一个监控项（如 `https://www.google.com`），然后等待几分钟查看状态变化。

## 5. 故障排查
- 如果 API 请求失败，请检查 Worker 的控制台日志 (`wrangler tail`)。
- 确认 `frontend/index.html` 中的 `API_BASE` 是否正确且没有尾部斜杠。
- 确认 Worker 的 CORS 设置是否允许了跨域请求。

