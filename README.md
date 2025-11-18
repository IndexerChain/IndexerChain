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
- ✅ **Bitcoin-like 减半发行模型**（10 个 Era，100 年挖完 10 亿 IDC）
- ✅ **动态区块奖励**（根据 Era 自动调整，初始约 15.87 IDC/区块）
- ✅ **交易手续费**（自动计入矿工奖励）
- ✅ 轻节点模式（自动修剪旧区块）
- ✅ 状态快照（快速启动）
- ✅ 状态承诺（State Commitment）验证

## 🏗️ 架构设计

IndexerChain 采用 **Browser-native Blockchain（浏览器原生链）** 架构，完全符合去中心化、轻量、高速、安全的设计理念。

### 架构组成

#### 1. **前端应用（Cloudflare Pages/Workers）**
- **作用**：分发前端应用代码（链逻辑、挖矿系统、UI 全在浏览器）
- **特点**：
  - ✅ 无后端服务器
  - ✅ 无中心区块链服务器
  - ✅ 全球 CDN 加速
  - ✅ 用户打开即是最新代码版本
- **部署**：可部署到 Cloudflare Pages（免费、全球 CDN）

#### 2. **信令服务器（WebSocket Signaling Server）**

IndexerChain 支持两种模式：

**A. 主网模式（生产环境）**
- **作用**：公网可访问的信令服务器，让全球用户加入同一条链
- **部署位置**：
  - **VPS**（DigitalOcean / Vultr / 阿里云等）- 传统方案，需要服务器
  - **Cloudflare Workers**（推荐）- 无服务器方案，全球 CDN，自动扩缩容
- **URL 示例**：`wss://signal.indexerchain.io`
- **部署文档**：详见下方「部署根节点」章节
- **特点**：
  - ✅ **不存储任何区块数据**
  - ✅ **不参与共识**
  - ✅ **不广播区块**
  - ✅ 本质是"电话交换机"，只负责介绍节点给彼此认识
  - ✅ 区块链数据**不走 WebSocket**，只走 WebRTC

**B. 本地开发模式（开发/测试）**
- **作用**：本地信令服务器，用于开发、测试、局域网 demo
- **URL**：`ws://localhost:8080` 或 `ws://192.168.x.x:8080`
- **使用场景**：
  - 本地开发测试
  - 单机挖矿
  - 局域网内多节点测试
  - 私有测试链

**安全性**（两种模式相同）：
- WebRTC 端到端加密
- 信令服务器看不到任何区块数据
- 即使信令服务器被攻破，也无法修改链、读取交易、伪造区块

#### 3. **WebRTC P2P 网络（真正的链通信）**
- **作用**：浏览器之间的直接点对点通信
- **传输内容**：
  - `NEW_BLOCK`：新区块广播
  - `NEW_TX`：新交易广播
  - `REQUEST_BLOCKS`：区块同步请求
  - `BLOCKS`：区块数据响应
  - 快照请求和状态同步
- **特点**：
  - ✅ 低延迟（真实点对点）
  - ✅ 高隐私（端到端加密）
  - ✅ 不经过任何服务器
  - ✅ NAT 友好，全球可用

#### 4. **浏览器本地挖矿（Web Worker）**
- **作用**：在浏览器中执行 PoW 挖矿
- **特点**：
  - ✅ 不阻塞 UI（Web Worker）
  - ✅ 完全本地执行
  - ✅ 无服务器依赖

### 架构优势

✅ **零后台服务器**（除了信令，且信令不参与链逻辑）  
✅ **Zero-trust 架构**（服务器不可被信任也不影响链安全）  
✅ **低成本**（几乎 0 服务器消耗，Cloudflare Pages 免费）  
✅ **高性能**（所有逻辑本地执行，毫秒级响应）  
✅ **去中心化**（浏览器即节点，无单点故障）  
✅ **双模式支持**（主网模式 + 本地开发模式）

### 架构模式说明

#### 主网模式（Mainnet Mode）
- **目标**：让全球用户加入同一条 IndexerChain 主网
- **信令服务器**：公网可访问（如 `wss://signal.indexerchain.io`）
- **使用场景**：生产环境、公共网络
- **用户体验**：打开网页 → 自动连接主网 → 和全球用户一起挖矿

