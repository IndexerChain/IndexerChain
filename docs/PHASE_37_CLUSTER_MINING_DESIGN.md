# Phase 37: 浏览器集群挖矿最终版设计文档

## 一、设计目标

### 1. 单浏览器内多 Worker 并行挖矿
- 充分利用多核 CPU，达到百万级 H/s
- 支持动态 Worker 数量调整

### 2. 与全局矿池协作
- **Local-only 模式**：单节点自己分配 nonce 空间
- **Global Pool 模式**：从 Delegator / GlobalNonceAllocator 领取区间

### 3. 无效挖矿防护
- 新区块头来时，旧任务必须「瞬间失效」
- 所有 Worker 的结果必须带 `miningEpochId`，避免旧消息污染

### 4. 资源与安全护栏
- 与 RuntimeManager 联动：Worker 数量、dutyCycle、后台降档
- Worker 崩溃自动恢复，不拖死浏览器

### 5. 与主网安全体系一致
- 启动挖矿前必须通过 MiningGuard / Quorum / StateLock 等检查
- 对接 global miner pool 的 nonce 分配协议

---

## 二、整体架构

### 1. 三层挖矿结构（浏览器内）

```
┌──────────────────────────┐
│        App / UI          │
│  - 选择单机/集群/全局池    │
│  - 显示总算力/状态        │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│      MinerCluster         │  ← 本层是 Phase 37 重点
│  - Worker 管理            │
│  - Nonce 区间分配         │
│  - MiningEpoch 管理       │
│  - 统计聚合 / 回调        │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│     MinerClient[N]        │
│  - 与 WebWorker 通信       │
│  - 单 Worker 统计          │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│       minerWorker.js      │
│  - 纯 PoW 计算             │
│  - dutyCycle 调度         │
│  - 按区间扫描 nonce        │
└──────────────────────────┘
```

### 2. 全局矿池协同（浏览器节点之间）

```
GlobalNonceAllocator / Delegator
        ▲            ▲
        │            │ P2P 消息：REQUEST_NONCE_RANGE / NONCE_RANGE
        │            │
┌───────┴────────────┴───────────┐
│        Browser Node (你)        │
│   MinerCluster + WorkerNode    │
└────────────────────────────────┘
```

---

## 三、核心模块详细设计

### 1. MiningEpoch 管理

**目的**：确保「某一轮挖矿任务」有唯一 ID，新区块头来时，旧任务自动作废，防止旧 Worker 结果回流。

**实现位置**：`src/core/miningEpoch.ts`

**接口设计**：
```typescript
export class MiningEpochManager {
  private currentEpochId: string | null = null;

  newEpoch(blockHeight: number, blockHash: string): string {
    // 例如: epoch_{height}_{随机数}
    this.currentEpochId =
      `epoch_${blockHeight}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
    return this.currentEpochId;
  }

  getCurrent(): string | null {
    return this.currentEpochId;
  }

  isValid(epochId: string | undefined | null): boolean {
    return !!epochId && epochId === this.currentEpochId;
  }

  reset(): void {
    this.currentEpochId = null;
  }
}
```

**要求**：
- `startMining()` 时必须先 `newEpoch(height, tipHash)`
- 所有 Worker START 消息带 `miningEpochId`
- 所有 Worker 回来的 PROGRESS/FOUND/EXHAUSTED 必须检查 epochId，不匹配直接丢弃

---

### 2. Nonce 区间管理

**分成两层**：
1. **Node 层**：当前节点在全局矿池中拿到的总区间 `globalNonceRange`（或者本地从 0~2^64-1 的无界区间）
2. **Worker 层**：从 Node 区间拆分小块给各个 Worker

**实现位置**：`src/core/nonceRangeManager.ts`

**接口设计**：
```typescript
export interface NonceRange {
  start: bigint;
  end: bigint; // inclusive
}

export class NodeNonceRangeManager {
  private currentRange: NonceRange | null = null;
  private cursor: bigint = 0n;

  setGlobalRange(range: NonceRange | null) {
    this.currentRange = range;
    this.cursor = range ? range.start : 0n;
  }

  // 本地模式: currentRange = null，cursor 从 0 自增
  allocateSubRange(size: bigint): NonceRange | null {
    if (!this.currentRange) {
      const start = this.cursor;
      const end = start + size - 1n;
      this.cursor = end + 1n;
      return { start, end };
    }

    const { start: gStart, end: gEnd } = this.currentRange;
    if (this.cursor > gEnd) return null;

    const start = this.cursor;
    let end = start + size - 1n;
    if (end > gEnd) end = gEnd;

    this.cursor = end + 1n;
    return { start, end };
  }

