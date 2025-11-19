# IndexerChain 信号服务器架构文档

## 📋 概述

IndexerChain 信号服务器是基于 **Cloudflare Workers** 和 **Durable Objects** 构建的 WebSocket 信令服务器，用于：
1. **WebRTC 信令**：帮助浏览器节点建立 P2P 连接
2. **Bootstrap 同步**：维护和分发链的最新状态（rootTip）
3. **Shadow Node**：为移动端提供持久连接支持

---

## 🏗️ 架构设计

### 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Worker (入口层)                      │
│  • 路由分发 (HTTP/WebSocket)                                │
│  • CORS 处理                                                │
│  • Shadow Node 路由                                          │
│  • Admin 端点                                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌──────────────────┐        ┌──────────────────┐
│ SignalingRoom    │        │ ShadowSession    │
│ (Durable Object) │        │ (Durable Object) │
│                  │        │                  │
│ • Peer 管理      │        │ • 会话持久化      │
│ • RootTip 存储   │        │ • 状态缓存        │
│ • WebRTC 信令    │        │ • Active Miner   │
└──────────────────┘        └──────────────────┘
```

### 1. SignalingRoom (主信令房间)

**职责**：
- 管理所有连接的 P2P 节点
- 维护链的最新状态（rootTip）
- 处理 WebRTC 信令消息
- 广播链状态更新

**状态管理**：
```javascript
{
  peers: Map<nodeId, WebSocket>,        // 连接的节点
  peerIPHashes: Map<nodeId, ipHash>,    // IP 哈希（隐私保护）
  bootstrapState: {
    latestHeight: 0,                     // 最新区块高度
    latestHeader: null,                  // 最新区块头
    latestHeaderHash: "",                // 最新区块哈希
    recentHeaders: [],                   // 最近 500 个区块头
    latestSnapshotMeta: null,            // 最新快照元数据
    lastUpdated: 0,                      // 最后更新时间
    stateCommitment: null,                // 状态承诺
    trustLevel: 'root-only'              // 信任级别
  }
}
```

**持久化存储**：
- 使用 Durable Objects 的 `state.storage` API
- 自动保存 rootTip 到持久化存储
- 启动时自动加载 rootTip

### 2. ShadowSession (Shadow Node 会话)

**职责**：
- 为移动端提供持久连接
- 缓存链状态（即使浏览器锁定）
- 管理 Active Miner 状态
- 同步状态到浏览器

**状态管理**：
```javascript
{
  sessionId: string,                    // 会话 ID
  nodeId: string,                       // 节点 ID
  cachedState: {                         // 缓存的状态
    latestHeight: 0,
    latestHeader: null,
    recentHeaders: [],
    latestSnapshotMeta: null,
    stateCommitment: null,
    finalizedHeight: 0,
    lastUpdated: 0
  },
  activeMinerId: string | null,         // 当前活跃矿工
  activeMinerLastSeen: number           // 最后活跃时间
}
```

---

## 📡 消息协议

### 客户端 → 服务器

#### 1. JOIN (加入网络)
```json
{
  "type": "join",
  "nodeId": "node_1234567890..."
}
```

**响应**：`JOIN_ACK`
```json
{
  "type": "JOIN_ACK",
  "peers": ["node_abc...", "node_def..."],
  "ipHash": "abc123...",
  "peerIPHashes": {
    "node_abc...": "hash1",
    "node_def...": "hash2"
  },
  "rootTip": {
    "latestHeight": 365,
    "latestHeader": {...},
    "latestHeaderHash": "0x...",
    "recentHeaders": [...],
    "latestSnapshotMeta": {...},
    "stateCommitment": "0x...",
    "trustLevel": "root-only"
  }
}
```

#### 2. REQUEST_BOOTSTRAP (请求引导数据)
```json
{
  "type": "REQUEST_BOOTSTRAP",
  "requestId": "req_1234567890",
  "wantSnapshotMeta": true,
  "wantHeaders": true,
  "headerCount": 200
}
```

**响应**：`BOOTSTRAP_RESPONSE`
```json
{
  "type": "BOOTSTRAP_RESPONSE",
  "requestId": "req_1234567890",
  "latestHeight": 365,
  "latestHeader": {...},
  "latestHeaderHash": "0x...",
  "recentHeaders": [...],
  "latestSnapshotMeta": {...},
  "stateCommitment": "0x...",
  "trustLevel": "root-only",
  "stale": false,
  "timestamp": 1234567890
}
```

#### 3. UPDATE_ROOT_TIP (更新根区块)
```json
{
  "type": "UPDATE_ROOT_TIP",
  "payload": {
    "latestHeight": 366,
    "latestHeader": {...},
    "latestHeaderHash": "0x...",
    "recentHeaders": [...],
    "latestSnapshotMeta": {...},
    "stateCommitment": "0x..."
  }
}
```

**触发**：服务器广播 `ROOT_TIP_UPDATE` 给所有连接的节点

#### 4. WebRTC 信令消息
```json
{
  "type": "offer" | "answer" | "ice-candidate",
  "to": "target_node_id",
  "sdp": "...",
  "candidate": "..."
}
```

### 服务器 → 客户端

#### 1. ROOT_TIP_UPDATE (根区块更新广播)
```json
{
  "type": "ROOT_TIP_UPDATE",
  "rootTip": {
    "latestHeight": 366,
    "latestHeader": {...},
    "latestHeaderHash": "0x...",
    "recentHeaders": [...],
    "latestSnapshotMeta": {...},
    "updatedAt": 1234567890,
    "stateCommitment": "0x...",
    "trustLevel": "root-only"
  },
  "timestamp": 1234567890
}
```

#### 2. new-peer (新节点加入)
```json
{
  "type": "new-peer",
  "peerId": "node_1234567890...",
  "ipHash": "abc123..."
}
```

#### 3. peer-left (节点离开)
```json
{
  "type": "peer-left",
  "peerId": "node_1234567890..."
}
```

---

## 🔄 工作流程

### 1. 节点连接流程

```
客户端                         信号服务器
  │                              │
  ├─ WebSocket 连接 ────────────>│
  │                              │
  ├─ JOIN 消息 ─────────────────>│
  │                              │
  │<─ JOIN_ACK (含 rootTip) ─────┤
  │                              │
  ├─ REQUEST_BOOTSTRAP ──────────>│
  │                              │
  │<─ BOOTSTRAP_RESPONSE ────────┤
  │                              │
  ├─ 建立 P2P 连接 ──────────────>│
  │                              │
