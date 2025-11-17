# IndexerChain (IndexNet)

A lightweight blockchain that runs entirely in browsers. All browsers are nodes and miners, and the chain primarily records "index operations" (PUT, APPEND, DELETE, TRANSFER) for ordered application logs.

## 🚀 项目简介

IndexerChain 是一条完全运行在浏览器中的轻量级区块链，具有以下特点：

- **🌐 浏览器即节点**：打开网页即成为一个完整的区块链节点
- **⛏️ 浏览器挖矿**：每个浏览器都可以参与 PoW 挖矿
- **🔐 身份与签名**：基于 ECDSA P-256 的完整身份和签名系统
- **💰 原生代币 IDC**：内置挖矿奖励和转账功能
- **📡 P2P 网络**：浏览器之间通过 WebRTC 直接通信
- **📊 动态难度调整**：自动调整挖矿难度，保持稳定的出块速度
- **💾 本地存储**：使用 localStorage 持久化链数据

## ✨ 核心功能

### Phase 1-7 已实现功能

1. **核心数据结构**：区块、交易、操作类型定义
2. **加密工具**：SHA-256 哈希、Merkle 树、区块哈希
3. **链存储**：localStorage 持久化存储
4. **索引状态机**：按顺序应用操作，维护全局状态
5. **PoW 挖矿**：浏览器内进行工作量证明挖矿
6. **P2P 网络**：WebSocket + WebRTC 点对点通信
7. **身份系统**：ECDSA P-256 密钥对、地址生成
8. **签名验证**：所有交易必须签名，全网验证
9. **动态难度**：根据出块时间自动调整难度
10. **挖矿奖励**：每个区块奖励 10 IDC
11. **余额系统**：原生代币 IDC 的余额管理
12. **转账功能**：支持地址间 IDC 转账

## Architecture

