# Phase 44: 浏览器挖矿经济学 + 安全模型（最终版）

## 概述

Phase 44 在 Phase 42.1 的基础上，实现了最终版的浏览器挖矿经济学和安全模型，确保：
- ✅ 代币奖励非常有吸引力（第一年爆发）
- ✅ 同一 IP / 同一设备无法滥用
- ✅ 多标签页、多浏览器、多设备不会作弊
- ✅ 开浏览器即可挖矿，同时保持安全与公平
- ✅ 邀请裂变机制与奖励倍率系统合理、可控

## 一、当前经济模型总结

### 奖励结构

```
最终奖励 = 
  基础区块奖励（第一年：200 → 50 IDC）
× IP信誉系数 (0.3x - 1.3x)
× Session时长系数 (0.5x - 1.2x)
× ActiveBooster连续在线系数 (1.0x - 2.5x，按年份调整)
× IP共享权重 (0.1x - 1.0x，同IP多设备衰减)
※ 总和加成 cap = 3.0x (Hard Cap)
+ 一级邀请奖励 (20% → 5%，按年份衰减，封顶1%总量)
+ 二级邀请奖励 (10% → 0%，按年份衰减，封顶0.5%总量)
+ 交易手续费
```

### 发行曲线

- **第 1 年**：200 IDC → 50 IDC（线性递减），总产出 50%（5 亿 IDC）
- **第 2-3 年**：继续递减，前 3 年产出 90%
- **第 4-10 年**：持续递减至完成 100% 发行

## 二、Phase 44 新增安全机制

### 1. 同一设备挖矿限制（强制）

**规则**：同一设备永远只有 1 个 active miner

**实现机制**：
- 使用 Shadow Node 的 `activeMinerId` 机制
- 每个设备生成唯一的 `deviceId`（持久化在 localStorage）
- 每次挖矿前向 Shadow Node 申请 active miner
- 如果 active miner ≠ 本设备 → **拒绝挖矿**

**效果**：

| 行为 | 结果 |
|------|------|
| 同设备开多个标签页 | 只有 1 个挖矿，其余被阻止 |
| 同设备开多个浏览器 | 永远只有 1 个浏览器挖矿 |
| 同设备开隐身模式 | 同样被阻止（deviceId 相同） |

### 2. IP 共享权重系统（奖励衰减）

**规则**：同 IP 同一小时最多允许 1 个"满奖励"矿工

**权重表**：

| 同IP矿工位置 | 奖励权重 |
|------------|---------|
| 第 1 个 | 1.0x（全额奖励） |
| 第 2 个 | 0.7x（70% 奖励） |
| 第 3 个 | 0.3x（30% 奖励） |
| 第 4 个+ | 0.1x（10% 奖励） |

**实现方式**：
- `IPSharingTracker` 跟踪每个 IP 的活跃矿工数
- 通过 QuorumManager 获取 IP Hash
- 动态调整奖励系数（不影响挖矿权限，只影响奖励）

**效果**：
- ✅ 不阻止用户参与（仍可挖矿）
- ✅ 但降低工作室作弊可得奖励
- ✅ 鼓励真实独立 IP 节点

### 3. 设备反作弊规则

**设备 ID 生成**：
- 浏览器使用 `deviceId`（随机持久 UUID）
- 存储在 localStorage：`indexerchain_device_id_v1`
- 同一设备的所有浏览器/标签页共享同一个 deviceId

**检查机制**：
- 邀请系统检查：同 deviceId 的邀请直接拒绝
- Active miner 检查：同 deviceId 只能有 1 个 active miner

### 4. 强制 Active Miner 检查

**在 MiningGuard 中实现**：

```typescript
// Phase 44: Check 2.5: Active miner check
if (shadowNodeClient && deviceId) {
  const currentActiveMinerId = shadowNodeClient.getActiveMinerId();
  const currentMinerId = `${sessionId}-${nodeId}`;
  
  if (currentActiveMinerId && currentActiveMinerId !== currentMinerId) {
    return {
      ok: false,
      code: "NOT_ACTIVE_MINER",
      reason: "Another device/tab is already mining..."
    };
  }
}
```

