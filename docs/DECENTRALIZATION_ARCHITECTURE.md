# IndexerChain 去中心化架构文档

## 🎯 核心目标

**实现真正的去中心化，使链不依赖任何单一服务器即可运行。**

---

## ✅ 已实现的去中心化能力（Phase 45 + Phase 46+）

### 1. 多信号服务器机制 ✅

**实现位置**: `src/core/p2p.ts`

**能力**:
- 支持多个信号服务器 URL 列表
- 自动故障转移：一个服务器挂了，自动切换到下一个
- 所有服务器都挂了 → 使用 Peer 缓存继续运行

**配置示例**:
```typescript
signalServers: [
  "wss://signal1.indexerchain.com",
  "wss://signal2.indexerchain.com",
  "wss://signal3.indexerchain.com"
]
```

**状态**: ✅ **已实现** - 消除了第一层单点故障

---

### 2. Peer 缓存（P2P 自引导）✅

**实现位置**: `src/core/p2p.ts`, `src/core/connectionManager.ts`

**能力**:
- 缓存已连接的 peer 列表到 `localStorage`
- 即使所有信号服务器挂了，也能从缓存恢复连接
- WebRTC ICE 自动重连机制

**工作流程**:
```
1. 节点连接信号服务器 → 获取 peer 列表
2. 建立 WebRTC 连接 → 缓存 peer 信息
3. 信号服务器挂了 → 从 localStorage 读取 lastPeers
4. 直接 WebRTC call peers → 链继续运行
```

**状态**: ✅ **已实现** - 真正的去中心化核心特性

---

### 3. Shadow Node 分布式部署 ✅

**实现位置**: `workers/src/shadow.js`, `src/core/shadowNode.ts`

**能力**:
- 支持多个 Shadow Node URL
- 自动故障转移
- 即使所有 Shadow Node 挂了，只是失去移动端离线保持功能，链仍可运行

**配置示例**:
```typescript
shadowNodeUrls: [
  "wss://shadow1.indexerchain.com",
  "wss://shadow2.indexerchain.com",
  "wss://shadow3.indexerchain.com"
]
```

**状态**: ✅ **已实现**

---

### 4. Bootstrap.json 导入/导出 ✅

**实现位置**: `src/ui/App.tsx` (Advanced 标签页)

**能力**:
- 导出：根区块 + 快照 + 最近 500 个区块头
- 导入：独立启动节点，无需任何服务器
- 类似 BitTorrent DHT + bootstrap seeds 的结构

**使用场景**:
- 新节点首次加入网络
- 信号服务器全部不可用时
- 私有网络部署

**状态**: ✅ **已实现** - 链不再依赖任何服务器即可独立运行

---

### 5. P2P RootTip Gossip（Phase 46+）✅ **新增**

**实现位置**: `src/core/rootTipGossip.ts`, `src/core/chain.ts`, `src/ui/App.tsx`

**能力**:
- 节点挖到新区块时，通过 P2P 网络 gossip rootTip
- 节点收到 gossip 时，使用 UnifiedSyncManager 处理并继续传播
- 防止循环传播（TTL、seen set）
- 即使所有信号服务器挂了，rootTip 仍能在 P2P 网络中传播

**工作流程**:
```
矿工节点挖到新区块:
  1. 发送 UPDATE_ROOT_TIP 到信号服务器（如果在线）← 加速器
  2. 同时通过 P2P gossip 广播 rootTip ← 去中心化传播

其他节点收到 gossip:
  1. 检查是否已处理（防重复）
  2. 使用 UnifiedSyncManager 处理 rootTip
  3. 如果 TTL > 0，继续转发给其他 peers
```

**防循环机制**:
- **TTL (Time To Live)**: 默认 5 跳，每转发一次减 1
- **Seen Set**: 记录已处理该消息的节点 ID，避免重复处理
- **消息 ID**: 基于 height + hash + timestamp，确保唯一性

**状态**: ✅ **已实现** - 完成去中心化的最后一块拼图

---

