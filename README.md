# IndexerChain (IndexNet)

一条完全运行在浏览器中的轻量级区块链，所有浏览器都是节点和矿工。

## 🚀 项目简介

IndexerChain 是一个浏览器挖矿的索引链，具有以下特点：

- **🌐 浏览器即节点**：打开网页即成为一个完整的区块链节点
- **⛏️ 浏览器挖矿**：每个浏览器都可以参与 PoW 挖矿，获得 IDC 代币奖励
- **📡 P2P 网络**：浏览器之间通过 WebRTC 直接通信，无需中心服务器
- **💾 本地存储**：使用 localStorage 持久化链数据
- **⚡ 轻节点模式**：自动修剪旧区块，只保留最近 200 个区块，大幅减少存储占用
- **📸 快速同步**：使用快照技术，启动时快速恢复状态

## ✨ 核心功能

- ✅ 创建索引操作（PUT/APPEND/DELETE）
- ✅ IDC 代币转账
- ✅ PoW 挖矿（Web Worker，不阻塞 UI）
- ✅ 实时挖矿统计（算力、哈希数、耗时）
- ✅ P2P 网络同步
- ✅ 动态难度调整
- ✅ 自动挖矿奖励（10 IDC/区块）
- ✅ 轻节点模式（自动修剪旧区块）
- ✅ 状态快照（快速启动）

## 🚀 快速开始

### 前置要求

- Node.js 16+ 
- npm 或 yarn
- 现代浏览器（支持 Web Crypto API、WebRTC、Web Workers）

### 安装步骤

#### 1. 克隆项目并安装依赖

```bash
# 进入项目目录
cd IndexerChain

# 安装依赖
npm install
```

#### 2. 启动开发服务器

```bash
npm run dev
```

开发服务器将在 `http://localhost:5173` 启动。

#### 3. 启动信令服务器（用于 P2P 网络）

IndexerChain 使用 WebRTC 进行点对点通信，需要一个 WebSocket 信令服务器来帮助节点发现和连接。

**方式一：使用快速启动脚本（推荐）**

```bash
# Mac/Linux
./start-server.sh

# Windows
start-server.bat
```

**方式二：手动启动**

```bash
# 安装 ws 包（如果尚未安装）
npm install ws

# 启动信令服务器
node signaling-server-example.js
```

信令服务器将在 `ws://localhost:8080` 启动。

#### 4. 连接网络

1. 在浏览器中打开应用：`http://localhost:5173`
2. 在 "P2P Network" 部分输入信令服务器 URL：`ws://localhost:8080`
3. 点击 "Connect" 加入 P2P 网络
4. 打开多个浏览器窗口/标签页测试多节点网络

## 📖 使用指南

### 创建交易

#### 索引操作（PUT/APPEND/DELETE）

1. 在 "Create Transaction (Index Operations)" 部分
2. 选择操作类型：
   - **PUT**：写入或覆盖一个键值对
   - **APPEND**：在已有值后追加内容
   - **DELETE**：删除一个键
3. 输入命名空间（namespace），例如：`test`
4. 输入键（key），例如：`mykey`
5. 输入值（value），DELETE 操作不需要值
6. 点击 "Create Transaction" 创建交易

交易会自动签名并加入交易池（Pending Transactions）。

#### 转账操作（TRANSFER IDC）

1. 在 "Transfer IDC" 部分
2. 输入接收者地址（格式：`idc_...`）
3. 输入转账金额（IDC）
4. 点击 "Transfer IDC" 创建转账交易

**注意**：确保你的余额足够支付转账金额。

### 启动挖矿

#### 基本步骤

1. **确保有待处理的交易**：
   - 在 "Pending Transactions" 部分查看待处理交易数量
   - 至少需要 1 笔交易才能开始挖矿

2. **点击 "Start Mining"**：
   - 按钮会显示待处理交易数量，例如：`Start Mining (3 pending)`
   - 点击后开始挖矿

3. **查看挖矿状态**：
   - 在 "Mining Status" 部分查看实时统计：
     - **Status**：Mining... / Stopped
     - **Current Difficulty**：当前难度（需要的前导 0 数量）
     - **Estimated Hashrate**：估算算力（hash/s）
     - **Total Hashes Tried**：本轮尝试的哈希总数
     - **Elapsed Time**：本轮挖矿耗时
     - **Current Hash**：当前计算的哈希值
     - **Current Nonce**：当前尝试的 nonce 值

