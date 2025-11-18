/**
 * Internationalization (i18n) Locales
 * 
 * Supports Chinese (zh) and English (en)
 */

export type Locale = "zh" | "en";

export interface Translations {
  // Common
  common: {
    loading: string;
    error: string;
    success: string;
    confirm: string;
    cancel: string;
    close: string;
    save: string;
    delete: string;
    edit: string;
    copy: string;
  };

  // Status
  status: {
    ready: string;
    notReady: string;
    connected: string;
    disconnected: string;
    mining: string;
    stopped: string;
    active: string;
    inactive: string;
  };

  // Quick Start
  quickStart: {
    title: string;
    step1Title: string;
    step1Desc: string;
    step1Completed: string;
    step1Action: string;
    step2Title: string;
    step2Desc: string;
    step2Completed: string;
    step3Title: string;
    step3Desc: string;
    step3Mining: string;
    step3Action: string;
    networkConnected: string;
    networkDisconnected: string;
    walletInitializing: string;
    miningStarted: string;
    miningNotStarted: string;
  };

  // Mining
  mining: {
    title: string;
    guide: string;
    whatIsMining: string;
    whatIsMiningDesc: string;
    steps: string;
    step1: string;
    step2: string;
    step3: string;
    step3Single: string;
    step3Cluster: string;
    step4: string;
    tips: string;
    tip1: string;
    tip2: string;
    tip3: string;
    tip4: string;
    active: string;
    controls: string;
    singleWorker: string;
    singleWorkerDesc: string;
    clusterMining: string;
    clusterMiningDesc: string;
    recommended: string;
    startMining: string;
    stopMining: string;
    startClusterMining: string;
    stopClusterMining: string;
    autoMining: string;
    autoMiningDesc: string;
    workerCount: string;
    optimalWorkers: string;
    pendingTxs: string;
    coinbaseOnly: string;
    status: string;
    difficulty: string;
    difficultyDesc: string;
    hashRate: string;
    hashesTried: string;
    elapsedTime: string;
    currentHash: string;
    currentNonce: string;
    clusterStats: string;
    totalHashRate: string;
    activeWorkers: string;
    totalHashes: string;
    workerDetails: string;
    workerStatus: string;
    running: string;
    stopped: string;
    exhausted: string;
    nonceRange: string;
    calculating: string;
  };

  // Network (expanded)
  network: {
    title: string;
    status: string;
    mode: string;
    mainnet: string;
    dev: string;
    peers: string;
    connect: string;
    disconnect: string;
    mainnetMode: string;
    mainnetDesc: string;
    devMode: string;
    devModeDesc: string;
    signalingServer: string;
    fastRelay: string;
    headersCached: string;
    missingBodies: string;
    pendingBodyRequests: string;
    receivedBodies: string;
    lastHeaderDelay: string;
    lastBodyDownload: string;
    globalSnapshotNetwork: string;
    snapshotSources: string;
    avgLatency: string;
    avgIntegrity: string;
    cachedSnapshots: string;
    globalPool: string;
    globalPoolDesc: string;
    enableGlobalPool: string;
    disableGlobalPool: string;
    delegatorStatus: string;
    isDelegator: string;
    notDelegator: string;
    globalPointer: string;
    peerReputation: string;
    peerReputationDesc: string;
    peerId: string;
    score: string;
    trustLevel: string;
    blocksServed: string;
    blocksInvalid: string;
    snapshotsServed: string;
    snapshotsInvalid: string;
    avgLatencyMs: string;
    workCompleted: string;
    workFailed: string;
    fastFinality: string;
    fastFinalityDesc: string;
    finalizedBlocks: string;
    pendingVotes: string;
    committeeRound: string;
    committeeSize: string;
    members: string;
    currentBlockFinality: string;
    finalized: string;
    pending: string;
    unconfirmed: string;
    currentCommittee: string;
    noCommittee: string;
    notInitialized: string;
    notInitializedDesc: string;
  };