#### 本地开发模式（Dev Mode）
- **目标**：本地开发、测试、私有链
- **信令服务器**：本地运行（`ws://localhost:8080`）
- **使用场景**：开发、测试、局域网 demo、单机挖矿
- **用户体验**：开发者自己运行信令服务器，创建私有测试链

### 架构兼容性

| Phase | 功能 | 兼容性 | 说明 |
|-------|------|--------|------|
| 1-4 | 核心链/P2P | ✅ 完全兼容 | P2P WebRTC 已支持，WS 用作信令 |
| 5-7 | 身份/奖励/转账 | ✅ 完全兼容 | 所有逻辑在本地运行 |
| 8 | WebWorker 挖矿 | ✅ 完全兼容 | 本地挖矿，不依赖服务器 |
| 9-12 | 快照/压缩/增量/验证 | ✅ 完全兼容 | 快照为本地存储，不需要服务端 |
| 13 | 自动挖矿 | ✅ 完全兼容 | 挖矿触发仅依赖 P2P 来中断/重启 |
| 14 | 远程快照 | ✅ 可选 | Cloudflare 可以托管快照列表 JSON |
| 15 | 状态承诺 | ✅ 完全兼容 | 验证在本地执行，与信令无关 |
| 16 | IDC 发行模型 | ✅ 完全兼容 | 完全本地计算 |

👉 **当前架构对所有已完成的 Phase 完全兼容，无阻碍点。**

## 🚀 快速开始

### 安装和运行

#### 第一步：安装依赖

打开终端，进入项目目录，运行：

```bash
npm install
```

这会自动安装所有必需的依赖包。

#### 第二步：启动应用

运行开发服务器：

```bash
npm run dev
```

启动成功后，浏览器会自动打开，或手动访问：`http://localhost:5173`

#### 第三步：连接网络

IndexerChain 需要连接到网络才能与其他节点通信。有两种模式可选：

**本地测试模式（推荐新手）**

1. 在项目目录中找到并运行信令服务器启动脚本：
   - **Mac/Linux 用户**：双击运行 `start-server.sh` 或在终端执行 `./start-server.sh`
   - **Windows 用户**：双击运行 `start-server.bat`

2. 在浏览器页面的 "P2P Network" 部分：
   - 确保 **未勾选** "Mainnet Mode"
   - 信令服务器地址输入：`ws://localhost:8080`
   - 点击 "Connect" 按钮

3. 连接成功后，状态会显示 "Connected"，你可以开始使用所有功能。

**主网模式（需要部署服务器）**

1. 首先需要部署一个公网可访问的信令服务器（详见下方「部署」章节）

2. 在浏览器页面的 "P2P Network" 部分：
   - **勾选** "Mainnet Mode"
   - 输入你的信令服务器地址（例如：`wss://signal.yourdomain.com`）
   - 点击 "Connect" 按钮

3. 连接成功后，你将与全球用户共享同一条链。

> 💡 **提示**：如果只是想测试功能，建议使用本地测试模式，无需部署服务器。

### 部署到生产环境

#### 部署前准备

部署 IndexerChain 需要完成两个部分：

1. **前端应用**：用户访问的网页界面
2. **信令服务器**：让用户之间建立连接的服务器（必需）

> ⚠️ **重要**：如果只部署前端，用户将无法连接到网络。必须同时部署信令服务器。

#### 第一步：构建前端应用

在项目目录运行：

```bash
npm run build
```

构建完成后，会在 `dist/` 目录生成所有文件。

#### 第二步：部署前端到 Cloudflare Pages（推荐）

Cloudflare Pages 提供免费的全球 CDN 和自动 HTTPS，非常适合部署前端应用。

**通过网页界面部署（最简单）**：

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/) 并登录
2. 点击左侧菜单的 "Pages"，然后点击 "Create a project"
3. 选择 "Connect to Git"，连接你的 GitHub/GitLab 仓库
4. 配置构建设置：
   - **Build command**：输入 `npm run build`
   - **Build output directory**：输入 `dist`
   - **Root directory**：留空或输入 `/`
5. 点击 "Save and Deploy" 开始部署
6. 等待几分钟，部署完成后会获得一个 `*.pages.dev` 的免费域名

