# IndexerChain 页面结构文档

## 整体布局

### 顶部导航栏
- **标签页切换按钮**（水平排列）
- **语言切换**（中文/英文）
- **钱包地址显示**（如果已创建）

### 主内容区
根据选中的标签页显示不同内容

---

## 标签页列表

### 1. Overview（概览）
**位置**: `activeTab === "overview"`

**主要内容**:
- **Chain Status Card（链状态卡片）**
  - 网络模式（主网/测试网）
  - 网络健康状态（健康/降级/已阻止）
  - 挖矿就绪状态（SAFE/GUARDED/LOCAL_ONLY/BLOCKED）
  - 模式描述和原因

- **Wallet Status Card（钱包状态卡片）**
  - 钱包地址（截断显示）
  - 余额（IDC）

- **Network Status Card（网络状态卡片）**
  - P2P 连接状态
  - 对等节点数量
  - 当前高度
  - 连接/断开按钮

- **Mining Status Card（挖矿状态卡片）**（如果正在挖矿）
  - 挖矿状态
  - 难度
  - 算力
  - 已尝试哈希数
  - 运行时间
  - 当前哈希
  - 当前 Nonce

- **Cluster Mining Stats（集群挖矿统计）**（如果集群挖矿）
  - 总算力
  - 活跃 Worker 数
  - 总哈希数
  - Worker 详情列表

- **Global Miner Pool（全局矿池）**（如果启用）
  - 模式（启用/禁用）
  - 角色（Delegator/Worker Node）
  - 活跃范围数
  - 总节点数
  - 全局指针

- **Phase 37: Bootstrap Debug Info（Bootstrap 调试信息）**
  - Bootstrap 完成状态
  - Signal Server RootTip（高度、Hash、更新时间）
  - Local Tip（高度、差距）
  - 同步状态警告

- **Quorum Panel（Quorum 面板）**
  - 总分/需要分数
  - 独立 Peer 数
  - 分数详情
  - 提升建议

---

### 2. Wallet（钱包）
**位置**: `activeTab === "wallet"`

**主要内容**:
- **Wallet Manager Panel（钱包管理面板）**
  - 创建新钱包
  - 导入钱包
  - 钱包列表
  - 选择挖矿钱包
  - 删除钱包

- **Wallet Backup Panel（钱包备份面板）**
  - 导出钱包
  - 导入备份

---

### 3. Mining（挖矿）⭐ Phase 38 重构
**位置**: `activeTab === "mining"`

**主要内容**:

#### Phase 38-E: 特殊状态横幅
- **Cold Start Mode Banner（冷启动模式横幅）**
  - 条件: `bootstrapComplete && peerCount === 0`
  - 提示: 网络处于冷启动阶段

- **Mainnet Admission Rules（主网准入规则）**
  - 条件: 主网 + 挖矿被阻止
  - 显示未通过的规则列表

- **Follower Mode Warning（FOLLOWER 模式警告）**
  - 条件: 主网 + FOLLOWER 角色
  - 提示: 只有 LEADER 可以挖矿

#### Phase 38-A: Mining Main Card（挖矿主卡片）
- **状态指示器**
  - 图标 + 状态文字（Ready to Mine / Limited / Not Ready）
  - 颜色编码（绿色/黄色/红色）

- **主操作按钮**
  - Start Mining / Stop Mining
  - 根据模式显示不同标签（Solo/Cluster/Global Pool）
  - 禁用时显示 Tooltip

- **快速状态提示**
  - MiningGuard 阻止原因
  - Quorum 分数详情

#### Phase 38-C: Live Stats Card（实时统计卡片）
- **当前模式**: Solo / Local Cluster / Global Pool
- **当前高度 & Tip Hash**
- **算力**: 总 hashrate
- **区块统计**: Mined / Accepted / Rejected
- **有效率**: Accepted / Mined (%)
- **警告**: 有效率 < 80% 时显示

#### Phase 38: Advanced Settings Toggle（高级设置切换）
- 按钮: "显示高级设置" / "隐藏高级设置"

#### Phase 38-B: Advanced Settings Panel（高级设置面板）
- **Mining Mode Selector（挖矿模式选择器）**
  - Solo（单机挖矿）
  - Local Cluster（本地集群）
  - Global Pool（全局矿池）
  - FOLLOWER 模式时全部禁用

- **Performance Presets（性能预设）**
  - Power Save（省电模式）
  - Balanced（平衡模式）
  - Performance（性能模式）
  - Extreme（极限模式）
  - Custom（自定义设置）
    - Worker Count 滑块
    - Duty Cycle 滑块
    - 估算 CPU 占用

- **Mining Readiness Chips（挖矿就绪检查芯片）**
  - Bootstrap 状态
  - Quorum 状态
  - Height Consensus
  - Local Role
  - "查看详情" 按钮（跳转到 Network 标签页）

