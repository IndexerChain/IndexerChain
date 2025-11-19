# ✅ 信号服务器部署成功

## 部署信息

**部署时间**: 2024-12-19  
**Worker 名称**: `indexerchain-signaling`  
**自定义域名**: `signal.indexerchain.com`  
**当前版本 ID**: `38bcf192-6e9b-4cc5-b700-b6714e998041`

## 部署详情

### Worker 配置

- **入口文件**: `src/index.js`
- **上传大小**: 33.35 KiB (gzip: 6.00 KiB)
- **Durable Objects**:
  - `SIGNALING_ROOM` (SignalingRoom) - 信令房间，管理所有 P2P 连接
  - `SHADOW_SESSION` (ShadowSession) - Shadow Node 会话，用于移动端持久连接
- **路由**: `signal.indexerchain.com/*`

### 功能特性

✅ **WebSocket 信令服务器**
- 处理 P2P 节点之间的 WebRTC 信令
- 管理节点连接和断开
- 广播新节点加入/离开事件

✅ **Bootstrap 同步**
- 维护最新的 rootTip（链的最新状态）
- 提供快速同步服务
- 支持状态持久化

✅ **Shadow Node 支持** (Phase 40)
- 移动端持久连接
- 即使浏览器锁定也能保持连接
- Active Miner 管理

✅ **IP 哈希追踪** (Phase 33)
- 隐私保护的 IP 识别
- 用于 Quorum 评分和独立节点检测

## 访问地址

### WebSocket 连接
```
wss://signal.indexerchain.com
```

### HTTP 端点
- **Keepalive**: `https://signal.indexerchain.com/keepalive`
- **Shadow Node**: `https://signal.indexerchain.com/shadow/{sessionId}/...`

## 应用配置

应用已配置为使用 `signal.indexerchain.com`：

```typescript
// src/ui/App.tsx
const DEFAULT_MAINNET_SIGNALING = "wss://signal.indexerchain.com";
```

**无需修改配置**，应用会自动连接到已部署的信号服务器。

## 验证部署

### 1. 检查 Keepalive 端点

```bash
curl https://signal.indexerchain.com/keepalive
# 应该返回: ok
```

### 2. 查看实时日志

```bash
cd workers
wrangler tail
```

### 3. 在应用中测试

1. 打开应用
2. 勾选 "Mainnet Mode"
3. 点击 "Connect"
4. 应该看到 "Connected" 状态

## 监控和管理

### Cloudflare Dashboard

访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → `indexerchain-signaling`

可以查看：
- **Metrics**: 请求数、错误率、响应时间
- **Logs**: 实时日志
- **Settings**: Worker 配置
- **Durable Objects**: 查看持久化状态

### 常用命令

```bash
# 查看实时日志
cd workers
wrangler tail

# 重新部署
wrangler deploy

# 查看 Worker 信息
wrangler whoami

# 本地开发测试
wrangler dev
```

## 更新部署

如果需要更新 Worker 代码：

```bash
cd workers
wrangler deploy
```

部署会自动更新，无需停机。

## 故障排除

### WebSocket 连接失败

1. 检查 Worker 是否正常运行：访问 Cloudflare Dashboard
2. 检查 URL 是否正确（使用 `wss://` 而不是 `ws://`）
3. 查看日志：`wrangler tail`

### 自定义域名不工作

1. 检查 DNS 记录是否正确
2. 检查 CNAME 是否指向正确的 Worker
3. 等待 DNS 传播（可能需要几分钟）

## 性能指标

- **免费额度**: 每天 100,000 次请求
- **并发连接**: 每个 Worker 实例最多约 30,000 个并发 WebSocket 连接
- **自动扩缩容**: Cloudflare 会根据流量自动创建多个 Worker 实例

## 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [WebSocket 支持](https://developers.cloudflare.com/workers/learning/using-websockets/)
- [Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
