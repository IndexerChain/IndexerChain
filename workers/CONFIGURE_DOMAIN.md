# 配置自定义域名：signal.indexerchain.com

## ✅ 配置完成！

**域名**: `signal.indexerchain.com`  
**状态**: ✅ **已配置并正常工作**

### 验证结果

- ✅ DNS 解析成功（指向 Cloudflare IP）
- ✅ HTTPS 连接正常（HTTP 426 - WebSocket 升级请求正确处理）
- ✅ SSL 证书有效（Google Trust Services 签发）
- ✅ WebSocket 支持正常
- ✅ Worker 路由已配置并部署

## ✅ 已完成的配置

1. ✅ **DNS 记录已配置** - Cloudflare Dashboard 中已添加 CNAME 记录
2. ✅ **应用配置已更新** - `src/ui/App.tsx` 中的 `DEFAULT_MAINNET_SIGNALING` 已更新为 `wss://signal.indexerchain.com`
3. ✅ **Worker 路由已配置** - `wrangler.toml` 中已添加路由配置
4. ✅ **Worker 已部署** - 路由已生效
5. ✅ **域名验证通过** - 所有测试通过

## 📋 需要在 Cloudflare Dashboard 完成的步骤

### 步骤 1: 配置 DNS 记录

1. **登录 Cloudflare Dashboard**：
   - 访问：https://dash.cloudflare.com/
   - 选择域名：`indexerchain.com`

2. **添加 CNAME 记录**：
   - 进入 "DNS" → "Records"
   - 点击 "Add record"
   - 配置如下：
     - **Type**: `CNAME`
     - **Name**: `signal`
     - **Target**: `indexerchain-signaling.seven-psong.workers.dev`
     - **Proxy status**: ✅ **已代理**（橙色云，重要！）
     - **TTL**: 自动
   - 点击 "Save"

3. **等待 DNS 传播**：
   - 通常需要 1-5 分钟
   - 可以通过 `nslookup signal.indexerchain.com` 或 `dig signal.indexerchain.com` 检查

### 步骤 2: 验证 DNS 配置

运行以下命令检查 DNS 是否已生效：

```bash
# Mac/Linux
nslookup signal.indexerchain.com
# 或
dig signal.indexerchain.com

# 应该显示指向 Cloudflare 的 IP 地址
```

### 步骤 3: 重新部署 Worker（如果需要）

如果修改了 `wrangler.toml`，重新部署：

```bash
cd workers
wrangler deploy
```

### 步骤 4: 测试连接

1. **重新构建应用**：
```bash
npm run build
```

2. **在浏览器中测试**：
   - 打开应用
   - 勾选 "Mainnet Mode"
   - 点击 "Connect"
   - 应该连接到 `wss://signal.indexerchain.com`

## 🔍 验证配置

### 方法 1: 浏览器控制台测试

打开浏览器控制台，运行：

```javascript
const ws = new WebSocket('wss://signal.indexerchain.com');
ws.onopen = () => console.log('✅ Connected to signal.indexerchain.com!');
ws.onerror = (e) => console.error('❌ Error:', e);
ws.onclose = () => console.log('Connection closed');
```

### 方法 2: 使用 curl 测试

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://signal.indexerchain.com
```

应该返回 `101 Switching Protocols`。

## 🚨 常见问题

### Q: DNS 记录添加后无法连接

**A**: 检查：
1. **代理状态**：确保 CNAME 记录的代理状态是"已代理"（橙色云），不是"仅 DNS"（灰色云）
2. **DNS 传播**：等待几分钟让 DNS 传播
3. **域名所有权**：确保 `indexerchain.com` 在 Cloudflare 账户中

### Q: 连接失败，显示 SSL 错误

**A**: 
- Cloudflare 会自动为自定义域名配置 SSL 证书
- 等待几分钟让 SSL 证书生效
- 检查 Cloudflare Dashboard → SSL/TLS → 证书状态

### Q: 如何检查 Worker 路由是否生效？

**A**: 在 Cloudflare Dashboard：
1. 进入 "Workers & Pages" → `indexerchain-signaling`
2. 查看 "Triggers" 标签
3. 应该看到 `signal.indexerchain.com/*` 路由

## 📝 配置检查清单

- [ ] DNS CNAME 记录已添加（`signal` → `indexerchain-signaling.seven-psong.workers.dev`）
- [ ] DNS 记录代理状态为"已代理"（橙色云）
- [ ] DNS 已传播（`nslookup signal.indexerchain.com` 返回 Cloudflare IP）
- [ ] Worker 路由已配置（`wrangler.toml` 中的 routes）
- [ ] Worker 已重新部署（如果修改了 wrangler.toml）
- [ ] 应用配置已更新（`DEFAULT_MAINNET_SIGNALING`）
- [ ] 应用已重新构建（`npm run build`）
- [ ] 浏览器测试连接成功

## 🎉 完成后的效果

配置完成后：
- ✅ 用户可以通过 `wss://signal.indexerchain.com` 连接
- ✅ 更专业的域名，更容易记忆
- ✅ 统一的品牌标识
- ✅ 自动 SSL 证书（HTTPS/WSS）

## 🔗 相关文档

- [Cloudflare Workers 自定义域名文档](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare DNS 配置文档](https://developers.cloudflare.com/dns/manage-dns-records/)