## 🏗️ 完整去中心化架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    BrowserNode (任意节点)                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  SignalServer (可选 - 加速器)                        │  │
│  │  • 多服务器故障转移                                   │  │
│  │  • 全部挂了 → 使用 Peer 缓存                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────┴──────────────────────────────┐  │
│  │  P2P Multi-Peer (WebRTC) - 核心去中心化层            │  │
│  │  • ROOT_TIP_GOSSIP - rootTip 点对点传播              │  │
│  │  • NEW_BLOCK - 区块广播                               │  │
│  │  • NEW_TX - 交易广播                                  │  │
│  │  • REQUEST_BLOCKS - 区块同步                          │  │
│  │  • GLOBAL_VIEW_REQUEST - 网络高度查询                 │  │
│  │  • Peer 发现和连接                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────┴──────────────────────────────┐  │
│  │  Bootstrap.json (可选 - 独立启动)                     │  │
│  │  • 导出：根区块 + 快照 + 最近 500 头                   │  │
│  │  • 导入：无需服务器即可启动节点                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Shadow Node (可选 - 移动端离线保持)                  │  │
│  │  • 多节点故障转移                                      │  │
│  │  • 全部挂了 → 只是失去离线保持功能                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 去中心化能力对比表

| 功能 | 不依赖信号服务器 | 实现状态 | 说明 |
|------|----------------|---------|------|
| **节点发现** | ✅ | ✅ 已实现 | Peer 缓存 + WebRTC 自动重连 |
| **链同步** | ✅ | ✅ 已实现 | P2P multi-sync + UnifiedSyncManager |
| **快照同步** | ✅ | ✅ 已实现 | Warp snapshot + peer 下载 |
| **rootTip 传播** | ✅ | ✅ **Phase 46+ 新增** | P2P RootTip Gossip |
| **移动端离线保持** | ⚠️ 部分 | ✅ 已实现 | Shadow Node（可选） |
| **bootstrap 独立启动** | ✅ | ✅ 已实现 | bootstrap.json 导入/导出 |
| **区块广播** | ✅ | ✅ 已实现 | NEW_BLOCK + NEW_BLOCK_HEADER |
| **交易广播** | ✅ | ✅ 已实现 | NEW_TX |

---

## 🔄 完整工作流程

### 场景 1: 正常情况（信号服务器在线）

```
矿工挖到新区块:
  ├─ UPDATE_ROOT_TIP → 信号服务器 → 广播给所有连接的节点
  └─ ROOT_TIP_GOSSIP → P2P 网络 → 点对点传播

其他节点:
  ├─ 收到信号服务器的 ROOT_TIP_UPDATE → UnifiedSyncManager 处理
  └─ 收到 P2P 的 ROOT_TIP_GOSSIP → UnifiedSyncManager 处理 + 转发
```

**优势**: 双重保障，信号服务器加速传播，P2P 确保去中心化

---

### 场景 2: 信号服务器全部离线

```
矿工挖到新区块:
  └─ ROOT_TIP_GOSSIP → P2P 网络 → 点对点传播（唯一方式）

其他节点:
  ├─ 从 Peer 缓存恢复连接
  ├─ 收到 P2P 的 ROOT_TIP_GOSSIP → UnifiedSyncManager 处理 + 转发
  └─ 链继续正常运行
```

**结果**: ✅ **链完全正常运行，不依赖任何服务器**

---

### 场景 3: 新节点首次加入（无服务器）

```
新节点:
  1. 导入 bootstrap.json（包含根区块 + 快照）
  2. 从 bootstrap.json 恢复链状态
  3. 尝试连接信号服务器（可选）
  4. 如果信号服务器不可用：
     - 使用 Peer 缓存（如果有）
     - 或等待其他节点通过 P2P 连接
  5. 通过 P2P 接收 ROOT_TIP_GOSSIP 和区块
  6. 同步到最新高度
```

**结果**: ✅ **完全独立启动，无需任何服务器**

---

## 🛡️ 防循环传播机制

### TTL (Time To Live)

- **默认值**: 5 跳
- **机制**: 每转发一次减 1，TTL = 0 时停止转发
- **目的**: 限制传播范围，防止无限扩散

### Seen Set

- **机制**: 记录已处理该消息的节点 ID
- **大小限制**: 最多 50 个节点（防止消息过大）
- **目的**: 防止节点重复处理同一消息

### Message ID

