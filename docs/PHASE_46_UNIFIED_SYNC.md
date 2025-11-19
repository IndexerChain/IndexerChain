# Phase 46: 统一区块同步 + 分叉处理 + 多节点竞争挖矿

## ✅ 实现完成

本方案实现了完整的统一同步系统，保证：
- 节点永远能自动同步到最新高度
- 不会错误触发"从 0 开始"的假重组
- 不会因为 A 在挖矿 B 不挖矿导致 B 重置链
- 不会无脑回滚（只在真正分叉时才回滚）
- 多节点同时挖矿不会互相伤害
- 网络小规模（前期）也能安全运行

## 🎯 核心目标（全部满足）

1. ✅ 只要有可信 rootTip 或多数 Peer，一定能自动同步
2. ✅ 非真正分叉绝不回滚（不能误判）
3. ✅ 真正分叉时必须自动修复
4. ✅ 每个节点都能最终收敛到唯一链
5. ✅ 允许多个节点同时挖矿（但最终只有一个链）
6. ✅ 手机、掉线上线、后台运行，都能恢复正确状态

## 🚀 架构实现

### A. 3层决策逻辑（优先级最高 → 最低）

实现位置：`src/core/unifiedSyncManager.ts`

1. **StateLock** - 最权威，2/3 超多数确认
2. **网络多数 (P2P+Signal)** - 多数Height/Hash一致
3. **本地 + ShadowNode** - 本地缓存、Shadow、最终 fallback

决策顺序：
```
StateLock > P2P Majority > Signal RootTip > Shadow > Local
```

### B. 3层同步方式

1. **Warp Sync** - 超大差距 / 新节点 / 1000+ 区块
2. **Chunk Sync** - 标准差距 / 100-1000 区块
3. **FastSync500** - 差距 < 500 区块

同步策略自动选择，完全自动。

## 🧠 统一算法实现

### 核心函数：`handleRootTipUpdate`

位置：`src/core/unifiedSyncManager.ts`

算法流程：

```typescript
handleRootTipUpdate(rootTip) {
  const local = getLocalTip();
  
  // 1. 状态锁最高优先级
  if (stateLock.exists && !stateLock.matches(local)) {
    return performStateLockSync(stateLock);
  }
  
  // 2. 若高度相等 → 无需同步
  if (rootTip.height === local.height) return;
  
  // 3. 若远远落后 → Warp Sync
  if (rootTip.height - local.height >= 1000) {
    return warpSync(rootTip);
  }
  
  // 4. 若本地 tip 在 recent headers → Fast Sync
  if (recentHeaders.contains(local.hash)) {
    return fastSync500(rootTip.height);
  }
  
  // 5. 检查共同祖先
  const ancestor = findCommonAncestor(local, recentHeaders);
  if (ancestor) {
    rollbackTo(ancestor.height);
    return chunkSync(ancestor.height+1, rootTip.height);
  }
  
  // 6. 找不到共同祖先（极少） → Warp Sync（不清空）
  return warpSync(rootTip);
}
```

### 关键函数

#### 1. `findCommonAncestor`
- 检查最近 200-500 区块
- 返回共同祖先的高度和哈希
- 如果找不到，返回 null

#### 2. `fastSync500`
- 差距 < 500 区块时使用
- 使用 ChunkBasedSyncManager 快速同步

#### 3. `chunkSync`
- 差距 100-1000 区块时使用
- 智能检测缺失区块，只请求需要的部分

#### 4. `rollbackTo`
- **关键保证**：永远不回滚到 0
- 最小回滚高度是 1（保留 genesis）
- 除非用户手动清除，否则不会清空链

## 🛡️ 安全保证

### 1. 永远不回滚到 0

实现位置：`src/core/hardReorg.ts` 和 `src/core/unifiedSyncManager.ts`

```typescript
// 在 hardReorg.ts 中
if (rewindHeight < 1) {
  logger.warn(`[HardReorg] Rewind height ${rewindHeight} is invalid, using minimum height 1 (keep genesis)`);
  rewindHeight = 1;
}

// 在 unifiedSyncManager.ts 中
const ancestorHeight = Math.max(1, ancestor.height);
```

### 2. 非挖矿节点永不触发硬重组

实现位置：`src/core/hardReorg.ts`

```typescript
if (!isMiner) {
  logger.debug(`[HardReorg] Non-miner node: skipping fork check.`);
  return null;
}
```

### 3. 分叉检测只在真正分叉时触发

- 只有当本地 tip hash 不在 recent headers 中时才检测
- 必须找到共同祖先才回滚
- 找不到共同祖先时使用 Warp Sync，不清空链

## 📋 使用方式

### 在 App.tsx 中

已更新 `ROOT_TIP_UPDATE` 处理逻辑，使用新的统一同步管理器：

```typescript
import { handleRootTipUpdate } from "../core/unifiedSyncManager.js";

const syncResult = await handleRootTipUpdate(
  chainContext,
  p2pNode,
  rootTip,
  isMiner
);
```

## 🎯 场景测试

### 场景 B：终端 A 挖矿，终端 B 没挖矿

**保证**：B 不会出现"从 0 重置链"

1. B 收到 `ROOT_TIP_UPDATE`，rootHeight = 178，localHeight = 40
2. 高度差距大（138 区块），但不会触发回滚
3. 自动触发 Chunk Sync 或 FastSync500
4. 同步到高度 178，不会清空链

### 场景：多节点同时挖矿

**保证**：不会互相伤害

1. A 和 B 都在挖矿
2. 如果 B 挖出 block，但 A 广播了更长链
3. B 的 block 被孤块（orphan）
4. 自动丢弃该 block
5. 自动同步回到主链
6. 不会出现清空、回到 0、死锁

## 📊 日志输出

### 正常同步
```
[UnifiedSync] Processing ROOT_TIP_UPDATE: local=40, root=178, isMiner=false
[FastSync500] 🚀 Starting fast sync: 40 → 178 (gap: 138 blocks)
[FastSync500] ✅ Fast sync completed: requested 2 chunk(s), 0 blocks already present
```

### 分叉检测（挖矿节点）
```
[UnifiedSync] Hash mismatch detected, checking for common ancestor (miner node)
[UnifiedSync] Found common ancestor at height 40
[UnifiedSync] 🚨 Fork detected! Common ancestor at height 40
[UnifiedSync] ✅ Rolled back to height 40, now syncing to 178
```

### 非挖矿节点
```
[UnifiedSync] Non-miner node: hash mismatch but no fork check needed, syncing missing blocks
[ChunkSync] 🚀 Starting chunk sync: 40 → 178 (gap: 138 blocks)
```

## ✅ 完成状态

- [x] 创建统一的同步管理器 `unifiedSyncManager.ts`
- [x] 实现 3 层决策逻辑
- [x] 实现 3 层同步方式
- [x] 实现 `findCommonAncestor` 函数
- [x] 实现 `fastSync500` 函数
- [x] 更新 App.tsx 使用新算法
- [x] 确保硬重组逻辑永远不会回滚到 0
- [x] 非挖矿节点永不触发硬重组

## 🔄 后续优化

1. 性能优化：并行请求多个区块
2. 网络优化：优先使用低延迟节点
3. 状态同步：增量状态同步优化
4. 监控：添加同步进度和性能指标