  isExhausted(): boolean {
    if (!this.currentRange) return false; // local mode = 无限
    return this.cursor > this.currentRange.end;
  }
}
```

---

### 3. Worker 消息协议（浏览器内）

**目标**：尽量只传「紧凑区块头 + nonce」，避免传整块 tx 列表。

#### 3.1 CompactBlockHeader

**实现位置**：`src/core/types.ts`

```typescript
export interface CompactBlockHeader {
  version: number;
  height: number;
  prevHash: string;
  merkleRoot: string;
  timestamp: number;
  difficulty: number;
  stateCommitment?: string;
}
```

#### 3.2 Worker 消息格式

**主线程 → Worker**：
```typescript
type MinerWorkerCommand =
  | {
      type: "START";
      header: CompactBlockHeader;
      difficulty: number;
      nonceStart: bigint;
      nonceEnd: bigint;
      dutyCycle: number;
      miningEpochId: string;
    }
  | { type: "STOP"; miningEpochId: string };
```

**Worker → 主线程**：
```typescript
type MinerWorkerEvent =
  | {
      type: "PROGRESS";
      hashesTried: number;
      currentNonce: bigint;
      hashRateEstimate: number;
      miningEpochId: string;
    }
  | {
      type: "FOUND";
      nonce: bigint;
      hash: string;
      miningEpochId: string;
    }
  | {
      type: "EXHAUSTED";
      lastNonce: bigint;
      hashesTried: number;
      miningEpochId: string;
    }
  | {
      type: "STOPPED";
      reason?: string;
      miningEpochId: string;
    }
  | {
      type: "ERROR";
      error: string;
      miningEpochId: string;
    };
```

**规则**：
- MinerCluster 收到任何 event，第一件事就是 `if (!epochManager.isValid(event.miningEpochId)) return;`
- 确保「旧任务的 late event」不会污染当前状态

---

### 4. MinerCluster 设计（浏览器内总控）

#### 4.1 对外接口

**实现位置**：`src/core/minerCluster.ts`

```typescript
interface ClusterOptions {
  runtimeManager?: RuntimeManager;
  onBlockFound: (nonce: bigint, header: CompactBlockHeader) => void;
  onProgress?: (stats: ClusterStats) => void;
  onExhaustedGlobalRange?: () => void; // 全局 nonce 用完时通知上层（global pool 模式）
}

interface StartClusterMiningOptions {
  compactHeader: CompactBlockHeader;
  globalNonceRange?: NonceRange | null;  // 若为 null，则本地模式
  targetDifficulty: number;
  miningGuard?: MiningGuard;
}

export class MinerCluster {
  private workers: MinerClient[] = [];
  private epochManager = new MiningEpochManager();
  private nodeRangeManager = new NodeNonceRangeManager();

  constructor(private opts: ClusterOptions) {}

  configure(params: { workerCount: number; dutyCycle: number }) {
    // 1) 根据 RuntimeManager 的推荐做裁剪
    // 2) 调整已有 worker 数量（增加/减少）
    // 3) 更新各 worker 的 dutyCycle
  }

  async startMining(opts: StartClusterMiningOptions): Promise<void> {
    // 0. 安全检查
    if (opts.miningGuard && !(await opts.miningGuard.canMineNow())) {
      throw new Error("MiningGuard: cannot mine now");
    }

    // 1. 初始化 epoch
    const epochId = this.epochManager.newEpoch(
      opts.compactHeader.height,
      opts.compactHeader.prevHash
    );

    // 2. 配置全局/本地 nonce 区间
    this.nodeRangeManager.setGlobalRange(opts.globalNonceRange ?? null);

    // 3. 给每个 worker 分配子区间并 START
    for (const [idx, worker] of this.workers.entries()) {
      this.assignNewRangeToWorker(worker, idx, epochId, opts);
    }
  }

  stopMining(reason = "manual") {
    const epoch = this.epochManager.getCurrent();
    if (!epoch) return;

    for (const w of this.workers) {
      w.stop(epoch, reason);
    }

    this.epochManager.reset();
  }