- **Warnings Panel（警告面板）**
  - MiningGuard 错误
  - RuntimeManager 警告（Event Loop Lag、FPS、崩溃率）
  - MinerCluster 警告（Worker 错误）

#### Phase 38-D: Onboarding Dialog（首次挖矿引导）
- **步骤 1**: 环境检查
  - 检测到的设备类型
  - CPU 核心数
  - 推荐 Worker 数
  - 提示信息

- **步骤 2**: 安全说明
  - CPU 占用警告
  - 设备发热警告
  - 浏览器变慢提示

- **步骤 3**: 模式选择
  - Power Save / Balanced / Performance
  - "不再显示此提示" 选项

#### 原有内容（保留）
- **Mining Effectiveness Stats（挖矿有效性统计）**
  - 已接受区块
  - 拒绝/孤块
  - 总挖矿数
  - 有效率
  - 警告（如果有效率低）

- **Mining Guide（挖矿指南）**（未挖矿时显示）
  - 什么是挖矿
  - 挖矿步骤
  - 提示

- **Mining Status Banner（挖矿状态横幅）**（挖矿中显示）
  - 挖矿模式信息
  - 算力
  - 停止按钮

- **Mining Controls（挖矿控制）**
  - Single Worker Mode（单 Worker 模式）
  - Cluster Mining Mode（集群挖矿模式）
  - 自动挖矿选项

- **Mining Status（挖矿状态）**（如果正在挖矿）
  - 状态
  - 难度
  - 算力
  - 已尝试哈希数
  - 运行时间
  - 当前哈希
  - 当前 Nonce

- **Cluster Mining Stats（集群挖矿统计）**
  - 总算力
  - 活跃 Worker 数
  - 总哈希数
  - Worker 详情列表

- **Global Miner Pool（全局矿池）**
  - 模式状态
  - 角色
  - 统计信息

---

### 4. Transactions（交易）
**位置**: `activeTab === "transactions"`

**主要内容**:
- **Transaction Form（交易表单）**
  - Namespace 输入
  - Key 输入
  - Value 输入
  - Operation Type 选择（SET/DELETE）
  - 创建交易按钮

- **Pending Transactions（待处理交易）**
  - 交易列表
  - 交易详情
  - 取消按钮

- **Transaction History（交易历史）**
  - 所有交易列表
  - 交易状态
  - 交易详情

---

### 5. Network（网络）
**位置**: `activeTab === "network"`

**主要内容**:
- **Network Health Panel（网络健康面板）**
  - P2P 连接状态
  - 对等节点列表
  - 网络统计
  - Bootstrap Debug Info（Phase 37）
  - RootTip Trust Level（Phase 37）

- **Quorum Panel（Quorum 面板）**
  - Quorum 状态
  - 分数详情
  - 独立 Peer 信息
  - 提升建议

---

### 6. Storage（存储）
**位置**: `activeTab === "storage"`

**主要内容**:
- **Snapshot Management（快照管理）**
  - 快照列表
  - 快照详情
  - 创建快照
  - 加载快照
  - 删除快照
  - 快照大小信息

- **Storage Statistics（存储统计）**
  - 区块数量
  - 存储大小
  - 快照数量

---

### 7. Advanced（高级）
**位置**: `activeTab === "advanced"`

**主要内容**:
- **Config Checker（配置检查器）**
  - 浏览器兼容性检查
  - 功能支持检查

- **Network Configuration（网络配置）**
  - Bootstrap URL 设置
  - 网络模式切换（主网/测试网）

- **Developer Tools（开发者工具）**
  - 重置链数据
  - 清除所有快照
  - 导出/导入数据

---

### 8. Token（代币）
**位置**: `activeTab === "token"`

**主要内容**:
- **Token Information（代币信息）**
  - IDC 基本信息
  - 总供应量
  - 当前流通量
  - 挖矿奖励

- **Emission Stats（发行统计）**
  - 按 Era 的发行量
  - 历史发行数据

---

### 9. Privacy（隐私）
**位置**: `activeTab === "privacy"`

**主要内容**:
- **Privacy Panel（隐私面板）**
  - Shielded Balance（隐私余额）
  - Privacy Transactions（隐私交易）
  - Stealth Address Management（隐身地址管理）

---

### 10. Tools（工具）
**位置**: `activeTab === "tools"`

**主要内容**:
- **Utility Tools（实用工具）**
  - 地址生成器
  - 哈希计算器
  - 签名验证器

---

### 11. Runtime（运行时）
**位置**: `activeTab === "runtime"`

**主要内容**:
- **Runtime Panel（运行时面板）**
  - Device Capability（设备能力）
  - Performance Metrics（性能指标）
  - Multi-Tab Detection（多标签页检测）
  - Safety Warnings（安全警告）

