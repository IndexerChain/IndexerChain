# Phase 45: Mining UX 1.0 - 挖矿体验界面

## 概述

Phase 45 实现了完整的挖矿体验界面，让普通用户能够：
- ✅ 一眼看懂：我现在能不能挖？为什么？
- ✅ 挖到多少：当前区块奖励是多少？我的倍率是多少？
- ✅ 怎么变多：清晰告诉用户如何提高奖励（邀请 / 连续在线 / 信誉分等）
- ✅ 设备 & IP 限制要讲清楚：防止用户觉得"项目在暗扣"

## 一、新增组件

### 1. MiningStatusBar（状态总览条）

**位置**：Mining Tab 最顶部

**功能**：
- 显示挖矿状态（🟢 正在挖矿 / 🟡 等待条件 / 🔴 无法挖矿）
- 显示当前高度（Local / Network）
- 显示挖矿钱包地址
- 显示 Active Miner 状态（来自 Shadow Node）
- 点击"详情"按钮跳转到 Network Tab

**文件**：`src/ui/mining/MiningStatusBar.tsx`

### 2. RewardBreakdownCard（奖励计算说明卡片）

**位置**：MiningStatusBar 之后，MiningMainCard 之前

**功能**：
- 显示预期区块奖励的完整拆解
- 基础区块奖励
- 全局乘数（IP信誉 × Session时长 × ActiveBooster，封顶3.0x）
- IP共享权重（同IP多设备衰减）
- 邀请奖励（一级/二级）
- 预期总奖励

**交互**：
- 默认显示摘要模式（基础奖励 / 总乘数 / 预期总奖励）
- 点击"展开详情"显示完整拆解

**文件**：`src/ui/mining/RewardBreakdownCard.tsx`

### 3. ReferralAndBoosterCard（邀请 & 裂变收益卡片）

**位置**：RewardBreakdownCard 之后

**功能**：
- **邀请收益总览**：
  - 累计一级邀请奖励（已占总量百分比，上限1%）
  - 累计二级邀请奖励（已占总量百分比，上限0.5%）
- **邀请状态**：
  - 邀请码 / 邀请链接
  - 有效邀请人数（满足在线 ≥ 60 分钟 + 挖出 ≥ 1 块）
  - 待激活邀请（还未满足有效条件）
- **ActiveBooster 进度**：
  - 今日是否签到
  - 连续挖矿天数
  - 下一个档位提示
  - 当前年份对应的 ActiveBooster 上限
- **玩法提示**：
  - 邀请真实矿工，长期在线收益更高
  - 同一 IP 多设备挖矿只会摊薄收益
  - 连续挖矿越久，ActiveBooster 倍率越高

**文件**：`src/ui/mining/ReferralAndBoosterCard.tsx`

### 4. NetworkMiniHealthCard（简化版网络状态）

**位置**：MiningLiveStatsCard 之后

**功能**：
- 只显示与挖矿直接相关的关键状态：
  - 🛡 Quorum Score（当前/阈值）
  - 🔗 独立节点数
  - 🔐 Finality 状态（Initialization/Normal）
  - 📡 StateLock 状态（Early/Locked）
- 如果状态导致不能挖矿，会显示相应提示

**文件**：`src/ui/mining/NetworkMiniHealthCard.tsx`

## 二、Mining Tab 布局结构

```
Mining Tab
├── MiningStatusBar（状态总览条）
│   ├── 挖矿状态（颜色+图标）
│   ├── 当前高度（Local/Network）
│   ├── 挖矿钱包地址
│   └── Active Miner 状态
│
├── RewardBreakdownCard（奖励计算说明）
│   ├── 摘要模式（默认）
│   └── 详情模式（可展开）
│
├── ReferralAndBoosterCard（邀请 & 裂变收益）
│   ├── 邀请收益总览
│   ├── 邀请状态
│   ├── ActiveBooster 进度
│   └── 玩法提示
│
├── MiningMainCard（挖矿控制）
│   ├── Start Solo Mining
│   ├── Start Cluster Mining
│   └── Stop Mining
│
├── MiningLiveStatsCard（实时挖矿统计，挖矿时显示）
│
└── NetworkMiniHealthCard（简化版网络状态）
    ├── Quorum Score
    ├── 独立节点数
    ├── Finality 状态
    └── StateLock 状态
```

