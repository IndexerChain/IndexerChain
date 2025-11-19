# 重置创世区块操作指南

## 部署状态

✅ **信号服务器已部署成功！**

- Worker 名称: `indexerchain-signaling`
- 版本 ID: `385072f4-0391-4015-9a1b-377d0d8cadca`
- 域名: `signal.indexerchain.com`

## 执行重置

### 方法 1: 浏览器控制台（推荐）

1. **打开应用**: 访问 `https://indexerchain.com` 或本地开发服务器
2. **等待应用完全加载**: 确保所有模块都已加载
3. **打开浏览器控制台**: 按 `F12` 或 `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows)
4. **复制并粘贴以下代码**:

```javascript
(async function resetGenesisFromConsole() {
  console.log('🔄 Phase 45: Genesis Reset Script');
  console.log('=====================================\n');
  
  try {
    // Step 1: Generate new genesis block
    console.log('Step 1: Generating new genesis block...');
    
    const { createGenesisBlock } = await import('/src/core/genesis.js');
    const { MAINNET_PARAMS } = await import('/src/core/networkParams.js');
    
    const params = MAINNET_PARAMS;
    const genesisBlock = await createGenesisBlock(params);
    
    console.log('✅ New Genesis Block Generated:');
    console.log(`   Hash: ${genesisBlock.hash}`);
    console.log(`   Timestamp: ${new Date(params.genesisTimestamp * 1000).toISOString()}`);
    console.log(`   State Commitment: ${genesisBlock.header.stateCommitment?.substring(0, 32)}...`);
    console.log('');
    
    // Step 2: Connect to signaling server
    console.log('Step 2: Connecting to signaling server...');
    const SIGNALING_URL = 'wss://signal.indexerchain.com';
    
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SIGNALING_URL);
      let resolved = false;
      let nodeId = null;
      let joined = false;
      
      ws.onopen = () => {
        console.log('✅ Connected to signaling server');
        nodeId = `reset_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        ws.send(JSON.stringify({ type: 'join', nodeId: nodeId }));
      };
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if ((message.type === 'JOIN_ACK' || message.type === 'peers') && !joined) {
          joined = true;
          console.log('   Sending RESET_ROOT_TIP message...\n');
          ws.send(JSON.stringify({
            type: 'RESET_ROOT_TIP',
            newGenesisHeader: genesisBlock.header,
            newGenesisHash: genesisBlock.hash,
            newStateCommitment: genesisBlock.header.stateCommitment,
          }));
        } else if (message.type === 'RESET_ROOT_TIP_SUCCESS') {
          console.log('✅ RootTip reset successful!');
          console.log(`   New Genesis Hash: ${message.newGenesisHash}`);
          resolved = true;
          ws.close();
          resolve(message);
        } else if (message.type === 'error') {
          console.error('❌ Error:', message.message);
          resolved = true;
          ws.close();
          reject(new Error(message.message));
        }
      };
      
      ws.onerror = (error) => {
        if (!resolved) {
          console.error('❌ WebSocket error:', error);
          reject(error);
        }
      };
      
      ws.onclose = () => {
        if (!resolved) {
          console.log('⚠️  Connection closed');
          resolve();
        }
      };
      
      setTimeout(() => {
        if (!resolved) {
          console.error('❌ Timeout');
          ws.close();
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  } catch (error) {
    console.error('❌ Failed:', error);
    throw error;
  }
})().then(() => {
  console.log('✅ Genesis reset complete!');
  console.log('Refresh the page to see the reset.');
}).catch((error) => {
  console.error('❌ Reset failed:', error);
});
```

5. **按 Enter 执行**
6. **等待重置完成**
7. **刷新页面**查看重置结果

### 方法 2: 使用脚本文件

如果浏览器控制台方法不工作，可以：

1. 打开 `scripts/reset-genesis-console.js`
2. 复制整个文件内容
3. 粘贴到浏览器控制台
4. 按 Enter 执行

## 验证重置

重置后，验证以下内容：

1. **RootTip 高度为 0**
   - 打开浏览器控制台
   - 检查网络请求中的 `BOOTSTRAP_RESPONSE`
   - `latestHeight` 应该是 `0`

2. **本地链高度为 0**
   - 刷新页面
   - 检查应用界面中的"Local Height"
   - 应该是 `0`

3. **所有旧数据已清除**
   - 打开浏览器开发者工具
   - 进入 Application > Local Storage
   - 检查 `indexerchain_blocks_v1` 应该只包含创世区块

## 注意事项

⚠️ **重要**:
- 重置操作是**不可逆的**
- 所有旧区块、状态、快照都会被清除
- 所有浏览器会在下次连接时自动重置
- Shadow Sessions 会在下次连接时自动重置

## 故障排查

### 问题: 脚本无法导入模块

**解决**: 确保应用已完全加载，等待几秒后再运行脚本

### 问题: WebSocket 连接失败

**解决**: 
- 检查网络连接
- 确认 `signal.indexerchain.com` 可访问
- 检查防火墙设置

### 问题: 重置后浏览器没有自动重置

**解决**:
- 手动清除 localStorage: `localStorage.clear()`
- 刷新页面
- 或等待 HardReorg 自动触发

---

**部署完成时间**: 2024-11-19  
**Worker 版本**: 385072f4-0391-4015-9a1b-377d0d8cadca

