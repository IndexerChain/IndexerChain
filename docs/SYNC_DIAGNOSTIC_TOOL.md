# 同步诊断工具

## 快速诊断命令

在终端B（高度40）的控制台运行以下命令来诊断同步问题：

### 1. 检查 P2P 连接状态

```javascript
// 获取 P2P 节点
const p2p = chainContext.p2p;
const isConnected = p2p.isConnected;
const peerCount = p2p.getPeerCount();
const peers = Array.from(p2p.peers.keys());

console.log('=== P2P 连接状态 ===');
console.log('已连接:', isConnected);
console.log('Peer 数量:', peerCount);
console.log('Peer IDs:', peers.map(id => id.substring(0, 16) + '...'));

// 检查每个 peer 的连接状态
peers.forEach(peerId => {
  const peer = p2p.peers.get(peerId);
  if (peer) {
    console.log(`Peer ${peerId.substring(0, 16)}...:`, {
      connected: peer.connected,
      dataChannelState: peer.dataChannel?.readyState,
      lastSeen: peer.lastSeenAt ? new Date(peer.lastSeenAt).toLocaleTimeString() : 'unknown'
    });
  }
});
```

### 2. 检查同步状态

```javascript
// 获取当前状态
const tip = chainContext.storage.getTip();
const localHeight = tip?.header.height ?? 0;
const syncStatus = window.lastSyncStatus || {};

console.log('=== 同步状态 ===');
console.log('本地高度:', localHeight);
console.log('网络高度:', syncStatus.networkHeight || '未知');
console.log('落后数量:', syncStatus.behindBy || 0);
console.log('是否同步中:', syncStatus.isSyncing || false);
console.log('同步进度:', syncStatus.progress ? syncStatus.progress.toFixed(1) + '%' : '0%');
```

### 3. 手动触发同步

```javascript
// 1. 请求网络高度
console.log('📡 发送 GLOBAL_VIEW_REQUEST...');
p2p.broadcast('GLOBAL_VIEW_REQUEST', {});

// 2. 等待 2 秒后请求区块
setTimeout(() => {
  const tip = chainContext.storage.getTip();
  const localHeight = tip?.header.height ?? 0;
  const networkHeight = window.lastSyncStatus?.networkHeight || 178; // 从终端A获取
  
  if (networkHeight > localHeight) {
    const behindBy = networkHeight - localHeight;
    const requestRange = Math.min(behindBy, 500);
    const targetHeight = Math.min(localHeight + requestRange, networkHeight);
    
    console.log(`📦 请求区块: ${localHeight + 1} - ${targetHeight} (共 ${requestRange} 个)`);
    p2p.broadcast('REQUEST_BLOCKS', {
      fromHeight: localHeight + 1,
      toHeight: targetHeight
    });
    
    // 也向每个 peer 直接发送请求
    if (p2p.sendToPeer) {
      const peerIds = Array.from(p2p.peers.keys());
      peerIds.forEach(peerId => {
        const peer = p2p.peers.get(peerId);
        if (peer && peer.connected && peer.dataChannel?.readyState === 'open') {
          console.log(`📤 直接请求 peer ${peerId.substring(0, 16)}...`);
          p2p.sendToPeer(peerId, 'REQUEST_BLOCKS', {
            fromHeight: localHeight + 1,
            toHeight: targetHeight
          });
        }
      });
    }
  } else {
    console.log('⚠️ 网络高度未知或已同步');
  }
}, 2000);
```

### 4. 监听消息

```javascript
// 监听 GLOBAL_VIEW_RESPONSE
p2p.onMessage('GLOBAL_VIEW_RESPONSE', (data, sender) => {
  console.log('✅ 收到网络高度响应:', {
    sender: sender.substring(0, 16) + '...',
    height: data.height,
    tipHash: data.tipHash?.substring(0, 16) + '...',
    availableFromHeight: data.availableFromHeight
  });
});

// 监听 BLOCKS
p2p.onMessage('BLOCKS', (data, sender) => {
  if (data.blocks && data.blocks.length > 0) {
    const firstHeight = data.blocks[0]?.header?.height;
    const lastHeight = data.blocks[data.blocks.length - 1]?.header?.height;
    console.log(`✅ 收到区块: ${data.blocks.length} 个 (高度 ${firstHeight}-${lastHeight}) 来自 ${sender.substring(0, 16)}...`);
  }
});

// 监听 REQUEST_BLOCKS（在终端A运行）
p2p.onMessage('REQUEST_BLOCKS', (data, sender) => {
  console.log(`📥 收到区块请求: ${data.fromHeight}-${data.toHeight} 来自 ${sender.substring(0, 16)}...`);
});
```

### 5. 检查区块存储