```

### 2. RootTip 更新流程

```
矿工节点                       信号服务器                    其他节点
  │                              │                            │
  ├─ UPDATE_ROOT_TIP ───────────>│                            │
  │                              │                            │
  │                              ├─ 验证并更新 rootTip        │
  │                              ├─ 持久化到存储              │
  │                              │                            │
  │                              ├─ ROOT_TIP_UPDATE ─────────>│
  │                              ├─ ROOT_TIP_UPDATE ─────────>│
  │                              ├─ ROOT_TIP_UPDATE ─────────>│
  │                              │                            │
```

### 3. Bootstrap 同步流程

```
新节点                         信号服务器
  │                              │
  ├─ JOIN ──────────────────────>│
  │                              │
  │<─ JOIN_ACK (rootTip) ────────┤
  │                              │
  ├─ REQUEST_BOOTSTRAP ──────────>│
  │                              │
  │<─ BOOTSTRAP_RESPONSE ────────┤
  │  (latestHeight, headers,     │
  │   snapshotMeta)              │
  │                              │
  ├─ 使用 UnifiedSyncManager ────>│
  │  同步到最新高度               │
  │                              │
```

---

## 💾 持久化存储

### SignalingRoom 存储

**键**: `rootTip`
**值**:
```javascript
{
  latestHeight: number,
  latestHeader: BlockHeader,
  latestHeaderHash: string,
  recentHeaders: BlockHeader[],  // 最近 500 个
  latestSnapshotMeta: SnapshotMeta | null,
  lastUpdated: number,
  stateCommitment: string | null,
  trustLevel: 'root-only' | 'local-majority' | 'stale'
}
```

**加载时机**：
- Durable Object 首次创建时（lazy initialization）
- 每次 `fetch()` 调用时检查 `initialized` 标志

**保存时机**：
- 收到 `UPDATE_ROOT_TIP` 时
- 调用 `resetRootTip()` 时

### ShadowSession 存储

**键**: `session`
**值**:
```javascript
{
  sessionId: string,
  nodeId: string,
  cachedState: {...},
  activeMinerId: string | null,
  activeMinerLastSeen: number,
  lastUpdated: number
}
```

---

## 🔐 安全特性

### 1. IP 哈希（隐私保护）
- 不存储真实 IP 地址
- 使用哈希算法生成 IP 指纹
- 用于 Quorum 评分和独立节点检测

### 2. 信任级别
- `root-only`: 仅来自根节点的更新（默认）
- `local-majority`: 本地多数节点确认
- `stale`: 过时的状态

### 3. 状态验证
- 验证高度递增
- 验证必要字段存在
- 可扩展：验证 stateCommitment、finalityCert 等

---

## 🌐 HTTP 端点

### 1. Keepalive
```
GET/POST /keepalive
```
**用途**: PWA 持久化保持连接

### 2. Shadow Node
```
WebSocket: /shadow/{sessionId}
POST: /init?sessionId=...
POST: /setActiveMiner?sessionId=...
GET: /getActiveMiner?sessionId=...
```

### 3. Admin (生产环境需要认证)
```
POST /admin/reset-root-tip
Body: {
  newGenesisHeader: {...},
  newGenesisHash: "0x...",
  newStateCommitment: "0x..."
}
```

---

## 📊 性能特性

### 1. Durable Objects
- **单例模式**: 所有 Worker 实例共享同一个 SignalingRoom
- **状态一致性**: 自动保证所有连接看到相同的 rootTip
- **自动扩缩容**: Cloudflare 自动处理负载

### 2. 消息广播
- **高效广播**: 遍历所有连接的 WebSocket 发送
- **错误处理**: 单个节点失败不影响其他节点
- **连接状态检查**: 只向 `OPEN` 状态的连接发送

### 3. 存储优化
- **最近 500 个区块头**: 平衡同步速度和存储空间
- **延迟加载**: rootTip 在首次请求时加载
- **自动持久化**: 更新后自动保存

---

## 🐛 调试和监控

### 日志输出

**SignalingRoom**:
- `[SignalingRoom] Node ... joined. Total peers: X`
- `[SignalingRoom] Received REQUEST_BOOTSTRAP from ...`
- `[SignalingRoom] Sending BOOTSTRAP_RESPONSE: height=X`
- `[SignalingRoom] Broadcasting ROOT_TIP_UPDATE to X peer(s)`

**ShadowSession**:
- `[ShadowSession] Loaded session: ...`
- `[ShadowSession] Browser connected`
- `[ShadowSession] Browser disconnected`

### 查看实时日志

```bash
cd workers
wrangler tail
```

### Cloudflare Dashboard

访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → `indexerchain-signaling`

---

## 🔧 配置

### wrangler.toml

```toml
name = "indexerchain-signaling"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "SIGNALING_ROOM"
class_name = "SignalingRoom"