**配置自定义域名（可选）**：

1. 在项目设置中找到 "Custom domains"
2. 点击 "Set up a custom domain"
3. 输入你的域名（如 `indexerchain.com`）
4. 按照提示配置 DNS 记录
5. Cloudflare 会自动配置 SSL 证书

#### 第三步：部署信令服务器

信令服务器是必需的，它帮助用户之间建立连接。有两种部署方式：

**方式一：使用 Cloudflare Workers（推荐，免费且简单）**

适合：快速部署、全球用户、无需服务器

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击左侧菜单的 "Workers & Pages"
3. 点击 "Create application" → "Create Worker"
4. 将项目中的信令服务器代码复制到 Worker 编辑器
5. 点击 "Deploy" 部署
6. 获得 Worker 地址（如 `your-worker.your-subdomain.workers.dev`）
7. 配置自定义域名（可选）：在 Worker 设置中添加你的域名

**方式二：使用 VPS 服务器（需要购买服务器）**

适合：完全控制、高并发、自定义配置

1. 购买一台 VPS 服务器（推荐：DigitalOcean、Vultr、阿里云等，约 $5/月）
2. 在服务器上安装 Node.js（版本 20 或更高）
3. 上传信令服务器文件到服务器
4. 安装依赖并启动服务
5. 配置域名和 SSL 证书（使用 Let's Encrypt 免费证书）
6. 配置防火墙开放必要端口

> 📖 **详细步骤**：查看 [DEPLOY_SIGNALING.md](./DEPLOY_SIGNALING.md) 获取信令服务器的详细部署步骤。

#### 第四步：更新应用配置

部署完成后，需要在前端应用中配置信令服务器地址：

1. 打开项目中的配置文件
2. 将主网信令服务器地址更新为你部署的地址
3. 重新构建并部署前端应用

#### 部署检查清单

部署完成后，请验证：

- ✅ 前端应用可以正常访问
- ✅ 信令服务器可以正常连接
- ✅ 在浏览器中可以成功连接网络
- ✅ 可以创建交易和开始挖矿
- ✅ 多个用户之间可以正常同步

#### 成本估算

- **前端部署**：Cloudflare Pages 免费
- **信令服务器（Workers）**：免费额度充足，超出后按量付费（通常免费额度足够使用）
- **信令服务器（VPS）**：约 $5-10/月
- **域名**：约 $10-15/年（可选）

**总计**：如果使用 Cloudflare Workers，几乎完全免费；如果使用 VPS，约 $5-10/月。

#### 关于信令服务器

**什么是信令服务器？**

信令服务器是 IndexerChain 网络的基础设施，它的作用是帮助用户的浏览器之间建立连接。可以把它想象成"电话交换机"——它只负责介绍用户给彼此认识，之后用户之间直接通信。

**重要说明**：
- ✅ 信令服务器**不存储任何区块链数据**
- ✅ 信令服务器**不参与共识和挖矿**
- ✅ 信令服务器**不广播区块和交易**
- ✅ 所有区块链数据直接在用户浏览器之间传输
- ✅ 即使信令服务器出现问题，也不会影响链的安全性

#### 信令服务器部署方式对比

| 方式 | 难度 | 成本 | 适合场景 |
|------|------|------|----------|
| Cloudflare Workers | ⭐ 简单 | 免费 | 快速部署、全球用户 |
| VPS 服务器 | ⭐⭐ 中等 | $5-10/月 | 完全控制、高并发 |

**推荐选择**：
- 如果是第一次部署或用户量不大，推荐使用 **Cloudflare Workers**，免费且简单
- 如果需要完全控制或预期高并发，可以选择 **VPS 服务器**

> 📖 **详细部署步骤**：查看 [DEPLOY_SIGNALING.md](./DEPLOY_SIGNALING.md) 获取信令服务器的详细部署指南，包括完整的命令和配置说明。

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

**注意**：
- 确保你的余额足够支付转账金额
- 转账会收取手续费（基础 0.001 IDC + 按大小收费）
- 手续费会支付给挖出该交易的矿工

### 启动挖矿

#### 挖矿前准备