  // Wallet
  wallet: {
    title: string;
    address: string;
    balance: string;
    nodeId: string;
    manager: string;
    backup: string;
  };

  // Transactions
  transactions: {
    title: string;
    transfer: string;
    transferIdc: string;
    recipient: string;
    amount: string;
    createTx: string;
    createIndexOp: string;
    operationType: string;
    namespace: string;
    key: string;
    value: string;
    pending: string;
    signing: string;
  };

  // Storage (expanded)
  storage: {
    title: string;
    state: string;
    lastSnapshot: string;
    snapshotCount: string;
    blocksSinceSnapshot: string;
    stateStorage: string;
    lastSnapshotHeight: string;
    lastSnapshotTime: string;
    latestSnapshotType: string;
    full: string;
    delta: string;
    incremental: string;
    unknown: string;
    latestSnapshotSize: string;
    compressionRatio: string;
    reduction: string;
    estimatedUncompressed: string;
    stateHash: string;
    verificationStatus: string;
    verified: string;
    notVerified: string;
    noHash: string;
    lastVerified: string;
    commitmentMatch: string;
    matches: string;
    mismatch: string;
    remoteSnapshot: string;
    used: string;
    notUsed: string;
    disabled: string;
  };

  // Advanced (expanded)
  advanced: {
    title: string;
    configChecker: string;
    resetChain: string;
    resetChainDesc: string;
  };

  // Tabs
    tabs: {
      overview: string;
      wallet: string;
      mining: string;
      transactions: string;
      network: string;
      storage: string;
      advanced: string;
      token: string;
    };

  // Banner
    banner: {
      systemReady: string;
      configRequired: string;
      networkConnected: string;
      networkDisconnected: string;
      walletInitializing: string;
      configNetwork: string;
    };

    // Chain Status
    chain: {
      currentHeight: string;
      blockCount: string;
      pendingTxs: string;
      mining: string;
      latestBlock: string;
      hash: string;
      height: string;
      transactions: string;
      difficulty: string;
      nonce: string;
      stateCommitment: string;
    };

    // Token Model
    token: {
      title: string;
      overview: string;
      totalSupply: string;
      maxSupply: string;
      decimals: string;
      emissionModel: string;
      halvingSchedule: string;
      blockReward: string;
      currentEra: string;
      eraInfo: string;
      eraReward: string;
      blocksInEra: string;
      blocksRemaining: string;
      eraStartHeight: string;
      eraEndHeight: string;
      transactionFees: string;
      baseFee: string;
      feePer100Bytes: string;
      feeFormula: string;
      emissionCurve: string;
      eraTable: string;
      eraNumber: string;
      years: string;
      rewardPerBlock: string;
      totalEraReward: string;
      cumulativeReward: string;
      economics: string;
      inflationRate: string;
      deflationary: string;
      supplyCap: string;
      noInflation: string;
    };

    // Overview
    overview: {
      chainStatus: string;
      networkStatus: string;
      walletStatus: string;
      nodeIdentity: string;
      connectedPeers: string;
      connectedTo: string;
    };


}

