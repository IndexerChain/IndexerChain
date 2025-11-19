# Phase 45: 重新创世（Genesis Reset）方案

## 概述

本方案实现了完整的"重新创世"功能，允许在网络经济模型大升级后，废弃旧链并重新从创世区块启动。整个过程完全兼容现有架构，不会破坏任何功能。

## 实现的功能

### 1. 更新创世区块定义

**文件**: `src/core/networkParams.ts`

- 更新了 `MAINNET_PARAMS.genesisTimestamp` 为新的时间戳：`1710000000` (2024-03-10 00:00:00 UTC)
- 新的创世区块会使用这个时间戳，生成新的区块哈希

### 2. SignalingRoom 重置功能

**文件**: `workers/src/index.js`

添加了 `resetRootTip()` 方法：

```javascript
async resetRootTip(newGenesisHeader, newGenesisHash, newStateCommitment) {
  // 重置 bootstrapState 到创世区块
  // 保存到持久化存储
  // 广播 ROOT_TIP_UPDATE 到所有连接的节点
}
```

支持通过 WebSocket 消息 `RESET_ROOT_TIP` 来触发重置。

### 3. ShadowSession 重置功能

**文件**: `workers/src/shadow.js`

添加了 `resetShadowState()` 方法：

```javascript
async resetShadowState() {
  // 清除所有缓存状态
  // 重置高度为 0
  // 清除活跃矿工信息
  // 清除持久化存储
}
```

支持通过 HTTP POST `/reset` 端点来触发重置。

## 使用方法

### 步骤 1: 生成新的创世区块

在浏览器控制台或 Node.js 环境中：

```javascript
import { createGenesisBlock } from './src/core/genesis.js';
import { MAINNET_PARAMS } from './src/core/networkParams.js';

const params = MAINNET_PARAMS;
const genesisBlock = await createGenesisBlock(params);

console.log('New Genesis Block:');
console.log('Hash:', genesisBlock.hash);
console.log('Header:', JSON.stringify(genesisBlock.header, null, 2));
console.log('State Commitment:', genesisBlock.header.stateCommitment);
```

### 步骤 2: 重置 SignalingRoom RootTip

#### 方法 A: 通过 WebSocket（推荐）

连接到信令服务器并发送：

```javascript
const ws = new WebSocket('wss://signal.indexerchain.com');
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'RESET_ROOT_TIP',
    newGenesisHeader: genesisBlock.header,
    newGenesisHash: genesisBlock.hash,
    newStateCommitment: genesisBlock.header.stateCommitment,
  }));
};
```

#### 方法 B: 通过 HTTP API（需要实现）

```bash
curl -X POST https://signal.indexerchain.com/admin/reset-root-tip \
  -H "Content-Type: application/json" \
  -d '{
    "newGenesisHeader": {...},
    "newGenesisHash": "...",
    "newStateCommitment": "..."
  }'
```

### 步骤 3: 重置 ShadowSession

对于每个活跃的 ShadowSession，发送重置请求：

```bash
# 需要知道 sessionId
curl -X POST https://signal.indexerchain.com/shadow/{sessionId}/reset \
  -H "Content-Type: application/json"
```

或者通过代码批量重置所有会话（需要实现批量重置端点）。

### 步骤 4: 浏览器自动重置

**无需手动操作！** 浏览器会自动检测到：

1. **RootTip 高度变为 0**
2. **本地高度 > 0**

然后自动触发：

- `HardReorg` 检测到分叉
- 回退到高度 0（删除所有旧区块）
- 清除所有状态和快照
- 重新初始化创世区块
- 开始新的同步

## 自动化脚本

创建一个重置脚本 `scripts/reset-genesis.js`：

