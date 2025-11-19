# Sync 3.5: 非挖矿节点同步设计

## 🎯 核心原则

**只有挖矿节点才允许触发 Hard Reorg。非挖矿节点（Light Node）永远只追加区块，不做回滚。**

## 📋 设计原理

### 为什么非挖矿节点不会分叉？

1. **A 是唯一的生产者**：终端 A 在挖矿，是链的唯一生产者
2. **B 没挖矿，不可能有自己的链**：终端 B 不挖矿，无法产生新区块
3. **B 的链一定是 A 的子集**：B 的链只能是从 A 同步来的，因此是 A 的子集

**结论**：B 只需要同步 A 的链，根本不需要 Hard Reorg。

## ✅ 实现规则

### 规则 1：非挖矿节点永不触发 Hard Reorg

```typescript
const isMiner = isMining || clusterMining;
if (!isMiner) {
  // 非挖矿节点：跳过分叉检测
  logger.debug(`[HardReorg] Non-miner node: skipping fork check.`);
  return null;
}
```

**效果**：
- ✅ B 不会出现 "链重组" 提示
- ✅ B 不会把 A 的链误判为分叉
- ✅ B 不会删除自己的区块
- ✅ B 不会从 0 重新开始

### 规则 2：同步区块时只做 "追加" 不做 "回滚"

非挖矿节点只允许：

```typescript
if (block.height == localHeight + 1) {
  appendBlock(block);
  localHeight++;
} else {
  // 跳过，稍后请求缺失的块
  requestMissingBlocks(localHeight + 1, networkHeight);
}
```

**不允许**：
- ❌ `delete blocks`
- ❌ `reset state`
- ❌ `removeBlocksFromHeight`

这就是一个纯客户端 light sync 模式。

### 规则 3：缺失区块 → 补齐，而不是回滚

**例子**：
- 本地：40
- 远端 A：178
- B 收到 43（因为 chunk/peer 排序不同）

**处理**：
```
expect = localHeight + 1 = 41
43 != 41 → 跳过
自动请求 41-178 缺失区块
```

这样最终会同步完整。

### 规则 4：只有真正"互相矛盾"的链需要 Hard Reorg

只有满足下面才算分叉：

```
本地 tip 的 prevHash 与远端提供的 block 不一致
```

例如：
- 本地第 41 块 prevHash = X
- 网络第 41 块 prevHash = Y（且 X != Y）

才是分叉。

**但 B 没挖矿永远不会出现这种情况。**

## 📌 新同步算法（终端 B 专用轻节点逻辑）

```typescript
if (!isMiner) {
  // 轻节点模式：永不回滚
  for (block of receivedBlocksSorted) {
    if (block.height == localHeight + 1) {
      appendBlock(block);
      localHeight++;
    }
  }
  
  if (localHeight < networkHeight) {
    requestMissingBlocks(localHeight + 1, networkHeight);
  }
}
```

## 📌 新分叉算法（只用于挖矿者）

```typescript
if (isMiner) {
  if (!chain.matchParent(block)) {
    performHardReorg();
  }
}
```

## 🧱 最终效果

| 节点 | 是否挖矿 | 是否回滚 | 行为 |
|------|---------|---------|------|
| A | ✅ 挖矿 | ✅ 允许 | 能出现真正分叉时才回滚 |
| B | ❌ 不挖矿 | ❌ 不允许回滚 | 永远只同步，不会回到 0、不会删除区块 |

**结果**：
- ✅ B 不会出现 "链重组" 提示
- ✅ B 不会把 A 的链误判为分叉
- ✅ B 不会删除自己的区块
- ✅ B 不会从 0 重新开始
- ✅ B 会很顺滑同步到最新高度（40 → 178）

## 🚀 系统架构

```
Miner Node（活跃挖矿）
  ↳ Miner Sync Mode（允许 reorg）

Light Node（普通浏览器）
  ↳ Non-miner Sync Mode（禁止 reorg，仅追加）
```

**80% 的用户是 Light Node → 永远不会出问题**  
**20% 的 Leader 节点负责挖矿 → 需要 Reorg 逻辑**

## 📝 简化总结

**只有挖矿节点执行分叉回滚；普通节点永远只追加区块，不做回滚，因此不会乱重置链，也不会从 0 开始同步。**

## 🔧 代码实现

### 1. `checkForFork` 函数修改

```typescript
export function checkForFork(
  chainContext: ChainContext,
  rootTipHash: string,
  recentHeaders: Array<{ height: number; hash: string }> | undefined,
  rootHeight: number,
  isMiner: boolean = false  // 新增参数
): HardReorgResult | null {
  // Sync 3.5: Non-miners never fork
  if (!isMiner) {
    logger.debug(`[HardReorg] Non-miner node: skipping fork check.`);
    return null;
  }
  // ... 继续分叉检测逻辑
}
```

### 2. `App.tsx` 中调用修改

```typescript
// BOOTSTRAP_RESPONSE 处理
const isMiner = isMining || clusterMining;
if (payload.latestHeaderHash && payload.recentHeaders && payload.recentHeaders.length > 0 && isMiner) {
  const forkResult = checkForFork(chainContext, payload.latestHeaderHash, payload.recentHeaders, networkHeight, isMiner);
  // ...
}

// ROOT_TIP_UPDATE 处理
const isMiner = isMining || clusterMining;
if (rootHeaderHash && recentHeaders && recentHeaders.length > 0 && isMiner) {
  const forkResult = checkForFork(chainContext, rootHeaderHash, recentHeaders, rootHeight, isMiner);
  // ...
}
```

### 3. 同步逻辑（已实现）

`handleReceivedBlocks` 函数已经实现了只追加的逻辑：
- 只处理 `block.height === localHeight + 1` 的区块
- 缺失的区块会请求补齐
- 不会删除或回滚区块

## ✅ 验证清单

- [x] 非挖矿节点跳过分叉检测
- [x] 非挖矿节点只追加区块
- [x] 非挖矿节点不会删除区块
- [x] 非挖矿节点不会从 0 重新开始
- [x] 挖矿节点可以触发 Hard Reorg
- [x] 同步逻辑只做追加，不做回滚

## 🎉 完成

Sync 3.5 设计已完成，非挖矿节点现在可以稳定同步，不会出现误判分叉或回滚到 0 的问题。

