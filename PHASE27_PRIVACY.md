# Phase 27: Privacy Foundation Layer

## 概述

Phase 27 实现了 IndexerChain 的隐私基础架构，为未来 ZK 版本做准备。本阶段不引入重型 ZK，但提供了完整的隐私基础设施。

## 已实现功能

### 1. Stealth Address（一次性地址）✅

**文件**: `src/core/privacy/stealthAddress.ts`

- 实现了 Monero-style 的一次性地址系统
- 每个交易使用唯一的 one-time address
- 外部观察者无法将交易链接到同一接收者
- 支持生成和验证 stealth address

**主要函数**:
- `generateStealthAddress()`: 为接收者生成一次性地址
- `checkStealthAddress()`: 检查地址是否属于当前钱包

### 2. Commitment（金额隐藏）✅

**文件**: `src/core/privacy/commitment.ts`

- 实现了简化的 Pedersen Commitment
- 使用 SHA-256 哈希：`C = sha256(amount || random || "commitment")`
- 隐藏金额，同时允许验证

**主要函数**:
- `createCommitment()`: 创建 commitment
- `verifyCommitment()`: 验证 commitment
- `generateRandom()`: 生成随机盲化因子

### 3. Note（隐私资产）数据结构 ✅

**文件**: `src/core/privacy/types.ts`, `src/core/privacy/noteStore.ts`

- 定义了 `Note` 接口，表示隐私池中的资产
- 本地存储在浏览器 localStorage
- 每个钱包有独立的 note store

**主要功能**:
- 添加/删除 notes
- 计算隐私余额
- 按 commitment 查找 notes

### 4. Nullifier（防止双花）✅

**文件**: `src/core/privacy/nullifier.ts`

- 实现了 nullifier 系统防止双花
- `nullifier = sha256(random || privSpend || "nullifier")`
- 链上存储 nullifier set

**主要函数**:
- `generateNullifier()`: 生成 nullifier
- `createNullifier()`: 创建 nullifier 对象
- `verifyNullifier()`: 验证 nullifier 未被使用

### 5. Operation 类型扩展 ✅

**文件**: `src/core/types.ts`

- 添加了 `SHIELDED_TRANSFER` 操作类型
- 扩展了 `Operation` 接口，支持：
  - `commitment`: Commitment 值
  - `nullifier`: Nullifier 值（防止双花）
  - `oneTimePublic`: 一次性公钥
  - `ephemeralPub`: 临时公钥
  - `proof`: ZK proof（Phase Z2，当前为可选）

### 6. IndexState 隐私支持 ✅

**文件**: `src/core/indexState.ts`

- 添加了 `commitments` Map 和 `nullifierSet` Set
- 实现了 `applyShieldedTransfer()` 方法
- 支持从快照恢复 commitments 和 nullifiers
- 提供了查询方法：
  - `isNullifierUsed()`: 检查 nullifier 是否已使用
  - `getCommitments()`: 获取所有 commitments
  - `getNullifierSet()`: 获取 nullifier set

### 7. 隐私转账创建 ✅

**文件**: `src/core/privacy/shieldedTransfer.ts`

- 实现了 `createShieldedTransferOp()` 函数
- 支持创建隐私转账操作
- 实现了 `scanShieldedTransaction()` 用于扫描接收的交易
- 实现了 `createNote()` 用于创建本地 note

## 架构设计

### 隐私池命名空间

所有隐私相关的状态存储在以下命名空间：

- `shielded_pool`: 存储 commitments（key = commitment, value = oneTimePublic）
- `nullifiers`: 存储已使用的 nullifiers（key = nullifier, value = "1"）

### 数据流

1. **发送隐私转账**:
   - 创建 commitment（隐藏金额）
   - 生成 nullifier（如果花费 note）
   - 生成 stealth address（隐藏接收者）
   - 创建 `SHIELDED_TRANSFER` 操作

2. **接收隐私转账**:
   - 扫描交易中的 stealth address
   - 使用 view key 验证是否属于自己
   - 创建本地 note（存储金额和 random）

3. **链上验证**:
   - 检查 nullifier 是否已使用（防止双花）
   - 存储 commitment
   - 更新 nullifier set

## 与现有系统的兼容性

✅ **完全兼容**:
- PoW 挖矿
- Finality 系统
- P2P 网络
- 快照系统
- 状态承诺（stateCommitment）

隐私交易作为新的操作类型，不影响现有功能。

## 下一步（Phase Z2）

1. **ZK Proof 集成**:
   - 实现轻量级 ZK 系统（Halo2/Plonk）
   - 证明 commitment 正确性
   - 证明 nullifier 有效性

2. **金额加密**:
   - 使用 view key 加密金额和 random
   - 只有接收者可以解密

3. **UI 支持**:
   - 隐私转账表单
   - 隐私余额显示
   - Note 管理界面

## 安全说明

⚠️ **Phase 27 是基础层，提供部分隐私保护**:

- ✅ 地址隐私（Stealth Address）
- ✅ 金额隐藏（Commitment）
- ✅ 双花防护（Nullifier）
- ⚠️ 金额和 random 当前未加密（Phase Z2 将实现）
- ⚠️ 无 ZK proof（Phase Z2 将实现）

## 使用示例

```typescript
// 创建隐私转账
const op = await createShieldedTransferOp(
  fromNotes, // 输入 notes（可选）
  toAmount, // 输出金额
  recipientPubView, // 接收者公钥
  recipientPubSpend,
  ownerAddress,
  nonce,
  privSpend // 发送者私钥
);

// 扫描接收的交易
const notes = await scanShieldedTransaction(tx, keys);

// 管理 notes
const noteStore = getNoteStore(walletId);
noteStore.addNote(note);
const balance = noteStore.getShieldedBalance();
```

## 文件结构

```
src/core/privacy/
├── types.ts              # 类型定义
├── stealthAddress.ts     # Stealth Address 系统
├── commitment.ts         # Commitment 系统
├── nullifier.ts          # Nullifier 系统
├── noteStore.ts          # Note 存储
├── stealthKeys.ts        # Stealth Keys 管理
└── shieldedTransfer.ts   # 隐私转账创建
```