  private assignNewRangeToWorker(
    worker: MinerClient,
    workerIndex: number,
    epochId: string,
    opts: StartClusterMiningOptions
  ) {
    const rangeSize = this.computeWorkerRangeSize(workerIndex);
    const range = this.nodeRangeManager.allocateSubRange(rangeSize);
    if (!range) {
      // 全局区间耗尽
      if (this.nodeRangeManager.isExhausted()) {
        this.opts.onExhaustedGlobalRange?.();
      }
      return;
    }

    worker.start({
      header: opts.compactHeader,
      difficulty: opts.targetDifficulty,
      nonceStart: range.start,
      nonceEnd: range.end,
      dutyCycle: this.getCurrentDutyCycle(),
      miningEpochId: epochId,
    });
  }
}
```

#### 4.2 Worker 事件处理逻辑

在 MinerCluster 中订阅 MinerClient 的事件：

```typescript
// 伪代码示意
worker.on("event", (ev: MinerWorkerEvent) => {
  if (!this.epochManager.isValid(ev.miningEpochId)) return; // 丢弃旧 epoch

  switch (ev.type) {
    case "FOUND":
      // 1) 停止所有 worker
      this.stopMining("found");
      // 2) 通知上层构造完整 Block，并尝试提交
      this.opts.onBlockFound(ev.nonce, currentHeader);
      break;

    case "EXHAUSTED":
      // 为该 worker 分配新的 nonce 区间
      this.assignNewRangeToWorker(worker, workerIndex, ev.miningEpochId, currentMiningOpts);
      break;

    case "PROGRESS":
      // 聚合统计，更新 ClusterStats
      break;

    case "ERROR":
      // 标记 worker 错误，按策略重启 / 降低 worker 数量
      break;
  }
});
```

---

### 5. 与 Global Miner Pool 的集成

**已有**：Phase 19 的 `delegatorManager` / `globalNonceAllocator` / `WorkerNode`

在集群挖矿的时候，整体关系变成：
- **Browser Node 内部**：MinerCluster 负责本机 Worker 分配
- **Browser Node 对外**：整个 node 作为 一个 WorkerNode 连接到 Delegator 请求区间

#### 5.1 WorkerNode 和 MinerCluster 的接口对接

**实现位置**：`src/core/workerNode.ts`

```typescript
class WorkerNode {
  constructor(private minerCluster: MinerCluster, private p2p: BrowserP2PNode) {}

  async onNonceRangeAssigned(range: NonceRange) {
    await this.minerCluster.startMining({
      compactHeader: currentHeader,
      globalNonceRange: range,
      targetDifficulty: currentDifficulty,
      miningGuard: miningGuardInstance,
    });
  }

  onGlobalRangeExhausted() {
    // 通过 P2P 发送 NONCE_RANGE_EXHAUSTED，向 Delegator 请求新区间
    this.p2p.sendNonceRangeExhausted();
  }
}
```

**注意**：
- MinerCluster 的 `onExhaustedGlobalRange` 回调就是上面的 `onGlobalRangeExhausted`
- 所以对全局矿池来说，这个节点永远是「一个 Worker」，内部多少 WebWorker 都透明

---

### 6. RuntimeManager 与安全护栏集成

**目标**：
- 调整 Worker 数量和 dutyCycle 只在一个地方做决策：RuntimeManager
- MinerCluster.configure() 只执行策略，不再自己做复杂判断

#### 6.1 RuntimeManager 输出

**实现位置**：`src/core/runtimeManager.ts`（已存在，扩展接口）

```typescript
export interface RuntimeMiningProfile {
  workerCount: number;
  dutyCycle: number;  // 0.1 ~ 1.0
  mode: "power_save" | "balanced" | "performance" | "extreme";
}