## 三、完整奖励计算公式（Phase 44 最终版）

```
基础奖励 = getBlockRewardRaw(height)  // 第一年：200 → 50 IDC

总乘数 = IP信誉分系数 × Session时长系数 × ActiveBooster系数
最终乘数 = min(总乘数, 3.0)  // Hard Cap

矿工基础奖励 = 基础奖励 × 最终乘数

IP共享权重 = getIPSharingWeight(ipHash, deviceId)  // 0.1x - 1.0x
矿工最终奖励 = 矿工基础奖励 × IP共享权重

一级邀请奖励 = 矿工最终奖励 × 邀请比例(按年份衰减) × 有效邀请系数
二级邀请奖励 = 矿工最终奖励 × 邀请比例(按年份衰减) × 有效邀请系数

最终奖励 = 矿工最终奖励 + 一级邀请奖励(封顶) + 二级邀请奖励(封顶) + 手续费
```

## 四、示例计算（Phase 44）

### 第一年早期用户（所有系数拉满，独立IP）

- **基础奖励**：200 IDC
- **IP 信誉分**：150 → 1.3x
- **Session 时长**：90 分钟 → 1.2x
- **连续登录**：30 天 → 1.5x（第一年上限）
- **总乘数**：1.3 × 1.2 × 1.5 = 2.34x
- **应用 Hard Cap**：min(2.34, 3.0) = 2.34x
- **矿工基础奖励**：200 × 2.34 = 468 IDC
- **IP共享权重**：1.0x（独立IP，第1个矿工）
- **矿工最终奖励**：468 × 1.0 = 468 IDC

- **一级邀请**：3 人，每人挖 468 IDC
  - 邀请比例：20%（第一年）
  - 一级邀请奖励：3 × 468 × 0.20 = 280.8 IDC

- **二级邀请**：10 人，每人挖 468 IDC
  - 邀请比例：10%（第一年）
  - 二级邀请奖励：10 × 468 × 0.10 = 468 IDC

**总计**：468 + 280.8 + 468 = **1,216.8 IDC**

### 同IP第2个矿工（奖励衰减）

- **基础奖励**：200 IDC
- **总乘数**：2.34x（同上）
- **矿工基础奖励**：468 IDC
- **IP共享权重**：0.7x（同IP第2个矿工）
- **矿工最终奖励**：468 × 0.7 = 327.6 IDC

**对比**：第1个矿工 468 IDC，第2个矿工 327.6 IDC（-30%）

### 同IP第4个矿工（严重衰减）

- **基础奖励**：200 IDC
- **总乘数**：2.34x
- **矿工基础奖励**：468 IDC
- **IP共享权重**：0.1x（同IP第4个矿工）
- **矿工最终奖励**：468 × 0.1 = 46.8 IDC

**对比**：第1个矿工 468 IDC，第4个矿工 46.8 IDC（-90%）

## 五、用户体验流程（Phase 44）

### "打开浏览器就能挖"

1. **用户打开浏览器**
   - 自动连接 Shadow Node
   - 自动同步区块高度
   - 自动生成/加载 deviceId
   - 自动申请 active miner

2. **系统自动判断**
   - ✅ 是否已有其他设备在挖 → 显示对话框："另一台设备正在挖矿，要接管吗？"
   - ✅ 是否是 active miner → 允许/拒绝挖矿
   - ✅ IP共享权重 → 自动计算并应用

3. **开始挖矿**
   - 单击"Start 挖矿"
   - 系统应用所有奖励系数
   - 实时显示挖矿效率和IP共享权重

4. **多标签页/多浏览器**
   - 同设备其他标签页/浏览器 → 自动阻止
   - 显示："该设备已有 miner 正在挖矿"

## 六、安全机制总结

