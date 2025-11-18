# 信令服务器快速部署指南

## 🚨 问题说明

如果你看到以下错误：
```
WebSocket connection to 'wss://signal.indexerchain.io/' failed
```

这说明主网信令服务器还没有部署。你有两个选择：

---

## 方案一：本地开发模式（最简单，推荐用于测试）

### 快速开始（5 分钟）

1. **安装依赖**：
```bash
npm install ws
```

2. **启动本地信令服务器**：
```bash
# Mac/Linux
./start-server.sh

# Windows
start-server.bat

# 或手动启动
node signaling-server-example.js
```

3. **在浏览器中切换到开发模式**：
   - 打开 IndexerChain 页面
   - 在 "P2P Network" 部分
   - **取消勾选 "Mainnet Mode"**
   - 输入：`ws://localhost:8080`
   - 点击 "Connect"

✅ **完成！** 现在可以本地测试了。

---

## 方案二：部署公网信令服务器（用于主网）

### 选项 A：使用 Cloudflare Workers（推荐，免费，5 分钟部署）

**优势**：
- ✅ 完全免费（每天 10 万次请求）
- ✅ 无需 VPS
- ✅ 全球 CDN，低延迟
- ✅ 自动 SSL（HTTPS/WSS）

**✅ 项目已配置完成！**

所有必要的文件已创建在 `workers/` 目录中，包括：
- ✅ Worker 代码 (`src/index.js`)
- ✅ 配置文件 (`wrangler.toml`)
- ✅ 部署脚本 (`deploy.sh` / `deploy.bat`)
- ✅ 详细文档 (`README.md` / `DEPLOY_INSTRUCTIONS.md`)

**快速部署步骤**：

1. **安装 Wrangler**：
```bash
npm install -g wrangler
```

2. **登录 Cloudflare**：
```bash
wrangler login
```

3. **进入 workers 目录并部署**：
```bash
cd workers

# Mac/Linux - 使用一键部署脚本
./deploy.sh

# Windows - 使用一键部署脚本
deploy.bat

# 或手动部署
wrangler deploy
```

4. **获取 Worker URL**：
   部署成功后，会显示类似这样的 URL：
   ```
   https://indexerchain-signaling.your-subdomain.workers.dev
   ```
   **复制这个 URL**（注意使用时需要改为 `wss://`）

5. **更新应用配置**：
   在 `src/ui/App.tsx` 中修改：
```typescript
const DEFAULT_MAINNET_SIGNALING = "wss://indexerchain-signaling.your-subdomain.workers.dev";
```
   将 `your-subdomain` 替换为你的实际子域名。

6. **重新构建并测试**：
```bash
npm run build
```
   然后在浏览器中测试连接。

> 📖 **详细说明**：查看 [workers/DEPLOY_INSTRUCTIONS.md](./workers/DEPLOY_INSTRUCTIONS.md) 获取完整的部署指南和故障排除。

---

### 选项 B：使用 VPS 部署（传统方案）

**需要**：
- VPS 服务器（$5/月，如 DigitalOcean、Vultr）
- 域名（可选，可用 IP 地址）

**快速部署脚本**：

```bash
#!/bin/bash
# 一键部署脚本

# 1. 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安装依赖
npm install ws

# 3. 安装 PM2
npm install -g pm2

# 4. 启动服务
pm2 start signaling-server-example.js --name indexerchain-signaling
pm2 save
pm2 startup

# 5. 开放端口
sudo ufw allow 8080/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

echo "✅ 信令服务器已启动在 ws://YOUR_SERVER_IP:8080"
echo "💡 如需 HTTPS，请配置 Nginx 反向代理（见 README.md）"
```

**使用 IP 地址连接**：
- 在浏览器中输入：`ws://YOUR_SERVER_IP:8080`
- 或配置域名后使用：`wss://signal.yourdomain.com`

---

## 验证部署

### 测试 WebSocket 连接

**方法 1：浏览器控制台**
```javascript
const ws = new WebSocket('wss://your-signaling-server.com');
ws.onopen = () => console.log('✅ Connected!');
ws.onerror = (e) => console.error('❌ Error:', e);
```

**方法 2：使用 wscat（命令行）**
```bash
npm install -g wscat
wscat -c wss://your-signaling-server.com
```

---

## 常见问题

### Q: 为什么连接失败？
A: 可能的原因：
1. 信令服务器未启动
2. 防火墙阻止了端口
3. URL 错误（检查 ws:// 或 wss://）
4. SSL 证书问题（WSS 需要有效证书）

### Q: 本地可以连接，但公网不行？
A: 检查：
1. VPS 防火墙是否开放端口
2. 云服务商安全组是否允许
3. 域名 DNS 是否正确解析

### Q: 如何查看服务器日志？
A: 使用 PM2：
```bash
pm2 logs indexerchain-signaling
```

### Q: 如何重启服务？
A:
```bash
pm2 restart indexerchain-signaling
```

---

## 推荐方案对比

| 方案 | 成本 | 难度 | 适用场景 |
|------|------|------|----------|
| 本地开发模式 | 免费 | ⭐ 简单 | 测试、开发、单机 |
| Cloudflare Workers | 免费 | ⭐⭐ 中等 | 主网、全球用户 |
| VPS 部署 | $5/月 | ⭐⭐⭐ 较难 | 完全控制、高并发 |

---

## 下一步

部署完成后：
1. ✅ 更新 `DEFAULT_MAINNET_SIGNALING` 为你的服务器地址
2. ✅ 测试连接
3. ✅ 开始挖矿！

更多详细信息请查看 [README.md](./README.md) 中的「部署根节点」章节。

