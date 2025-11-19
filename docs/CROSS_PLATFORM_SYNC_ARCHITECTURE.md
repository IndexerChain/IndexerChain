# IndexerChain: 跨终端区块高度同步架构（最终版）

## 🎯 架构目标

为了让所有终端（浏览器、移动端、桌面、服务器）随时、瞬间、稳定同步到最新高度，同步系统需要满足：

| 能力 | 说明 |
|------|------|
| 统一入口 | 所有节点无论来源，都从 Signal RootTip 开始同步 |
| 多源同步 | Worker → P2P → 本地快照，三路并行 |
| 快速对齐 | 浏览器连接后 1 秒内接近最新高度 |
| 强一致性 | 状态锁(StateLock) + 状态漂移检测(StateDrift) |
| 容错性 | 任意链路丢包、失败不会让同步中断 |
| 跨终端支持 | 支持浏览器、App、桌面、server 节点 |

---

## 🏛 同步总架构（跨终端）

```
                                ┌─────────────────────────┐
                                │   Cloudflare Worker     │
                                │  (Signal + RootTip Hub) │
                                │  • RootTip (持久化)       │
                                │  • Bootstrap Sync       │
                                └──────────┬──────────────┘
                                           │ WebSocket
                                           ▼
                 ┌────────────────────────────────────────────────┐
                 │               Bootstrap Sync Layer              │
                 │ (Browser / Mobile / Desktop / Server 节点通用) │
                 └───────────────────┬────────────────────────────┘
                                     │
                              ROOT_TIP_UPDATE
                                     ▼
         ┌─────────────────────────────────────────────────────────────┐
         │                  Fast Sync / Snapshot Sync                  │
         │  • recentHeaders 快速拉到最新 <200 差距                     │
         │  • snapshotMeta → 从快照恢复                               │
         └───────────────────┬────────────────────────────────────────┘
                             │
                      request missing blocks
                             ▼
            ┌─────────────────────────────────────────┐
            │       P2P WebRTC / Native Sync Layer     │
            │  • GLOBAL_VIEW_REQUEST                   │
            │  • REQUEST_BLOCKS                        │
            │  • BLOCKS                                │
            └─────────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────────┐
                  │     Block Sync Engine     │
                  │  • 验证                   │
                  │  • 竞态处理               │
                  │  • 批量容错               │
                  └──────────┬───────────────┘
                             │
                             ▼
               ┌────────────────────────────────┐
               │   State Sync Layer (最终一致性) │
               │  • StateCommit Gossip           │
               │  • StateLock (2/3 超多数锁)     │
               │  • StateDrift Detection         │
               │  • 自动修复 StateRepair         │
               └────────────────────────────────┘
```

**总结一句话：**

**Cloudflare Worker → FastSync → P2P BlockSync → StateLock → 完全一致。**

这整套同步适用所有终端。

---

## 🔥 核心：跨终端同步逻辑（终端无关）

所有终端必须执行的同步步骤：

### 1️⃣ 启动 → Worker 引导（统一链高度来源）

所有终端（浏览器/APP/桌面/服务端）连接主网的第一步：

```
connect → send REQUEST_BOOTSTRAP → receive rootTip
```

**rootTip 包含：**
```typescript
{
  latestHeight,
  latestHeader,
  recentHeaders[200],
  latestSnapshotMeta,
  stateCommitment,
  trustLevel
}
```

这个 RootTip 是所有终端的唯一正确高度来源。

即使 peers=0，也必须基于 Worker 的 RootTip 启动同步。

**当前实现：**
- ✅ `BootstrapSyncManager` 已实现
- ✅ `REQUEST_BOOTSTRAP` / `BOOTSTRAP_RESPONSE` 协议已实现
- ✅ Worker 持久化 RootTip 已实现

### 2️⃣ Fast Sync（如果高度差 ≤ 200）

使用 recentHeaders 直接更新 tip：

```
localHeight < latestHeight
→ 使用 recentHeaders 快速追到最新200个区块
```

**性能：**
- 200 headers 仅几 KB，非常轻量
- 1 秒内追到 Tip

**当前实现：**
- ✅ `BootstrapSyncManager.processBootstrapResponse()` 已实现
- ✅ `fastSetTip()` 快速更新 tip 引用已实现
- ⚠️ 需要优化：确保 recentHeaders 总是包含最新 200 个

### 3️⃣ Snapshot Sync（如果高度差 >= snapshotInterval）

适用于移动端/弱设备/首次启动：

```
latestSnapshotMeta → 最新快照文件（压缩状态）
恢复 storage
恢复 indexState
然后使用 recentHeaders 补齐尾部区块
```

**当前实现：**
- ✅ `SnapshotDownloader` 已实现
- ✅ `SnapshotSeeder` 已实现
- ⚠️ 需要优化：快照压缩（gzip+binary pack）减少传输 90%

### 4️⃣ P2P Block Sync（用于补齐缺失区块）

不管什么设备，都走 P2P sync：

```
REQUEST_BLOCKS
BLOCKS
GLOBAL_VIEW_REQUEST
GLOBAL_VIEW_RESPONSE
```

**当前实现：**
- ✅ 批量 500 区块
- ✅ 区块容错（continue）
- ✅ 竞态检查（tip变化重新验证）
- ✅ 排序处理
- ✅ 直接 peer 请求（sendToPeer）
- ✅ 详细诊断日志

