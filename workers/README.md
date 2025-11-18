# IndexerChain Signaling Server (Cloudflare Worker)

这是 IndexerChain 的信令服务器，部署在 Cloudflare Workers 上。

## 🚀 快速部署

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
# 或使用 npx（无需全局安装）
npx wrangler --version
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

这会打开浏览器，让你登录 Cloudflare 账户。

### 3. 部署 Worker

```bash
cd workers
wrangler deploy
```

部署成功后，你会获得一个 URL，例如：
- `https://indexerchain-signaling.your-subdomain.workers.dev`

### 4. 配置自定义域名（可选）

如果你想使用自定义域名（如 `signal.indexerchain.io`）：

1. **在 Cloudflare Dashboard 中配置 DNS**：
   - 进入你的域名管理页面
   - 添加 CNAME 记录：
     - 名称：`signal`
     - 目标：`indexerchain-signaling.your-subdomain.workers.dev`
     - 代理状态：已代理（橙色云）

2. **在 wrangler.toml 中添加路由**（可选）：
```toml
routes = [
  { pattern = "signal.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

3. **重新部署**：
```bash
wrangler deploy
```

### 5. 更新应用配置

在 `src/ui/App.tsx` 中修改主网信令服务器地址：

```typescript
const DEFAULT_MAINNET_SIGNALING = "wss://indexerchain-signaling.your-subdomain.workers.dev";
// 或使用自定义域名
// const DEFAULT_MAINNET_SIGNALING = "wss://signal.yourdomain.com";
```

## 📊 监控和日志

### 查看实时日志

```bash
wrangler tail
```

### 查看 Worker 状态

在 Cloudflare Dashboard 中：
1. 进入 "Workers & Pages"
2. 选择 `indexerchain-signaling`
3. 查看指标、日志、请求等

## 🔧 开发模式

本地测试 Worker：

```bash
wrangler dev
```

这会启动一个本地开发服务器，你可以在浏览器中测试。

## ⚙️ 配置说明

### wrangler.toml

- `name`: Worker 名称
- `main`: 入口文件
- `compatibility_date`: 兼容性日期（影响可用的 API）

### 环境变量

如果需要环境变量，可以在 `wrangler.toml` 中配置：

```toml
[vars]
ENVIRONMENT = "production"
LOG_LEVEL = "info"
```

然后在代码中访问：

```javascript
const env = env.ENVIRONMENT;
```

## 🚨 注意事项

1. **状态持久化**：
   - 当前实现使用内存存储 peer 连接（`peers` Map）
   - Worker 重启会导致连接丢失
   - 对于生产环境，建议使用 Durable Objects（见下方）

2. **免费额度**：
   - 每天 100,000 次请求免费
   - 超出后按量付费（非常便宜）
   - WebSocket 连接数：每个 Worker 实例最多约 30,000 个并发连接

3. **自动扩缩容**：
   - Cloudflare 会根据流量自动创建多个 Worker 实例
   - 每个实例独立管理自己的 peer 连接

## 🔐 生产环境增强（可选）

### 使用 Durable Objects（推荐）

对于需要持久化状态的生产环境，可以使用 Durable Objects：

1. **创建 Durable Object 类**（在 `src/index.js` 中）：

```javascript
export class SignalingRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.peers = new Map();
  }

  async fetch(request) {
    // 将上面的 WebSocket 处理逻辑移到这里
    // ...
  }
}

export default {
  async fetch(request, env) {
    const id = env.SIGNALING_ROOM.idFromName('main');
    const room = env.SIGNALING_ROOM.get(id);
    return room.fetch(request);
  },
};
```

2. **在 wrangler.toml 中配置**：

```toml
[[durable_objects.bindings]]
name = "SIGNALING_ROOM"
class_name = "SignalingRoom"
script_name = "indexerchain-signaling"
```

这样可以确保节点连接状态在 Worker 重启后仍然保持。

## 📝 故障排除

### 部署失败

- 检查是否已登录：`wrangler whoami`
- 检查 `wrangler.toml` 配置是否正确
- 检查代码语法错误

### WebSocket 连接失败

- 检查 Worker 是否已部署：在 Cloudflare Dashboard 查看
- 检查 URL 是否正确（使用 `wss://` 而不是 `ws://`）
- 查看 Worker 日志：`wrangler tail`

### 自定义域名不工作

- 检查 DNS 记录是否正确
- 检查 CNAME 是否指向正确的 Worker
- 等待 DNS 传播（可能需要几分钟）

## 🔗 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [WebSocket 支持](https://developers.cloudflare.com/workers/learning/using-websockets/)