```javascript
// 检查存储的区块
const allBlocks = chainContext.storage.getAllBlocks();
console.log('=== 区块存储 ===');
console.log('区块总数:', allBlocks.length);
if (allBlocks.length > 0) {
  console.log('高度范围:', `${allBlocks[0].header.height} - ${allBlocks[allBlocks.length - 1].header.height}`);
  console.log('最新区块:', {
    height: allBlocks[allBlocks.length - 1].header.height,
    hash: allBlocks[allBlocks.length - 1].hash.substring(0, 16) + '...',
    timestamp: new Date(allBlocks[allBlocks.length - 1].header.timestamp).toLocaleString()
  });
  
  // 检查是否有缺失的区块
  const heights = allBlocks.map(b => b.header.height).sort((a, b) => a - b);
  const missing = [];
  for (let i = heights[0]; i <= heights[heights.length - 1]; i++) {
    if (!heights.includes(i)) {
      missing.push(i);
    }
  }
  if (missing.length > 0) {
    console.log('⚠️ 缺失的区块高度:', missing.slice(0, 20), missing.length > 20 ? '...' : '');
  } else {
    console.log('✅ 区块连续，无缺失');
  }
} else {
  console.log('⚠️ 没有区块');
}
```

### 6. 完整诊断脚本

```javascript
// 运行完整诊断
async function diagnoseSync() {
  console.log('🔍 开始同步诊断...\n');
  
  // 1. P2P 连接
  const p2p = chainContext.p2p;
  console.log('1️⃣ P2P 连接状态:');
  console.log('   - 已连接:', p2p.isConnected);
  console.log('   - Peer 数量:', p2p.getPeerCount());
  console.log('   - Peer IDs:', Array.from(p2p.peers.keys()).map(id => id.substring(0, 16) + '...'));
  
  // 2. 本地状态
  const tip = chainContext.storage.getTip();
  const localHeight = tip?.header.height ?? 0;
  console.log('\n2️⃣ 本地状态:');
  console.log('   - 当前高度:', localHeight);
  console.log('   - Tip Hash:', tip?.hash?.substring(0, 16) + '...');
  
  // 3. 同步状态
  const syncStatus = window.lastSyncStatus || {};
  console.log('\n3️⃣ 同步状态:');
  console.log('   - 网络高度:', syncStatus.networkHeight || '未知');
  console.log('   - 落后数量:', syncStatus.behindBy || 0);
  console.log('   - 同步中:', syncStatus.isSyncing || false);
  
  // 4. 触发同步
  if (p2p.isConnected && p2p.getPeerCount() > 0) {
    console.log('\n4️⃣ 触发同步...');
    p2p.broadcast('GLOBAL_VIEW_REQUEST', {});
    
    setTimeout(() => {
      const networkHeight = window.lastSyncStatus?.networkHeight || 0;
      if (networkHeight > localHeight) {
        const behindBy = networkHeight - localHeight;
        const requestRange = Math.min(behindBy, 500);
        const targetHeight = Math.min(localHeight + requestRange, networkHeight);
        
        console.log(`   请求区块: ${localHeight + 1} - ${targetHeight}`);
        p2p.broadcast('REQUEST_BLOCKS', {
          fromHeight: localHeight + 1,
          toHeight: targetHeight
        });
      } else {
        console.log('   ⚠️ 网络高度未知，无法请求区块');
      }
    }, 2000);
  } else {
    console.log('\n4️⃣ ⚠️ 未连接或没有 peer，无法同步');
  }
  
  console.log('\n✅ 诊断完成');
}

// 运行诊断
diagnoseSync();
```

## 常见问题检查清单

### ✅ 检查项 1: P2P 连接
- [ ] `p2p.isConnected === true`
- [ ] `p2p.getPeerCount() > 0`
- [ ] 能看到终端A的 peer ID

### ✅ 检查项 2: 网络高度
- [ ] 收到 `GLOBAL_VIEW_RESPONSE`
- [ ] `networkHeight > 0`
- [ ] `networkHeight === 178`（终端A的高度）

### ✅ 检查项 3: 区块请求
- [ ] 发送了 `REQUEST_BLOCKS`
- [ ] 终端A收到了请求
- [ ] 终端A发送了 `BLOCKS` 响应

### ✅ 检查项 4: 区块处理
- [ ] 收到 `BLOCKS` 消息
- [ ] 区块被追加到存储
- [ ] 本地高度增加

## 解决方案

### 如果 P2P 未连接
1. 检查信令服务器 URL
2. 确保两个终端连接到同一个信令服务器
3. 检查网络连接
4. 尝试重新连接

### 如果 networkHeight 为 0
1. 手动发送 `GLOBAL_VIEW_REQUEST`
2. 检查终端A是否在线
3. 检查消息是否被正确发送/接收

### 如果收到请求但没有响应
1. 检查终端A的控制台日志
2. 检查终端A是否有这些区块
3. 检查终端A的 `REQUEST_BLOCKS` 处理逻辑

### 如果收到区块但没有追加
1. 检查控制台错误日志
2. 检查区块是否有效
3. 检查区块高度是否连续

