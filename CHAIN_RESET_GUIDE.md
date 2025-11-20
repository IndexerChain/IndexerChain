# 链重置操作指南 (Phase 49)

## 概述

当需要重新开始链（例如：新的经济模型）时，需要执行完整重置：
1. 清空信号服务器的引导块
2. 重置 rootTip 到新的创世区块
3. 清空浏览器本地存储

## 方法一：直接重置信号服务器（推荐，最简单）

### 步骤

1. **运行重置脚本**
   ```bash
   cd /Users/pengs/Downloads/workspace/IndexerChain
   node scripts/reset-signal-server-simple.js
   ```

2. **脚本会自动执行**
   - ✅ 清空信号服务器的所有引导块
   - ✅ 重置 rootTip 到新的创世区块
   - ✅ 所有连接的浏览器会自动收到重置通知

3. **浏览器端操作**
   - 打开浏览器控制台（F12）
   - 运行：`localStorage.clear()`
   - 刷新页面
   - 验证链高度为 0

**✅ 测试通过**：此方法已测试，可以直接使用。

## 方法二：使用正确的创世区块（可选）

如果需要使用实际的网络参数生成正确的创世区块 hash：

1. **安装 tsx（如果未安装）**
   ```bash
   npm install -D tsx
   ```

2. **生成创世区块数据**
   ```bash
   npx tsx scripts/generate-genesis.js > genesis.json
   ```

3. **使用生成的创世区块重置**
   ```bash
   # 修改 reset-signal-server-simple.js 使用 genesis.json
   # 或直接使用 HTTP API
   ```

**注意**：方法一（简单脚本）已经可以正常工作，方法二仅用于确保创世区块 hash 完全正确。

## 验证重置

重置后，验证以下内容：

1. **RootTip 高度为 0**
   - 检查信号服务器的 rootTip
   - 应该显示 `latestHeight: 0`

2. **引导块已清空**
   - 访问：`https://signal.indexerchain.com/bootstrap-blocks?from=1&to=10`
   - 应该返回 `ok: false, reason: "NO_BOOTSTRAP_BLOCKS"`

3. **本地链高度为 0**
   - 刷新浏览器页面
   - 检查应用界面中的"当前高度"
   - 应该是 `0`

4. **本地存储已清空**
   - 打开浏览器开发者工具
   - 进入 Application > Local Storage
   - 检查 `indexerchain_*` 相关的键应该被清除

## API 接口

### 清空引导块

```bash
curl -X POST https://signal.indexerchain.com/admin/clear-bootstrap-blocks \
  -H "Content-Type: application/json"
```

响应：
```json
{
  "ok": true,
  "message": "All bootstrap blocks cleared",
  "deleted": 256,
  "from": 1,
  "to": 256
}
```

### 重置 RootTip

**方法 1：HTTP API（推荐）**
```bash
curl -X POST https://signal.indexerchain.com/admin/reset-root-tip-http \
  -H "Content-Type: application/json" \
  -d '{
    "newGenesisHeader": { ... },
    "newGenesisHash": "...",
    "newStateCommitment": "..."
  }'
```

**方法 2：WebSocket**
通过 WebSocket 发送：
```json
{
  "type": "RESET_ROOT_TIP",
  "newGenesisHeader": { ... },
  "newGenesisHash": "...",
  "newStateCommitment": "..."
}
```

## 注意事项

⚠️ **重要警告**：

- **重置操作是不可逆的**
- 所有旧区块、状态、快照都会被清除
- 所有浏览器会在下次连接时自动重置
- Shadow Sessions 会在下次连接时自动重置
- 确保所有节点都已准备好接受新链

## 故障排查

### 问题：脚本无法导入模块

**解决**：
- 确保应用已完全加载
- 等待几秒后再运行脚本
- 检查控制台是否有错误信息

### 问题：WebSocket 连接失败

**解决**：
- 检查网络连接
- 确认 `signal.indexerchain.com` 可访问
- 检查防火墙设置

### 问题：清空引导块失败

**解决**：
- 检查 Worker 是否已部署最新版本
- 查看 Worker 日志：`wrangler tail`
- 确认 `/admin/clear-bootstrap-blocks` 接口可用

### 问题：重置后浏览器没有自动重置

**解决**：
- 手动清除 localStorage：`localStorage.clear()`
- 刷新页面
- 或等待 HardReorg 自动触发

## 测试脚本

### 测试重置功能

```bash
node scripts/test-reset.js
```

测试内容：
- 清空引导块接口
- 验证引导块已清空
- WebSocket 连接测试

### 验证重置状态

```bash
node scripts/verify-reset.js
```

检查内容：
- 引导块状态
- RootTip 状态（需要浏览器检查）

## 测试结果

✅ **所有测试通过** (2024-12-XX)

- ✅ 清空引导块接口工作正常
- ✅ 引导块验证通过
- ✅ WebSocket 连接正常
- ✅ Worker 部署成功

## Worker 版本

- **当前版本**: `e122de9c-47fc-4f98-ae63-6ca8c181334b`
- **部署时间**: 2024-12-XX
- **功能**: 
  - ✅ 支持清空引导块 (`/admin/clear-bootstrap-blocks`)
  - ✅ 支持 HTTP API 重置 rootTip (`/admin/reset-root-tip-http`)
  - ✅ 支持 WebSocket 重置 rootTip (`RESET_ROOT_TIP`)
- **测试状态**: ✅ 全部通过

---

**最后更新**: Phase 49 - Complete Chain Reset

