# 发布流程

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 18 |
| npm | >= 8 |
| 操作系统 | Linux (推荐 Ubuntu 22.04+) 或 macOS |

---

## 核心原则：前端必须编译后发布

**线上环境绝不运行 dev server**。前端通过 Vite 编译为静态文件，由 Node 服务或 Nginx 直接提供。

```
开发环境:  client (vite dev :5173) + server (ts-node :3001)
生产环境:  server (node dist/app.js :3001) 同时提供 API 和前端静态文件
```

---

## 部署架构

### 方案 A：Node 统一服务（推荐，简单）

Server 进程同时提供 API 接口和前端静态文件。只需暴露一个端口。

```
用户请求 → Nginx(SSL) → Node(:3001)
                          ├── /api/*       → Express 路由
                          └── /*           → client/dist/ 静态文件 (SPA fallback)
```

### 方案 B：Nginx 分流

Nginx 直接提供前端静态文件，只将 API 请求转发给 Node。

```
用户请求 → Nginx(SSL)
              ├── /api/*      → proxy_pass Node(:3001)
              └── /*          → /opt/mmPla/client/dist/ (try_files → index.html)
```

**两种方案都要求前端先编译**。本文档以方案 A 为主。

---

## 目录结构（部署后）

```
/opt/mmPla/
├── client/
│   └── dist/             # 前端编译产物（Vite 构建输出）
│       ├── index.html
│       └── assets/       # JS/CSS 带 hash，可长期缓存
├── server/
│   ├── dist/             # 后端编译产物（tsc 输出）
│   ├── node_modules/     # 生产依赖
│   └── package.json
├── skills/               # AI 技能定义
├── workspaces/           # 用户工作区数据（运行时生成）
├── data/                 # SQLite 数据库（运行时生成）
└── .env                  # 环境变量
```

---

## 一、完整构建流程

### 1.1 后端构建

```bash
cd server
npm ci --production=false   # 安装所有依赖（含 devDependencies，用于编译）
npm run build               # tsc 编译 → dist/

# 生产环境仅保留运行依赖
rm -rf node_modules
npm ci --production          # 只安装 dependencies
```

### 1.2 前端构建

```bash
cd client
npm ci
npm run build               # vite build → dist/
```

**构建产物说明：**

| 文件 | 说明 |
|------|------|
| `client/dist/index.html` | SPA 入口（所有路由 fallback 到此文件） |
| `client/dist/assets/*.js` | 编译后的 JS，文件名带 content hash |
| `client/dist/assets/*.css` | 编译后的 CSS，文件名带 content hash |

带 hash 的 assets 可设置永久缓存（`Cache-Control: public, immutable, max-age=2592000`）。

### 1.3 验证构建

```bash
# 后端类型检查
cd server && npx tsc --noEmit

# 前端类型检查
cd client && npx vue-tsc --noEmit

# 确认产物存在
ls server/dist/app.js
ls client/dist/index.html
```

---

## 二、前端如何在线上被加载

Server (`server/src/app.ts`) 包含以下逻辑：

```typescript
// 当 client/dist 目录存在时，自动提供静态文件服务
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath, { maxAge: '30d', immutable: true, index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}
```

**工作机制：**

1. 带 hash 的静态资源（`/assets/*`）→ 直接返回文件，设置 30 天缓存
2. API 路径（`/api/*`）→ 跳过，交给 Express 路由处理
3. 其他所有路径 → 返回 `index.html`（SPA 路由由 Vue Router 处理）

**这意味着：**
- 部署时只需把 `client/dist/` 放在 `server/` 的上级目录的 `client/dist` 位置
- 不需要单独的前端服务或 Nginx（但仍推荐 Nginx 做 SSL 终止和反向代理）
- 前端更新只需替换 `client/dist/` 内容并清浏览器缓存（hash 变化自动失效旧文件）

---

## 三、环境变量

创建 `/opt/mmPla/server/.env`：

```env
# 必填
PORT=3001
NODE_ENV=production
JWT_SECRET=<48字符以上随机字符串>

# 可选 - CORS 允许跨域的域名（逗号分隔）
# 方案A（Node统一服务）下前端和API同源，无需设置
# 方案B（Nginx分流，或前端部署在不同域）必须设置
# CORS_ORIGIN=https://your-domain.com,https://www.your-domain.com

# 可选 - 数据库路径（默认 ./data/app.db）
# DB_PATH=./data/app.db
```

### 生成 JWT_SECRET

