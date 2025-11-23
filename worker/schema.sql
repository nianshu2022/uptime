DROP TABLE IF EXISTS monitors;
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT DEFAULT 'GET',
  interval INTEGER DEFAULT 300, -- 监测间隔，单位秒
  status TEXT DEFAULT 'UP', -- UP, DOWN, RETRYING
  retry_count INTEGER DEFAULT 0,
  last_check DATETIME,
  keyword TEXT, -- 可选：必须包含的关键词
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS logs;
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id INTEGER,
  status_code INTEGER,
  latency INTEGER, -- 毫秒
  is_fail BOOLEAN DEFAULT 0,
  reason TEXT, -- 失败原因描述
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monitor_id) REFERENCES monitors(id)
);

-- 插入一条测试数据
INSERT INTO monitors (name, url) VALUES ('Baidu', 'https://www.baidu.com');

