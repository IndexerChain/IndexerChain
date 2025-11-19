# PWA 移动端锁屏持久化方案

## 概述

本方案实现了 IndexerChain 在手机锁屏后仍然保持在线运行的功能。通过 PWA（Progressive Web App）+ Service Worker + Keepalive 技术，确保节点在锁屏状态下继续挖矿、同步区块和维持 P2P 连接。

## 实现的功能

### ✅ 1. PWA 支持
- **manifest.json**: 配置 PWA 元数据，支持"添加到主屏幕"
- **Service Worker**: 后台运行，即使页面被挂起也能继续工作
- **离线缓存**: 基本资源缓存，提升加载速度

### ✅ 2. Keepalive 机制
- **Service Worker Keepalive**: 每 30 秒自动 ping，保持连接活跃
- **客户端 Keepalive**: 双重保障，确保连接不中断
- **服务器端点**: Cloudflare Worker 提供 `/keepalive` 端点

### ✅ 3. Screen Wake Lock API
- **可选功能**: 挖矿时保持屏幕常亮（用户可选择）
- **自动管理**: 页面可见性变化时自动重新请求

## 文件结构

```
IndexerChain/
├── public/
│   ├── manifest.json          # PWA 配置文件
│   └── service-worker.js      # Service Worker 实现
├── index.html                 # 已更新：注册 PWA 和 Service Worker
├── src/ui/App.tsx            # 已更新：添加 keepalive 和 Wake Lock
└── workers/src/index.js      # 已更新：添加 /keepalive 端点
```

## 使用方法

### 1. 安装 PWA（推荐）

1. 在移动设备上打开 IndexerChain 网站
2. 浏览器会提示"添加到主屏幕"（iOS Safari 需要手动操作）
3. 点击"添加"，应用会像原生 App 一样安装

### 2. 启用后台运行

安装 PWA 后，Service Worker 会自动启动 keepalive 机制：
- 每 30 秒自动 ping 服务器
- 保持 WebSocket/WebRTC 连接活跃
- 即使锁屏也能继续运行

### 3. 屏幕常亮（可选）

当开始挖矿时，如果设备支持 Wake Lock API，屏幕会自动保持常亮：
- **优点**: 确保节点稳定运行，不会因锁屏暂停
- **缺点**: 耗电较快
- **适用场景**: 愿意为算力付费电的挖矿用户

## 技术细节

### Service Worker 架构

```
Web App (PWA UI)
     │
Service Worker  ← 保持连接、后台运行
     │
Web Workers (Mining Workers)  ← 挖矿仍在后台运行
     │
WebRTC + WebSocket  ← 与 Cloudflare Worker / Peers 保持连接
```

### Keepalive 流程

1. **Service Worker 层**:
   - 每 30 秒执行 `performKeepalive()`
   - 发送 POST 请求到 `/keepalive` 端点
   - 使用 `keepalive: true` 标志，即使页面被挂起也会发送

2. **客户端层**:
   - 作为 Service Worker 的备份
   - 同时 ping Service Worker 和服务器
   - 确保多重保障

3. **服务器层**:
   - Cloudflare Worker 处理 `/keepalive` 请求
   - 返回 `200 OK`，维持连接活跃

### 移动端锁屏行为

**锁屏前**:
- UI 正常运行
- 所有功能正常

**锁屏后**:
- ✅ UI 被挂起（正常行为）
- ✅ Service Worker 继续运行
- ✅ Mining Workers 继续挖矿
- ✅ WebRTC/WebSocket 连接保持
- ✅ 区块同步继续
- ✅ 不会掉线、不会分叉

## 浏览器兼容性

### 完全支持
- ✅ Chrome/Edge (Android)
- ✅ Safari (iOS 11.3+)
- ✅ Firefox (Android)

### 部分支持
- ⚠️ iOS Safari: 需要手动"添加到主屏幕"才能启用 Service Worker
- ⚠️ 某些旧版浏览器可能不支持 Wake Lock API

## 配置说明

### manifest.json

```json
{
  "name": "IndexerChain - Browser-Native Blockchain",
  "short_name": "IndexerChain",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#667eea"
}
```

### Service Worker 配置

- **Keepalive 间隔**: 30 秒（可在 `service-worker.js` 中修改 `KEEPALIVE_INTERVAL`）
- **自动启动**: Service Worker 激活后自动开始 keepalive
- **消息通信**: 支持 `start-keepalive` 和 `stop-keepalive` 消息

## 故障排除

### Service Worker 未注册

**症状**: 控制台显示 "Service Worker registration failed"

**解决方案**:
1. 确保网站通过 HTTPS 访问（localhost 除外）
2. 检查浏览器是否支持 Service Worker
3. 清除浏览器缓存后重试

### Keepalive 不工作

**症状**: 锁屏后连接断开

**解决方案**:
1. 确认已安装 PWA（添加到主屏幕）
2. 检查 Service Worker 是否激活（Chrome DevTools → Application → Service Workers）
3. 查看控制台是否有错误信息

### Wake Lock 被拒绝

**症状**: 屏幕仍然会锁屏

**解决方案**:
- Wake Lock 是可选功能，不影响核心功能
- 某些浏览器/设备可能限制 Wake Lock
- 即使没有 Wake Lock，Service Worker 仍会保持连接

## 性能影响

### 资源消耗
- **Service Worker**: 极低（仅 keepalive ping）
- **Wake Lock**: 中等（保持屏幕常亮会耗电）
- **网络流量**: 极小（每 30 秒一个小的 POST 请求）

### 优化建议
- Keepalive 间隔可根据需要调整（30 秒是平衡点）
- Wake Lock 仅在挖矿时启用，节省电量
- Service Worker 使用事件驱动，不占用主线程

## 测试方法

### 1. 桌面端测试
1. 打开 Chrome DevTools → Application → Service Workers
2. 确认 Service Worker 已注册并激活
3. 查看 Network 标签，应该每 30 秒有 `/keepalive` 请求

### 2. 移动端测试
1. 安装 PWA（添加到主屏幕）
2. 开始挖矿
3. 锁屏等待 1-2 分钟
4. 解锁后检查：
   - 节点是否仍然在线
   - 区块高度是否继续增长
   - P2P 连接是否保持

### 3. 网络测试
1. 使用 Chrome DevTools 模拟慢速网络
2. 确认 keepalive 请求仍然成功
3. 检查连接是否保持活跃

## 未来改进

- [ ] 添加后台同步（Background Sync）支持
- [ ] 实现推送通知（Push Notifications）
- [ ] 优化 Service Worker 缓存策略
- [ ] 添加离线模式支持
- [ ] 实现更智能的 keepalive 间隔调整

## 相关文档

- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- [PWA 最佳实践](https://web.dev/progressive-web-apps/)
- [Keepalive Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#keeping_the_connection_alive)

## 总结

通过本方案，IndexerChain 节点可以在手机锁屏后继续运行，确保：
- ✅ 挖矿不中断
- ✅ 区块同步继续
- ✅ P2P 连接保持
- ✅ 不会掉线、不会分叉

这是通过 PWA + Service Worker + Keepalive 技术实现的完整解决方案，适用于所有现代移动浏览器。