```bash
# 方法1: macOS / Linux
openssl rand -base64 48

# 方法2: Node.js
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

将输出的随机字符串填入 `JWT_SECRET=` 后面即可。

### 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 是 | 服务监听端口，默认 3001 |
| `NODE_ENV` | 是 | 设为 `production` 启用安全检查（JWT 强制、CORS 严格） |
| `JWT_SECRET` | 是 | JWT 签名密钥。生产环境未设置或为默认值时**服务拒绝启动** |
| `CORS_ORIGIN` | 视情况 | 允许跨域的域名列表。方案A同源不需要；方案B必填 |
| `DB_PATH` | 否 | SQLite 数据库路径，默认 `./data/app.db` |

### 安全要求

- **`NODE_ENV=production` 时**，如果 `JWT_SECRET` 未设置或仍为 `.env.example` 中的默认值，服务会输出 FATAL 错误并退出
- **`CORS_ORIGIN` 未设置时**，生产环境默认拒绝所有跨域请求（方案A同源访问不受影响）
- **`.env` 文件权限**应设为 `600`：`chmod 600 /opt/mmPla/server/.env`

> 平台 AI Key 通过管理后台（系统配置）设置，不放在 .env 中。

---

## 四、首次部署

```bash
# 1. 创建目录
sudo mkdir -p /opt/mmPla
sudo chown $USER:$USER /opt/mmPla

# 2. 拉取代码
git clone <repo-url> /opt/mmPla/source

# 3. 构建后端
cd /opt/mmPla/source/server
npm ci --production=false && npm run build
rm -rf node_modules && npm ci --production

# 4. 构建前端
cd /opt/mmPla/source/client
npm ci && npm run build

# 5. 部署产物（保持相对路径关系）
mkdir -p /opt/mmPla/server /opt/mmPla/client
cp -r /opt/mmPla/source/server/dist /opt/mmPla/server/dist
cp -r /opt/mmPla/source/server/node_modules /opt/mmPla/server/node_modules
cp /opt/mmPla/source/server/package.json /opt/mmPla/server/
cp -r /opt/mmPla/source/client/dist /opt/mmPla/client/dist
cp -r /opt/mmPla/source/skills /opt/mmPla/skills

# 6. 配置环境变量
cp /opt/mmPla/source/server/.env.example /opt/mmPla/server/.env
vim /opt/mmPla/server/.env    # 填入真实 JWT_SECRET

# 7. 创建数据目录
mkdir -p /opt/mmPla/server/data /opt/mmPla/workspaces

# 8. 验证启动
cd /opt/mmPla/server && node dist/app.js
# 测试: curl http://localhost:3001/api/health → {"status":"ok"}
# 测试: curl http://localhost:3001/ → 返回 index.html 内容
```

---

## 五、Systemd 服务

创建 `/etc/systemd/system/mmPla.service`：

```ini
[Unit]
Description=mmPla Platform
After=network.target

[Service]
Type=simple
User=mmPla
WorkingDirectory=/opt/mmPla/server
ExecStart=/usr/bin/node dist/app.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/mmPla/server/.env
StandardOutput=journal
StandardError=journal

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/mmPla/server/data /opt/mmPla/workspaces

[Install]
WantedBy=multi-user.target
```

```bash
# 创建服务用户
sudo useradd -r -s /bin/false mmPla
sudo chown -R mmPla:mmPla /opt/mmPla

# 启用服务
sudo systemctl daemon-reload
sudo systemctl enable mmPla
sudo systemctl start mmPla
sudo systemctl status mmPla
```

---

## 六、Nginx 配置（SSL 终止 + 反向代理）

即使 Node 已能提供前端静态文件，生产环境仍推荐在前面加 Nginx 做 SSL 和安全头。

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # 全部转发给 Node（方案A）
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持（AI 流式调用）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

如果选方案 B（Nginx 直接提供静态文件），替换 location 块为：

```nginx
    # 静态文件直接由 Nginx 提供
    root /opt/mmPla/client/dist;

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:3001;
    }

    # SPA fallback — 所有非文件路径返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
```

---

## 七、更新/升级流程

```bash
# 1. 拉取最新代码
cd /opt/mmPla/source && git pull

# 2. 重新构建后端
cd server && npm ci --production=false && npm run build
rm -rf node_modules && npm ci --production

# 3. 重新构建前端
cd ../client && npm ci && npm run build

# 4. 替换产物
rm -rf /opt/mmPla/server/dist /opt/mmPla/client/dist
cp -r /opt/mmPla/source/server/dist /opt/mmPla/server/dist
cp -r /opt/mmPla/source/server/node_modules /opt/mmPla/server/node_modules
cp -r /opt/mmPla/source/client/dist /opt/mmPla/client/dist
cp -r /opt/mmPla/source/skills /opt/mmPla/skills

# 5. 重启服务
sudo systemctl restart mmPla

