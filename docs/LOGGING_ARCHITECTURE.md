# 日志管理架构设计

## 概述

为了在生产环境中减少日志输出，提高性能，我们实现了一个集中式日志管理系统。在生产环境中，只输出错误日志；在开发环境中，输出所有级别的日志。

## 日志级别

- **DEBUG** (0): 详细的调试信息，仅在开发环境显示
- **INFO** (1): 一般信息，仅在开发环境显示
- **WARN** (2): 警告信息，仅在开发环境显示
- **ERROR** (3): 错误信息，在所有环境显示（包括生产环境）
- **NONE** (4): 不输出任何日志

## 环境检测

系统通过以下方式检测生产环境：

1. **Vite 构建模式**：
   - `import.meta.env.PROD === true` → 生产环境
   - `import.meta.env.MODE === "production"` → 生产环境

2. **域名检测**：
   - `indexerchain.com`
   - `www.indexerchain.com`
   - `*.pages.dev` (Cloudflare Pages)

## 使用方法

### 基本用法

```typescript
import { logger } from "../core/logger.js";

// Debug 日志（开发环境）
logger.debug("Debug message", data);

// Info 日志（开发环境）
logger.info("Info message", data);

// Warning 日志（开发环境）
logger.warn("Warning message", data);

// Error 日志（所有环境）
logger.error("Error message", error);
```

### 便捷函数

```typescript
import { debug, info, warn, error } from "../core/logger.js";

debug("Debug message");
info("Info message");
warn("Warning message");
error("Error message");
```

### 自定义前缀

```typescript
import { log } from "../core/logger.js";

log("CustomPrefix", "Message with custom prefix");
```

## 运行时配置

可以通过 `localStorage` 在运行时调整日志级别（用于调试）：

```javascript
// 设置日志级别（0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=NONE）
localStorage.setItem("indexerchain_log_level", "1");

// 清除设置，恢复默认行为
localStorage.removeItem("indexerchain_log_level");
```

## 迁移指南

### 替换 console.log

```typescript
// 旧代码
console.log("[P2P] Message", data);

// 新代码
logger.debug("[P2P] Message", data);
```

### 替换 console.warn

```typescript
// 旧代码
console.warn("[P2P] Warning", data);

// 新代码
logger.warn("[P2P] Warning", data);
```

### 替换 console.error

```typescript
// 旧代码
console.error("[P2P] Error", error);

// 新代码
logger.error("[P2P] Error", error);
```

### 替换 console.info

```typescript
// 旧代码
console.info("[P2P] Info", data);

// 新代码
logger.info("[P2P] Info", data);
```

### 替换 console.debug

```typescript
// 旧代码
console.debug("[P2P] Debug", data);

// 新代码
logger.debug("[P2P] Debug", data);
```

## 已迁移的文件

- ✅ `src/core/logger.ts` - 日志管理模块
- ✅ `src/core/p2p.ts` - P2P 网络层（所有日志已迁移）
- 🔄 `src/ui/App.tsx` - 主应用组件（部分迁移）

## 待迁移的文件

以下文件仍在使用 `console.log/warn/error`，需要逐步迁移：

- `src/core/sync.ts`
- `src/core/chain.ts`
- `src/core/bootstrapSync.ts`
- `src/core/miningGuard.ts`
- `src/core/minerClient.ts`
- `src/core/minerCluster.ts`
- `src/core/localStateCoordinator.ts`
- `src/core/stateLockManager.ts`
- 其他核心模块...

## 批量迁移策略

对于大量文件，可以使用以下策略：

1. **按优先级迁移**：
   - 高优先级：用户可见的日志（App.tsx）
   - 中优先级：频繁调用的模块（p2p.ts, sync.ts）
   - 低优先级：低频调用的模块

2. **使用查找替换**：
   ```bash
   # 查找所有 console.log
   grep -r "console\.log" src/
   
   # 查找所有 console.warn
   grep -r "console\.warn" src/
   
   # 查找所有 console.error
   grep -r "console\.error" src/
   ```

3. **逐步迁移**：
   - 每次迁移一个文件
   - 确保导入 `logger`
   - 替换所有 `console.*` 调用
   - 测试确保功能正常

## 注意事项

1. **错误日志必须保留**：所有 `console.error` 都应该替换为 `logger.error`，确保生产环境也能看到错误。

2. **不要移除错误处理**：即使日志被禁用，错误处理逻辑必须保留。

3. **性能考虑**：在生产环境中，`logger.debug/info/warn` 会立即返回，不会执行日志输出，因此性能影响最小。

4. **调试模式**：如果需要临时启用所有日志（在生产环境），可以设置：
   ```javascript
   localStorage.setItem("indexerchain_log_level", "0");
   ```

## 测试

### 开发环境测试

```bash
npm run dev
# 应该看到所有级别的日志
```

### 生产环境测试

```bash
npm run build
npm run preview
# 或部署到 Cloudflare Pages
# 应该只看到 ERROR 级别的日志
```

## 未来改进

1. **结构化日志**：支持 JSON 格式的结构化日志
2. **远程日志收集**：在生产环境中收集错误日志到远程服务器
3. **日志采样**：对于高频日志，支持采样输出
4. **日志聚合**：聚合相同类型的日志，减少重复输出

