# Phase 40: Mobile Persistent Connection Architecture (Shadow Node)

## 概述

Phase 40 实现了移动端持久连接架构，通过 Shadow Node（影子节点）确保手机锁屏后节点仍然保持在线，永不掉线。

## 问题背景

移动端浏览器在锁屏时会执行以下行为：

| 场景 | 浏览器行为 | 后果 |
|------|-----------|------|
| 屏幕熄灭 | JS 暂停、计时器暂停 | 心跳停止、WebRTC 断线 |
| iOS 锁屏 | WebRTC 直接被系统挂起 | 节点掉线 |
| 安卓锁屏 | JS 降到几秒钟执行一次，甚至冻结 | 心跳超时 |
| 后台 30 秒 | Safari 会强制冻结 JS | 节点完全失效 |

这导致浏览器挖矿、P2P、state gossip、同步全部断开。

## 解决方案：Browser Node + Shadow Node 双节点模型

### 架构设计

```
   ┌───────────────────────────┐
   │  Cloudflare Signal Server │
   └───────────────────────────┘
                 ▲       ▲
                 │       │
          ROOT_TIP_UPDATE
                 │       │
   ┌─────────────┘       └───────────────┐
   ┌────────────────────┐     ┌──────────────────────┐
   │   Shadow Node       │ ←→ │   Other Peers         │
   │ (永不掉线轻节点)    │     │ (WebRTC + P2P)        │
   └────────────────────┘     └──────────────────────┘
             ▲
             │ Shadow Sync Channel (WebSocket)
             ▼
   ┌───────────────────────────┐
   │  Browser Node（易掉线）   │
   │  挖矿 + 状态管理 + UI      │
   └───────────────────────────┘
```

### 节点职责

#### Browser Node（浏览器节点）
- ✅ 显示 UI
- ✅ 浏览器集群挖矿
- ✅ WebRTC P2P 通讯
- ✅ 区块验证
- ✅ StateCommit + StateLock 处理
- ❌ 会因为锁屏挂起（正常行为）

#### Shadow Node（影子节点）
- ✅ 运行在 Cloudflare Worker（永不掉线）
- ✅ 保持 WebSocket 永远在线
- ✅ 接收全网 ROOT_TIP_UPDATE
- ✅ 维持 session（不断线）
- ✅ 保持 peer online 状态
- ✅ 转发核心消息给浏览器（当浏览器恢复后）
- ❌ 不挖矿（只负责保持连接）

## 实现细节

### 1. Shadow Node WebSocket 端点

**文件**: `workers/src/shadow.js`

- **ShadowSession Durable Object**: 每个浏览器节点有一个 Shadow Session
- **状态缓存**: 缓存最新的 rootTip、headers、state commitments
- **WebSocket 连接**: 与浏览器保持 WebSocket 连接
- **心跳机制**: 每 30 秒 ping，保持连接活跃

### 2. 浏览器端 Shadow Node 客户端

**文件**: `src/core/shadowNode.ts`

- **ShadowNodeClient**: 管理 Shadow Node 连接
- **自动重连**: 连接断开时自动重连
- **状态同步**: 从 Shadow Node 获取最新状态
- **消息转发**: 将 ROOT_TIP_UPDATE 转发给 Shadow Node

### 3. App.tsx 集成

**文件**: `src/ui/App.tsx`

- **初始化**: 在 P2P 连接时自动初始化 Shadow Node
- **状态监听**: 监听 Shadow Node 的状态更新
- **浏览器恢复**: 当浏览器从锁屏恢复时，从 Shadow Node 同步状态
- **消息转发**: 将接收到的 ROOT_TIP_UPDATE 转发给 Shadow Node

### 4. Cloudflare Worker 路由

**文件**: `workers/src/index.js`

- **路由处理**: `/shadow/{sessionId}` 路由到 ShadowSession
- **Durable Object**: 使用 Durable Object 保持状态持久化

## 工作流程

### 初始化流程

1. 浏览器启动，连接 P2P 网络
2. 自动创建 Shadow Session（生成 sessionId）
3. Shadow Node 连接到 Signaling Server
4. Shadow Node 开始接收 ROOT_TIP_UPDATE