1. **了解挖矿奖励机制**：
   - IndexerChain 使用 **Bitcoin-like 减半发行模型**
   - 总量：**10 亿 IDC**，100 年挖完
   - 10 个 Era，每个 Era 约 10 年，奖励每 Era 减半
   - **Era 0（0-10 年）**：约 **15.87 IDC/区块**
   - **Era 1（10-20 年）**：约 **7.94 IDC/区块**
   - 以此类推，每个 Era 奖励减半
   - **交易手续费**：自动计入矿工奖励（基础 0.001 IDC + 按大小收费）

2. **查看当前发行状态**：
   - 在 "Chain Status" 部分查看：
     - **Total Minted**：已发行总量 / 最大供应量（10 亿）
     - **Minting Progress**：发行进度百分比
     - **Current Era**：当前 Era（0-9）
     - **Block Reward (next)**：下一个区块的奖励（IDC）
     - **Blocks in Era**：当前 Era 剩余区块数

3. **确保有待处理的交易**（可选）：
   - 在 "Pending Transactions" 部分查看待处理交易数量
   - 即使没有待处理交易，也可以挖矿（只有 coinbase 奖励）
   - 有交易时，矿工可以获得额外的手续费收入

#### 开始挖矿

1. **点击 "Start Mining" 按钮**：
   - 按钮会显示待处理交易数量，例如：`Start Mining (3 pending)`
   - 点击后，挖矿在 **Web Worker** 中开始，不会阻塞 UI

2. **查看挖矿状态**：
   - 在 "Mining Status" 部分查看实时统计：
     - **Status**：Mining... / Stopped
     - **Current Difficulty**：当前难度（需要的前导 0 数量）
     - **Estimated Hashrate**：估算算力（K hash/s）
     - **Total Hashes Tried**：本轮尝试的哈希总数
     - **Elapsed Time**：本轮挖矿耗时（秒）
     - **Current Hash**：当前计算的哈希值（实时更新）
     - **Current Nonce**：当前尝试的 nonce 值（实时更新）

3. **挖矿过程**：
   - 挖矿在后台 Web Worker 中进行，不影响页面操作
   - 可以继续创建交易、查看状态等
   - 挖矿进度会实时更新到 UI

#### 挖矿成功

当找到符合难度的区块时，系统会自动：

1. **验证区块**：
   - 验证 PoW 难度
   - 验证所有交易签名
   - 验证余额和转账
   - 验证区块奖励是否符合发行曲线
   - 验证总量上限（不超过 10 亿 IDC）

2. **追加到链上**：
   - 区块写入本地存储
   - 更新链高度
   - 应用所有交易到状态

3. **矿工奖励**：
   - **区块奖励**：根据当前 Era 自动计算（Era 0 约 15.87 IDC）
   - **手续费奖励**：区块中所有交易的手续费总和
   - **总奖励** = 区块奖励 + 手续费
   - 奖励自动转入矿工地址（你的节点地址）

4. **更新状态**：
   - 从交易池移除已打包的交易
   - 更新总发行量（Total Minted）
   - 更新你的 IDC 余额
   - 如果达到快照间隔，自动创建快照

5. **自动重启挖矿**：
   - 如果有新的待处理交易，自动开始下一轮挖矿
   - 确保持续挖矿，最大化收益

#### 停止挖矿

- 点击 **"Stop Mining"** 按钮停止当前挖矿
- 挖矿会立即停止，不会继续消耗 CPU

#### 自动挖矿管理

- **收到新区块时**：如果网络中有其他节点挖出新区块，你的挖矿会自动停止并重启
- **确保链同步**：始终在最新的链上挖矿，避免分叉
- **难度调整**：每 10 个区块自动调整难度，保持约 10 秒出块时间

#### 挖矿技巧

1. **提高收益**：
   - 等待更多交易进入交易池，获得更多手续费
   - 但不要等太久，其他节点可能先挖出区块

2. **降低难度（测试用）**：
   - 修改 `initialDifficulty` 为 `1` 或 `2`，挖矿更快
   - 适合本地测试和演示

3. **多节点挖矿**：
   - 打开多个浏览器窗口，每个都是独立节点
   - 可以测试多节点竞争挖矿
   - 注意：所有节点共享同一个信令服务器

4. **监控发行进度**：
   - 关注 "Minting Progress"，了解整体发行情况
   - 关注 "Current Era"，了解当前处于哪个 Era
   - Era 切换时，奖励会自动减半

