# Phase 46: 完整同步方案 - 为什么 B 不会再莫名从 0 开始

## 一句话介绍

**IndexerChain 是一条"浏览器原生、自动同步、挖矿+隐私+多端协作"的轻链，首年用宽松的安全规则快速启动网络，之后再自动收紧到 PoW+状态锁+Quorum 共治的高安全模式。**

---

## 核心问题：为什么 B 不会再莫名从 0 开始？

### 场景设定
- **终端 A**：在挖矿，高度 = 178
- **终端 B**：不挖矿，只是落后在高度 40

**问题**：B 收到 A 的高度信息后，会不会误判为"分叉"并清空链从 0 开始？

**答案**：**绝对不会**。以下是完整的保证机制。

---

## 一、自动同步高度：谁说了算？

### 统一决策：UnifiedSyncManager（已实现 Phase 46）

所有高度决策由 `UnifiedSyncManager` 统一管理，优先级顺序：

#### 1. StateLock 超多数锁定（最高优先级）

**实现位置**：`src/core/stateLockManager.ts`

- 如果有 **2/3+ 独立节点**对某个 `(height, stateCommitment)` 达成锁定
- 这就是**绝对主链高度**，所有节点必须同步到这个高度
- 通过 `StateCommitGossip` 收集网络状态，`QuorumManager` 计算超多数

**代码逻辑**：
```typescript
// unifiedSyncManager.ts
const stateLock = stateLockManager.getCurrentLock();
if (stateLock && stateLock.locked && stateLock.height > localHeight) {
  if (stateLock.tipHash !== localTipHash) {
    return await performStateLockSync(chainContext, p2pNode, stateLock);
  }
}
```

#### 2. P2P 多数 + Signal RootTip 一致

**实现位置**：`src/core/heightSyncManager.ts`

- 从多个 peer 的 `GLOBAL_VIEW_RESPONSE` + 信号服 `rootTip` 做 height histogram
- 找出"网络多数高度"
- 如果多数高度和 signal 一致，就以它为目标

**代码逻辑**：
```typescript
// heightSyncManager.ts
// 2. P2P majority + Signal RootTip (if consistent)
if (this.p2pHeight !== null && this.signalHeight !== null) {
  if (this.p2pHeight === this.signalHeight) {
    sources.push({
      type: "p2p",
      height: this.p2pHeight,
      trustLevel: "majority",
      ...
    });
  }
}
```

#### 3. Signal RootTip

**实现位置**：`src/core/unifiedSyncManager.ts`

- 只有信号服在线、P2P 较弱时，把 `rootTip` 当作默认主链高度
- Worker 节点持续维护最新的 `rootTip`，通过 `ROOT_TIP_UPDATE` 广播

#### 4. Shadow Node + Local

**实现位置**：`src/core/shadowNode.ts` + `src/core/heightSyncManager.ts`

- **Shadow**：云端"影子节点"的高度（掉线/锁屏时持续跑）
- **Local**：本地浏览器存的高度（localStorage + 本地链）

### 终端 B 的情况

**场景**：
- A 在挖，A 的高度 = 178
- 通过 P2P + Signal + StateCommitGossip 形成主链视图
- B 不挖，只是落后在 40

**UnifiedSyncManager 的判断**：
1. 检查 StateLock：如果有锁定，使用锁定高度
2. 检查 P2P 多数：多数节点高度 = 178
3. 检查 Signal RootTip：rootTip.height = 178
4. **结论**：B 是"Behind，但同一条链"，目标高度 = 178

**关键保证**：
- ✅ B 的 tip (40) 一定在 A 的链前缀里（因为 B 不挖矿，只能从 A 同步）
- ✅ 不会误判为"分叉"
- ✅ 不会触发硬重组
- ✅ 只会被判定为 "behind → 追块"

---

## 二、如何同步到 178：三种模式自动选择

### UnifiedSyncManager 的三档档位（已实现）

#### 1. Warp Sync（height 差 ≥ 1000）

**实现位置**：`src/core/warpSync.ts`