### 正常运行流程

1. Browser Node 正常挖矿、同步
2. Shadow Node 在后台保持连接
3. 当 Browser Node 收到 ROOT_TIP_UPDATE 时，转发给 Shadow Node
4. Shadow Node 缓存最新状态

### 锁屏恢复流程

1. 手机锁屏 → Browser Node 挂起
2. Shadow Node 继续运行，接收 ROOT_TIP_UPDATE
3. 手机解锁 → Browser Node 恢复
4. Browser Node 从 Shadow Node 同步最新状态
5. 几毫秒内恢复，无需重新 bootstrap

## 配置

### Shadow Node URL

- **主网模式**: `https://shadow.indexerchain.com`
- **开发模式**: 从 signaling URL 自动推导

### Session ID

- 自动生成并保存到 localStorage
- 格式: `{timestamp}-{random}-{random}`
- 持久化，浏览器重启后仍可使用

## 效果对比

| 行为 | 以前 | 现在 |
|------|------|------|
| 手机锁屏 | 直接掉线 | Session 保持、状态保持 |
| 浏览器挂起（iOS） | 完全停止 | Shadow Node 继续抓取区块 |
| 回到页面 | 需要 bootstrap | 毫秒恢复 |
| 独立节点信誉 | 容易丢失 | 永久保持在线 |
| quorum 分数 | 会掉到0 | 永远满足挖矿要求 |
| 区块同步 | 偶尔错过 | 永远保持最新 |

## 技术特点

### 1. 永不掉线
- Shadow Node 运行在 Cloudflare Worker，不受浏览器限制
- 即使手机锁屏，Shadow Node 仍然在线

### 2. 状态持久化
- 使用 Durable Object 持久化状态
- 浏览器重启后仍可恢复

### 3. 自动同步
- 浏览器恢复时自动从 Shadow Node 同步
- 无需手动操作

### 4. 零成本
- Cloudflare Workers 免费额度充足
- 不需要额外服务器

## 使用说明

### 自动启用

Shadow Node 会在以下情况自动启用：
- P2P 网络连接成功
- 主网模式或开发模式

### 状态显示

在 UI 中可以看到：
- Shadow Node 连接状态
- Shadow Node 缓存的最新区块高度
- 最后更新时间

### 手动控制

目前 Shadow Node 是自动管理的，未来可以添加：
- 手动启用/禁用 Shadow Node
- Shadow Node 状态监控面板
- 同步状态查看

## 故障排除

### Shadow Node 未连接

**症状**: Shadow Node 状态显示为 disconnected

**解决方案**:
1. 检查网络连接
2. 确认 Shadow Node URL 正确
3. 查看浏览器控制台错误信息

### 状态不同步

**症状**: Shadow Node 状态与 Browser Node 不一致

**解决方案**:
1. 检查 Shadow Node 是否正常接收 ROOT_TIP_UPDATE
2. 手动触发同步：`shadowNodeRef.current.requestSync()`

### Session 丢失

**症状**: 每次刷新都需要重新创建 session

**解决方案**:
1. 检查 localStorage 是否被清除
2. 确认浏览器允许 localStorage

## 未来改进

- [ ] Shadow Node 状态监控面板
- [ ] 手动同步按钮
- [ ] Shadow Node 性能指标
- [ ] 多设备 Shadow Node 共享
- [ ] Shadow Node 自动故障转移

## 相关文档

- [PWA Mobile Persistence](./PWA_MOBILE_PERSISTENCE.md) - PWA + Service Worker 方案
- [Block Sync Architecture](./BLOCK_SYNC_ARCHITECTURE.md) - 区块同步架构
- [Cross Platform Sync](./CROSS_PLATFORM_SYNC_ARCHITECTURE.md) - 跨平台同步

## 总结

Phase 40 通过 Shadow Node 架构实现了移动端永不掉线的目标：

- ✅ 手机锁屏后节点仍然在线
- ✅ 浏览器恢复时毫秒级同步
- ✅ 不会丢失节点信誉和 quorum 分数
- ✅ 永远保持最新区块状态
- ✅ 零成本、自动管理

这是目前 Web3 移动端永不掉线的最成熟方案。