- **生成方式**: `gossip_{height}_{hash}_{timestamp}`
- **唯一性**: 确保同一 rootTip 更新只有一个消息 ID
- **目的**: 去重，防止重复处理

### 转发过滤

- **排除已见节点**: 不转发给已处理过该消息的节点
- **排除发送者**: 不转发回发送者
- **只转发给连接节点**: 只转发给已建立 WebRTC 连接的节点

---

## 📈 性能特性

### 传播速度

- **信号服务器**: 1 跳，所有节点同时收到（最快）
- **P2P Gossip**: 多跳传播，但覆盖所有节点（去中心化）

### 网络负载

- **信号服务器**: 单点负载高（所有节点连接）
- **P2P Gossip**: 负载分散（每个节点只转发给部分 peers）

### 容错性

- **信号服务器**: 单点故障影响所有节点
- **P2P Gossip**: 部分节点故障不影响整体传播

---

## 🔐 安全考虑

### 1. 消息验证

- **高度验证**: 只接受高度递增的 rootTip
- **哈希验证**: 验证 rootTip 的哈希一致性
- **状态承诺验证**: 可选的 stateCommitment 验证

### 2. 防攻击

- **TTL 限制**: 防止恶意节点无限转发
- **Seen Set 限制**: 防止消息过大攻击
- **Peer 信誉**: 结合 PeerReputation 系统，降低恶意节点影响

### 3. 隐私保护

- **不暴露 IP**: 只使用 nodeId 和 IP 哈希
- **端到端加密**: WebRTC 数据通道加密

---

## 🚀 未来扩展

### 1. 自适应 TTL

根据网络规模动态调整 TTL：
- 小网络（< 10 节点）: TTL = 3
- 中网络（10-100 节点）: TTL = 5
- 大网络（> 100 节点）: TTL = 7

### 2. Gossip 优先级

根据节点类型设置优先级：
- 矿工节点: 高优先级，快速传播
- 普通节点: 正常优先级
- 移动节点: 低优先级，节省带宽

### 3. 网络分区检测

检测网络分区并自动调整传播策略：
- 检测到分区 → 增加 TTL
- 检测到合并 → 恢复正常 TTL

---

## 📝 关键代码位置

### 核心实现

1. **`src/core/rootTipGossip.ts`**
   - `RootTipGossipManager`: 管理 gossip 传播
   - `gossipRootTip()`: 广播 rootTip
   - `handleGossipMessage()`: 处理收到的 gossip

2. **`src/core/chain.ts`**
   - `appendMinedBlock()`: 挖到新区块时触发 gossip

3. **`src/ui/App.tsx`**
   - `ROOT_TIP_GOSSIP` 消息处理
   - 使用 UnifiedSyncManager 处理 rootTip

4. **`src/core/p2p.ts`**
   - 添加 `ROOT_TIP_GOSSIP` 消息类型

---

## ✅ 最终答案

### 问题：如果信号服务器以后没了，是不是整条链也就没了？

### 答案：**不会。**

**原因**：

1. ✅ **多信号服务器机制** - 一个挂了自动切换
2. ✅ **Peer 缓存** - 所有服务器挂了，从缓存恢复连接
3. ✅ **P2P RootTip Gossip** - rootTip 通过 P2P 网络传播
4. ✅ **Bootstrap.json** - 新节点可以独立启动
5. ✅ **P2P 区块同步** - 区块和交易通过 WebRTC 直接传输

**信号服务器的作用**：
- ✅ **加速器** - 加速 rootTip 传播（1 跳 vs 多跳）
- ✅ **引导器** - 帮助新节点快速发现 peers
- ✅ **可选组件** - 不是必需的

**最终状态**：
```
信号服务器 = 只是加速器，not required

即使所有 Cloudflare Workers 全部关闭，
整条链依然会照样运转。
```

---

## 📚 相关文档

- [信号服务器架构](./SIGNALING_SERVER_ARCHITECTURE.md)
- [Phase 46 统一同步方案](./PHASE_46_COMPLETE_SYNC_SOLUTION.md)
- [区块同步架构](./BLOCK_SYNC_ARCHITECTURE.md)
- [跨终端同步架构](./CROSS_PLATFORM_SYNC_ARCHITECTURE.md)

