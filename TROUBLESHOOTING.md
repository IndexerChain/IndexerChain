# 故障排除指南

## 常见错误和解决方案

### 1. WebSocket 连接失败

**错误信息：**
```
WebSocket connection to 'ws://localhost:8080/' failed
```

**原因：**
信令服务器没有运行。

**解决方案：**

1. **启动信令服务器：**
   ```bash
   # 安装依赖（如果还没有）
   npm install ws
   
   # 运行信令服务器
   node signaling-server-example.js
   ```

2. **确认服务器正在运行：**
   你应该看到：
   ```
   Signaling server started on ws://localhost:8080
   ```

3. **在浏览器中连接：**
   - 打开应用（通常是 `http://localhost:5173`）
   - 在 "Bootstrap Server URL" 输入框中输入：`ws://localhost:8080`
   - 点击 "Connect"

4. **检查端口是否被占用：**
   ```bash
   # macOS/Linux
   lsof -i :8080
   
   # Windows
   netstat -ano | findstr :8080
   ```

5. **如果端口被占用，可以更改端口：**
   ```bash
   PORT=8081 node signaling-server-example.js
   ```
   然后在浏览器中使用 `ws://localhost:8081`

### 2. favicon.ico 404 错误

**错误信息：**
```
Failed to load resource: the server responded with a status of 404 (Not Found)
```

**说明：**
这是一个无害的警告，不影响功能。浏览器只是找不到网站图标文件。

**解决方案（可选）：**
- 可以忽略这个错误，不影响使用
- 或者添加一个 favicon 文件到 `public/` 目录

### 3. 连接超时

**错误信息：**
```
Connection timeout. Please check:
1. Is the signaling server running?
2. Is the URL correct?
```

**解决方案：**

1. **确认信令服务器正在运行**
2. **检查 URL 格式：**
   - 正确：`ws://localhost:8080`
   - 错误：`http://localhost:8080`（缺少 `ws://` 前缀）
3. **检查防火墙设置**
4. **尝试使用 `127.0.0.1` 代替 `localhost`：**
   - `ws://127.0.0.1:8080`

### 4. 无法建立 WebRTC 连接

**症状：**
- WebSocket 连接成功
- 但没有 peers 连接

**可能原因：**

1. **NAT/防火墙问题：**
   - WebRTC 需要 STUN/TURN 服务器来穿透 NAT
   - 当前使用 Google 的公共 STUN 服务器
   - 某些网络环境可能需要 TURN 服务器

2. **只有一个节点：**
   - 需要至少两个浏览器窗口/标签页才能建立连接
   - 打开多个窗口，都连接到同一个信令服务器

**解决方案：**

1. **打开多个浏览器窗口：**
   - 每个窗口都是一个节点
   - 都连接到同一个信令服务器
   - 它们应该自动建立连接

2. **检查浏览器控制台：**
   - 查看是否有 WebRTC 相关的错误
   - 查看是否有 ICE candidate 交换的日志

3. **尝试不同的网络：**
   - 如果在公司网络，可能有防火墙限制
   - 尝试在家庭网络或移动热点测试

### 5. 区块不同步

**症状：**
- 多个节点连接成功
- 但链的高度不一致

**解决方案：**

1. **检查节点是否都从同一个创世块开始：**
   - 如果节点在不同时间启动，可能有不同的创世块
   - 建议：清空所有节点的 localStorage，重新开始

2. **手动触发同步：**
   - 在一个节点挖出一个区块
   - 其他节点应该自动接收并同步

3. **检查网络连接：**
   - 确保所有节点都连接到同一个信令服务器
   - 检查浏览器控制台是否有错误

## 调试技巧

### 查看网络状态

在浏览器控制台中：
```javascript
// 查看当前连接的 peers
chainContext.p2p?.getPeerCount()

// 查看所有 peers
Array.from(chainContext.p2p?.peers.values() || [])
```

### 查看链状态

```javascript
// 查看当前高度
chainContext.storage.getTip()?.header.height

// 查看所有区块
chainContext.storage.getAllBlocks()
```

### 清空本地数据（重新开始）

在浏览器控制台中：
```javascript
localStorage.clear()
location.reload()
```

## 测试步骤

1. **启动信令服务器：**
   ```bash
   node signaling-server-example.js
   ```

2. **启动应用：**
   ```bash
   npm run dev
   ```

3. **打开第一个浏览器窗口：**
   - 访问 `http://localhost:5173`
   - 输入 `ws://localhost:8080`
   - 点击 "Connect"
   - 应该显示 "Connected"，Peers: 0

4. **打开第二个浏览器窗口：**
   - 访问 `http://localhost:5173`
   - 输入 `ws://localhost:8080`
   - 点击 "Connect"
   - 两个窗口都应该显示 "Connected"，Peers: 1

5. **测试交易广播：**
   - 在第一个窗口创建交易
   - 第二个窗口应该自动收到并显示在 mempool 中

6. **测试区块同步：**
   - 在第一个窗口挖出一个区块
   - 第二个窗口应该自动接收并更新链高度

## 需要帮助？

如果遇到其他问题：

1. 检查浏览器控制台的完整错误信息
2. 检查信令服务器的日志
3. 确认所有依赖都已安装
4. 尝试清空浏览器缓存和 localStorage

