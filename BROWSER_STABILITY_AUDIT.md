# 浏览器稳定性审计报告

## 审计日期
2024年

## 审计范围
检查长期运行浏览器挖矿可能导致浏览器崩溃的潜在问题

## 发现的问题

### 🔴 严重问题

#### 1. 定时器泄漏（Critical）
**位置：** `src/ui/App.tsx`

**问题描述：**
多个 `setInterval` 定时器没有在组件卸载或依赖变化时清理，导致：
- 定时器持续运行，即使组件已卸载
- 内存泄漏
- CPU 资源浪费
- 可能导致浏览器变慢或崩溃

**问题代码：**
```typescript
// 问题 1: updateStats 定时器
const interval = setInterval(updateStats, 2000);
// ❌ 没有清理

// 问题 2: gsnStatsInterval
const gsnStatsInterval = setInterval(updateGsnStats, 3000);
// ❌ 没有清理

// 问题 3: checkTip 定时器
const interval = setInterval(checkTip, 1000);
// ❌ 没有清理

// 问题 4: finalityStatsInterval
const finalityStatsInterval = setInterval(updateFinalityStats, 2000);
// ❌ 没有清理
```

**影响：**
- 长时间运行后，会有大量定时器同时运行
- 每个定时器都会执行回调，消耗 CPU
- 可能导致浏览器标签页卡顿或崩溃

#### 2. P2P 事件监听器泄漏（Critical）
**位置：** `src/ui/App.tsx` (useEffect for P2P handlers)

**问题描述：**
P2P 消息处理器在 `useEffect` 中注册，但没有清理函数：
```typescript
useEffect(() => {
  if (!chainContext || !chainContext.p2p) return;
  
  p2p.onMessage("NEW_TX", async (tx: Tx, sender: string) => {
    // ... handler code
  });
  
  // ❌ 没有返回清理函数
}, [chainContext]);
```

**影响：**
- 每次 `chainContext` 变化时，会注册新的监听器
- 旧的监听器没有被移除
- 导致内存泄漏和重复处理消息

#### 3. localStorage 溢出风险（High）
**位置：** `src/core/chainStorage.ts`, `src/core/snapshot.ts`

**问题描述：**
- 区块数据存储在 localStorage（通常限制 5-10MB）
- 快照数据也存储在 localStorage
- 虽然有自动修剪机制，但在极端情况下可能溢出

**风险场景：**
- 如果快照压缩失败，未压缩数据可能很大
- 如果自动修剪被禁用或失败，区块数据会无限增长
- localStorage 溢出会导致 `QuotaExceededError`

**当前保护：**
- ✅ 有自动修剪机制（lightNodeWindow）
- ✅ 快照有数量限制（maxSnapshotCount）
- ❌ 但没有错误处理和降级方案

### 🟡 中等问题

#### 4. Web Worker 未正确清理（Medium）
**位置：** `src/core/minerClient.ts`, `src/core/minerCluster.ts`

**问题描述：**
- `destroy()` 方法存在，但只在组件卸载时调用
- 如果用户长时间运行（不关闭页面），worker 会一直存在
- 虽然不会直接导致崩溃，但会占用内存

**当前状态：**
- ✅ 有 `destroy()` 方法
- ✅ 在组件卸载时调用
- ⚠️ 但没有在页面隐藏/恢复时处理

#### 5. 事件处理器 Set 可能增长（Medium）
**位置：** `src/core/minerClient.ts`, `src/core/minerCluster.ts`

**问题描述：**
事件处理器存储在 `Set` 中，虽然可以删除，但如果忘记删除会导致内存泄漏：
```typescript
private progressHandlers: Set<MinerProgressHandler> = new Set();
```

**当前状态：**
- ✅ 有 `removeProgressHandler` 等方法
- ⚠️ 但在某些错误情况下可能忘记清理

#### 6. 深度复制导致内存峰值（Medium）
**位置：** `src/core/minerWorker.ts`

**问题描述：**
每次启动挖矿时，都会深度复制区块：
```typescript
currentBlock = JSON.parse(JSON.stringify(command.candidateBlock)); // Deep copy
```

**影响：**
- 如果区块很大（包含很多交易），深度复制会消耗大量内存
- 在内存受限的设备上可能导致问题

### 🟢 低风险问题

#### 7. 控制台日志过多（Low）
**位置：** 多个文件

**问题描述：**
大量 `console.log` 语句，长时间运行会产生大量日志：
- 浏览器开发者工具可能变慢
- 内存占用增加

#### 8. 没有内存监控（Low）
**问题描述：**
- 没有监控内存使用情况
- 没有在内存不足时发出警告
- 没有自动降级机制

## 修复建议

### 优先级 1：立即修复（Critical）

1. **修复定时器泄漏**
   - 所有 `setInterval` 必须在 `useEffect` 的清理函数中清理
   - 使用 `useRef` 存储定时器 ID

2. **修复事件监听器泄漏**
   - 所有 `p2p.onMessage` 注册必须返回清理函数
   - 使用 `useEffect` 的清理机制

3. **添加 localStorage 错误处理**
   - 捕获 `QuotaExceededError`
   - 提供降级方案（减少快照数量、强制修剪等）

### 优先级 2：重要修复（High）

4. **优化 Web Worker 生命周期**
   - 在页面隐藏时暂停挖矿
   - 在页面恢复时恢复挖矿
   - 使用 `Page Visibility API`

5. **添加内存监控**
   - 使用 `performance.memory` API（如果可用）
   - 在内存不足时发出警告
   - 自动降级（减少 worker 数量等）

### 优先级 3：优化改进（Medium）

6. **优化区块复制**
   - 考虑使用结构化克隆（structured clone）
   - 或者只复制必要的数据

7. **减少控制台日志**
   - 使用日志级别控制
   - 生产环境禁用详细日志

## 长期运行建议

### 用户建议
1. **定期刷新页面**
   - 建议每 24 小时刷新一次
   - 或者使用自动刷新机制

2. **监控浏览器内存**
   - 使用浏览器任务管理器监控内存使用
   - 如果内存持续增长，需要刷新

3. **使用轻节点模式**
   - 启用 `lightNodeWindow` 限制区块数量
   - 减少快照数量

### 开发者建议
1. **实现健康检查**
   - 定期检查内存使用
   - 自动清理不需要的数据

2. **实现自动恢复**
   - 检测到异常时自动重启
   - 保存状态以便恢复

3. **添加监控面板**
   - 显示内存使用情况
   - 显示定时器数量
   - 显示事件监听器数量

## 测试建议

### 压力测试
1. **长时间运行测试**
   - 运行 24 小时以上
   - 监控内存使用
   - 检查是否有泄漏

2. **高负载测试**
   - 大量交易
   - 快速出块
   - 多个 worker

3. **边界测试**
   - localStorage 接近上限
   - 内存接近上限
   - CPU 高负载

## 结论

**风险评估：**
- 🔴 Critical: 定时器泄漏、事件监听器泄漏
- 🟡 Medium: localStorage 溢出、Worker 清理
- 🟢 Low: 日志过多、缺少监控

**建议优先级：**
1. 立即修复定时器和事件监听器泄漏
2. 添加 localStorage 错误处理
3. 实现内存监控和自动降级

**预计修复后稳定性：**
- 修复 Critical 问题后，可以稳定运行 24+ 小时
- 添加监控后，可以自动处理异常情况
- 优化后，可以长期稳定运行

---

**审计完成时间：** 2024年
**审计人员：** AI Assistant
**状态：** ⚠️ 需要修复