- **core/**: Core types, crypto utilities, and Merkle tree
- **node/**: Node components (storage, state, mempool, miner, network) - *Coming in Phase 2+*
- **ui/**: React UI components

## Development Status

**Phase 7 Complete**: Full browser blockchain with mining rewards and balance system!

### Completed Phases

**Phase 1**: Core types, crypto tools, and Merkle tree
- ✅ Type definitions (Operation, Tx, BlockHeader, Block, ChainParams)
- ✅ Crypto utilities using Web Crypto API (sha256, hashBlockHeader)
- ✅ Merkle tree root calculation

**Phase 2**: Chain storage and index state
- ✅ ChainStorage with localStorage persistence
- ✅ IndexState for applying operations
- ✅ Genesis block generation
- ✅ Chain initialization

**Phase 3**: Mining and block production
- ✅ PoW mining in browser
- ✅ Transaction creation and mempool
- ✅ Block building and verification
- ✅ Automatic state updates

**Phase 4**: P2P networking
- ✅ WebSocket signaling server client
- ✅ WebRTC DataChannel peer-to-peer connections
- ✅ Block and transaction broadcasting
- ✅ Chain synchronization
- ✅ Multi-node network support

**Phase 5**: Identity and signatures
- ✅ ECDSA P-256 key pair generation and management
- ✅ Address derivation from public keys
- ✅ Transaction signing and verification
- ✅ Signature validation in mempool, P2P, and block verification
- ✅ Node identity display and persistence

**Phase 6**: Dynamic difficulty adjustment
- ✅ Automatic difficulty adjustment based on block times
- ✅ Target block time stabilization (10 seconds)
- ✅ Difficulty verification to prevent forgery
- ✅ Smooth adjustment with ±20% limit per interval
- ✅ UI display of difficulty status and statistics

**Phase 7**: Mining rewards and balances
- ✅ Native token IDC (IndexerCoin)
- ✅ Automatic mining rewards (10 IDC per block)
- ✅ Balance system stored in IndexState
- ✅ Transfer operations (TRANSFER)
- ✅ Balance verification to prevent negative balances
- ✅ Coinbase transaction validation
- ✅ UI balance display and transfer interface

### Next Steps (Future Phases)
- Access control (address-based permissions)
- WebAuthn integration
- State compression and snapshots
- Cross-chain binding

## 🚀 快速开始

### 前置要求

- Node.js 16+ 
- npm 或 yarn
- 现代浏览器（支持 Web Crypto API、WebRTC）

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

### 使用指南

#### 创建交易

1. **索引操作（PUT/APPEND/DELETE）**：
   - 选择操作类型
   - 输入命名空间（namespace）
   - 输入键（key）
   - 输入值（value，DELETE 不需要）
   - 点击 "Create Transaction"

2. **转账操作（TRANSFER）**：
   - 在 "Transfer IDC" 部分
   - 输入接收者地址（格式：`idc_...`）
   - 输入转账金额
   - 点击 "Transfer IDC"

#### 挖矿

1. 确保有待处理的交易（Pending Transactions）
2. 点击 "Start Mining" 开始挖矿
3. 挖矿成功后，矿工将自动获得 10 IDC 奖励
4. 余额会在 "Node Identity" 部分显示

#### 查看链状态

- **Chain Status**：显示当前链高度、区块数量、待处理交易数
- **Difficulty Status**：显示当前难度、目标出块时间、平均出块时间
- **Node Identity**：显示节点地址和 IDC 余额
- **Latest Block**：显示最新区块的详细信息

### 其他命令

```bash
# 构建生产版本
npm run build

# TypeScript 类型检查
npm run type-check

# 预览生产构建
npm run preview
```

### 多节点测试

1. 启动信令服务器（一个实例即可）
2. 在多个浏览器窗口/标签页中打开应用
3. 每个窗口都连接到同一个信令服务器
4. 在一个窗口中创建交易或挖矿
5. 其他窗口会自动同步区块和交易

### 故障排除

#### 无法连接到信令服务器

- 确认信令服务器正在运行
- 检查 URL 是否正确（`ws://localhost:8080`）
- 检查防火墙设置
- 查看浏览器控制台的错误信息

#### 余额不更新

- 确认区块已成功挖出
- 检查交易是否包含在区块中
- 刷新页面重新加载链状态

#### 挖矿很慢

- 这是正常的，PoW 挖矿需要时间
- 难度越高，挖矿时间越长
- 可以降低初始难度进行测试（修改 `src/core/chain.ts` 中的 `initialDifficulty`）

## Design Principles

1. **No dependency on other chains** - Completely independent blockchain
2. **Browser as node & miner** - Open webpage = start a light node
3. **Index + ordered log only** - Chain records ordered operation stream
4. **No contracts, no complex VM** - Protocol defines only a few Operation types (PUT, APPEND, DELETE)

## 📖 协议说明

### 操作类型（Operation Types）

- **PUT**：写入一个键值对（覆盖已存在的值）
- **APPEND**：在已有值后追加内容（字符串拼接）
- **DELETE**：删除一个键
- **TRANSFER**：转账 IDC 代币（Phase 7）

### PoW 挖矿规则

- **哈希算法**：`sha256(JSON.stringify(headerWithoutNonce) + nonce)`
- **难度要求**：哈希前缀必须有 `difficulty` 个十六进制 0
- **示例**：`difficulty=3` → 哈希必须以 `000` 开头
- **动态调整**：每 10 个区块根据实际出块时间调整难度

### 区块结构

```typescript
Block {
  header: {
    version: number
    height: number
    prevHash: string
    merkleRoot: string
    timestamp: number
    difficulty: number  // 动态难度
    nonce: number
  }
  txs: Transaction[]  // 第一笔必须是 coinbase
  hash: string
}
```

### 交易结构

```typescript
Transaction {
  txId: string
  ownerAddress: Address  // 发送者地址
  ownerPubKey: SerializedPublicKey
  signature: string  // ECDSA 签名
  ops: Operation[]
  timestamp: number
}
```

### 地址格式

- 格式：`idc_` + 40 个十六进制字符
- 示例：`idc_a3f92b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0`
- 生成：从公钥 JWK 的 SHA-256 哈希推导

### 挖矿奖励

- **奖励金额**：每个区块 10 IDC（可配置）
- **奖励方式**：自动创建 coinbase 交易
- **接收者**：挖出区块的矿工地址

### 难度调整

- **调整间隔**：每 10 个区块调整一次
- **目标时间**：10 秒出块
- **调整幅度**：单次最多 ±20%
- **最小难度**：1

## 🏗️ 项目结构

```
IndexerChain/
├── src/
│   ├── core/           # 核心功能模块
│   │   ├── types.ts    # 类型定义
│   │   ├── crypto.ts   # 加密工具
│   │   ├── merkle.ts   # Merkle 树
│   │   ├── chainStorage.ts  # 链存储
│   │   ├── indexState.ts    # 索引状态机
│   │   ├── genesis.ts       # 创世块
│   │   ├── tx.ts            # 交易工具
│   │   ├── mempool.ts       # 交易池
│   │   ├── blockBuilder.ts  # 区块构建
│   │   ├── miner.ts         # 挖矿
│   │   ├── verify.ts        # 区块验证
│   │   ├── chain.ts         # 链管理
│   │   ├── keys.ts          # 密钥管理
│   │   ├── signatures.ts    # 签名工具
│   │   ├── txCodec.ts       # 交易编码
│   │   ├── difficulty.ts    # 难度调整
│   │   ├── p2p.ts           # P2P 网络
│   │   └── sync.ts          # 链同步
│   └── ui/
│       └── App.tsx          # React UI
├── signaling-server-example.js  # 信令服务器示例
├── start-server.sh          # 启动脚本（Mac/Linux）
├── start-server.bat        # 启动脚本（Windows）
└── package.json
```

## 🔧 技术栈

- **前端框架**：React + TypeScript
- **构建工具**：Vite
- **加密**：Web Crypto API（ECDSA P-256, SHA-256）
- **网络**：WebSocket + WebRTC
- **存储**：localStorage
- **共识**：PoW（Proof of Work）

## 📝 开发路线图

### 已完成（Phase 1-7）

✅ 核心类型和数据结构  
✅ 链存储和状态机  
✅ PoW 挖矿  
✅ P2P 网络  
✅ 身份和签名系统  
✅ 动态难度调整  
✅ 挖矿奖励和余额系统  

### 计划中

- Phase 8: 访问控制（基于地址的权限）
- Phase 9: WebAuthn 集成
- Phase 10: 状态压缩和快照
- Phase 11: 交易手续费系统
- Phase 12: 跨链绑定

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

感谢所有为浏览器区块链技术做出贡献的开发者和研究者。