- 用快照 + 少量区块，目标是新节点 3 秒同步
- 优先使用 `latestSnapshotMeta`，如果没有则使用 `recentHeaders`

**代码逻辑**：
```typescript
// unifiedSyncManager.ts
if (rootHeight - localHeight >= 1000) {
  const warpSyncManager = getWarpSyncManager();
  warpSyncManager.init(chainContext, p2pNode);
  return await warpSyncManager.performWarpSync(rootTip);
}
```

#### 2. Chunk Sync（100 ≤ 差 < 1000）

**实现位置**：`src/core/chunkBasedSync.ts`

- 把差距切成 chunk（默认 100 区块一块）
- 多 peer 并行请求（最多 5 个并发）
- 自动重试失败的 chunk
- 智能检测缺失区块，只请求需要的部分

**代码逻辑**：
```typescript
// unifiedSyncManager.ts
if (heightDiff >= 100) {
  return await chunkSync(chainContext, p2pNode, localHeight + 1, rootHeight);
}
```

#### 3. FastSync500（差 < 500）

**实现位置**：`src/core/unifiedSyncManager.ts` + `src/core/chunkBasedSync.ts`

- 利用 Signal + peers 提供的 `recentHeaders[最多 500 个]`
- 先把 header 填进 `headerCache`，再按需拉 body
- 使用 `ChunkBasedSyncManager` 快速同步

**代码逻辑**：
```typescript
// unifiedSyncManager.ts
if (recentHashes.has(localTipHash)) {
  // Local tip is in recent headers - no fork, just need to sync
  return await fastSync500(chainContext, p2pNode, rootHeight, rootTip.recentHeaders);
}
```

### 你给的例子：A = 178，B = 40

**差距 = 138 区块**

**处理流程**：
1. UnifiedSyncManager 计算：`138 < 500` → 走 **FastSync500** 模式
2. 发现 B 已经有 `[1..40]`，就只把 `[41..178]` 分 chunk 去拉
3. 区块追加时用 `expectedNextHeight` 模型，不会因乱序丢块

**关键保证**：
- ✅ 整个过程中**不会删除** 0 区块
- ✅ 更不会"从 0 开始"
- ✅ 只是追加缺失的区块 `[41..178]`

**代码实现**（`src/core/sync.ts`）：
```typescript
// expectedNextHeight 模型
let expectedNextHeight = -1;
for (const block of sortedBlocks) {
  if (expectedNextHeight === -1) {
    // First block in batch - must be consecutive from local height
    if (block.header.height !== localHeight + 1) {
      // Skip blocks that are too far ahead
      continue;
    }
    expectedNextHeight = block.header.height + 1;
  } else {
    // We're processing a batch - check if this block continues the sequence
    if (block.header.height !== expectedNextHeight) {
      // Gap in the batch - skip this block
      continue;
    }
    expectedNextHeight = block.header.height + 1;
  }
  // Append block
  context.storage.appendBlock(block);
}
```

---

## 三、什么时候才算"真正分叉"？

### 分叉检测逻辑（已实现）

**实现位置**：`src/core/unifiedSyncManager.ts` + `src/core/hardReorg.ts`

#### 检测步骤

1. **拿到主链侧提供的 `recentHeaders`（100–500 个）**

2. **检查本地 tip hash 是否在这个窗口中**：
   - **在** → 说明本地链只是落后 / 子前缀，**没有分叉**
   - **不在** → 再用 `findCommonAncestor` 向后找最近的共同祖先

3. **只有在这两种情况才认为"真正分叉"**：
   - tip hash 不在 `recentHeaders` 里
   - 且向后 200–500 个高度都找不到共同祖先

**代码实现**：
```typescript
// unifiedSyncManager.ts
if (localTipHash !== rootTipHash && rootTip.recentHeaders && rootTip.recentHeaders.length > 0) {
  // Only miners can trigger fork detection and reorg
  if (isMiner) {
    const ancestor = await findCommonAncestor(chainContext, localTip, rootTip.recentHeaders, 500);
    
    if (ancestor) {
      // Found common ancestor - rollback to it and sync
      logger.warn(`[UnifiedSync] 🚨 Fork detected! Common ancestor at height ${ancestor.height}`);
      const rollbackResult = await rollbackTo(chainContext, ancestor.height);
      // ...
    } else {
      // No common ancestor - use warp sync instead of clearing to 0
      logger.warn(`[UnifiedSync] ⚠️ No common ancestor found, using warp sync`);
      return await warpSyncManager.performWarpSync(rootTip);
    }
  }
}
```