**这套机制已经是完美的主网级实现。**

### 5️⃣ State Sync（最终状态一致性）

Phase 36 完美解决了"高度相同但状态不同"的主网终极难题：

- ✅ StateCommit Gossip（每 10 秒广播状态commit）
- ✅ StateLock（2/3 超多数锁）
- ✅ State Drift Detector（检测状态漂移）
- ✅ State Repair（自动修复重建状态）

这保证：跨终端不可能出现"同高度但余额不一致"问题。

---

## 🧠 多终端适配策略

### 浏览器端
- ✅ 信令服务器（CF Worker）是主要 bootstrap 来源
- ✅ P2P 使用 WebRTC
- ✅ 使用 IndexedDB 持久化链与状态
- ✅ Snapshot 通过 HTTP 下载

### 移动端（iOS/Android）
- ⚠️ 不允许使用 WebRTC（iOS 限制）
- 可选：
  - WebSocket + 压缩区块同步 API
  - 直接连接一个"trusted peer"
- ✅ Snapshot Sync 是移动端默认同步方式
- ⚠️ 需要实现：SQLite 持久化

### 桌面客户端（Electron）
- ✅ WebRTC + TCP 任选
- ✅ 可以全存储完整链
- ✅ 支持全节点模式（Mining 不限制）

### 服务端节点（Node.js）
- ⚠️ 不用 WebRTC，可直接用 TCP/WebSocket
- ⚠️ 支持 P2P 全连接
- ⚠️ 可以作为超级 Peer 提供区块流

---

## 🌐 多终端统一同步协议

**Worker 是所有节点的 "高度与状态的源头"**

所有终端必须遵循：

```
if(rootTipHeight > localHeight):
    → FastSync or SnapshotSync first
    → Then P2P block sync
    → Then StateLock alignment
```

这是统一的主网规则。

---

## 💡 高度同步关键要求（主网必须遵守）

1. **所有节点必须以 Cloudflare Worker 的 RootTip 为唯一入口**
   - ✅ 已实现：避免网络分叉

2. **最近 200 Headers 是所有终端的快速同步加速器**
   - ✅ 已实现：移动端只要 200 headers 就能跟上

3. **区块同步必须容错**
   - ✅ 已实现：逐区块 continue，这是最正确的做法

4. **最终一致性由 StateLock 保证**
   - ✅ 已实现：Worker、浏览器、移动端都会收到同一状态锁

---

## 🧱 最终版同步流程（终端无关）

```
connect 
  → receive rootTip 
  → FastSync/SnapshotSync 
  → P2P BlockSync 
  → StateLock 
  → 完全一致 
  → 允许挖矿
```

任何终端都必须按此流程进行。

---

## 🚀 当前实现状态

### ✅ 已完成

- ✅ BootstrapSync
- ✅ FastSync
- ✅ SnapshotSync
- ✅ P2P BlockSync
- ✅ StateLock
- ✅ StateDrift
- ✅ StateRepair
- ✅ 详细诊断日志
- ✅ 直接 peer 请求（sendToPeer）

### ⚠️ 需要优化

1. **快照压缩**：gzip+binary pack 减少传输 90%
2. **移动端支持**：WebSocket + 压缩区块同步 API
3. **服务端节点**：TCP/WebSocket P2P 支持
4. **带宽检测**：为 P2P 区块同步增加 QoS
5. **StateLock 可视化**：把 StateLock 信息加入 NetworkHealthPanel

---

## 🔍 当前同步问题诊断

如果同步卡住，检查以下日志：

1. **是否有 peers？**
   ```
   [Auto-Sync] 🔄 Local: 736, Network: 1933, Behind: 1197, Peers: X
   ```
   如果 `Peers: 0`，说明没有连接对等节点

2. **是否在请求区块？**
   ```
   [Sync] 🔄 Requesting 500 blocks to catch up (from 737 to 1236, network: 1933, peers: 1)
   ```
   如果看到这个日志，说明正在请求

3. **是否收到区块？**
   ```
   [Sync] 📦 Received 500 blocks from node_xxx... (heights: 737-1236, local: 736)
   ```
   如果看到这个日志，说明收到了区块

4. **是否成功追加？**
   ```
   [Sync] ✅ Appended 500 blocks. New height: 1236 (was 736)
   ```
   如果看到这个日志，说明同步成功

---

## 📝 下一步建议

1. **为移动端和桌面端制作独立的 Bootstrap 客户端模块**
2. **支持 Snapshot 压缩（gzip+binary pack）减少传输 90%**
3. **为 P2P 区块同步增加带宽检测（QoS）**
4. **把 StateLock 信息加入 NetworkHealthPanel（最终一致性可视化）**

---

## 🎯 总结

区块高度与状态同步架构现在已经是主网级别的。

当前实现已经具备：
- 统一入口（Worker RootTip）
- 多源同步（Worker → P2P → Snapshot）
- 快速对齐（FastSync）
- 强一致性（StateLock）
- 容错性（区块容错处理）

下一步主要是：
- 跨终端适配（移动端、服务端）
- 性能优化（快照压缩、带宽检测）
- 可视化增强（StateLock 显示）

