# 信令服务器部署说明

## 🎯 快速开始（5 分钟）

### 步骤 1: 安装 Wrangler

```bash
npm install -g wrangler
```

### 步骤 2: 登录 Cloudflare

```bash
wrangler login
```

这会打开浏览器，让你登录 Cloudflare 账户（如果没有账户，可以免费注册）。

### 步骤 3: 部署

```bash
cd workers

# Mac/Linux
./deploy.sh

# Windows
deploy.bat

# 或手动部署
wrangler deploy
```

### 步骤 4: 获取 Worker URL

部署成功后，你会看到类似这样的输出：

```
✨  Uploaded indexerchain-signaling (X.XX sec)
Published indexerchain-signaling (X.XX sec)
  https://indexerchain-signaling.your-subdomain.workers.dev
```

**复制这个 URL**（注意是 `https://`，但使用时需要改为 `wss://`）

### 步骤 5: 更新应用配置

在 `src/ui/App.tsx` 中修改：

```typescript
const DEFAULT_MAINNET_SIGNALING = "wss://indexerchain-signaling.your-subdomain.workers.dev";
```

将 `your-subdomain` 替换为你的实际子域名。

### 步骤 6: 测试连接

1. 重新构建应用：`npm run build`
2. 在浏览器中打开应用
3. 勾选 "Mainnet Mode"
4. 点击 "Connect"

如果连接成功，你会看到 "Connected" 状态。

---

## 🔧 配置自定义域名（可选）

如果你想使用自己的域名（如 `signal.indexerchain.io`）：

### 1. 在 Cloudflare Dashboard 配置 DNS

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择你的域名
3. 进入 "DNS" → "Records"
4. 添加 CNAME 记录：
   - **名称**: `signal`
   - **目标**: `indexerchain-signaling.your-subdomain.workers.dev`
   - **代理状态**: 已代理（橙色云）
   - **TTL**: 自动

### 2. 更新应用配置

```typescript
const DEFAULT_MAINNET_SIGNALING = "wss://signal.yourdomain.com";
```

### 3. 重新部署（可选，如果修改了 wrangler.toml）

```bash
wrangler deploy
```

---

## 📊 监控和调试

### 查看实时日志

```bash
cd workers
wrangler tail
```

### 在 Cloudflare Dashboard 查看

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择 "Workers & Pages"
3. 点击 `indexerchain-signaling`
4. 查看：
   - **Metrics**: 请求数、错误率、响应时间
   - **Logs**: 实时日志
   - **Settings**: Worker 配置

---

## 🚨 常见问题

### Q: 部署失败，提示 "Authentication required"

**A**: 需要先登录：
```bash
wrangler login
```

### Q: 部署失败，提示 "Account ID not found"

**A**: 需要先创建 Cloudflare 账户并添加 Worker 订阅（免费）。

### Q: WebSocket 连接失败

**A**: 检查：
1. Worker 是否已成功部署
2. URL 是否正确（使用 `wss://` 而不是 `ws://`）
3. 查看 Worker 日志：`wrangler tail`

### Q: 如何更新 Worker？

**A**: 直接重新运行 `wrangler deploy` 即可，会自动更新。

### Q: 免费额度够用吗？

**A**: 
- 每天 100,000 次请求免费
- 对于信令服务器来说，这通常足够
- 超出后按量付费，价格非常便宜

---

## 🔐 生产环境建议

### 1. 使用 Durable Objects（可选）

当前实现使用内存存储，Worker 重启会导致连接丢失。对于生产环境，建议使用 Durable Objects 来持久化状态。

详见 `README.md` 中的 "生产环境增强" 部分。

### 2. 添加监控

在 Cloudflare Dashboard 中设置告警：
- 错误率超过阈值
- 请求数异常
- Worker 执行时间过长

### 3. 配置自定义域名

使用自己的域名更专业，也更容易管理。

---

## 📝 文件说明

- `src/index.js`: Worker 主代码
- `wrangler.toml`: Cloudflare Workers 配置文件
- `package.json`: 项目依赖（可选）
- `deploy.sh` / `deploy.bat`: 一键部署脚本
- `README.md`: 详细文档

---

## 🎉 完成！

部署完成后，你的信令服务器就可以为全球用户提供服务了！

如有问题，请查看：
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [项目 README.md](../README.md)
- [部署指南](../DEPLOY_SIGNALING.md)