### 查看链状态

#### Chain Status（链状态）

- **Current Height**：当前链高度
- **Block Count**：存储的区块数量（轻节点模式下可能少于高度）
- **Pending Txs**：待处理交易数量
- **Mining**：挖矿状态（Active/Inactive）
- **Total Minted**：已发行总量 / 最大供应量（10 亿 IDC）
- **Minting Progress**：发行进度百分比
- **Current Era**：当前 Era（0-9，共 10 个 Era）
- **Block Reward (next)**：下一个区块的奖励（IDC，会根据 Era 自动调整）
- **Blocks in Era**：当前 Era 剩余区块数

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
  blockReward: 10,                         // 区块奖励（IDC，已废弃，使用动态发行模型）
  snapshotInterval: 50,                    // 快照生成间隔（区块数）
  maxSnapshotCount: 5,                     // 最大快照数量
  lightNodeWindow: 200,                    // 轻节点窗口大小（区块数）
  fullSnapshotInterval: 5,                 // 每 N 个快照创建一个完整快照
  maxBlockSizeBytes: 1_000_000,           // 最大区块大小（字节）
  snapshotVerificationSampleRate: 0.3,    // 快照验证采样率（0-1）
  snapshotAutoVerifyIntervalMs: 60_000,   // 后台验证间隔（毫秒）
  remoteSnapshotEnabled: false,            // 是否启用远程快照同步
  remoteSnapshotEndpoints: [],             // 远程快照服务器 URL 列表
  remoteSnapshotMinHeight: 0,              // 远程快照最小高度要求
}
```

**注意**：`blockReward` 参数已废弃，现在使用 **Phase 16 的动态发行模型**，奖励根据 Era 自动计算。

### IDC 发行模型配置

IDC 发行模型在 `src/core/idcEmission.ts` 中定义，使用常量配置：

```typescript
// 货币参数
IDC_DECIMALS = 6                          // 1 IDC = 10^6 uIDC（微 IDC）
IDC_MAX_SUPPLY = 1,000,000,000 IDC       // 最大供应量：10 亿 IDC

// 挖矿参数
IDC_TARGET_BLOCK_TIME = 10                // 目标出块时间（秒）
IDC_BLOCKS_PER_ERA = 31,536,000           // 每个 Era 的区块数（10 年）
IDC_ERA_COUNT = 10                        // Era 总数（100 年）

// 基础奖励
IDC_BASE_REWARD = 15,870,394 uIDC        // Era 0 每块奖励（≈ 15.87 IDC）

