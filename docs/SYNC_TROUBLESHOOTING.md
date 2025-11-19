# 区块同步问题排查指南

## 问题描述
- 终端A：区块高度 178
- 终端B：区块高度 40
- 同步不起作用

## 当前同步机制

### 1. P2P 网络同步流程

```
终端B (高度40)                   终端A (高度178)
    |                                    |
    |--- GLOBAL_VIEW_REQUEST ---------->|
    |                                    |
    |<-- GLOBAL_VIEW_RESPONSE ----------|
    |    { height: 178 }                |
    |                                    |
    |--- REQUEST_BLOCKS {41-178} ------>|
    |                                    |
    |<-- BLOCKS {blocks: [...]} --------|
    |                                    |
    |  处理并追加区块                    |
```

### 2. 同步触发条件

**自动同步**（每3秒检查一次）：
- 检查 `networkHeight > localHeight`
- 如果落后，广播 `REQUEST_BLOCKS`
- 同时向所有连接的 peer 发送直接请求

**手动触发**：
- 接收到新区块头时
- 接收到 `GLOBAL_VIEW_RESPONSE` 时
- Peer 连接时

### 3. 多终端协调机制

#### 同一台机器（多个浏览器标签页）
- **LocalInstanceCoordinator**：
  - 选举一个 LEADER（可以挖矿）
  - 其他实例为 FOLLOWER（只读）
  - 通过 BroadcastChannel 通信
  - LEADER 每秒广播状态更新

#### 不同机器（不同物理设备）
- **P2P 网络同步**：
  - 通过信令服务器连接
  - 使用 WebRTC 直连
  - 通过 P2P 消息同步区块

## 问题排查步骤

### 步骤 1: 检查 P2P 连接

在终端B的控制台检查：

```javascript
// 检查是否连接
console.log('P2P Connected:', p2p.isConnected);
console.log('Peer Count:', p2p.getPeerCount());

// 检查连接的 peer
console.log('Peers:', Array.from(p2p.peers.keys()));
```

**预期结果**：
- `isConnected: true`
- `peerCount > 0`
- 能看到终端A的 peer ID

**如果未连接**：
1. 检查信令服务器 URL 是否正确
2. 检查网络连接
3. 检查防火墙设置

### 步骤 2: 检查同步状态

在终端B的控制台检查：

```javascript
// 检查同步状态
const syncStatus = window.lastSyncStatus || {};
console.log('Sync Status:', {
  localHeight: syncStatus.localHeight,
  networkHeight: syncStatus.networkHeight,
  behindBy: syncStatus.behindBy,
  isSyncing: syncStatus.isSyncing
});
```

**预期结果**：
- `networkHeight: 178`
- `behindBy: 138`
- `isSyncing: true`

**如果 networkHeight 为 0**：
- 说明没有收到 `GLOBAL_VIEW_RESPONSE`
- 检查终端A是否在线
- 检查消息是否被正确发送/接收

### 步骤 3: 检查消息发送/接收

在终端B的控制台监听消息：

```javascript
// 监听 GLOBAL_VIEW_RESPONSE
p2p.onMessage('GLOBAL_VIEW_RESPONSE', (data) => {
  console.log('收到网络高度:', data);
});

// 监听 BLOCKS
p2p.onMessage('BLOCKS', (data) => {
  console.log('收到区块:', data.blocks?.length, '个');
});
```

**手动触发同步**：

```javascript
// 手动请求网络高度
p2p.broadcast('GLOBAL_VIEW_REQUEST', {});

// 手动请求区块
p2p.broadcast('REQUEST_BLOCKS', {
  fromHeight: 41,
  toHeight: 178
});
```

### 步骤 4: 检查区块处理

在终端B的控制台检查：

```javascript
// 检查存储的区块
const tip = chainContext.storage.getTip();
console.log('当前 Tip:', {
  height: tip?.header.height,
  hash: tip?.hash.substring(0, 16)
});

// 检查所有区块
const allBlocks = chainContext.storage.getAllBlocks();
console.log('区块数量:', allBlocks.length);
console.log('区块高度范围:', 
  allBlocks.length > 0 ? 
    `${allBlocks[0].header.height}-${allBlocks[allBlocks.length-1].header.height}` : 
    '无'
);
```

### 步骤 5: 检查终端A是否响应

在终端A的控制台检查：