---

## 组件依赖关系

### 核心组件
- `App.tsx` - 主应用组件
- `NetworkHealthPanel.tsx` - 网络健康面板
- `QuorumPanel.tsx` - Quorum 面板
- `WalletManagerPanel.tsx` - 钱包管理面板
- `WalletBackupPanel.tsx` - 钱包备份面板
- `PrivacyPanel.tsx` - 隐私面板
- `RuntimePanel.tsx` - 运行时面板
- `GlobalSentinelPanel.tsx` - 全局哨兵面板
- `ConfigChecker.tsx` - 配置检查器

### Phase 38 新增组件
- `MiningMainCard.tsx` - 挖矿主卡片
- `MiningModeSelector.tsx` - 挖矿模式选择器
- `MiningAdvancedPanel.tsx` - 高级设置面板
- `MiningReadinessChipList.tsx` - 挖矿就绪检查芯片列表
- `MiningWarningsPanel.tsx` - 警告面板
- `MiningLiveStatsCard.tsx` - 实时统计卡片
- `MiningOnboardingDialog.tsx` - 首次挖矿引导对话框

---

## 状态管理

### 主要 State
- `activeTab` - 当前选中的标签页
- `chainContext` - 链上下文
- `isMining` - 是否正在挖矿（单 Worker）
- `clusterMining` - 是否正在集群挖矿
- `miningMode` - 挖矿模式（solo/cluster/global-pool）
- `showAdvanced` - 是否显示高级设置
- `showOnboarding` - 是否显示引导对话框
- `onboardingCompleted` - 是否完成引导
- `bootstrapComplete` - Bootstrap 是否完成
- `isP2PConnected` - P2P 是否连接
- `peerCount` - 对等节点数量
- `localRole` - 本地角色（LEADER/FOLLOWER）
- `miningGuardResult` - 挖矿守卫结果

### 持久化 State（localStorage）
- `isMining` - 挖矿状态
- `clusterMining` - 集群挖矿状态
- `autoMining` - 自动挖矿
- `bootstrapUrl` - Bootstrap URL
- `globalPoolEnabled` - 全局矿池是否启用
- `mining_onboarding_completed` - 引导是否完成

---

## 用户体验流程

### 新用户首次使用
1. 打开页面 → Overview 标签页
2. 创建钱包 → Wallet 标签页
3. 连接网络 → Overview 标签页（点击连接按钮）
4. 开始挖矿 → Mining 标签页
   - 首次点击 → 弹出 Onboarding Dialog
   - 完成引导 → 自动开始挖矿

### 日常使用流程
1. 打开页面 → 自动恢复状态
2. 查看概览 → Overview 标签页
3. 挖矿管理 → Mining 标签页
   - 查看状态 → Mining Main Card
   - 调整设置 → Advanced Settings
   - 查看统计 → Live Stats Card

### 高级用户流程
1. 网络诊断 → Network 标签页
2. 性能调优 → Runtime 标签页
3. 存储管理 → Storage 标签页
4. 隐私交易 → Privacy 标签页

---

## 潜在优化点

### 1. 信息架构
- **Overview 标签页内容过多**：可以考虑拆分或折叠部分内容
- **Mining 标签页新旧内容混合**：Phase 38 新内容 + 原有内容，可能需要整合

### 2. 导航体验
- **标签页数量多（11个）**：可以考虑分组或使用下拉菜单
- **标签页顺序**：根据使用频率调整顺序

### 3. 状态可见性
- **关键状态分散**：网络状态、挖矿状态、钱包状态分散在不同标签页
- **状态同步**：多个标签页可能显示相同信息，需要保持同步

### 4. 首次使用体验
- **引导流程**：目前只有挖矿引导，可以考虑整体应用引导
- **默认状态**：新用户打开页面时的默认状态和提示

### 5. 响应式设计
- **移动端适配**：11个标签页在移动端可能显示困难
- **内容密度**：某些卡片内容较多，在小屏幕上可能显示不全

---

## 建议的优化方向

### 短期优化
1. **整合 Mining 标签页**：将 Phase 38 新内容和原有内容更好地整合
2. **简化 Overview**：将部分内容移到专门标签页，Overview 只显示关键信息
3. **优化标签页顺序**：将常用标签页（Overview、Mining、Wallet）放在前面

### 中期优化
1. **标签页分组**：将相关标签页分组（如：核心功能、高级功能、工具）
2. **状态仪表板**：创建一个统一的状态仪表板，显示所有关键指标
3. **快捷操作**：在 Overview 添加常用操作的快捷按钮

### 长期优化
1. **移动端优化**：重新设计移动端布局，使用抽屉式导航
2. **个性化**：允许用户自定义标签页顺序和显示内容
3. **引导系统**：为每个主要功能添加引导和帮助