// 手续费参数
IDC_BASE_FEE = 1,000 uIDC                 // 基础手续费（0.001 IDC）
IDC_FEE_PER_100_BYTES = 100 uIDC          // 每 100 字节手续费（0.0001 IDC）
```

**发行曲线**：
- **Era 0（0-10 年）**：15.87 IDC/区块 → 约 5 亿 IDC
- **Era 1（10-20 年）**：7.94 IDC/区块 → 约 2.5 亿 IDC
- **Era 2（20-30 年）**：3.97 IDC/区块 → 约 1.25 亿 IDC
- ... 以此类推，每个 Era 减半
- **Era 9（90-100 年）**：0.031 IDC/区块 → 约 1000 万 IDC
- **100 年后**：不再挖新币，只靠手续费激励

### 修改配置

#### 调整挖矿难度

修改 `initialDifficulty`：
- **降低难度**（测试用）：设置为 `1` 或 `2`，挖矿更快
- **提高难度**（生产用）：设置为 `3` 或更高，挖矿更慢但更安全
- **注意**：难度会根据实际出块时间自动调整，保持约 10 秒出块

#### 调整出块时间

修改 `targetBlockTime`：
- 默认 `10` 秒
- 可以调整为 `5` 秒（更快）或 `20` 秒（更慢）
- **注意**：修改后需要同步修改 `IDC_BLOCKS_PER_ERA`（在 `idcEmission.ts` 中）

#### 调整轻节点窗口

修改 `lightNodeWindow`：
- 默认 `200` 个区块
- 设置为 `0` 或 `undefined` 禁用轻节点模式（保留所有区块）
- 设置为更大的值（如 `500`）保留更多区块
- **极端裁剪**：设置为 `1-20` 实现极端裁剪（Phase 15），只保留最近几个区块

#### 调整快照频率

修改 `snapshotInterval`：
- 默认每 `50` 个区块生成一次快照
- 更小的值（如 `20`）更频繁，但占用更多存储
- 更大的值（如 `100`）更少，但启动时可能需要重放更多区块

#### 调整发行模型（高级）

如需修改发行模型，编辑 `src/core/idcEmission.ts`：

1. **修改总量**：
   ```typescript
   IDC_MAX_SUPPLY = 1_000_000_000n * 10n ** BigInt(IDC_DECIMALS)
   ```

2. **修改 Era 数量**：
   ```typescript
   IDC_ERA_COUNT = 10  // 改为其他值，如 20（200 年）
   ```

3. **修改基础奖励**：
   ```typescript
   IDC_BASE_REWARD = 15_870_394n  // 调整 Era 0 的奖励
   ```

4. **修改手续费**：
   ```typescript
   IDC_BASE_FEE = 1_000n           // 基础手续费
   IDC_FEE_PER_100_BYTES = 100n    // 每 100 字节手续费
   ```

**警告**：修改发行模型会影响所有节点，需要所有节点同步更新代码。

### 信令服务器配置

#### 本地开发模式（Dev Mode）

本地信令服务器默认监听 `8080` 端口，可以在 `signaling-server-example.js` 中修改：

```javascript
const PORT = 8080; // 修改为你想要的端口
```

#### 部署公网信令服务器（主网模式）

要实现"所有用户一起挖同一条链"，需要部署一个公网可访问的信令服务器。

**方案一：VPS 部署（推荐）**

1. **选择 VPS 提供商**：
   - DigitalOcean（$5/月）
   - Vultr（$5/月）
   - 阿里云 / 腾讯云（按需付费）

2. **部署步骤**：
   ```bash
   # 1. 在 VPS 上安装 Node.js
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # 2. 克隆项目（或只上传 signaling-server-example.js）
   git clone <your-repo>
   cd IndexerChain
   
   # 3. 安装依赖
   npm install ws
   
   # 4. 使用 PM2 或 systemd 保持运行
   npm install -g pm2
   pm2 start signaling-server-example.js --name indexerchain-signaling
   pm2 save
   pm2 startup  # 设置开机自启
   ```

3. **配置域名和 SSL**：
   - 使用 Nginx 反向代理：
     ```nginx
     server {
         listen 443 ssl;
         server_name signal.indexerchain.io;
         
         ssl_certificate /path/to/cert.pem;
         ssl_certificate_key /path/to/key.pem;
         
         location / {
             proxy_pass http://localhost:8080;
             proxy_http_version 1.1;
             proxy_set_header Upgrade $http_upgrade;
             proxy_set_header Connection "upgrade";
             proxy_set_header Host $host;
         }
     }
     ```
   - 或使用 Cloudflare Tunnel（免费，自动 SSL）

4. **更新 UI 默认配置**：
   在 `src/ui/App.tsx` 中修改：
   ```typescript
   const DEFAULT_MAINNET_SIGNALING = "wss://signal.indexerchain.io";
   ```

**方案二：Cloudflare Workers（未来支持）**

Cloudflare Workers 现在支持 WebSocket，可以部署无服务器信令服务：

```javascript
// workers/signaling-server.js
export default {
  async fetch(request, env) {
    // WebSocket upgrade handling
    // ... (实现信令逻辑)
  }
}
```

**重要说明**：
- 信令服务器**仅用于 WebRTC 连接建立**，不存储任何区块链数据
- 区块链数据（区块、交易）**完全通过 WebRTC DataChannel 传输**，不经过信令服务器
- 即使信令服务器被攻破，也无法影响链的安全性
- 信令服务器只负责"介绍节点给彼此认识"，之后节点之间直接通过 WebRTC 通信

### 部署到 Cloudflare Pages（生产环境）

#### 1. 构建项目

```bash
npm run build
```

构建产物在 `dist/` 目录。

#### 2. 部署到 Cloudflare Pages

**方式一：通过 Cloudflare Dashboard（推荐）**
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 "Pages" → "Create a project"
3. 连接你的 Git 仓库（GitHub/GitLab）
4. 构建设置：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`（项目根目录）
5. 点击 "Save and Deploy"
6. 等待构建完成，获得 `*.pages.dev` 域名

