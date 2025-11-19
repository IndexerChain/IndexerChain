# Hard Reorg 实现文档

## ✅ 问题本质

当终端B在高度落后时继续挖矿，会产生自己的分叉链：

```
主网链（终端A）:  [...40][41][42]...[178]
B 本地链（分叉）:  [...40][41][42][43] ← B自己挖的（不在主网）
```

**结果**：B的链与主网链不一致，无法直接同步到178。

---

## 🔥 解决方案：Hard Reorg（链重组）

### 核心机制

1. **分叉检测**：检查本地 tip hash 是否在 root tip 的 recent headers 中
2. **链重组**：删除分叉区块，回滚到共同祖先
3. **状态重建**：从回滚点重建状态
4. **重新同步**：从共同祖先开始重新下载区块

---

## 📋 实现细节

### 1. 分叉检测 (`checkForFork`)

**触发条件**：
- 收到 `ROOT_TIP_UPDATE` 或 `BOOTSTRAP_RESPONSE`
- 本地高度落后 ≥ 5 个区块
- 有 `recentHeaders`（最近500个区块头）

**检测逻辑**：
```typescript
if (localTipHash !== rootTipHash) {
  // Hash 不匹配，可能分叉
  if (!recentHashes.has(localTipHash)) {
    // 本地 tip hash 不在 recent headers 中 → 确认分叉
    // 查找共同祖先
    // 返回 rewindHeight
  }
}
```

**共同祖先查找**：
- 从本地高度向后检查最近100个区块
- 找到第一个在 `recentHeaders` 中的区块
- 该区块高度即为共同祖先
- 如果没有找到，回滚到 `localHeight - 50`（安全点）

### 2. 链重组 (`performHardReorg`)

**步骤**：

1. **停止挖矿**：
   ```typescript
   if (isMining) handleStopMining();
   if (clusterMining) handleStopClusterMining();
   ```

2. **删除分叉区块**：
   ```typescript
   chainContext.storage.removeBlocksFromHeight(rewindHeight + 1);
   ```

3. **重建状态**：
   - 优先使用快照（如果可用）
   - 否则重放所有剩余区块

4. **触发重新同步**：
   ```typescript
   p2p.broadcast("REQUEST_BLOCKS", {
     fromHeight: rewindHeight + 1,
     toHeight: rootHeight,
   });
   ```

---

## 🎯 实际效果

### 场景：终端B在高度40，挖出41-43（分叉）

**收到 ROOT_TIP_UPDATE（rootHeight=178）后**：

```
Step 1: 分叉检测
  - Local tip hash (43) 不在 recent headers 中
  - 查找共同祖先 → 找到高度40
  - 返回 rewindHeight = 40

Step 2: 停止挖矿
  - handleStopMining()
  - handleStopClusterMining()

Step 3: 链重组
  - 删除高度 41-43 的区块
  - 回滚到高度 40

Step 4: 状态重建
  - 从高度 40 重建状态（使用快照或重放）

Step 5: 重新同步
  - 请求区块 41-178
  - 应用区块到本地
  - 高度从 40 → 178

Step 6: 恢复挖矿
  - 状态一致后，可以恢复挖矿
```

---

## 🛡️ 安全性保障

### 1. 多层验证

- **分叉检测**：基于 recent headers，确保准确性
- **共同祖先查找**：向后检查，找到真实共同点
- **状态重建**：使用快照或完整重放，确保一致性

### 2. 防止误触发

- **高度差阈值**：只有高度差 ≥ 5 才检查
- **Hash 验证**：必须 hash 不匹配且不在 recent headers
- **保守策略**：找不到共同祖先时，只回滚50个区块

### 3. 状态一致性

- **快照优先**：使用快照快速重建
- **完整重放**：如果没有快照，重放所有区块
- **验证机制**：重建后验证状态一致性

---

## 📊 日志输出

### 分叉检测时

```
[HardReorg] 🚨 Fork detected! Local tip hash not in recent headers...
[HardReorg] Local: height=43, hash=abc123...
[HardReorg] Root: height=178, hash=def456...
[HardReorg] Found common ancestor at height 40
[HardReorg] Will rewind to height 40
```

### 链重组时

```
[HardReorg] 🔄 Starting hard reorg: rewinding from height 43 to 40
[HardReorg] ✅ Removed 3 blocks (from height 41 to 43)
[HardReorg] 🔄 Rebuilding index state from height 40...
[HardReorg] ✅ Rebuilt state from snapshot (height 40) + 0 blocks
[HardReorg] ✅ Hard reorg completed: removed 3 blocks, rewound to height 40
[HardReorg] Triggering resync from height 41 to 178
```

---

## 🔍 调试建议

### 如果 Hard Reorg 没有触发

1. **检查是否有 recent headers**：
   ```javascript
   const recentHeaders = window.lastRootTipRecentHeaders;
   console.log('Recent headers:', recentHeaders?.length);
   ```

2. **检查本地 tip hash**：
   ```javascript
   const localTip = chainContext.storage.getTip();
   console.log('Local tip:', {
     height: localTip?.header.height,
     hash: localTip?.hash?.substring(0, 16) + '...'
   });
   ```

3. **检查 root tip hash**：
   ```javascript
   const rootTipHash = window.lastRootTipHash;
   console.log('Root tip hash:', rootTipHash?.substring(0, 16) + '...');
   ```

### 如果 Hard Reorg 失败

1. **检查错误日志**：
   - 查找 `[HardReorg] ❌` 日志
   - 查看具体错误信息

2. **手动触发**：
   ```javascript
   const { performHardReorg } = await import('./core/hardReorg.js');
   const result = await performHardReorg(chainContext, 40);
   console.log('Reorg result:', result);
   ```

---

## ✅ 最终效果

### 修复前

```
终端B: 高度 40 → 挖出 41, 42, 43（分叉）
收到 rootTip (178) → 无法同步（分叉链）
结果: 高度停在 43，无法同步
```

### 修复后

```
终端B: 高度 40 → 挖出 41, 42, 43（分叉）
收到 rootTip (178) → 检测到分叉
→ Hard Reorg: 删除 41-43，回滚到 40
→ 重新同步: 下载 41-178
结果: 高度从 40 → 178，成功同步
```

---

## 🎉 总结

**问题根源**：
- B在落后时继续挖矿 → 产生分叉链
- 分叉链与主网不一致 → 无法同步

**解决方案**：
- Hard Reorg 机制自动检测并修复分叉
- 删除分叉区块，回滚到共同祖先
- 重新同步到主网高度

**效果**：
- ✅ 自动检测分叉
- ✅ 自动停止挖矿
- ✅ 自动删除分叉区块
- ✅ 自动重建状态
- ✅ 自动重新同步
- ✅ 无需手动重置链

**现在终端B可以自动从分叉链恢复到主网链，无需手动干预！**

