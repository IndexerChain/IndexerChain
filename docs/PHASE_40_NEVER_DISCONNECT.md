# Phase 40: 永不掉线架构实现

## ✅ 实现总结

已实现完整的"永不掉线"架构，确保浏览器节点能够像后台程序一样全天候运行。

---

## 📋 已实现的功能

### 1. ✅ WebSocket 自动重连机制

**文件**: `src/core/connectionManager.ts`

**功能**:
- 无限自动重连（默认配置）
- Session ID 持久化（localStorage）
- 重连间隔：1.5秒
- 连接状态恢复

**实现细节**:
```typescript
// 自动重连配置
{
  reconnectInterval: 1500,
  maxReconnectAttempts: -1, // 无限重连
  enableSessionPersistence: true,
}
```

**Session ID 管理**:
- 首次连接时生成 UUID v4
- 保存到 localStorage (`indexerchain_session`)
- 重连时复用相同 sessionId
- 信令服务器可识别相同节点，避免重复注册

---

### 2. ✅ Peer 心跳机制

**功能**:
- 每 10 秒发送 PING 消息
- 收到 PONG 响应记录成功
- 3 次心跳失败自动重连 peer
- 心跳超时：30 秒

**实现位置**:
- `src/core/connectionManager.ts`: 心跳管理
- `src/core/p2p.ts`: PING/PONG 消息处理

**工作流程**:
```
Peer 连接建立
  ↓
启动心跳定时器（10s 间隔）
  ↓
发送 PING → 等待 PONG
  ↓
收到 PONG → 重置失败计数
  ↓
3 次失败 → 触发重连
```

---

### 3. ✅ Page Visibility 增强

**文件**: `src/core/runtimeManager.ts`

**功能**:
- Tab 切换到后台时进入低功耗模式
- 保持 P2P 连接活跃
- 只降低挖矿功率，不中断连接
- Tab 恢复时自动退出低功耗模式

**实现**:
```typescript
private handleVisibilityChange(): void {
  if (document.hidden) {
    // 后台：降低挖矿功率，但保持连接
    this.enterLowPowerMode();
  } else {
    // 前台：恢复全功率
    this.exitLowPowerMode();
  }
}
```

---

### 4. ✅ P2P 连接集成

**文件**: `src/core/p2p.ts`, `src/ui/App.tsx`

**集成点**:
- `handleConnectP2P()`: 自动设置 ConnectionManager
- WebSocket `onclose`: 触发自动重连
- DataChannel `onopen`: 启动心跳
- DataChannel `onclose`: 清理心跳

**关键代码**:
```typescript
// App.tsx
p2pNode.setupConnectionManager({
  bootstrapUrl: urlToUse,
  reconnectInterval: 1500,
  maxReconnectAttempts: -1,
  heartbeatInterval: 10000,
  heartbeatTimeout: 30000,
  enableSessionPersistence: true,
});
```

---

## 🔄 工作流程

### 正常连接流程

```
页面加载
  ↓
自动连接（300ms 延迟）
  ↓
建立 WebSocket 连接
  ↓
发送 JOIN（带 sessionId）
  ↓
建立 Peer 连接
  ↓
启动心跳（10s 间隔）
  ↓
保持连接活跃
```

### 断线重连流程

```
WebSocket 断开
  ↓
检测到 onclose（非手动断开）
  ↓
ConnectionManager 启动重连
  ↓
1.5 秒后重试连接
  ↓
连接成功 → 恢复 sessionId
  ↓
重新请求 peers
  ↓
恢复所有连接
```

### 心跳失败处理

```
Peer 心跳失败（3 次）
  ↓
标记 peer 为失败
  ↓
删除旧连接
  ↓
重新发起连接
  ↓
恢复心跳监控
```

---

## 🎯 效果

### ✅ 已实现

1. **WebSocket 自动重连**
   - ✅ 无限重连（默认）
   - ✅ Session ID 复用
   - ✅ 1.5 秒重连间隔

2. **Peer 心跳**
   - ✅ 10 秒间隔
   - ✅ 3 次失败重连
   - ✅ 自动清理失效连接

3. **Page Visibility**
   - ✅ 后台低功耗模式
   - ✅ 保持连接活跃
   - ✅ 自动恢复

4. **状态持久化**
   - ✅ Session ID 保存
   - ✅ Bootstrap URL 保存
   - ✅ 连接状态恢复

### 🚧 待实现（可选增强）

1. **Service Worker 保活**
   - 需要注册 Service Worker
   - 在页面关闭后保持连接
   - 类似 TON/IPFS 浏览器节点

2. **SharedWorker 支持**
   - 多 Tab 共享连接
   - 减少资源消耗

3. **IndexedDB 区块缓存**
   - 加速状态恢复
   - 减少网络请求

4. **保持在线模式 UX**
   - 用户可启用/禁用
   - 显示连接状态
   - 手动重连按钮

---

## 📊 连接状态监控

### ConnectionManager Stats

```typescript
const stats = connectionManager.getStats();
// {
//   sessionId: "xxx-xxx-xxx",
//   reconnectAttempts: 0,
//   isReconnecting: false,
//   activeHeartbeats: 3
// }
```

### 日志输出

```
[ConnectionManager] Loaded session: abc123...
[ConnectionManager] Attempting reconnect #1...
[ConnectionManager] Reconnected successfully
[ConnectionManager] Sent heartbeat to peer def456...
[P2P] Peer def456... missed 3 heartbeats, attempting reconnection...
```

---

## 🔍 调试建议

### 检查连接状态

```javascript
// 在浏览器控制台
const p2p = window.p2pNodeRef?.current;
console.log('Connected:', p2p?.isConnected);
console.log('Peers:', p2p?.getPeerCount());

// 检查 session
const session = localStorage.getItem('indexerchain_session');
console.log('Session:', JSON.parse(session));
```

### 检查心跳

```javascript
const stats = connectionManager.getStats();
console.log('Active heartbeats:', stats.activeHeartbeats);
console.log('Reconnect attempts:', stats.reconnectAttempts);
```

---

## ✅ 最终效果

### 场景 1: 网络抖动

```
网络断开 → WebSocket onclose
  ↓
1.5 秒后自动重连
  ↓
连接恢复 → Session ID 复用
  ↓
Peer 连接自动恢复
  ↓
心跳继续工作
```

### 场景 2: Tab 切换

```
切换到后台 Tab
  ↓
进入低功耗模式（降低挖矿）
  ↓
连接保持活跃
  ↓
心跳继续
  ↓
切换回前台
  ↓
恢复全功率
```

### 场景 3: Peer 掉线

```
Peer 心跳失败（3 次）
  ↓
自动删除失效连接
  ↓
重新发起连接
  ↓
恢复心跳监控
```

---

## 🎉 总结

**已实现的核心功能**:
- ✅ WebSocket 无限自动重连
- ✅ Session ID 持久化
- ✅ Peer 心跳机制（10s 间隔，3 次失败重连）
- ✅ Page Visibility 低功耗模式（保持连接）
- ✅ 自动连接（页面加载时）

**效果**:
- 🔵 网络抖动 → 自动重连
- 🔵 Tab 切换 → 连接保持
- 🔵 Peer 掉线 → 自动恢复
- 🔵 页面刷新 → Session 恢复

**现在你的浏览器节点具备了类似全节点客户端的持续在线能力！**

