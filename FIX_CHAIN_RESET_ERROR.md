# 修复链重置错误

## 问题描述

错误信息：
```
❌ Chain Initialization Error:
❌ 链重组失败: Rewind height 0 must be less than local height 0。建议手动重置链。
```

## 问题原因

这个错误发生在以下情况：
1. 链高度为 0（只有创世区块）
2. 系统检测到分叉并尝试回退到高度 0
3. `performHardReorg` 函数检测到 `rewindHeight >= localHeight` 并报错

## 已修复的问题

### 1. `performHardReorg` 特殊处理

当 `rewindHeight === 0 && localHeight === 0` 时，直接返回成功（无需回退）。

### 2. `checkForFork` 边界检查

当链高度为 0 时，跳过分叉检测，避免触发不必要的回退。

### 3. `handleResetChain` 增强

改进了重置链逻辑，确保清除所有相关数据：
- 链数据（`indexerchain_blocks_v1`）
- 快照数据
- Bootstrap 状态
- 状态修复数据

## 解决方案

### 方案 1：使用工具中的重置按钮（推荐）

1. 打开应用
2. 进入 **Advanced** 标签页或 **Tools** 标签页
3. 点击 **🔄 Reset Chain** 按钮
4. 确认重置
5. 页面会自动刷新并重新初始化

### 方案 2：手动清除浏览器数据（如果方案 1 不行）

如果重置按钮不起作用，可以手动清除：

#### 在浏览器控制台中执行：

```javascript
// 打开浏览器控制台（F12），然后执行：

// 清除所有链相关数据
localStorage.removeItem("indexerchain_blocks_v1");
localStorage.removeItem("indexerchain_blocks");

// 清除所有快照
localStorage.removeItem("indexerchain_snapshots_meta");
Object.keys(localStorage)
  .filter(k => k.startsWith("indexerchain_snapshot_"))
  .forEach(k => localStorage.removeItem(k));

// 清除其他相关数据
localStorage.removeItem("indexerchain_bootstrap_state");
localStorage.removeItem("indexerchain_state_repair");

// 清除所有以 indexerchain_ 开头的键（可选，更彻底）
Object.keys(localStorage)
  .filter(k => k.startsWith("indexerchain_"))
  .forEach(k => localStorage.removeItem(k));

// 刷新页面
window.location.reload();
```

#### 或者使用浏览器设置：

1. 打开浏览器开发者工具（F12）
2. 进入 **Application** 标签页（Chrome）或 **Storage** 标签页（Firefox）
3. 展开 **Local Storage**
4. 选择你的域名（如 `localhost` 或 `indexerchain.com`）
5. 删除所有以 `indexerchain_` 开头的键
6. 刷新页面

### 方案 3：清除所有站点数据（最彻底）

如果以上方法都不行：

1. 打开浏览器设置
2. 进入 **隐私和安全** → **清除浏览数据**
3. 选择 **仅清除此站点的数据**
4. 选择你的域名
5. 清除 **Cookie 和其他网站数据**
6. 刷新页面

## 验证修复

清除数据后，页面应该：
1. ✅ 自动重新初始化链
2. ✅ 创建新的创世区块
3. ✅ 不再显示错误信息
4. ✅ 可以正常连接和挖矿

## 预防措施

修复后的代码已经：
- ✅ 在链高度为 0 时跳过分叉检测
- ✅ 在回退到高度 0 时正确处理
- ✅ 重置链时清除所有相关数据

如果问题仍然存在，请：
1. 检查浏览器控制台是否有其他错误
2. 尝试使用无痕模式打开应用
3. 检查是否有浏览器扩展干扰

---

**修复版本**: v1.0  
**修复日期**: 2024-11-19  
**相关文件**: 
- `src/core/hardReorg.ts`
- `src/ui/App.tsx`