### 终端 B 不挖矿时

**关键保证**：
- ✅ B 的 tip（40）一定在 A 的链前缀里
- ✅ 所以 **绝对不会触发 hard reorg**
- ✅ 更不会"删到 0"
- ✅ 只会被判定为 "behind → 追块"

**代码实现**（`src/core/hardReorg.ts`）：
```typescript
// Sync 3.5: Non-miners never fork - they only sync by appending blocks
if (!isMiner) {
  logger.debug(`[HardReorg] Non-miner node: skipping fork check. Only miners can trigger hard reorg.`);
  return null;
}
```

---

## 四、真正需要硬重组时怎么做？

### 只对自己挖出分叉的节点生效（已实现）

**实现位置**：`src/core/hardReorg.ts` + `src/core/unifiedSyncManager.ts`

#### 多重保险

1. **仅在"真分叉"时触发**（见上）

2. **永远不回滚到 0**：
   ```typescript
   // hardReorg.ts
   // CRITICAL: Never rewind to 0 unless user manually clears
   if (rewindHeight < 1) {
     logger.warn(`[HardReorg] Rewind height ${rewindHeight} is invalid, using minimum height 1 (keep genesis)`);
     rewindHeight = 1;
   }
   ```

3. **回滚高度最多回退到最近的"安全祖先"**：
   - 找到共同祖先高度（最多检查 500 个区块）
   - 回滚到共同祖先高度（最小为 1，保留 Genesis）

4. **回滚后走统一同步流程**：
   - 使用 `chunkSync` 从回滚高度 + 1 同步到目标高度
   - 再把缺失的正确区块追回来

5. **会触发 HardReorgBanner**：
   - BANNER 告诉用户：回滚了多少高度，从多少回到多少
   - 记录到 localStorage 的 Reorg History

**代码实现**：
```typescript
// unifiedSyncManager.ts
const rollbackResult = await rollbackTo(chainContext, ancestor.height);
if (rollbackResult.success) {
  logger.info(`[UnifiedSync] ✅ Rolled back to height ${ancestor.height}, now syncing to ${rootHeight}`);
  // Sync from ancestor height + 1 to root height
  return await chunkSync(chainContext, p2pNode, ancestor.height + 1, rootHeight);
}
```

### 关键点

- ✅ **非挖矿节点（FOLLOWER & 非 LEADER）默认不做 hard reorg，只追加块**
- ✅ 只有你是 **LEADER**、自挖高度明显"跑偏"，才会考虑重组自己的错误分支
- ✅ **永远不回滚到 0**（最小高度为 1，保留 Genesis）

---

## 五、多节点同时挖矿怎么避免互相伤害？

### 三层约束一起工作（已实现 Phase 40-46）

#### 1. Active Miner Control（多终端互斥）

**实现位置**：`src/core/shadowNode.ts` + `workers/src/shadow.js` + `src/core/miningGuard.ts`

- Shadow Node 上有 `activeMinerId`，同一账号 / 设备只能一个活跃挖矿源
- 终端 B 想挖矿时，会先问 Shadow Node：
  - 如果 A 正在挖 → 弹出对话框：抢不抢控制权？
  - 不抢的话 B 就只同步，不挖

**代码实现**：
```typescript
// miningGuard.ts
// Phase 44: Check 2.5: Active miner check (same device restriction)
if (shadowNodeClient && deviceId) {
  const currentActiveMinerId = shadowNodeClient.getActiveMinerId();
  if (currentActiveMinerId && currentActiveMinerId !== currentMinerId) {
    return {
      ok: false,
      code: "NOT_ACTIVE_MINER",
      reason: "Another device/tab is already mining. Only one active miner per device is allowed.",
    };
  }
}
```