```javascript
// 检查是否收到 REQUEST_BLOCKS
// 应该在控制台看到日志：
// "[P2P] Received REQUEST_BLOCKS from ..."

// 检查是否发送了 BLOCKS
// 应该在控制台看到日志：
// "[P2P] Sending BLOCKS to ..."
```

## 常见问题及解决方案

### 问题 1: P2P 未连接

**症状**：
- `peerCount === 0`
- `isConnected === false`

**解决方案**：
1. 检查信令服务器 URL
2. 确保两个终端都连接到同一个信令服务器
3. 检查网络连接
4. 尝试重新连接

### 问题 2: 收到 GLOBAL_VIEW_RESPONSE 但 networkHeight 仍为 0

**症状**：
- 控制台看到 `GLOBAL_VIEW_RESPONSE` 消息
- 但 `networkHeight` 没有更新

**解决方案**：
- 检查 `GLOBAL_VIEW_RESPONSE` 处理逻辑
- 确保消息格式正确

### 问题 3: 收到 REQUEST_BLOCKS 但没有响应

**症状**：
- 终端B发送了 `REQUEST_BLOCKS`
- 终端A没有响应

**解决方案**：
1. 检查终端A是否在线
2. 检查终端A是否有这些区块（可能被修剪了）
3. 检查终端A的 `REQUEST_BLOCKS` 处理逻辑

### 问题 4: 收到 BLOCKS 但没有追加

**症状**：
- 收到 `BLOCKS` 消息
- 但区块没有被追加

**可能原因**：
1. **区块高度不连续**：如果收到高度 100 的区块，但本地只有高度 40，会被跳过
   - 解决方案：需要先同步中间区块（41-99）

2. **区块验证失败**：
   - 检查控制台错误日志
   - 检查区块是否有效

3. **区块已存在**：
   - 检查是否已经存在这些区块

## 强制同步方法

### 方法 1: 使用快照同步

如果区块差距太大（>1000），建议使用快照：

```javascript
// 在终端B
// 1. 停止挖矿
// 2. 清除本地数据
// 3. 从快照恢复
```

### 方法 2: 手动触发同步

```javascript
// 在终端B控制台
const p2p = chainContext.p2p;
const localHeight = chainContext.storage.getTip().header.height;

// 1. 请求网络高度
p2p.broadcast('GLOBAL_VIEW_REQUEST', {});

// 2. 等待响应后，请求区块
setTimeout(() => {
  const networkHeight = 178; // 从终端A获取
  p2p.broadcast('REQUEST_BLOCKS', {
    fromHeight: localHeight + 1,
    toHeight: networkHeight
  });
}, 2000);
```

### 方法 3: 重置并重新同步

如果同步完全失败：

```javascript
// 在终端B
// 1. 停止应用
// 2. 清除 localStorage
localStorage.clear();

// 3. 重新加载页面
// 4. 重新连接网络
// 5. 等待自动同步
```

## 调试日志

启用详细日志：

```javascript
// 在控制台
localStorage.setItem('indexerchain_debug', 'true');
// 重新加载页面
```

查看同步相关日志：
- `[Sync]` - 同步相关
- `[Auto-Sync]` - 自动同步
- `[P2P]` - P2P 消息

## 验证同步成功

同步成功后，应该看到：

1. **终端B的高度逐渐增加**：
   ```
   40 -> 41 -> 42 -> ... -> 178
   ```

2. **控制台日志**：
   ```
   [Sync] ✅ Appended block 41
   [Sync] ✅ Appended block 42
   ...
   ```

3. **UI 更新**：
   - 高度显示更新
   - 同步进度条更新

## 多终端挖矿协调

### 同一台机器

- **LEADER**：可以挖矿
- **FOLLOWER**：只读，自动同步 LEADER 的状态
- 通过 `LocalInstanceCoordinator` 协调

### 不同机器

- **各自独立挖矿**：
  - 每个终端都可以挖矿
  - 通过 P2P 网络同步区块
  - 挖到区块后广播给其他节点

- **防止冲突**：
  - 区块验证确保只有有效区块被接受
  - 难度调整确保挖矿难度合理
  - 最长链原则确保链的一致性

## 最佳实践

1. **保持连接**：
   - 确保两个终端都连接到 P2P 网络
   - 保持信令服务器连接

2. **定期检查**：
   - 定期检查同步状态
   - 如果落后太多，考虑使用快照

3. **监控日志**：
   - 关注控制台日志
   - 及时发现同步问题

4. **网络健康**：
   - 确保网络连接稳定
   - 避免频繁断开重连