4. **挖矿成功**：
   - 当找到符合难度的区块时，会自动：
     - 验证区块
     - 追加到链上
     - 更新状态
     - 矿工获得 10 IDC 奖励
     - 从交易池移除已打包的交易
     - 自动重启挖矿（如果有新的待处理交易）

#### 停止挖矿

- 点击 "Stop Mining" 按钮停止当前挖矿

#### 自动重启挖矿

- 当收到新区块时（来自网络或其他节点），挖矿会自动停止并重启
- 确保始终在最新的链上挖矿

### 查看链状态

#### Chain Status（链状态）

- **Current Height**：当前链高度
- **Block Count**：存储的区块数量（轻节点模式下可能少于高度）
- **Pending Txs**：待处理交易数量
- **Mining**：挖矿状态（Active/Inactive）

#### Node Identity（节点身份）

- **Address**：你的节点地址（格式：`idc_...`）
- **Node ID**：节点 ID
- **IDC Balance**：你的 IDC 余额

#### Difficulty Status（难度状态）

- **Current Difficulty**：当前难度
- **Target Block Time**：目标出块时间（10 秒）
- **Blocks Until Adjustment**：距离下次难度调整的区块数
- **Avg Block Time**：最近 N 个区块的平均出块时间

#### Latest Block（最新区块）

- **Hash**：区块哈希
- **Transactions**：交易数量
- **Difficulty**：难度
- **Nonce**：挖矿随机数

#### Light Node Status（轻节点状态）

- **Light Node Window**：轻节点窗口大小（默认 200 个区块）
- **Stored Blocks**：当前存储的区块数量
- **Earliest Block Height**：最早存储的区块高度
- **Latest Block Height**：最新存储的区块高度
- **Storage Reduction**：存储减少百分比

#### State & Storage（状态和存储）

- **Last Snapshot Height**：最新快照高度
- **Last Snapshot Time**：最新快照时间
- **Blocks Since Snapshot**：距离快照的区块数
- **Snapshot Count**：快照总数
- **Latest Snapshot Size**：最新快照大小（压缩后）
- **Compression Ratio**：压缩比例（减少百分比）
- **Estimated Uncompressed**：估算未压缩大小
- **Force Snapshot**：手动创建快照（自动压缩）
- **Clear Snapshots**：清除所有快照
- **Recompress All**：重新压缩所有快照（升级旧格式）

### 多节点测试

1. **启动信令服务器**（一个实例即可）
2. **打开多个浏览器窗口/标签页**：
   - 每个窗口都连接到同一个信令服务器（`ws://localhost:8080`）
   - 每个窗口都是一个独立的节点
3. **测试同步**：
   - 在一个窗口中创建交易或挖矿
   - 其他窗口会自动同步区块和交易
4. **查看网络状态**：
   - 在 "P2P Network" 部分查看连接的节点数量
   - 在 "Connected Peers" 中查看所有连接的节点

## ⚙️ 配置说明

### 链参数配置

链参数在 `src/core/chain.ts` 的 `getDefaultChainParams()` 中定义：

```typescript
{
  version: 1,
  networkId: "indexerchain-dev",
  genesisTimestamp: Math.floor(Date.now() / 1000),
  initialDifficulty: 1,                    // 初始难度
  targetBlockTime: 10,                     // 目标出块时间（秒）
  difficultyAdjustmentInterval: 10,        // 难度调整间隔（区块数）
  blockReward: 10,                         // 区块奖励（IDC）
  snapshotInterval: 50,                    // 快照生成间隔（区块数）
  maxSnapshotCount: 5,                     // 最大快照数量
  lightNodeWindow: 200,                    // 轻节点窗口大小（区块数）
  maxBlockSizeBytes: 1_000_000,           // 最大区块大小（字节）
}
```

### 修改配置

#### 调整挖矿难度

修改 `initialDifficulty`：
- **降低难度**（测试用）：设置为 `1` 或 `2`，挖矿更快
- **提高难度**（生产用）：设置为 `3` 或更高，挖矿更慢但更安全

#### 调整出块时间

修改 `targetBlockTime`：
- 默认 `10` 秒
- 可以调整为 `5` 秒（更快）或 `20` 秒（更慢）

#### 调整轻节点窗口