#### 2. Global Nonce Pool + Delegator

**实现位置**：`src/core/globalNonceAllocator.ts` + `src/core/delegatorManager.ts`

- Whole network 的 nonce 空间由 Delegator 分配
- 避免两个 miner 在同一高度重复算同一范围
- 每个节点/worker 分配不重叠的 nonce 范围

**代码实现**：
```typescript
// globalNonceAllocator.ts
async allocateRange(nodeId: string, workerId: number): Promise<NonceRange | null> {
  // Check for overlap with existing ranges
  for (const range of this.allocatedRanges.values()) {
    if (range.expiresAt > Date.now()) {
      // Check overlap
      if ((start >= range.start && start < range.end) ||
          (end > range.start && end <= range.end) ||
          (start <= range.start && end >= range.end)) {
        // Overlap detected, skip to after this range
        this.globalPointer = range.end;
        return await this.allocateRange(nodeId, workerId); // Retry
      }
    }
  }
  // Allocate non-overlapping range
  // ...
}
```

#### 3. StateLock + Finality

**实现位置**：`src/core/stateLockManager.ts` + `src/core/finality/finalityManager.ts`

- 一旦 **2/3+ 节点**对某个高度形成 StateLock + FinalityCert
- 所有节点都被"锁死"在这个高度之前，不能重组
- 迟来的错误分支会被直接丢弃

**代码实现**：
```typescript
// stateLockManager.ts
const locked = majorityCommit.quorum >= this.SUPERMAJORITY_THRESHOLD; // 66.67%
if (locked) {
  this.currentLock = {
    height: currentHeight,
    stateCommitment: majorityCommit.stateCommitment,
    tipHash: majorityCommit.tipHash,
    quorum: majorityCommit.quorum,
    locked: true,
    // ...
  };
}
```

### 结果

- ✅ A 和 B 都挖时，最多出现非常短命的"本地微分叉"
- ✅ 但通过 Fast Relay + Finality + StateLock 很快就把赢家链锁定下来
- ✅ 失败分支只在本地 miner 节点被回滚，不会伤害全网
- ✅ 不会把跟随节点（不挖的 B）搞崩

---

## 六、总结：一句话回答你的担心

### 现在的 Sync 3.0 + UnifiedSyncManager 设计保证

**终端 B 如果不挖矿，只会"从 40 自动追到 178"，不会被当成分叉、更不会莫名从 0 重来；只有真正挖错链的节点才做有限度的回滚，而且永远不会回滚掉创世。**

### 完整保证链

1. ✅ **高度决策**：UnifiedSyncManager 统一决策，B 的 40 被识别为"落后"而非"分叉"
2. ✅ **同步方式**：自动选择 Warp/Chunk/FastSync，只追加缺失区块，不清空
3. ✅ **分叉检测**：只有 tip hash 不在 recentHeaders 且找不到共同祖先才算分叉
4. ✅ **非挖矿节点**：永不触发硬重组，只追加区块
5. ✅ **硬重组保护**：永远不回滚到 0（最小高度为 1，保留 Genesis）
6. ✅ **多节点挖矿**：Active Miner Control + Global Nonce Pool + StateLock 三重保护

### 实现文件清单

- ✅ `src/core/unifiedSyncManager.ts` - 统一同步管理器
- ✅ `src/core/hardReorg.ts` - 硬重组逻辑（永远不回滚到 0）
- ✅ `src/core/heightSyncManager.ts` - 高度同步管理器
- ✅ `src/core/stateLockManager.ts` - 状态锁管理器
- ✅ `src/core/chunkBasedSync.ts` - 分块同步
- ✅ `src/core/warpSync.ts` - 快速同步
- ✅ `src/core/shadowNode.ts` - Shadow Node 客户端
- ✅ `src/core/miningGuard.ts` - 挖矿守卫（Active Miner 检查）
- ✅ `src/core/globalNonceAllocator.ts` - 全局 Nonce 分配器
- ✅ `src/ui/App.tsx` - 主应用（ROOT_TIP_UPDATE 处理）