# 6. 验证
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/ | head -5   # 应返回 HTML
```

**仅更新前端（无后端变更）：**

```bash
cd /opt/mmPla/source/client && git pull && npm ci && npm run build
rm -rf /opt/mmPla/client/dist
cp -r /opt/mmPla/source/client/dist /opt/mmPla/client/dist
# 无需重启 Node，新文件立即生效（文件名 hash 变了，浏览器自动拉新）
```

---

## 八、数据备份

```bash
#!/bin/bash
# /opt/mmPla/backup.sh
BACKUP_DIR=/opt/mmPla/backups
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
sqlite3 /opt/mmPla/server/data/app.db ".backup '$BACKUP_DIR/app_$DATE.db'"
find $BACKUP_DIR -name "*.db" -mtime +30 -delete
```

Crontab（每天凌晨 3 点）：

```bash
0 3 * * * /opt/mmPla/backup.sh
```

---

## 九、监控 & 日志

```bash
# 实时日志
sudo journalctl -u mmPla -f

# 最近 1 小时
sudo journalctl -u mmPla --since "1h ago"

# 健康检查
curl -s http://localhost:3001/api/health | jq .
```

关键指标：
- 服务状态：`systemctl status mmPla`
- 数据库大小：`du -sh /opt/mmPla/server/data/app.db`
- 磁盘空间：`df -h /opt/mmPla`
- AI 用量：管理后台 `/admin/usage`

---

## 十、故障排查

| 现象 | 排查 |
|------|------|
| 502 Bad Gateway | `systemctl status mmPla`，确认 Node 进程存活 |
| 前端白屏/404 | 确认 `client/dist/index.html` 存在且路径正确 |
| 前端加载旧版本 | 文件 hash 未变 → 重新 build；或 Nginx 缓存 → 清理 |
| API 返回 404 | 确认 API 路由以 `/api/` 开头 |
| 数据库锁定 | 检查是否多进程访问同一 DB |
| AI 调用失败 | 管理后台检查 API Key → 查看错误日志 |
| SSE 断连 | 检查 Nginx `proxy_read_timeout` 和 `proxy_buffering off` |

---

## 十一、安全清单

### 部署前必做

- [ ] `NODE_ENV=production` 已设置
- [ ] `JWT_SECRET` 使用 `openssl rand -base64 48` 生成的强随机值
- [ ] 方案A下 `CORS_ORIGIN` 可不设（同源）；方案B下设为实际域名
- [ ] 首次登录后**立即修改** admin 默认密码（admin/123456）
- [ ] `.env` 文件权限设为 600：`chmod 600 .env`

### 已内置的安全机制

| 机制 | 说明 |
|------|------|
| JWT Secret 强制检查 | 生产环境未设置则拒绝启动 |
| CORS 严格模式 | 生产环境默认拒绝跨域，仅白名单放行 |
| 安全响应头 | 自动设置 X-Frame-Options、X-Content-Type-Options 等 |
| Auth 限流 | 登录/注册每分钟最多 10 次 |
| AI 限流 | AI 调用每分钟 30 次，Chat/Consultant 每分钟 20 次 |
| Analytics 限流 | 页面访问统计每分钟 60 次 |
| XSS 防护 | 文章内容 DOMPurify 消毒，Chat HTML 转义，SSG icon 转义 |
| 路径穿越防护 | slug 格式校验 + 文件路径解析检查 |
| Token 撤销 | 修改密码后旧 JWT 自动失效（token_version 机制） |
| 模块 Token 隔离 | 每个 Token 只能访问白名单路径，所有请求记录审计日志 |

### 运维安全

- [ ] 启用 HTTPS（Let's Encrypt）
- [ ] 定期备份数据库
- [ ] Nginx 配置 HSTS：`Strict-Transport-Security "max-age=31536000"`
- [ ] 限制 SSH 访问（密钥登录、禁用 root）
- [ ] 定期更新 Node.js 和系统补丁
- [ ] 监控磁盘空间（SQLite + workspaces + SSG 静态文件）

---

## 十二、规范总结

| 规则 | 说明 |
|------|------|
| 前端必须编译后上线 | `npm run build` 产出静态文件，线上不运行 Vite dev server |
| Node 服务编译后的前端 | `server/src/app.ts` 检测 `../client/dist` 存在则自动提供静态文件 |
| 只暴露一个端口 | 线上只开 3001，Nginx 做 SSL 反向代理 |
| 资源带 hash 缓存 | Vite 产出的 JS/CSS 带 content hash，可设 immutable 长缓存 |
| 前端更新不需重启 | 替换 `client/dist/` 即生效，hash 变化使浏览器拉新资源 |
| 后端更新需重启 | 替换 `server/dist/` 后 `systemctl restart mmPla` |
| 数据库自动迁移 | 服务启动时自动执行 pending migration，无需手动操作 |