**方式二：通过 Wrangler CLI**
```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 部署
wrangler pages deploy dist --project-name=indexerchain
```

#### 3. 配置自定义域名（可选）

在 Cloudflare Pages 项目中：
1. 进入 "Custom domains"
2. 添加你的域名（如 `indexerchain.io`）
3. Cloudflare 会自动配置 DNS 和 SSL 证书

#### 4. 性能优化

Cloudflare Pages 自动提供：
- ✅ **全球 CDN 加速**：用户从最近的边缘节点加载
- ✅ **自动 HTTPS**：免费 SSL 证书
- ✅ **边缘缓存**：静态资源自动缓存
- ✅ **自动压缩**：gzip/brotli 压缩
- ✅ **HTTP/2 和 HTTP/3**：现代协议支持

#### 5. 未来扩展：Cloudflare Worker 信令服务器（可选）

未来可以将信令服务器迁移到 Cloudflare Worker，实现：
- ✅ 无需本地运行 `ws://localhost:8080`
- ✅ 全球低延迟信令服务
- ✅ 自动扩缩容
- ✅ 仍然不存储任何区块链数据

**注意**：即使使用 Cloudflare Worker 信令，区块链数据仍然通过 WebRTC 直接传输，保持完全去中心化。

#### 6. 部署检查清单

部署后验证：
- ✅ 前端应用正常加载
- ✅ 可以创建交易
- ✅ 可以开始挖矿
- ✅ P2P 网络可以连接（需要本地信令服务器或 Cloudflare Worker 信令）
- ✅ 所有功能在浏览器中正常运行

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
3. **检查奖励金额**：
   - 查看 "Chain Status" 中的 "Block Reward (next)" 了解当前 Era 的奖励
   - Era 0 约 15.87 IDC，Era 1 约 7.94 IDC，以此类推
   - 奖励 = 区块奖励 + 手续费
4. **刷新页面**：重新加载链状态
5. **检查地址**：确认 "Node Identity" 中的地址是正确的
6. **查看总发行量**：在 "Chain Status" 中查看 "Total Minted" 是否增加

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

**当前版本**：Phase 16 Complete

**架构状态**：✅ **完全符合 Browser-native Blockchain 最佳实践**

### 架构评估

✅ **功能性**：所有 Phase 1-16 功能完全兼容  
✅ **安全性**：Zero-trust 架构，信令服务器无法影响链安全  
✅ **性能**：毫秒级响应，所有逻辑本地执行  
✅ **可扩展性**：可平滑升级到 Cloudflare Worker 信令

### 已完成功能

- ✅ 核心链功能（区块、交易、状态）
- ✅ PoW 挖矿（Web Worker，不阻塞 UI）
- ✅ P2P 网络（WebRTC DataChannel，WebSocket 仅作信令）
- ✅ 身份和签名系统（ECDSA P-256）
- ✅ 动态难度调整
- ✅ 挖矿奖励和余额系统
- ✅ **Bitcoin-like 减半发行模型**（10 个 Era，100 年挖完 10 亿 IDC）
- ✅ **动态区块奖励**（根据 Era 自动调整）
- ✅ **交易手续费系统**（自动计入矿工奖励）
- ✅ 轻节点模式和自动修剪（支持极端裁剪）
- ✅ 状态快照和快速同步（压缩、增量、验证）
- ✅ 快照压缩（60-90% 存储减少）
- ✅ 远程快照同步（Phase 14）
- ✅ 状态承诺验证（Phase 15）

### 架构特点总结

🎯 **完全去中心化**：浏览器即节点，无中心服务器参与共识  
🎯 **零信任架构**：服务器不可被信任也不影响链安全  
🎯 **低成本部署**：Cloudflare Pages 免费，几乎 0 服务器成本  
🎯 **高性能执行**：毫秒级响应，适合 1 GHz ARM 设备  
🎯 **未来可扩展**：为可编程扩展留足空间

## 📄 许可证

MIT License

## 🙏 致谢

感谢所有为浏览器区块链技术做出贡献的开发者和研究者。