export const translations: Record<Locale, Translations> = {
  zh: {
    common: {
      loading: "加载中...",
      error: "错误",
      success: "成功",
      confirm: "确认",
      cancel: "取消",
      close: "关闭",
      save: "保存",
      delete: "删除",
      edit: "编辑",
      copy: "复制",
    },
    status: {
      ready: "就绪",
      notReady: "未就绪",
      connected: "已连接",
      disconnected: "未连接",
      mining: "挖矿中",
      stopped: "已停止",
      active: "活跃",
      inactive: "未激活",
    },
    quickStart: {
      title: "🚀 快速开始挖矿",
      step1Title: "连接网络",
      step1Desc: "需要连接到 P2P 网络才能同步区块和参与挖矿。点击上方按钮前往 Network 标签页配置。",
      step1Completed: "✓ 已完成",
      step1Action: "前往配置 →",
      step2Title: "检查钱包",
      step2Desc: "系统正在初始化钱包，请稍候...",
      step2Completed: "✓ 已完成",
      step3Title: "开始挖矿",
      step3Desc: "配置完成后，前往 Mining 标签页开始挖矿。挖矿在浏览器后台进行，不会影响其他操作。",
      step3Mining: "⛏️ 挖矿中",
      step3Action: "前往挖矿 →",
      networkConnected: "已连接到 {mode}，当前有 {count} 个节点",
      networkDisconnected: "需要连接到 P2P 网络才能同步区块和参与挖矿。点击上方按钮前往 Network 标签页配置。",
      walletInitializing: "系统正在初始化钱包，请稍候...",
      miningStarted: "挖矿已启动！当前算力: {hashRate}",
      miningNotStarted: "配置完成后，前往 Mining 标签页开始挖矿。挖矿在浏览器后台进行，不会影响其他操作。",
    },
    mining: {
      title: "⛏️ 挖矿",
      guide: "📖 挖矿指南",
      whatIsMining: "什么是浏览器挖矿？",
      whatIsMiningDesc: "IndexerChain 是一个完全运行在浏览器中的区块链。通过 PoW（工作量证明）挖矿，你可以获得 IDC 代币奖励。挖矿过程在 Web Worker 中运行，不会阻塞浏览器界面。",
      steps: "挖矿步骤：",
      step1: "确保已连接网络：在 Network 标签页连接到 P2P 网络（主网或开发网络）",
      step2: "检查钱包状态：确保钱包已初始化，挖矿奖励将发送到你的挖矿钱包地址",
      step3: "选择挖矿模式：",
      step3Single: "单工作线程模式：适合轻量挖矿，资源占用低",
      step3Cluster: "集群挖矿模式：使用多个 Web Worker，算力更高（推荐）",
      step4: "开始挖矿：点击下方按钮开始，挖矿会自动在后台运行",
      tips: "💡 提示：",
      tip1: "挖矿奖励 = 区块奖励 + 交易手续费",
      tip2: "难度会根据网络算力自动调整，保持约 10 秒出一个区块",
      tip3: "可以开启「自动挖矿」，挖出区块后会自动开始下一轮",
      tip4: "挖矿过程可以随时停止，不会丢失进度",
      active: "⛏️ 挖矿进行中",
      controls: "⛏️ 挖矿控制",
      singleWorker: "单工作线程模式",
      singleWorkerDesc: "适合轻量挖矿，资源占用低，适合后台运行",
      clusterMining: "🔥 集群挖矿模式（推荐）",
      clusterMiningDesc: "使用多个 Web Worker 并行挖矿，算力更高，挖矿速度更快",
      recommended: "推荐",
      startMining: "⛏️ 开始挖矿",
      stopMining: "停止挖矿",
      startClusterMining: "🔥 开始集群挖矿",
      stopClusterMining: "停止集群挖矿",
      autoMining: "自动挖矿（挖出区块后自动继续）",
      autoMiningDesc: "(自动挖矿已启用 - 挖出区块后将自动继续)",
      workerCount: "工作线程数:",
      optimalWorkers: "推荐: {count} 个工作线程（CPU 核心数 - 1）",
      pendingTxs: "{count} 待处理交易",
      coinbaseOnly: "仅区块奖励",
      status: "📊 挖矿状态",
      difficulty: "当前难度:",
      difficultyDesc: "{difficulty} (需要 {difficulty} 个前导零)",
      hashRate: "估算算力:",
      hashesTried: "已尝试哈希数:",
      elapsedTime: "已用时间:",
      currentHash: "当前哈希:",
      currentNonce: "当前 Nonce:",
      clusterStats: "🔥 集群挖矿统计",
      totalHashRate: "总算力:",
      activeWorkers: "活跃工作线程:",
      totalHashes: "总尝试哈希数:",
      workerDetails: "工作线程详情:",
      workerStatus: "工作线程 #{id}:",
      running: "运行中",
      stopped: "已停止",
      exhausted: "已耗尽",
      nonceRange: "Nonce 范围:",
      calculating: "计算中...",
    },
    network: {
      title: "🌐 网络",
      status: "状态",
      mode: "模式",
      mainnet: "🌐 主网",
      dev: "🔧 开发",
      peers: "节点",
      connect: "连接",
      disconnect: "断开",
      mainnetMode: "主网模式（自动连接主网）",
      mainnetDesc: "主网模式：将自动连接到公共 IndexerChain 主网，和全球用户一起挖矿。如需本地测试，请取消勾选「Mainnet Mode」。",
      devMode: "开发模式",
      devModeDesc: "开发模式：连接到本地信令服务器，用于开发、测试或私有链。需要先运行 node signaling-server-example.js",
      signalingServer: "信令服务器",
      fastRelay: "快速中继状态",
      headersCached: "缓存的区块头",
      missingBodies: "缺失的区块体",
      pendingBodyRequests: "待处理的区块体请求",
      receivedBodies: "已接收的区块体",
      lastHeaderDelay: "最后区块头延迟",
      lastBodyDownload: "最后区块体下载",
      globalSnapshotNetwork: "全球快照网络",
      snapshotSources: "快照源",
      avgLatency: "平均延迟",
      avgIntegrity: "平均完整性",
      cachedSnapshots: "缓存的快照",
      globalPool: "全局矿池",
      globalPoolDesc: "所有节点协调 nonce 范围以避免重复工作。",
      enableGlobalPool: "启用全局矿池",
      disableGlobalPool: "禁用全局矿池",
      delegatorStatus: "委托者状态",
      isDelegator: "您是此区块的委托者",
      notDelegator: "不是委托者",
      globalPointer: "全局指针",
      peerReputation: "节点声誉",
      peerReputationDesc: "跟踪节点行为，优先使用可靠节点，惩罚不当行为的节点。",
      peerId: "节点 ID",
      score: "分数",
      trustLevel: "信任级别",
      blocksServed: "提供的区块",
      blocksInvalid: "无效区块",
      snapshotsServed: "提供的快照",
      snapshotsInvalid: "无效快照",
      avgLatencyMs: "平均延迟",
      workCompleted: "完成的工作",
      workFailed: "失败的工作",
      fastFinality: "快速最终性状态",
      fastFinalityDesc: "区块在 300-800 毫秒内通过委员会投票达到最终性（不可逆性）。委员会成员根据节点声誉分数选举。",
      finalizedBlocks: "已最终确认的区块",
      pendingVotes: "待处理的投票",
      committeeRound: "委员会轮次",
      committeeSize: "委员会大小",
      members: "成员",
      currentBlockFinality: "当前区块最终性",
      finalized: "已最终确认",
      pending: "待处理",
      unconfirmed: "未确认",
      currentCommittee: "当前委员会",
      noCommittee: "尚未选举委员会",
      notInitialized: "最终性管理器未初始化",
      notInitializedDesc: "连接到 P2P 网络以启用最终性。",
    },
    wallet: {
      title: "💼 钱包",
      address: "地址",
      balance: "余额",
      nodeId: "节点 ID",
      manager: "钱包管理",
      backup: "备份与恢复",
    },
    transactions: {
      title: "💸 交易",
      transfer: "转账",
      transferIdc: "💸 转账 IDC",
      recipient: "收款地址",
      amount: "金额 (IDC)",
      createTx: "创建交易",
      createIndexOp: "📝 创建交易（索引操作）",
      operationType: "操作类型",
      namespace: "命名空间",
      key: "键",
      value: "值",
      pending: "待处理",
      signing: "签名中...",
    },
    storage: {
      title: "💾 存储",
      state: "状态与存储",
      lastSnapshot: "最新快照高度",
      snapshotCount: "快照数量",
      blocksSinceSnapshot: "自快照后的区块数",
      stateStorage: "状态与存储",
      lastSnapshotHeight: "最新快照高度",
      lastSnapshotTime: "最新快照时间",
      latestSnapshotType: "最新快照类型",
      full: "完整",
      delta: "增量",
      incremental: "增量",
      unknown: "未知",
      latestSnapshotSize: "最新快照大小",
      compressionRatio: "压缩比",
      reduction: "减少",
      estimatedUncompressed: "估计未压缩大小",
      stateHash: "状态哈希",
      verificationStatus: "验证状态",
      verified: "已验证",
      notVerified: "尚未验证",
      noHash: "无哈希",
      lastVerified: "最后验证时间",
      commitmentMatch: "承诺匹配",
      matches: "匹配",
      mismatch: "不匹配",
      remoteSnapshot: "远程快照",
      used: "已使用",
      notUsed: "未使用",
      disabled: "已禁用",
    },
    advanced: {
      title: "⚙️ 高级",
      configChecker: "配置检查器",
      resetChain: "重置链",
      resetChainDesc: "这将清除所有区块和状态，重新开始。此操作不可逆！",
    },
    tabs: {
      overview: "📊 概览",
      wallet: "💼 钱包",
      mining: "⛏️ 挖矿",
      transactions: "💸 交易",
      network: "🌐 网络",
      storage: "💾 存储",
      advanced: "⚙️ 高级",
      token: "🪙 代币",
    },
    banner: {
      systemReady: "系统就绪，可以开始挖矿",
      configRequired: "请完成配置以开始挖矿",
      networkConnected: "已连接网络 ({count} 个节点) • 钱包已初始化 • 当前高度: {height}",
      networkDisconnected: "需要连接网络并初始化钱包",
      walletInitializing: "需要初始化钱包（正在加载...）",
      configNetwork: "前往配置网络 →",
    },
    chain: {
      currentHeight: "当前高度",
      blockCount: "区块数量",
      pendingTxs: "待处理交易",
      mining: "挖矿",
      latestBlock: "最新区块",
      hash: "哈希",
      height: "高度",
      transactions: "交易",
      difficulty: "难度",
      nonce: "Nonce",
      stateCommitment: "状态承诺",
    },
    token: {
      title: "🪙 IDC 代币模型",
      overview: "代币概览",
      totalSupply: "总供应量",
      maxSupply: "最大供应量",
      decimals: "小数位数",
      emissionModel: "发行模型",
      halvingSchedule: "减半机制",
      blockReward: "区块奖励",
      currentEra: "当前时代",
      eraInfo: "时代信息",
      eraReward: "时代奖励",
      blocksInEra: "时代区块数",
      blocksRemaining: "剩余区块",
      eraStartHeight: "时代起始高度",
      eraEndHeight: "时代结束高度",
      transactionFees: "交易手续费",
      baseFee: "基础手续费",
      feePer100Bytes: "每 100 字节费用",
      feeFormula: "手续费公式",
      emissionCurve: "发行曲线",
      eraTable: "时代详情表",
      eraNumber: "时代",
      years: "年份",
      rewardPerBlock: "每区块奖励",
      totalEraReward: "时代总奖励",
      cumulativeReward: "累计奖励",
      economics: "代币经济学",
      inflationRate: "通胀率",
      deflationary: "通缩型",
      supplyCap: "供应上限",
      noInflation: "无通胀",
    },
    overview: {
      chainStatus: "链状态",
      networkStatus: "网络状态",
      walletStatus: "钱包状态",
      nodeIdentity: "节点身份",
      connectedPeers: "已连接节点",
      connectedTo: "已连接到",
    },
  },
  en: {
    common: {
      loading: "Loading...",
      error: "Error",
      success: "Success",
      confirm: "Confirm",
      cancel: "Cancel",
      close: "Close",
      save: "Save",
      delete: "Delete",
      edit: "Edit",
      copy: "Copy",
    },
    status: {
      ready: "Ready",
      notReady: "Not Ready",
      connected: "Connected",
      disconnected: "Disconnected",
      mining: "Mining",
      stopped: "Stopped",
      active: "Active",
      inactive: "Inactive",
    },
    quickStart: {
      title: "🚀 Quick Start Mining",
      step1Title: "Connect Network",
      step1Desc: "Need to connect to P2P network to sync blocks and participate in mining. Click the button above to go to Network tab for configuration.",
      step1Completed: "✓ Completed",
      step1Action: "Go to Config →",
      step2Title: "Check Wallet",
      step2Desc: "System is initializing wallet, please wait...",
      step2Completed: "✓ Completed",
      step3Title: "Start Mining",
      step3Desc: "After configuration, go to Mining tab to start mining. Mining runs in the background and won't affect other operations.",
      step3Mining: "⛏️ Mining",
      step3Action: "Go to Mining →",
      networkConnected: "Connected to {mode}, {count} peers",
      networkDisconnected: "Need to connect to P2P network to sync blocks and participate in mining. Click the button above to go to Network tab for configuration.",
      walletInitializing: "System is initializing wallet, please wait...",
      miningStarted: "Mining started! Current hash rate: {hashRate}",
      miningNotStarted: "After configuration, go to Mining tab to start mining. Mining runs in the background and won't affect other operations.",
    },
    mining: {
      title: "⛏️ Mining",
      guide: "📖 Mining Guide",
      whatIsMining: "What is Browser Mining?",
      whatIsMiningDesc: "IndexerChain is a blockchain that runs entirely in the browser. Through PoW (Proof of Work) mining, you can earn IDC token rewards. Mining runs in Web Workers and won't block the browser interface.",
      steps: "Mining Steps:",
      step1: "Ensure network is connected: Connect to P2P network (mainnet or dev) in Network tab",
      step2: "Check wallet status: Ensure wallet is initialized, mining rewards will be sent to your mining wallet address",
      step3: "Choose mining mode:",
      step3Single: "Single Worker Mode: Suitable for lightweight mining, low resource usage",
      step3Cluster: "Cluster Mining Mode: Uses multiple Web Workers, higher hash rate (Recommended)",
      step4: "Start mining: Click the button below to start, mining will run automatically in the background",
      tips: "💡 Tips:",
      tip1: "Mining reward = Block reward + Transaction fees",
      tip2: "Difficulty adjusts automatically based on network hash rate, maintaining ~10 seconds per block",
      tip3: "You can enable 'Auto Mining' to automatically start the next round after finding a block",
      tip4: "Mining can be stopped at any time without losing progress",
      active: "⛏️ Mining Active",
      controls: "⛏️ Mining Controls",
      singleWorker: "Single Worker Mode",
      singleWorkerDesc: "Suitable for lightweight mining, low resource usage, good for background running",
      clusterMining: "🔥 Cluster Mining Mode (Recommended)",
      clusterMiningDesc: "Uses multiple Web Workers for parallel mining, higher hash rate, faster mining",
      recommended: "Recommended",
      startMining: "⛏️ Start Mining",
      stopMining: "Stop Mining",
      startClusterMining: "🔥 Start Cluster Mining",
      stopClusterMining: "Stop Cluster Mining",
      autoMining: "Auto Mining (automatically continue after block found)",
      autoMiningDesc: "(Auto mining enabled - will automatically continue after block found)",
      workerCount: "Worker Count:",
      optimalWorkers: "Optimal: {count} workers (CPU cores - 1)",
      pendingTxs: "{count} pending transactions",
      coinbaseOnly: "coinbase only",
      status: "📊 Mining Status",
      difficulty: "Current Difficulty:",
      difficultyDesc: "{difficulty} (need {difficulty} leading zeros)",
      hashRate: "Estimated Hashrate:",
      hashesTried: "Total Hashes Tried:",
      elapsedTime: "Elapsed Time:",
      currentHash: "Current Hash:",
      currentNonce: "Current Nonce:",
      clusterStats: "🔥 Cluster Mining Stats",
      totalHashRate: "Total Hashrate:",
      activeWorkers: "Active Workers:",
      totalHashes: "Total Hashes Tried:",
      workerDetails: "Worker Details:",
      workerStatus: "Worker #{id}:",
      running: "running",
      stopped: "stopped",
      exhausted: "exhausted",
      nonceRange: "Nonce Range:",
      calculating: "Calculating...",
    },
    network: {
      title: "🌐 Network",
      status: "Status",
      mode: "Mode",
      mainnet: "🌐 Mainnet",
      dev: "🔧 Dev",
      peers: "Peers",
      connect: "Connect",
      disconnect: "Disconnect",
      mainnetMode: "Mainnet Mode (auto connect to mainnet)",
      mainnetDesc: "Mainnet Mode: Will automatically connect to public IndexerChain mainnet and mine with users worldwide. For local testing, uncheck 'Mainnet Mode'.",
      devMode: "Dev Mode",
      devModeDesc: "Dev Mode: Connect to local signaling server for development, testing, or private chain. Need to run node signaling-server-example.js first",
      signalingServer: "Signaling Server",
      fastRelay: "Fast Relay Status",
      headersCached: "Headers Cached",
      missingBodies: "Missing Bodies",
      pendingBodyRequests: "Pending Body Requests",
      receivedBodies: "Received Bodies",
      lastHeaderDelay: "Last Header Delay",
      lastBodyDownload: "Last Body Download",
      globalSnapshotNetwork: "Global Snapshot Network",
      snapshotSources: "Snapshot Sources",
      avgLatency: "Avg Latency",
      avgIntegrity: "Avg Integrity",
      cachedSnapshots: "Cached Snapshots",
      globalPool: "Global Pool",
      globalPoolDesc: "All nodes coordinate nonce ranges to avoid duplicate work.",
      enableGlobalPool: "Enable Global Pool",
      disableGlobalPool: "Disable Global Pool",
      delegatorStatus: "Delegator Status",
      isDelegator: "You are the delegator for this block.",
      notDelegator: "Not delegator",
      globalPointer: "Global Pointer",
      peerReputation: "Peer Reputation",
      peerReputationDesc: "Tracks peer behavior to prioritize reliable nodes and penalize misbehaving ones.",
      peerId: "Peer ID",
      score: "Score",
      trustLevel: "Trust Level",
      blocksServed: "Blocks Served",
      blocksInvalid: "Blocks Invalid",
      snapshotsServed: "Snapshots Served",
      snapshotsInvalid: "Snapshots Invalid",
      avgLatencyMs: "Avg Latency",
      workCompleted: "Work Completed",
      workFailed: "Work Failed",
      fastFinality: "Fast Finality Status",
      fastFinalityDesc: "Blocks reach finality (irreversibility) within 300-800ms through committee voting. Committee members are elected based on peer reputation scores.",
      finalizedBlocks: "Finalized Blocks",
      pendingVotes: "Pending Votes",
      committeeRound: "Committee Round",
      committeeSize: "Committee Size",
      members: "members",
      currentBlockFinality: "Current Block Finality",
      finalized: "Finalized",
      pending: "Pending",
      unconfirmed: "Unconfirmed",
      currentCommittee: "Current Committee",
      noCommittee: "No committee elected yet",
      notInitialized: "Finality manager not initialized",
      notInitializedDesc: "Connect to P2P network to enable finality.",
    },
    wallet: {
      title: "💼 Wallet",
      address: "Address",
      balance: "Balance",
      nodeId: "Node ID",
      manager: "Wallet Manager",
      backup: "Backup & Recovery",
    },
    transactions: {
      title: "💸 Transactions",
      transfer: "Transfer",
      transferIdc: "💸 Transfer IDC",
      recipient: "Recipient Address",
      amount: "Amount (IDC)",
      createTx: "Create Transaction",
      createIndexOp: "📝 Create Transaction (Index Operations)",
      operationType: "Operation Type",
      namespace: "Namespace",
      key: "Key",
      value: "Value",
      pending: "Pending",
      signing: "Signing...",
    },
    storage: {
      title: "💾 Storage",
      state: "State & Storage",
      lastSnapshot: "Last Snapshot Height",
      snapshotCount: "Snapshot Count",
      blocksSinceSnapshot: "Blocks Since Snapshot",
      stateStorage: "State & Storage",
      lastSnapshotHeight: "Last Snapshot Height",
      lastSnapshotTime: "Last Snapshot Time",
      latestSnapshotType: "Latest Snapshot Type",
      full: "Full",
      delta: "Delta",
      incremental: "Incremental",
      unknown: "Unknown",
      latestSnapshotSize: "Latest Snapshot Size",
      compressionRatio: "Compression Ratio",
      reduction: "reduction",
      estimatedUncompressed: "Estimated Uncompressed",
      stateHash: "State Hash",
      verificationStatus: "Verification Status",
      verified: "Verified",
      notVerified: "Not Verified Yet",
      noHash: "No Hash",
      lastVerified: "Last Verified",
      commitmentMatch: "Commitment Match",
      matches: "Matches",
      mismatch: "Mismatch",
      remoteSnapshot: "Remote Snapshot",
      used: "Used",
      notUsed: "Not Used",
      disabled: "Disabled",
    },
    advanced: {
      title: "⚙️ Advanced",
      configChecker: "Config Checker",
      resetChain: "Reset Chain",
      resetChainDesc: "This will clear all blocks and state, starting fresh. This action is irreversible!",
    },
    tabs: {
      overview: "📊 Overview",
      wallet: "💼 Wallet",
      mining: "⛏️ Mining",
      transactions: "💸 Transactions",
      network: "🌐 Network",
      storage: "💾 Storage",
      advanced: "⚙️ Advanced",
      token: "🪙 Token",
    },
    banner: {
      systemReady: "System ready, can start mining",
      configRequired: "Please complete configuration to start mining",
      networkConnected: "Network connected ({count} peers) • Wallet initialized • Current height: {height}",
      networkDisconnected: "Need to connect network and initialize wallet",
      walletInitializing: "Need to initialize wallet (loading...)",
      configNetwork: "Go to Config Network →",
    },
    chain: {
      currentHeight: "Current Height",
      blockCount: "Block Count",
      pendingTxs: "Pending Txs",
      mining: "Mining",
      latestBlock: "Latest Block",
      hash: "Hash",
      height: "Height",
      transactions: "Transactions",
      difficulty: "Difficulty",
      nonce: "Nonce",
      stateCommitment: "State Commitment",
    },
    token: {
      title: "🪙 IDC Token Model",
      overview: "Token Overview",
      totalSupply: "Total Supply",
      maxSupply: "Max Supply",
      decimals: "Decimals",
      emissionModel: "Emission Model",
      halvingSchedule: "Halving Schedule",
      blockReward: "Block Reward",
      currentEra: "Current Era",
      eraInfo: "Era Information",
      eraReward: "Era Reward",
      blocksInEra: "Blocks in Era",
      blocksRemaining: "Blocks Remaining",
      eraStartHeight: "Era Start Height",
      eraEndHeight: "Era End Height",
      transactionFees: "Transaction Fees",
      baseFee: "Base Fee",
      feePer100Bytes: "Fee per 100 Bytes",
      feeFormula: "Fee Formula",
      emissionCurve: "Emission Curve",
      eraTable: "Era Details Table",
      eraNumber: "Era",
      years: "Years",
      rewardPerBlock: "Reward per Block",
      totalEraReward: "Total Era Reward",
      cumulativeReward: "Cumulative Reward",
      economics: "Token Economics",
      inflationRate: "Inflation Rate",
      deflationary: "Deflationary",
      supplyCap: "Supply Cap",
      noInflation: "No Inflation",
    },
    overview: {
      chainStatus: "Chain Status",
      networkStatus: "Network Status",
      walletStatus: "Wallet Status",
      nodeIdentity: "Node Identity",
      connectedPeers: "Connected Peers",
      connectedTo: "Connected to",
    },
  },
};