---

## 七、测试场景验证

### 场景 1：B 不挖矿，只是落后

**输入**：
- A 高度 = 178，B 高度 = 40
- B 收到 `ROOT_TIP_UPDATE`，rootHeight = 178

**预期行为**：
1. UnifiedSyncManager 判断：B 的 tip (40) 在 A 的链前缀里 → **不是分叉**
2. 选择 FastSync500（差距 138 < 500）
3. 只请求区块 `[41..178]`
4. 追加区块，不清空
5. **结果**：B 从 40 → 178，**不会从 0 开始**

### 场景 2：B 挖矿，但挖错了链

**输入**：
- A 高度 = 178，B 高度 = 43（B 自己挖了 41-43，但不在主链上）
- B 收到 `ROOT_TIP_UPDATE`，rootHeight = 178

**预期行为**：
1. UnifiedSyncManager 判断：B 的 tip (43) 不在 recentHeaders 里 → **可能是分叉**
2. 因为 B 是 miner，触发分叉检测
3. `findCommonAncestor` 找到共同祖先在高度 40
4. 回滚到高度 40（**不会回滚到 0**）
5. 使用 `chunkSync` 从 41 → 178 同步
6. **结果**：B 从 43 → 40 → 178，**不会从 0 开始**

### 场景 3：B 完全不挖矿，掉线后上线

**输入**：
- A 高度 = 178，B 高度 = 40（掉线前）
- B 重新上线，收到 `ROOT_TIP_UPDATE`

**预期行为**：
1. UnifiedSyncManager 判断：B 的 tip (40) 在 A 的链前缀里 → **不是分叉**
2. 选择 FastSync500（差距 138 < 500）
3. 只请求区块 `[41..178]`
4. 追加区块，不清空
5. **结果**：B 从 40 → 178，**不会从 0 开始**

---

## 八、技术细节补充

### expectedNextHeight 模型

**实现位置**：`src/core/sync.ts`

**作用**：处理乱序区块，确保区块按顺序追加

**代码逻辑**：
```typescript
let expectedNextHeight = -1;
for (const block of sortedBlocks) {
  if (expectedNextHeight === -1) {
    // First block in batch - must be consecutive from local height
    if (block.header.height !== localHeight + 1) {
      continue; // Skip blocks that are too far ahead
    }
    expectedNextHeight = block.header.height + 1;
  } else {
    // We're processing a batch - check if this block continues the sequence
    if (block.header.height !== expectedNextHeight) {
      continue; // Gap in the batch - skip this block
    }
    expectedNextHeight = block.header.height + 1;
  }
  // Append block
  context.storage.appendBlock(block);
}
```

### findCommonAncestor 算法

**实现位置**：`src/core/unifiedSyncManager.ts`

**作用**：在最近 200-500 个区块中查找共同祖先

**代码逻辑**：
```typescript
export async function findCommonAncestor(
  chainContext: ChainContext,
  _localTip: Block,
  recentHeaders: Array<{ height: number; hash: string } | BlockHeader>,
  maxCheckDepth: number = 500
): Promise<{ height: number; hash: string } | null> {
  // Convert recent headers to a map of hash -> height for fast lookup
  const recentHashes = new Map<string, number>();
  // ... build hash map ...
  
  // Check from local tip backwards, up to maxCheckDepth blocks
  const allBlocks = chainContext.storage.getAllBlocks();
  const checkRange = Math.min(maxCheckDepth, allBlocks.length);
  
  for (let i = allBlocks.length - 1; i >= startIndex; i--) {
    const block = allBlocks[i];
    if (recentHashes.has(block.hash)) {
      // Found common ancestor
      return { height: block.header.height, hash: block.hash };
    }
  }
  
  return null; // No common ancestor found
}
```

---

## 结论

**Phase 46 的统一同步方案通过多层保护机制，确保了终端 B 在落后时只会自动追块，永远不会被误判为分叉，更不会从 0 开始。只有真正挖错链的节点才会做有限度的回滚，而且永远不会回滚掉创世区块。**

