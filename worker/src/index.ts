import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  WECOM_WEBHOOK_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// === API 路由 ===

// 获取所有监控项
app.get('/monitors', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM monitors').all();
    return c.json(results);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// 添加监控项
app.post('/monitors', async (c) => {
  try {
    const body = await c.req.json<any>();
    const { name, url, interval, keyword } = body;
    
    if (!name || !url) {
      return c.json({ error: 'Missing name or url' }, 400);
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO monitors (name, url, interval, keyword) VALUES (?, ?, ?, ?)'
    ).bind(name, url, interval || 300, keyword || null).run();

    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// === 定时任务入口 ===

export default {
  fetch: app.fetch,
  
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(checkSites(env));
  },
};

// === 核心监测逻辑 ===

async function checkSites(env: Bindings) {
  console.log('Starting scheduled check...');
  const now = Date.now(); // 毫秒

  // 获取所有监控项
  // 优化点：生产环境应该在 SQL 中筛选 (last_check + interval < now)
  const { results } = await env.DB.prepare('SELECT * FROM monitors').all();
  
  // 使用 Promise.all 并发执行，提高效率
  const tasks = results.map(async (monitor: any) => {
    const shouldCheck = isTimeToCheck(monitor, now);
    if (shouldCheck) {
      await performCheck(monitor, env);
    }
  });

  await Promise.all(tasks);
}

function isTimeToCheck(monitor: any, now: number): boolean {
  // 如果状态是 RETRYING，每分钟都检查 (Cron 本身是每分钟触发)
  if (monitor.status === 'RETRYING') return true;

  // 正常状态，检查间隔
  const lastCheck = monitor.last_check ? new Date(monitor.last_check).getTime() : 0;
  const intervalMs = (monitor.interval || 300) * 1000;
  return (now - lastCheck) >= intervalMs;
}

async function performCheck(monitor: any, env: Bindings) {
  const startTime = Date.now();
  let status = 200;
  let isFail = false;
  let reason = '';

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method || 'GET',
      headers: { 'User-Agent': 'Uptime-Monitor/1.0' },
      cf: {
        // 避免 Cloudflare 缓存，确保请求穿透
        cacheTtl: 0,
        cacheEverything: false
      }
    });
    
    status = response.status;
    
    if (!response.ok) {
      isFail = true;
      reason = `HTTP ${status}`;
    } else if (monitor.keyword) {
      // 关键词检查
      const text = await response.text();
      if (!text.includes(monitor.keyword)) {
        isFail = true;
        reason = `Keyword "${monitor.keyword}" not found`;
      }
    }

  } catch (e) {
    isFail = true;
    status = 0;
    reason = e.message || 'Network Error';
  }

  const latency = Date.now() - startTime;

  // 状态机逻辑
  let newStatus = monitor.status;
  let newRetryCount = monitor.retry_count;

  if (isFail) {
    if (monitor.status === 'UP') {
      // 第一次失败，进入重试
      newStatus = 'RETRYING';
      newRetryCount = 1;
      console.log(`Monitor ${monitor.name} failed first time. Retrying...`);
    } else if (monitor.status === 'RETRYING') {
      // 重试中再次失败
      if (newRetryCount < 3) {
        newRetryCount++;
        console.log(`Monitor ${monitor.name} retry ${newRetryCount}/3 failed.`);
      } else {
        // 三次重试失败，确认 DOWN
        newStatus = 'DOWN';
        await sendWeChatAlert(env, monitor, `Monitor is DOWN: ${reason}`);
        console.log(`Monitor ${monitor.name} is DOWN! Alert sent.`);
      }
    } else if (monitor.status === 'DOWN') {
      // 已经是 DOWN，持续 DOWN，不重复报警（或者可以设置间隔报警）
      console.log(`Monitor ${monitor.name} is still DOWN.`);
    }
  } else {
    // 成功
    if (monitor.status === 'DOWN') {
      // 从 DOWN 恢复
      await sendWeChatAlert(env, monitor, `Monitor Recovered! Latency: ${latency}ms`);
      console.log(`Monitor ${monitor.name} recovered.`);
    }
    newStatus = 'UP';
    newRetryCount = 0;
  }

  // 更新数据库状态
  await env.DB.prepare(
    'UPDATE monitors SET last_check = ?, status = ?, retry_count = ? WHERE id = ?'
  ).bind(new Date().toISOString(), newStatus, newRetryCount, monitor.id).run();

  // 写入日志
  await env.DB.prepare(
    'INSERT INTO logs (monitor_id, status_code, latency, is_fail, reason) VALUES (?, ?, ?, ?, ?)'
  ).bind(monitor.id, status, latency, isFail ? 1 : 0, reason).run();
}

// 发送企业微信通知
async function sendWeChatAlert(env: Bindings, monitor: any, message: string) {
  // 请在 wrangler.toml 或 Cloudflare Dashboard 设置 WECOM_WEBHOOK_KEY 环境变量
  // 格式通常为: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY
  const webhookUrl = env.WECOM_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('No WECOM_WEBHOOK_URL configured.');
    return;
  }

  const payload = {
    msgtype: 'text',
    text: {
      content: `[Uptime Monitor] ${monitor.name}\nURL: ${monitor.url}\nTime: ${new Date().toLocaleString()}\nInfo: ${message}`
    }
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('Failed to send WeChat alert:', e);
  }
}