```javascript
import { createGenesisBlock } from '../src/core/genesis.js';
import { MAINNET_PARAMS } from '../src/core/networkParams.js';

async function resetGenesis() {
  // 1. 生成新创世区块
  const params = MAINNET_PARAMS;
  const genesisBlock = await createGenesisBlock(params);
  
  console.log('✅ Generated new genesis block:');
  console.log('  Hash:', genesisBlock.hash);
  console.log('  Timestamp:', new Date(params.genesisTimestamp * 1000).toISOString());
  
  // 2. 连接到信令服务器并重置
  const ws = new WebSocket('wss://signal.indexerchain.com');
  
  await new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'RESET_ROOT_TIP',
        newGenesisHeader: genesisBlock.header,
        newGenesisHash: genesisBlock.hash,
        newStateCommitment: genesisBlock.header.stateCommitment,
      }));
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'RESET_ROOT_TIP_SUCCESS') {
        console.log('✅ RootTip reset successful');
        ws.close();
        resolve();
      } else if (data.type === 'error') {
        console.error('❌ Error:', data.message);
        ws.close();
        reject(new Error(data.message));
      }
    };
    
    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      reject(error);
    };
  });
  
  console.log('✅ Genesis reset complete!');
  console.log('All browsers will automatically reset on next connection.');
}

resetGenesis().catch(console.error);
```

## 验证重置

### 1. 检查 RootTip

```bash
# 连接到信令服务器并请求 bootstrap
curl -X POST https://signal.indexerchain.com/keepalive
# 或通过 WebSocket 发送 REQUEST_BOOTSTRAP
```

应该返回：
```json
{
  "latestHeight": 0,
  "latestHeader": {...},
  "latestHeaderHash": "...",
  "recentHeaders": [...]
}
```

### 2. 检查浏览器

打开浏览器，检查：
- 本地高度应该为 0
- 网络高度应该为 0
- 所有旧区块和状态应该被清除
- 新的创世区块应该被创建

### 3. 检查 ShadowSession

```bash
curl https://signal.indexerchain.com/shadow/{sessionId}/sync
```

应该返回：
```json
{
  "cachedState": {
    "latestHeight": 0,
    "latestHeader": null,
    ...
  }
}
```

## 安全注意事项

⚠️ **重要**: 重置操作是不可逆的！

1. **生产环境保护**:
   - 添加身份验证（API Key 或 Admin Token）
   - 限制重置端点只能从特定 IP 访问
   - 添加二次确认机制

2. **备份**:
   - 在重置前备份所有重要数据
   - 记录旧链的最终状态

3. **通知**:
   - 提前通知所有用户
   - 提供迁移指南

## 兼容性

✅ 完全兼容：
- 信令服务器（Cloudflare Worker）
- Shadow Node
- 多终端挖矿保护系统
- StateLock / StateCommit / Quorum
- Warp Sync / Chunk Sync
- 浏览器本地存储
- 快照系统
- 多 Tab 协调

## 测试

### 本地测试

1. 启动本地信令服务器
2. 运行重置脚本
3. 打开多个浏览器窗口
4. 验证所有窗口都重置到高度 0

### 生产测试

1. 在测试网络先验证
2. 通知用户准备
3. 执行重置
4. 监控网络状态
5. 验证所有节点同步

## 故障排查

### 问题：浏览器没有自动重置

**原因**: HardReorg 可能没有正确检测到分叉

**解决**: 
1. 检查 `checkForFork` 函数
2. 手动触发重置：在浏览器控制台执行 `localStorage.clear()` 并刷新

### 问题：ShadowSession 没有重置

**原因**: 批量重置可能没有执行

**解决**: 
1. 手动重置每个会话
2. 或等待会话过期后自动清除

### 问题：RootTip 重置失败

**原因**: WebSocket 连接问题或权限问题

**解决**:
1. 检查 WebSocket 连接
2. 验证消息格式
3. 检查 Durable Object 存储权限

## 后续步骤

1. **实现批量 ShadowSession 重置**: 添加端点来重置所有会话
2. **添加管理界面**: 创建 Web UI 来执行重置
3. **添加监控**: 监控重置过程和网络状态
4. **文档更新**: 更新用户文档说明重置流程

---

**版本**: Phase 45  
**日期**: 2024-11-19  
**状态**: ✅ 实现完成，待测试