## 三、用户体验改进

### 1. 清晰的状态展示

- **MiningStatusBar** 提供一目了然的状态总览
- 颜色编码：🟢 可以挖 / 🟡 受限 / 🔴 不能挖
- 主因直接显示在状态条上

### 2. 透明的奖励计算

- **RewardBreakdownCard** 完整展示奖励构成
- 用户可以清楚看到：
  - 基础奖励是多少
  - 每个倍率是怎么来的
  - IP共享权重如何影响奖励
  - 邀请奖励如何计算

### 3. 明确的提升路径

- **ReferralAndBoosterCard** 告诉用户如何提高奖励：
  - 邀请真实矿工
  - 保持连续在线
  - 提高 IP 信誉分
  - 避免同 IP 多设备

### 4. 设备 & IP 限制说明

- **MiningStatusBar** 显示 Active Miner 状态
- **RewardBreakdownCard** 显示 IP 共享权重
- **ReferralAndBoosterCard** 提示同 IP 多设备的影响

## 四、技术实现

### 数据来源

1. **MiningStatusBar**：
   - `MiningGuard.canMineNow()` - 挖矿状态检查
   - `ShadowNodeClient.getActiveMinerId()` - Active Miner 状态
   - `ChainContext.storage.getTip()` - 当前高度

2. **RewardBreakdownCard**：
   - `getBlockRewardRaw()` - 基础区块奖励
   - `calculateMiningReward()` - IP信誉 + Session时长倍率
   - `getActiveBoosterTracker()` - ActiveBooster 倍率
   - `getIPSharingTracker()` - IP共享权重
   - `getReferralSystem()` - 邀请奖励

3. **ReferralAndBoosterCard**：
   - `getReferralSystem()` - 邀请统计
   - `getActiveBoosterTracker()` - ActiveBooster 进度
   - `IDC_MAX_SUPPLY` - 邀请奖励封顶计算

4. **NetworkMiniHealthCard**：
   - `MiningGuard.canMineNow()` - 挖矿状态
   - `getQuorumManager()` - Quorum Score
   - `FinalityManager` - Finality 状态

### 实时更新

- 所有组件每 5-10 秒自动更新数据
- 使用 `useEffect` + `setInterval` 实现
- 组件卸载时自动清理定时器

## 五、与现有功能的集成

### 保持兼容

- ✅ 所有现有功能完全兼容
- ✅ 不修改挖矿内核逻辑
- ✅ 只在 UI 层读取状态并展示

### 集成点

1. **MiningMainCard**：
   - 保持原有功能
   - 新组件在前后提供补充信息

2. **MiningGuard**：
   - 新组件读取 `MiningGuard.canMineNow()` 结果
   - 显示详细的失败原因

3. **Shadow Node**：
   - `MiningStatusBar` 显示 Active Miner 状态
   - 与 Phase 44 的设备限制机制集成

## 六、后续优化建议

### 1. 挖矿控制区增强

- 在点击 Start 按钮时，如果 `MiningGuard.canMineNow()` 返回 false，弹出原因列表对话框
- 集成 `ActiveMinerDialog`：当 Shadow Node 显示已有 activeMinerId 且不是本设备时，弹窗提示并允许"强制接管"

### 2. 奖励计算优化

- 添加交易手续费预估（从 mempool 计算）
- 添加邀请奖励的实时追踪（需要持久化存储）

### 3. 用户体验优化

- 添加动画效果（奖励数字变化）
- 添加工具提示（hover 显示详细说明）
- 移动端适配优化

## 七、总结

Phase 45 实现了完整的挖矿体验界面，让普通用户能够：

✅ **一眼看懂** - MiningStatusBar 提供清晰的状态总览  
✅ **挖到多少** - RewardBreakdownCard 完整展示奖励构成  
✅ **怎么变多** - ReferralAndBoosterCard 提供明确的提升路径  
✅ **限制说明** - 所有组件都清楚说明设备 & IP 限制  

这套 UX 设计在保持技术准确性的同时，大大提升了用户体验，让复杂的代币经济学变得易于理解。

---

**文档版本**：v1.0  
**创建日期**：2024  
**最后更新**：2024