修改 `lightNodeWindow`：
- 默认 `200` 个区块
- 设置为 `0` 或 `undefined` 禁用轻节点模式（保留所有区块）
- 设置为更大的值（如 `500`）保留更多区块

#### 调整快照频率

修改 `snapshotInterval`：
- 默认每 `50` 个区块生成一次快照
- 更小的值（如 `20`）更频繁，但占用更多存储
- 更大的值（如 `100`）更少，但启动时可能需要重放更多区块

### 信令服务器配置

信令服务器默认监听 `8080` 端口，可以在 `signaling-server-example.js` 中修改：

```javascript
const PORT = 8080; // 修改为你想要的端口
```

## 🔧 其他命令

```bash
# 构建生产版本
npm run build

# TypeScript 类型检查
npm run type-check

# 预览生产构建
npm run preview
```

## 🐛 故障排除

### 无法连接到信令服务器

**症状**：P2P Network 显示 "Disconnected"，控制台报错 `WebSocket connection failed`

**解决方案**：
1. 确认信令服务器正在运行
2. 检查 URL 是否正确（`ws://localhost:8080`）
3. 检查防火墙设置
4. 查看浏览器控制台的错误信息
5. 尝试重启信令服务器

### 挖矿很慢或卡住

**症状**：点击 "Start Mining" 后没有反应，或挖矿进度不更新

**解决方案**：
1. **检查难度**：如果难度太高（> 3），挖矿会很慢，这是正常的
2. **降低难度**：修改 `initialDifficulty` 为 `1` 或 `2` 进行测试
3. **检查浏览器控制台**：查看是否有错误信息
4. **刷新页面**：重新加载应用
5. **检查 Web Worker**：确保浏览器支持 Web Workers

### 余额不更新

**症状**：挖出区块后，IDC Balance 没有增加

**解决方案**：
1. **确认区块已成功挖出**：查看 "Latest Block" 部分
2. **检查交易是否包含在区块中**：查看区块的 Transactions 数量
3. **刷新页面**：重新加载链状态
4. **检查地址**：确认 "Node Identity" 中的地址是正确的

### 交易无法创建

**症状**：点击 "Create Transaction" 后没有反应，或显示错误

**解决方案**：
1. **检查必填字段**：确保 Namespace 和 Key 已填写
2. **检查签名**：如果显示 "Signing..." 但一直不完成，可能是浏览器不支持 Web Crypto API
3. **查看错误信息**：在页面顶部的错误提示中查看具体错误
4. **刷新页面**：重新加载应用

### 轻节点模式下区块丢失

**症状**：链高度很高，但存储的区块数量很少

**解决方案**：
- **这是正常的**：轻节点模式会自动删除旧区块，只保留最近 200 个
- **使用快照恢复**：启动时会从快照恢复状态，然后只重放窗口内的区块
- **禁用轻节点模式**：设置 `lightNodeWindow: 0` 保留所有区块

### P2P 网络无法连接

**症状**：多个节点无法互相发现或同步

**解决方案**：
1. **确认所有节点连接到同一个信令服务器**
2. **检查 WebRTC 支持**：确保浏览器支持 WebRTC
3. **检查防火墙/NAT**：WebRTC 可能需要特定的网络配置
4. **查看控制台日志**：检查是否有连接错误

### 存储空间不足

**症状**：localStorage 报错或数据丢失

**解决方案**：
1. **启用轻节点模式**：确保 `lightNodeWindow` 已设置（默认 200）
2. **清除旧数据**：
   - 在浏览器开发者工具中清除 localStorage
   - 或使用 "Clear Snapshots" 按钮
3. **检查浏览器存储限制**：不同浏览器的 localStorage 限制不同（通常 5-10MB）

## 📝 开发状态

**当前版本**：Phase 11 Complete

**已完成功能**：
- ✅ 核心链功能（区块、交易、状态）
- ✅ PoW 挖矿（Web Worker）
- ✅ P2P 网络（WebRTC）
- ✅ 身份和签名系统
- ✅ 动态难度调整
- ✅ 挖矿奖励和余额系统
- ✅ 轻节点模式和自动修剪
- ✅ 状态快照和快速同步
- ✅ 快照压缩（60-90% 存储减少）

## 📄 许可证

MIT License

## 🙏 致谢

感谢所有为浏览器区块链技术做出贡献的开发者和研究者。