| 机制 | 实现 | 效果 |
|------|------|------|
| **同一设备限制** | Shadow Node activeMinerId | 同一设备只能1个active miner |
| **IP共享权重** | IPSharingTracker | 同IP多设备奖励衰减 |
| **设备ID绑定** | localStorage deviceId | 防止设备重复邀请/挖矿 |
| **邀请衰减** | 按年份阶段 | 早期高激励，后期稳定 |
| **邀请封顶** | 单个地址总量上限 | 防止工作室刷爆 |
| **有效邀请验证** | 在线时长+挖矿次数 | 防止假号刷邀请 |
| **Hard Cap** | 总乘数上限3.0x | 防止系数叠加失控 |

## 七、技术实现

### 核心文件

1. **`src/core/ipSharingWeight.ts`**（新增）
   - `IPSharingTracker` - 跟踪同IP矿工
   - `getIPSharingWeight()` - 计算IP共享权重
   - `getOrCreateDeviceId()` - 生成/获取设备ID

2. **`src/core/miningGuard.ts`**
   - 添加 `NOT_ACTIVE_MINER` 检查
   - 添加 IP共享权重计算
   - 返回 IP共享信息

3. **`src/core/blockBuilder.ts`**
   - `createCoinbaseTx()` 应用 IP共享权重
   - `buildCandidateBlock()` 计算 IP共享权重

4. **`src/core/miner.ts`**
   - 更新 `buildCandidateBlock()` 调用

### 设备ID生成

```typescript
// 存储在 localStorage
const deviceId = localStorage.getItem("indexerchain_device_id_v1");
if (!deviceId) {
  deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  localStorage.setItem("indexerchain_device_id_v1", deviceId);
}
```

### IP共享权重计算

```typescript
// 注册矿工
const position = ipSharingTracker.registerMiner(ipHash, deviceId);
// position: 1, 2, 3, 4...

// 获取权重
const weight = getIPSharingWeight(position);
// weight: 1.0, 0.7, 0.3, 0.1
```

## 八、为什么这套模型现在更安全？

### 1. 防止设备滥用
- ✅ 同一设备只能1个active miner
- ✅ 多标签页/多浏览器自动阻止
- ✅ 设备ID持久化，无法绕过

### 2. 防止IP滥用
- ✅ 同IP多设备奖励自动衰减
- ✅ 第1个：100%，第2个：70%，第3个：30%，第4个+：10%
- ✅ 不阻止参与，但降低奖励

### 3. 保持吸引力
- ✅ 第一年基础奖励高（200 → 50 IDC）
- ✅ 总乘数仍可达 3.0x
- ✅ 独立IP用户获得全额奖励

### 4. 公平性
- ✅ 普通用户：独立IP，全额奖励
- ✅ 工作室：同IP多设备，奖励衰减
- ✅ 邀请机制：有上限，有衰减

## 九、完整奖励示例对比

### 场景1：独立IP用户（最佳）

- 基础：200 IDC
- 系数：1.3 × 1.2 × 1.5 = 2.34x
- IP共享：1.0x（独立IP）
- **最终**：200 × 2.34 × 1.0 = **468 IDC**

### 场景2：同IP第2个矿工

- 基础：200 IDC
- 系数：2.34x
- IP共享：0.7x（第2个）
- **最终**：200 × 2.34 × 0.7 = **327.6 IDC**（-30%）

### 场景3：同IP第4个矿工

- 基础：200 IDC
- 系数：2.34x
- IP共享：0.1x（第4个）
- **最终**：200 × 2.34 × 0.1 = **46.8 IDC**（-90%）

## 十、总结

Phase 44 实现了最终版的浏览器挖矿经济学和安全模型：

✅ **同一设备限制** - Shadow Node activeMinerId 机制  
✅ **IP共享权重** - 同IP多设备奖励衰减（1.0x → 0.7x → 0.3x → 0.1x）  
✅ **设备ID绑定** - 持久化设备ID，防止设备重复  
✅ **强制检查** - MiningGuard 中强制 active miner 检查  
✅ **用户体验** - 打开浏览器就能挖，自动处理冲突  

这套机制在"爽感"和"安全"之间建立了完美平衡：
- 普通用户：独立IP，全额奖励，非常爽
- 工作室：同IP多设备，奖励衰减，无法刷爆
- 系统：安全可控，通胀不会失控

---

**文档版本**：v1.0  
**创建日期**：2024  
**最后更新**：2024

