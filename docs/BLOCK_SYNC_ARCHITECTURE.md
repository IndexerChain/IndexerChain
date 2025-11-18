# 区块高度同步架构设计文档

## 📋 目录

1. [架构概述](#架构概述)
2. [同步流程](#同步流程)
3. [核心组件](#核心组件)
4. [消息协议](#消息协议)
5. [状态管理](#状态管理)
6. [错误处理与容错](#错误处理与容错)
7. [性能优化](#性能优化)

---

## 架构概述

IndexerChain 的区块同步系统采用**多层次、多阶段**的同步策略，确保节点能够快速、可靠地同步到最新状态。

### 设计原则

1. **渐进式同步**：从快速引导到完整同步，分阶段进行
2. **容错性**：单个区块失败不影响整体同步
3. **实时性**：定期更新 UI，确保显示状态与实际状态一致
4. **去中心化**：不依赖单一数据源，支持多 peer 同步

### 架构层次

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (App.tsx)                    │
│  - 同步状态显示                                          │
│  - 定期状态更新                                          │
│  - 用户交互触发                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Bootstrap Sync Layer                        │
│  - 信令服务器引导 (BootstrapSyncManager)                 │
│  - 快速获取网络高度                                      │
│  - 快照元数据获取                                        │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              P2P Sync Layer                              │
│  - WebRTC 连接管理                                       │
│  - 消息路由与广播                                        │
│  - Peer 发现与连接                                       │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Block Sync Layer (sync.ts)                  │
│  - 区块接收与验证                                        │
│  - 批量区块处理                                          │
│  - 区块追加逻辑                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              Storage Layer                               │
│  - 区块持久化                                            │
│  - 状态索引更新                                          │
│  - 快照管理                                              │
└─────────────────────────────────────────────────────────┘
```

---

## 同步流程

### 阶段 1: 初始连接与引导 (Bootstrap)

**触发时机**：节点首次连接或重新连接网络

**流程**：

```
1. 节点连接信令服务器 (WebSocket)
   ↓
2. 发送 JOIN 消息，获取 peer 列表
   ↓
3. 信令服务器返回 JOIN_ACK，包含：
   - 当前 peer 列表
   - rootTip (最新高度、区块头、快照元数据)
   ↓
4. 处理 rootTip (ROOT_TIP_UPDATE 消息)
   ↓
5. 如果高度差 > 0，触发区块请求
```

**关键代码位置**：
- `src/core/p2p.ts`: WebSocket 连接与消息处理
- `src/core/bootstrapSync.ts`: BootstrapSyncManager 处理引导逻辑
- `src/ui/App.tsx`: 处理 ROOT_TIP_UPDATE 和 BOOTSTRAP_RESPONSE

### 阶段 2: Peer 连接建立

**触发时机**：收到 peer 列表后

**流程**：

```
1. 遍历 peer 列表，建立 WebRTC 连接
   ↓
2. 使用确定性排序避免重复连接
   (nodeId 较小的节点创建 offer)
   ↓
3. WebRTC 数据通道建立成功
   ↓
4. 触发 'peer-connected' 事件
   ↓
5. 立即执行同步操作：
   - 发送 GLOBAL_VIEW_REQUEST
   - 如果本地高度 ≤ 0，立即请求区块
   - 如果本地高度 < 100，主动请求区块
```

**关键代码位置**：
- `src/core/p2p.ts`: `initiatePeerConnection()`, `setupDataChannel()`
- `src/ui/App.tsx`: `handlePeerConnected()` 事件处理

### 阶段 3: 网络高度查询

**触发时机**：
- Peer 连接建立后
- 定期查询（每 5 秒，如果高度仍为 0）

**流程**：

```
1. 广播 GLOBAL_VIEW_REQUEST
   ↓
2. Peers 响应 GLOBAL_VIEW_RESPONSE，包含：
   - height: 网络高度
   - tipHash: 最新区块哈希
   - finalizedHeight: 已确认高度
   ↓
3. 更新同步状态：
   - networkHeight = max(所有响应的高度)
   - 计算 behindBy = networkHeight - localHeight
   - 更新进度百分比
   ↓
4. 如果 behindBy > 0，触发区块请求
```

**关键代码位置**：
- `src/ui/App.tsx`: `GLOBAL_VIEW_RESPONSE` 消息处理
- `src/core/p2p.ts`: 消息类型定义

### 阶段 4: 区块请求与接收

**触发时机**：
- 检测到高度落后
- Peer 连接后自动触发
- 定期重试（如果高度仍为 0）

**流程**：

```
1. 广播 REQUEST_BLOCKS { fromHeight, toHeight }
   ↓
2. Peers 响应 BLOCKS { blocks: Block[] }
   ↓
3. 处理接收到的区块：
   a. 按高度排序
   b. 跳过已存在的区块
   c. 验证每个区块：
      - 检查 sender 是否被 ban
      - 验证区块（难度、哈希、Merkle root 等）
      - 检查竞态条件（重新检查 tip）
   d. 追加有效区块：
      - storage.appendBlock()
      - indexState.applyBlock()
   e. 继续处理其他区块（即使部分失败）
   ↓
4. 更新同步状态：
   - 从 storage 读取实际高度
   - 更新 localHeight
   - 重新计算进度
   ↓
5. 如果还有缺失区块，继续请求
```

**关键代码位置**：
- `src/core/sync.ts`: `handleReceivedBlocks()` - 核心区块处理逻辑
- `src/ui/App.tsx`: `BLOCKS` 消息处理与状态更新

### 阶段 5: 定期状态同步

**触发时机**：每 2 秒（peer count 更新 interval）

**流程**：

```
1. 从 storage 读取实际 tip
   ↓
2. 计算实际高度
   ↓
3. 如果高度变化或 networkHeight > 0：
   - 更新 localHeight
   - 重新计算 behindBy 和 progress
   - 更新 UI 显示
```

**关键代码位置**：
- `src/ui/App.tsx`: peer count interval 中的状态更新逻辑

---

## 核心组件

### 1. BootstrapSyncManager

**职责**：处理从信令服务器获取的引导信息

**关键方法**：
- `processBootstrapResponse()`: 处理引导响应，决定同步策略
- `fastSetTip()`: 快速更新 tip 引用（用于快速同步）

**特性**：
- 支持快照同步（高度差 > snapshotInterval）
- 支持快速同步（高度差 ≤ 200，使用最近区块头）
- 标记引导完成，允许挖矿开始

### 2. handleReceivedBlocks()

**职责**：批量处理接收到的区块

**关键特性**：
- **容错处理**：单个区块失败不影响其他区块
- **竞态条件处理**：追加前重新检查 tip
- **排序处理**：按高度排序，确保顺序追加
- **详细日志**：记录每个区块的处理结果

**处理流程**：
```typescript
for (const block of sortedBlocks) {
  1. 检查是否已存在
  2. 检查 sender 是否被 ban
  3. 验证区块
  4. 重新检查 tip（避免竞态）
  5. 追加区块
  6. 记录成功/失败
}
```

### 3. 同步状态管理 (syncStatus)

**状态结构**：
```typescript
{
  isSyncing: boolean;      // 是否正在同步
  localHeight: number;     // 本地高度
  networkHeight: number;   // 网络高度
  behindBy: number;        // 落后数量
  progress: number;        // 进度百分比 (0-100)
}
```

**更新时机**：
1. 收到 `GLOBAL_VIEW_RESPONSE` 时
2. 收到 `BLOCKS` 消息并追加区块后
3. 定期从 storage 读取实际状态时

---

## 消息协议

### 关键消息类型

#### 1. GLOBAL_VIEW_REQUEST / GLOBAL_VIEW_RESPONSE

**用途**：查询网络高度

**请求**：
```typescript
{
  type: "GLOBAL_VIEW_REQUEST",
  data: {}
}
```

**响应**：
```typescript
{
  type: "GLOBAL_VIEW_RESPONSE",
  data: {
    height: number;           // 网络高度
    tipHash: string;          // 最新区块哈希
    finalizedHeight: number;  // 已确认高度
    timestamp: number;        // 时间戳
  }
}
```

#### 2. REQUEST_BLOCKS / BLOCKS

**用途**：请求和接收区块

**请求**：
```typescript
{
  type: "REQUEST_BLOCKS",
  data: {
    fromHeight: number;  // 起始高度
    toHeight: number;    // 结束高度
  }
}
```

**响应**：
```typescript
{
  type: "BLOCKS",
  data: {
    blocks: Block[];    // 区块数组
    requestId?: string;  // 请求 ID（可选）
  }
}
```

#### 3. ROOT_TIP_UPDATE

**用途**：信令服务器广播最新 tip

**消息**：
```typescript
{
  type: "ROOT_TIP_UPDATE",
  data: {
    rootTip: {
      latestHeight: number;
      latestHeader: BlockHeader;
      latestHeaderHash: string;
      recentHeaders?: BlockHeader[];
      latestSnapshotMeta?: SnapshotMeta;
      stateCommitment?: string;
      trustLevel: string;
    }
  }
}
```

#### 4. BOOTSTRAP_RESPONSE

**用途**：信令服务器响应引导请求

**消息**：
```typescript
{
  type: "BOOTSTRAP_RESPONSE",
  data: {
    latestHeight: number;
    latestHeader: BlockHeader;
    latestHeaderHash: string;
    recentHeaders?: BlockHeader[];
    latestSnapshotMeta?: SnapshotMeta;
  }
}
```

---

## 状态管理

### UI 状态更新机制

#### 1. 事件驱动更新

**触发源**：
- `BLOCKS` 消息接收
- `GLOBAL_VIEW_RESPONSE` 接收
- `ROOT_TIP_UPDATE` 接收

**更新逻辑**：
```typescript
// 收到区块后
const newTip = chainContext.storage.getTip();
const newHeight = newTip?.header.height ?? 0;

setSyncStatus(prev => {
  // 更新 localHeight
  // 重新计算 behindBy 和 progress
  // 如果 networkHeight 未设置，从接收的区块推断
});
```

#### 2. 定期轮询更新

**触发时机**：每 2 秒（peer count interval）

**更新逻辑**：
```typescript
const actualTip = chainContext.storage.getTip();
const actualHeight = actualTip?.header.height ?? 0;

setSyncStatus(prev => {
  if (actualHeight !== prev.localHeight || prev.networkHeight > 0) {
    // 从实际 storage 读取高度
    // 确保 UI 反映真实状态
  }
});
```

**优势**：
- 即使事件处理失败，UI 也能反映真实状态
- 处理竞态条件和异步更新问题

### 状态推断机制

#### 从接收的区块推断 networkHeight

**场景**：区块先于 `GLOBAL_VIEW_RESPONSE` 到达

**逻辑**：
```typescript
const maxReceivedHeight = Math.max(...data.blocks.map(b => b.header.height));

if (maxReceivedHeight > newHeight) {
  // 推断网络高度至少为 maxReceivedHeight
  networkHeight = maxReceivedHeight;
  // 计算进度
  progress = (newHeight / networkHeight) * 100;
}
```

---

## 错误处理与容错

### 1. 区块验证失败

**处理策略**：
- 记录错误日志
- 记录到 peer reputation
- **继续处理其他区块**（不中断同步）

**代码**：
```typescript
if (!verification.valid) {
  console.error(`Block ${block.header.height} verification failed`);
  // 记录到 reputation
  // continue; // 继续处理其他区块
}
```

### 2. 区块追加失败

**处理策略**：
- 捕获异常
- 记录错误
- **继续处理其他区块**

**代码**：
```typescript
try {
  context.storage.appendBlock(block);
  context.indexState.applyBlock(block);
  appended++;
} catch (error) {
  console.error(`Failed to append block:`, error);
  // continue; // 继续处理其他区块
}
```

### 3. 竞态条件处理

**场景**：多个区块同时到达，或本地也在挖矿

**处理策略**：
- 追加前重新检查 tip
- 如果区块已存在，跳过

**代码**：
```typescript
// 重新检查 tip
const currentTip = context.storage.getTip();
const currentHeight = currentTip?.header.height ?? -1;

if (block.header.height <= currentHeight) {
  // 已存在，跳过
  continue;
}
```

### 4. Peer 连接失败

**处理策略**：
- 定期重试同步请求（每 5 秒）
- 如果高度仍为 0 且有 peers，自动重试

**代码**：
```typescript
const syncCheckInterval = setInterval(() => {
  if (peerCount > 0 && localHeight <= 0) {
    // 重试同步
    p2p.broadcast("GLOBAL_VIEW_REQUEST", {});
    p2p.broadcast("REQUEST_BLOCKS", { fromHeight: 1, toHeight: 500 });
  }
}, 5000);
```

### 5. 网络高度不一致

**处理策略**：
- 使用多个 peer 响应的最大值
- 确保使用最高的 networkHeight

**代码**：
```typescript
const finalNetworkHeight = Math.max(networkHeight, prev.networkHeight);
```

---

## 性能优化

### 1. 批量区块处理

**优化**：一次请求多个区块（最多 500 个）

**代码**：
```typescript
const requestRange = Math.min(behindBy, 500);
p2p.broadcast("REQUEST_BLOCKS", {
  fromHeight: localHeight + 1,
  toHeight: localHeight + requestRange,
});
```

### 2. 智能区块请求

**优化**：
- 如果高度差 ≤ 200，使用快速同步（区块头）
- 如果高度差 ≥ snapshotInterval，建议快照同步
- 否则，使用常规区块同步

### 3. 状态更新优化

**优化**：
- 只在高度变化时更新 UI
- 使用函数式更新避免状态竞争

**代码**：
```typescript
setSyncStatus(prev => {
  if (actualHeight !== prev.localHeight || prev.networkHeight > 0) {
    // 只在需要时更新
    return { ...prev, localHeight: actualHeight };
  }
  return prev; // 避免不必要的更新
});
```

### 4. 消息去重

**优化**：使用 messageId 避免重复处理

**代码**：
```typescript
if (message.messageId && this.seenMessages.has(message.messageId)) {
  return; // 已处理，跳过
}
```

---

## 关键改进点（最近修复）

### 1. 定期状态同步

**问题**：UI 显示的高度可能与实际 storage 不一致

**解决方案**：在 peer count interval 中定期从 storage 读取实际高度

### 2. 容错区块处理

**问题**：单个区块失败会导致整个批次失败

**解决方案**：使用 `continue` 而非 `return`，确保继续处理其他区块

### 3. 竞态条件处理

**问题**：多个区块同时到达可能导致重复追加

**解决方案**：追加前重新检查 tip，跳过已存在的区块

### 4. 网络高度推断

**问题**：如果 `GLOBAL_VIEW_RESPONSE` 未到达，无法计算进度

**解决方案**：从接收的区块中推断 networkHeight

### 5. 主动同步触发

**问题**：新节点连接后可能不会立即同步

**解决方案**：
- Peer 连接时立即触发同步
- 定期检查并重试（如果高度仍为 0）

---

## 总结

IndexerChain 的区块同步系统采用**多层次、多阶段、容错性强**的设计：

1. **引导阶段**：从信令服务器快速获取网络状态
2. **连接阶段**：建立 WebRTC 连接，立即触发同步
3. **查询阶段**：查询网络高度，计算同步需求
4. **同步阶段**：批量请求和接收区块，容错处理
5. **维护阶段**：定期更新状态，确保 UI 反映真实情况

**核心优势**：
- ✅ 快速启动：引导机制快速获取网络状态
- ✅ 容错性强：单个区块失败不影响整体
- ✅ 实时更新：定期轮询确保 UI 准确
- ✅ 智能推断：从接收数据推断网络状态
- ✅ 主动同步：自动触发和重试机制

---

## 相关文件

- `src/core/sync.ts` - 核心同步逻辑
- `src/core/bootstrapSync.ts` - 引导同步管理
- `src/core/p2p.ts` - P2P 网络层
- `src/ui/App.tsx` - UI 状态管理和消息处理
- `src/core/chain.ts` - 链存储和状态管理