export class RuntimeManager {
  getRecommendedProfile(): RuntimeMiningProfile { /* ... */ }
  onRuntimeChange(cb: (profile: RuntimeMiningProfile) => void) { /* ... */ }
}
```

#### 6.2 MinerCluster 响应 RuntimeManager

```typescript
// MinerCluster 构造时：
if (opts.runtimeManager) {
  const profile = opts.runtimeManager.getRecommendedProfile();
  this.configure(profile);
  opts.runtimeManager.onRuntimeChange((p) => {
    this.configure(p);
  });
}
```

**效果**：
- 前台/后台切换、CPU load 过高、FPS 掉帧 → RuntimeManager 调整 profile → MinerCluster 自动收敛

---

### 7. 错误恢复与浏览器稳定性

**场景**：
- 单个 minerWorker 崩溃 / 抛异常
- 浏览器页面卡顿，Event Loop lag 超标

**策略**：

1. **Worker 崩溃**：
   - 标记该 MinerClient 状态为 ERROR
   - 若短时间内崩溃次数 > N：减少 workerCount，向 RuntimePanel 报警
   - 否则尝试重建一个新的 Worker 实例

2. **RuntimeManager 报告「危险模式」**：
   - 自动暂停挖矿
   - UI 显示「性能保护已触发」

3. **多 Tab 冲突**：
   - BroadcastChannel 已实现单机 LEADER / FOLLOWER
   - FOLLOWER 的 MinerCluster 永远不可 startMining，只能 stop，避免本机竞争资源

---

## 四、与安全体系的联动

### 1. MiningGuard

MinerCluster.startMining() 必须支持传入 miningGuard，并在真正启动前调用：

```typescript
if (opts.miningGuard && !(await opts.miningGuard.canMineNow())) {
  throw new Error("MiningGuard: not ready to mine");
}
```

**保证**：
- 主网参数匹配
- Quorum 分数满足当前阶段阈值
- Bootstrap / HeightConsensus / Finality / StateLock 都 OK
- 本机角色为 LEADER
- 没有状态漂移 / 分叉疑似

### 2. LongRangeDetector / StateLock / StateDriftDetector

- **新区块头到达** → MiningEpochManager 新 epoch → 所有旧 Worker 结果无效
- **状态漂移严重** → StateRepair 暂停挖矿，修复后再允许 MinerCluster 启动
- **Long-range 分叉检测触发** → 停止挖矿，建议快照恢复

---

## 五、UI 层建议

在现有 Mining/Advanced 页面基础上：

### 1. Cluster Mining 面板
- **显示**：
  - Worker 数量
  - 每个 Worker 的 nonce 区间、hashrate、状态
  - 当前 miningEpochId（前 8 位）
- **按钮**：
  - Start/Stop Cluster Mining
  - 使用 Global Pool / Local Only 的切换开关

### 2. Runtime 面板联动
- 显示当前 profile：Power Save / Balanced / Performance / Extreme
- 显示「本机资源保护」提示（如触发了降档）

### 3. 错误提示
- 当 MiningGuard 返回失败原因时，清晰列出（用 NetworkHealthPanel 已有结构）

---

## 六、实现任务拆分

### Phase 37-A：MiningEpochManager + worker 消息增加 miningEpochId
- 创建 `src/core/miningEpoch.ts`
- 修改 `MinerCluster` 集成 MiningEpochManager
- 修改 `MinerClient` 和 `minerWorker.ts` 支持 miningEpochId
- 所有 Worker 消息增加 epochId 校验

### Phase 37-B：NodeNonceRangeManager + MinerCluster 的 globalNonceRange 支持
- 创建 `src/core/nonceRangeManager.ts`
- 修改 `MinerCluster.startMining()` 支持 `globalNonceRange` 参数
- 与 `WorkerNode` 对接，实现 `onExhaustedGlobalRange` 回调

### Phase 37-C：CompactBlockHeader + Worker 只接收 header
- 在 `src/core/types.ts` 定义 `CompactBlockHeader`
- 修改 `MinerCluster` 构造 CompactBlockHeader 传给 Worker
- 修改 `minerWorker.ts` 只接收 header，FOUND 时只返回 nonce
- 修改 `MinerCluster` 在收到 FOUND 后构造完整 Block

### Phase 37-D：深度集成 RuntimeManager
- 扩展 `RuntimeManager` 接口，添加 `getRecommendedProfile()` 和 `onRuntimeChange()`
- 修改 `MinerCluster` 构造函数接受 `runtimeManager`
- 实现 `MinerCluster.configure()` 方法，支持动态调整 workerCount 和 dutyCycle
- 实现 Worker 动态增加/减少逻辑

### Phase 37-E：Worker 崩溃恢复逻辑与错误统计
- 在 `MinerCluster` 中实现 Worker 错误统计
- 实现 Worker 崩溃自动恢复机制
- 实现错误阈值检测和自动降级
- UI 显示 Worker 错误状态

---

## 七、当前实现与设计差距分析

### ✅ 已实现
- 基础三层架构（MinerCluster / MinerClient / minerWorker）
- 基本 nonce 区间分配
- DutyCycle 控制
- 统计聚合
- RuntimeManager 基础功能

### ❌ 缺失（按优先级）

#### 高优先级（影响功能正确性）
1. **MiningEpochManager**：防止旧任务回流
2. **NodeNonceRangeManager**：支持全局矿池区间
3. **CompactBlockHeader**：优化消息传递

#### 中优先级（影响性能和体验）
4. **RuntimeManager 深度集成**：动态调整和资源保护
5. **Worker 崩溃恢复**：提升稳定性
6. **MiningGuard 集成**：统一安全检查

#### 低优先级（优化）
7. **Worker 消息格式优化**：统一接口
8. **UI 增强**：更详细的 Worker 状态展示

---

## 八、实现建议

1. **按阶段实现**：先实现 Phase 37-A（MiningEpoch），确保无效挖矿防护
2. **逐步集成**：然后实现 Phase 37-B（NonceRange），支持全局矿池
3. **性能优化**：Phase 37-C（CompactBlockHeader）减少消息传递开销
4. **稳定性提升**：Phase 37-D 和 37-E 提升整体稳定性

---

**文档版本**：v1.0  
**创建日期**：2024  
**最后更新**：2024