[[durable_objects.bindings]]
name = "SHADOW_SESSION"
class_name = "ShadowSession"

[[routes]]
pattern = "signal.indexerchain.com/*"
zone_name = "indexerchain.com"
```

---

## 📝 关键代码位置

### 核心文件

1. **`workers/src/index.js`**
   - `SignalingRoom` 类：主信令房间
   - 路由处理和消息分发
   - HTTP 端点处理

2. **`workers/src/shadow.js`**
   - `ShadowSession` 类：Shadow Node 会话
   - 移动端持久连接
   - Active Miner 管理

### 关键方法

**SignalingRoom**:
- `loadRootTip()`: 从存储加载 rootTip
- `saveRootTip()`: 保存 rootTip 到存储
- `resetRootTip()`: 重置到新的 genesis 区块
- `fetch()`: 处理 WebSocket 连接和消息

**ShadowSession**:
- `loadSession()`: 加载会话状态
- `saveSession()`: 保存会话状态
- `updateCachedState()`: 更新缓存的状态
- `handleBrowserConnection()`: 处理浏览器连接

---

## 🚀 部署

### 部署到 Cloudflare Workers

```bash
cd workers
wrangler deploy
```

### 自定义域名

```bash
wrangler route add "signal.indexerchain.com/*" indexerchain-signaling
```

---

## 📚 相关文档

- [区块同步架构](./BLOCK_SYNC_ARCHITECTURE.md)
- [跨终端同步架构](./CROSS_PLATFORM_SYNC_ARCHITECTURE.md)
- [Phase 46 统一同步方案](./PHASE_46_COMPLETE_SYNC_SOLUTION.md)
- [Shadow Node 文档](./PHASE_40_SHADOW_NODE.md)

---

## ⚠️ 注意事项

1. **状态持久化**: rootTip 存储在 Durable Objects 中，重启后不会丢失
2. **单例模式**: 所有 Worker 实例共享同一个 SignalingRoom（通过 `idFromName('main')`）
3. **消息顺序**: WebSocket 消息可能乱序，需要客户端处理
4. **连接超时**: 长时间无活动的连接可能被 Cloudflare 关闭
5. **生产环境**: Admin 端点需要添加认证机制

---

## 🔄 版本历史

- **Phase 37**: 添加 rootTip 持久化和状态承诺
- **Phase 38**: 优化 recentHeaders（保留最近 500 个）
- **Phase 40**: 添加 Shadow Node 支持
- **Phase 45**: 添加 rootTip 重置功能

