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
    name: string;
    size: string;
    created: string;
    none: string;
    appTitle: string;
    appSubtitle: string;
    chinese: string;
    english: string;
  };

  // Status
  status: {
    status: string;
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
    performancePresets: string;
    powerSave: string;
    powerSaveDesc: string;
    balanced: string;
    balancedDesc: string;
    performance: string;
    performanceDesc: string;
    extreme: string;
    extremeDesc: string;
    extremeWarning: string;
    detectedDevice: string;
    cpuCores: string;
    recommendedWorkers: string;
    workers: string;
    dutyCycle: string;
    hideCustomSettings: string;
    customSettings: string;
    workerCountLabel: string;
    estimatedCpuUsage: string;
    applyCustomSettings: string;
    miningMode: string;
    solo: string;
    soloDesc: string;
    localCluster: string;
    localClusterDesc: string;
    globalPool: string;
    globalPoolDesc: string;
    requiresHigherQuorum: string;
    followerMiningDisabled: string;
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
    waitingForCommittee: string;
    finalityInitializationMode: string;
    votes: string;
    member: string;
    issuedRatio: string;
  };

  // Wallet
  wallet: {
    title: string;
    address: string;
    balance: string;
    nodeId: string;
    manager: string;
    backup: string;
    exportWallet: string;
    importWallet: string;
    currentWalletAddress: string;
    exportSuccess: string;
    importSuccess: string;
    addressCopied: string;
    exportTitle: string;
    importTitle: string;
    enterPassword: string;
    confirmPassword: string;
    passwordsNotMatch: string;
    selectBackupFile: string;
    enterBackupPassword: string;
    step1EnterPassword: string;
    step2SelectFile: string;
    passwordHint: string;
    fileHint: string;
    enterPasswordFirst: string;
    activeWallets: string;
    currentWallet: string;
    miningWallet: string;
    walletList: string;
    noWallets: string;
    createFirstWallet: string;
    setAsCurrent: string;
    setAsMining: string;
    rename: string;
    delete: string;
    export: string;
    createNewWallet: string;
    walletName: string;
    create: string;
    deleteConfirm: string;
    cannotUndone: string;
    walletExported: string;
    walletImported: string;
    pleaseEnterPassword: string;
    pleaseEnterBackupPassword: string;
    failedToExport: string;
    failedToImport: string;
    failedToDelete: string;
    pleaseEnterWalletName: string;
    backupFileDownloaded: string;
    failedToReadBackup: string;
    encryptionNotice: string;
    securityNotice: string;
    securityNotice1: string;
    securityNotice2: string;
    securityNotice3: string;
    securityNotice4: string;
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
    stateCommitment: string;
    source: string;
    remoteHeight: string;
    remoteStateHash: string;
    needAtLeastOneBlock: string;
    forceSnapshot: string;
    clearAllSnapshotsConfirm: string;
    clearSnapshots: string;
    allSnapshotsCleared: string;
    recompressedSnapshots: string;
    allSnapshotsCompressed: string;
    recompressing: string;
    recompressAll: string;
    failedToCreateSnapshot: string;
    failedToRecompressSnapshots: string;
    snapshotNotFound: string;
    snapshotVerifiedSuccess: string;
    snapshotCorruptedDeleted: string;
    failedToVerifySnapshot: string;
  };

  // Advanced (expanded)
  advanced: {
    title: string;
    configChecker: string;
    resetChain: string;
    resetChainDesc: string;
    showAdvancedTabs: string;
    hideAdvancedTabs: string;
    idcEmission: string;
    totalMinted: string;
    mintingProgress: string;
    currentEra: string;
    blockRewardNext: string;
    blocksInEra: string;
    remaining: string;
    lastBlocks: string;
    totalPeersTracked: string;
    trusted: string;
    normal: string;
    lowTrust: string;
    banned: string;
    peerDetails: string;
    runtimeHelp: string;
    initializing: string;
    safetyIssuesDetected: string;
    eventLoopLag: string;
    lowFps: string;
    highCrashRate: string;
    multiTabConflict: string;
    anotherTabMining: string;
    considerStopping: string;
    backgroundMode: string;
    tabInBackground: string;
    deviceCapability: string;
    type: string;
    cpuCores: string;
    recommendedWorkers: string;
    maxWorkers: string;
    cpuUsageControl: string;
    dutyCycle: string;
    powerSave: string;
    balanced: string;
    performance: string;
    extreme: string;
    workerCount: string;
    workers: string;
    workerCountExceeds: string;
    mayCausePerformanceIssues: string;
    performanceMetrics: string;
    workerCrashes: string;
    lastCrash: string;
    never: string;
    autoThrottleWhenBackground: string;
    manualNoAutoThrottle: string;
    persistentBackgroundMining: string;
    releaseWakeLock: string;
    requestWakeLock: string;
    preventsBrowserPausing: string;
    warning: string;
    highBatteryConsumption: string;
    helpTips: string;
    dutyCycleDesc: string;
    workerCountDesc: string;
    eventLoopLagDesc: string;
    fpsDesc: string;
    multiTabConflictDesc: string;
    wakeLockNotSupported: string;
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
      privacy: string;
      tools: string;
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
      localInstanceStatus: string;
      role: string;
      leader: string;
      follower: string;
      leaderInstance: string;
      waitingForPeerConnections: string;
      waitingForPeerConnectionsDesc: string;
      waitingForPeerConnectionsTip: string;
      leaderHeight: string;
      followerReadOnly: string;
      syncedToLatest: string;
    };

    // Tools
    tools: {
      title: string;
      description: string;
      storageInformation: string;
      chainBlocks: string;
      snapshotsMetadata: string;
      snapshots: string;
      total: string;
      chainDataManagement: string;
      resetChain: string;
      resetChainDesc: string;
      resetChainButton: string;
      clearSnapshots: string;
      clearSnapshotsDesc: string;
      clearSnapshotsConfirm: string;
      clearSnapshotsButton: string;
      clearSnapshotsSuccess: string;
      commonIssues: string;
      insufficientBalanceError: string;
      insufficientBalanceErrorDesc: string;
      fixBalanceError: string;
      initializationError: string;
      initializationErrorDesc: string;
      fixInitializationError: string;
      storageCleanup: string;
      clearAllData: string;
      clearAllDataDesc: string;
      clearAllDataConfirm: string;
      clearAllDataButton: string;
      clearAllDataSuccess: string;
      cleanUnusedStorage: string;
      cleanUnusedStorageDesc: string;
      noUnusedStorage: string;
      foundUnusedStorage: string;
      clearedUnusedStorage: string;
      warning: string;
      warningDesc: string;
      prunedOldBlocks: string;
      leaderHeight: string;
      followerReadOnly: string;
    };

    // Privacy
    privacy: {
      title: string;
    };

    // Transactions (expanded)
    transactionsExpanded: {
      currentBalance: string;
      address: string;
      recipientAddress: string;
      transferAmount: string;
      balanceAfterTransfer: string;
      insufficientBalance: string;
      pleaseEnterRecipient: string;
      amountMustBePositive: string;
      insufficientBalanceError: string;
      transferFailed: string;
      signingTransaction: string;
      transferSuccess: string;
      pendingTransactions: string;
      txId: string;
      from: string;
      ops: string;
    };

    // Network (expanded)
    networkExpanded: {
      p2pNetwork: string;
      mode: string;
      status: string;
      peers: string;
      connected: string;
      disconnected: string;
      mainnetSignalingServer: string;
      localSignalingServer: string;
      seconds: string;
      enabled: string;
      disabled: string;
      role: string;
      delegator: string;
      workerNode: string;
      activeRanges: string;
      totalNodes: string;
    };

    // Storage (expanded)
    storageExpanded: {
      lightNodeStatus: string;
      lightNodeWindow: string;
      storedBlocks: string;
      earliestBlockHeight: string;
      latestBlockHeight: string;
      storageReduction: string;
      clearPrunedBlocks: string;
      verifyLatestSnapshot: string;
      fetchRemoteSnapshot: string;
      remoteSnapshotNotEnabled: string;
      fetchingRemoteSnapshot: string;
      remoteSnapshotSynced: string;
      reloadToApply: string;
      failedToFetchRemoteSnapshot: string;
      blocks: string;
      extremePruning: string;
    };

    // Advanced (expanded)
    advancedExpanded: {
      difficultyStatus: string;
      currentDifficulty: string;
      targetBlockTime: string;
      blocksUntilAdjustment: string;
      averageBlockTime: string;
      difficultyChange: string;
      difficultyExplanation: string;
    };

    // Common (expanded)
    commonExpanded: {
      seconds: string;
      unknown: string;
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
      name: "名称",
      size: "大小",
      created: "创建时间",
      none: "无",
      appTitle: "IndexerChain",
      appSubtitle: "Browser-Native Blockchain",
      chinese: "中文",
      english: "English",
    },
    status: {
      status: "状态",
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
      performancePresets: "性能预设",
      powerSave: "省电模式",
      powerSaveDesc: "低 CPU 占用，适合笔记本电脑或长时间运行",
      balanced: "平衡模式",
      balancedDesc: "平衡性能和功耗，推荐日常使用",
      performance: "性能模式",
      performanceDesc: "较高 CPU 占用，提升挖矿速度",
      extreme: "极限模式",
      extremeDesc: "最高性能，可能导致设备发热和风扇噪音",
      extremeWarning: "⚠️ 可能导致设备过热，请确保良好散热",
      detectedDevice: "检测到设备",
      cpuCores: "CPU 核心数",
      recommendedWorkers: "推荐 Worker 数",
      workers: "Worker 数",
      dutyCycle: "Duty Cycle",
      hideCustomSettings: "隐藏自定义设置",
      customSettings: "自定义设置",
      workerCountLabel: "Worker 数量",
      estimatedCpuUsage: "估算 CPU 占用",
      applyCustomSettings: "应用自定义设置",
      miningMode: "挖矿模式",
      solo: "单机挖矿",
      soloDesc: "使用单个 Worker 进行挖矿，适合低功耗设备",
      localCluster: "本地集群",
      localClusterDesc: "使用多个 Worker 并行挖矿，提高算力",
      globalPool: "全局矿池",
      globalPoolDesc: "加入全局矿池，与其他节点协作挖矿",
      requiresHigherQuorum: "需要更高的 Quorum 分数",
      followerMiningDisabled: "⚠️ 此实例为 FOLLOWER（只读模式），所有挖矿模式已禁用",
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
      waitingForCommittee: "等待委员会",
      finalityInitializationMode: "Phase 39: Finality 初始化模式 - 挖矿已允许",
      votes: "票",
      member: "成员",
      issuedRatio: "已发行比例",
    },
    wallet: {
      title: "💼 钱包",
      address: "地址",
      balance: "余额",
      nodeId: "节点 ID",
      manager: "钱包管理",
      backup: "备份与恢复",
      exportWallet: "导出钱包",
      importWallet: "导入钱包",
      currentWalletAddress: "当前钱包地址",
      exportSuccess: "✅ 钱包备份导出成功！请安全保存文件。",
      importSuccess: "✅ 钱包导入成功！您的身份已恢复。",
      addressCopied: "地址已复制到剪贴板！",
      exportTitle: "🔐 导出钱包",
      importTitle: "♻️ 导入钱包",
      enterPassword: "输入密码（至少 8 个字符）",
      confirmPassword: "确认密码",
      passwordsNotMatch: "密码不匹配",
      selectBackupFile: "选择备份文件",
      enterBackupPassword: "输入备份密码",
      step1EnterPassword: "步骤 1: 输入备份密码",
      step2SelectFile: "步骤 2: 选择备份文件",
      passwordHint: "💡 输入创建备份时使用的密码。",
      fileHint: "💡 输入您的备份密码，然后选择您的 .idcbackup 文件。您的钱包身份将恢复到此浏览器。",
      enterPasswordFirst: "⚠️ 请先输入密码，然后再选择备份文件。",
      activeWallets: "📋 活动钱包",
      currentWallet: "当前钱包",
      miningWallet: "挖矿钱包",
      walletList: "💼 钱包列表",
      noWallets: "还没有钱包。请在下方创建您的第一个钱包。",
      createFirstWallet: "还没有钱包。请在下方创建您的第一个钱包。",
      setAsCurrent: "设为当前",
      setAsMining: "设为挖矿",
      rename: "重命名",
      delete: "删除",
      export: "导出",
      createNewWallet: "创建新钱包",
      walletName: "钱包名称",
      create: "创建",
      deleteConfirm: "删除钱包",
      cannotUndone: "此操作不可逆！",
      walletExported: "✅ 钱包导出成功！",
      walletImported: "✅ 钱包导入成功！",
      pleaseEnterPassword: "请输入密码",
      pleaseEnterBackupPassword: "请输入备份密码",
      failedToExport: "导出钱包失败",
      failedToImport: "导入钱包失败",
      failedToDelete: "删除钱包失败",
      pleaseEnterWalletName: "请输入钱包名称",
      backupFileDownloaded: "✅ 备份文件 \"{filename}\" 下载成功！地址: {address}...",
      failedToReadBackup: "读取备份文件失败。请确保这是一个有效的 .idcbackup 文件。",
      encryptionNotice: "💡 您的私钥将使用 PBKDF2（20万次迭代）+ AES-GCM 加密。请安全保存备份文件 - 您需要它来恢复钱包。",
      securityNotice: "⚠️ 安全提示：",
      securityNotice1: "备份文件已加密 - 永远不要分享您的密码",
      securityNotice2: "将备份存储在安全位置（密码管理器、加密驱动器）",
      securityNotice3: "没有备份文件和密码，您无法恢复钱包",
      securityNotice4: "这是一个零信任系统 - 没有服务器存储您的密钥",
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
      stateCommitment: "State Commitment",
      source: "来源",
      remoteHeight: "远程高度",
      remoteStateHash: "远程状态哈希",
      needAtLeastOneBlock: "需要至少一个区块（创世区块之后）才能创建快照",
      forceSnapshot: "强制创建快照",
      clearAllSnapshotsConfirm: "清除所有快照？下次启动时会从创世区块重建状态。",
      clearSnapshots: "清除快照",
      allSnapshotsCleared: "所有快照已清除。下次启动时会从创世区块重建状态。",
      recompressedSnapshots: "已重新压缩 {count} 个快照",
      allSnapshotsCompressed: "所有快照已压缩",
      recompressing: "重新压缩中...",
      recompressAll: "重新压缩全部",
      failedToCreateSnapshot: "创建快照失败",
      failedToRecompressSnapshots: "重新压缩快照失败",
      snapshotNotFound: "快照未找到或已删除",
      snapshotVerifiedSuccess: "✅ 快照验证成功！",
      snapshotCorruptedDeleted: "❌ 快照已损坏并已删除。下次启动将使用高度 {fallbackHeight} 的快照或从创世区块重放。",
      failedToVerifySnapshot: "验证快照失败",
    },
    advanced: {
      title: "⚙️ 高级",
      configChecker: "配置检查器",
      resetChain: "重置链",
      resetChainDesc: "这将清除所有区块和状态，重新开始。此操作不可逆！",
      showAdvancedTabs: "显示高级标签",
      hideAdvancedTabs: "隐藏高级标签",
      idcEmission: "💰 IDC 发行",
      totalMinted: "总发行量",
      mintingProgress: "挖矿进度",
      currentEra: "当前时代",
      blockRewardNext: "区块奖励（下一个）",
      blocksInEra: "时代中的区块数",
      remaining: "剩余",
      lastBlocks: "最后 {count} 个",
      totalPeersTracked: "跟踪的节点总数",
      trusted: "信任",
      normal: "正常",
      lowTrust: "低信任",
      banned: "已禁止",
      peerDetails: "节点详情",
      runtimeHelp: "🔧 运行时与帮助",
      initializing: "初始化中...",
      safetyIssuesDetected: "⚠️ 检测到安全问题",
      eventLoopLag: "事件循环延迟",
      lowFps: "低 FPS",
      highCrashRate: "崩溃频率高",
      multiTabConflict: "⚠️ 多标签页冲突",
      anotherTabMining: "另一个标签页正在挖矿 ({count} 个标签页)",
      considerStopping: "建议停止其他标签页的挖矿以避免资源冲突。",
      backgroundMode: "📱 后台模式",
      tabInBackground: "标签页在后台。挖矿已自动节流。",
      deviceCapability: "设备能力",
      type: "类型",
      cpuCores: "CPU 核心数",
      recommendedWorkers: "推荐 Worker 数",
      maxWorkers: "最大 Worker 数",
      cpuUsageControl: "CPU 使用控制",
      dutyCycle: "Duty Cycle",
      powerSave: "💾 省电模式",
      balanced: "⚖️ 平衡模式",
      performance: "⚡ 性能模式",
      extreme: "🔥 极限模式",
      workerCount: "Worker 数量",
      workers: "Workers",
      workerCountExceeds: "⚠️ Worker 数量超过推荐值 ({recommended})",
      mayCausePerformanceIssues: "这可能导致性能问题。",
      performanceMetrics: "性能指标",
      workerCrashes: "Worker 崩溃",
      lastCrash: "最后崩溃",
      never: "从未",
      autoThrottleWhenBackground: "自动（后台时节流）",
      manualNoAutoThrottle: "手动（无自动节流）",
      persistentBackgroundMining: "持久后台挖矿",
      releaseWakeLock: "🔒 释放唤醒锁",
      requestWakeLock: "🔓 请求唤醒锁",
      preventsBrowserPausing: "防止浏览器在标签页处于后台时暂停挖矿。",
      warning: "警告",
      highBatteryConsumption: "高电池消耗！",
      helpTips: "💡 帮助与提示",
      dutyCycleDesc: "Duty Cycle：控制 CPU 使用率。较低的值会降低 CPU 使用率，但也会降低挖矿速度。",
      workerCountDesc: "Worker 数量：更多 Worker = 更多并行挖矿，但 CPU 使用率更高。",
      eventLoopLagDesc: "事件循环延迟：应 < 200ms。较高的值表示 UI 延迟。",
      fpsDesc: "FPS：应 > 20。较低的值表示 UI 卡顿。",
      multiTabConflictDesc: "多标签页冲突：一次只应有一个标签页挖矿，以避免资源冲突。",
      wakeLockNotSupported: "唤醒锁 API 不支持或权限被拒绝",
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
      privacy: "🔒 隐私",
      tools: "🔧 工具",
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
      localInstanceStatus: "本地实例状态",
      role: "角色",
      leader: "主节点 (LEADER)",
      follower: "跟随节点 (FOLLOWER)",
      leaderInstance: "Leader 实例",
      waitingForPeerConnections: "等待对等节点连接",
      waitingForPeerConnectionsDesc: "当前已连接到信令服务器，但还没有对等节点连接（{count} 个对等节点）。系统正在自动请求对等节点...",
      waitingForPeerConnectionsTip: "💡 提示：如果有其他节点在线，它们会自动连接。如果没有其他节点，您可以开始挖矿，您的节点将成为网络的一部分。",
      leaderHeight: "Leader 高度",
      followerReadOnly: "⚠️ 当前实例为只读模式。如需挖矿，请先在其他实例中关闭挖矿或关闭页面。",
      syncedToLatest: "已同步到最新高度",
    },
    tools: {
      title: "🔧 工具",
      description: "用于处理本地存储引起的问题和链数据管理",
      storageInformation: "📊 存储信息",
      chainBlocks: "链区块数据:",
      snapshotsMetadata: "快照元数据:",
      snapshots: "快照数据 ({count}):",
      total: "总计:",
      chainDataManagement: "⛓️ 链数据管理",
      resetChain: "重置链",
      resetChainDesc: "清除所有链数据和快照，然后从创世区块重新开始。用于修复链状态损坏或数据不一致问题。",
      resetChainButton: "🔄 重置链",
      clearSnapshots: "清除快照",
      clearSnapshotsDesc: "仅清除快照数据，保留链区块数据。下次启动时会从创世区块重建状态。",
      clearSnapshotsConfirm: "确定要清除所有快照吗？下次启动时会从创世区块重建状态。",
      clearSnapshotsButton: "🗑️ 清除快照",
      clearSnapshotsSuccess: "✅ 所有快照已清除。下次启动时会从创世区块重建状态。",
      commonIssues: "🔍 常见问题修复",
      insufficientBalanceError: "余额不足错误",
      insufficientBalanceErrorDesc: "如果遇到 'Insufficient balance' 错误，通常表示链状态损坏或快照不一致。点击下面的按钮清除所有数据并重新开始。",
      fixBalanceError: "修复余额错误",
      initializationError: "初始化错误",
      initializationErrorDesc: "如果遇到链初始化错误，通常表示链数据损坏。点击下面的按钮清除所有数据并重新开始。",
      fixInitializationError: "修复初始化错误",
      storageCleanup: "🗑️ 存储清理",
      clearAllData: "清除所有数据",
      clearAllDataDesc: "清除所有链数据、快照和应用状态。这将完全重置应用，所有数据将丢失。",
      clearAllDataConfirm: "确定要清除所有数据吗？这将完全重置应用，所有数据将丢失。此操作不可逆！",
      clearAllDataButton: "🗑️ 清除所有数据",
      clearAllDataSuccess: "✅ 所有数据已清除。页面将重新加载。",
      cleanUnusedStorage: "🧹 清理未使用的存储",
      cleanUnusedStorageDesc: "检查并清理未使用的本地存储数据。这不会影响链数据。",
      noUnusedStorage: "没有发现未使用的存储数据。",
      foundUnusedStorage: "发现 {count} 个非链相关的存储项。是否清除？",
      clearedUnusedStorage: "✅ 已清除 {count} 个存储项。",
      warning: "警告",
      warningDesc: "这些操作会永久删除数据。请确保您了解操作的后果。建议在执行前备份重要数据。",
      prunedOldBlocks: "已清除旧区块",
      leaderHeight: "Leader 高度",
      followerReadOnly: "⚠️ 当前实例为只读模式。如需挖矿，请先在其他实例中关闭挖矿或关闭页面。",
    },
    privacy: {
      title: "🔒 隐私",
    },
    transactionsExpanded: {
      currentBalance: "当前余额",
      address: "地址",
      recipientAddress: "收款地址",
      transferAmount: "转账金额",
      balanceAfterTransfer: "转账后余额",
      insufficientBalance: "余额不足",
      pleaseEnterRecipient: "请输入收款地址和金额",
      amountMustBePositive: "金额必须是正数",
      insufficientBalanceError: "余额不足。当前余额: {current} IDC，转账金额: {amount} IDC",
      transferFailed: "添加转账交易失败（可能是重复交易或无效交易）",
      signingTransaction: "正在使用私钥签名交易...",
      transferSuccess: "转账交易已创建并广播！金额: {amount} IDC，接收者: {recipient}...",
      pendingTransactions: "⏳ 待处理交易",
      txId: "TxID:",
      from: "From:",
      ops: "Ops:",
    },
    networkExpanded: {
      p2pNetwork: "🌐 P2P Network",
      mode: "Mode:",
      status: "Status:",
      peers: "Peers:",
      connected: "Connected",
      disconnected: "Disconnected",
      mainnetSignalingServer: "主网信令服务器 (wss://...)",
      localSignalingServer: "本地信令服务器 (ws://localhost:8080)",
      seconds: "秒",
      enabled: "已启用",
      disabled: "已禁用",
      role: "角色",
      delegator: "委托者",
      workerNode: "工作节点",
      activeRanges: "活跃范围",
      totalNodes: "总节点数",
    },
    storageExpanded: {
      lightNodeStatus: "💡 Light Node Status",
      lightNodeWindow: "Light Node Window:",
      storedBlocks: "Stored Blocks:",
      earliestBlockHeight: "Earliest Block Height:",
      latestBlockHeight: "Latest Block Height:",
      storageReduction: "Storage Reduction:",
      clearPrunedBlocks: "Clear Pruned Blocks",
      verifyLatestSnapshot: "Verify Latest Snapshot",
      fetchRemoteSnapshot: "Fetch Remote Snapshot",
      remoteSnapshotNotEnabled: "Remote snapshot sync is not enabled. Please configure remoteSnapshotEndpoints in chain params.",
      fetchingRemoteSnapshot: "Fetching remote snapshot...",
      remoteSnapshotSynced: "✅ Remote snapshot synced successfully from height {height}!",
      reloadToApply: "Remote snapshot downloaded. Reload page to apply it?",
      failedToFetchRemoteSnapshot: "❌ Failed to fetch remote snapshot from any configured source.",
      blocks: "blocks",
      extremePruning: "(Extreme Pruning - Phase 15)",
    },
    advancedExpanded: {
      difficultyStatus: "⚙️ Difficulty Status",
      currentDifficulty: "Current Difficulty:",
      targetBlockTime: "Target Block Time:",
      blocksUntilAdjustment: "Blocks Until Adjustment:",
      averageBlockTime: "Average Block Time:",
      difficultyChange: "Difficulty Change:",
      difficultyExplanation: "Difficulty Explanation:",
    },
    commonExpanded: {
      seconds: "秒",
      unknown: "Unknown",
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
      name: "Name",
      size: "Size",
      created: "Created",
      none: "None",
      appTitle: "IndexerChain",
      appSubtitle: "Browser-Native Blockchain",
      chinese: "中文",
      english: "English",
    },
    status: {
      status: "Status",
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
      performancePresets: "Performance Presets",
      powerSave: "Power Save",
      powerSaveDesc: "Low CPU usage, suitable for laptops or long-running",
      balanced: "Balanced",
      balancedDesc: "Balance performance and power, recommended for daily use",
      performance: "Performance",
      performanceDesc: "Higher CPU usage, faster mining",
      extreme: "Extreme",
      extremeDesc: "Maximum performance, may cause device heating and fan noise",
      extremeWarning: "⚠️ May cause device overheating, ensure proper cooling",
      detectedDevice: "Detected device",
      cpuCores: "CPU cores",
      recommendedWorkers: "Recommended workers",
      workers: "Workers",
      dutyCycle: "Duty Cycle",
      hideCustomSettings: "Hide Custom Settings",
      customSettings: "Custom Settings",
      workerCountLabel: "Worker Count",
      estimatedCpuUsage: "Estimated CPU Usage",
      applyCustomSettings: "Apply Custom Settings",
      miningMode: "Mining Mode",
      solo: "Solo",
      soloDesc: "Mine with a single worker, suitable for low-power devices",
      localCluster: "Local Cluster",
      localClusterDesc: "Use multiple workers for parallel mining, higher hash rate",
      globalPool: "Global Pool",
      globalPoolDesc: "Join global pool, collaborate with other nodes",
      requiresHigherQuorum: "Requires higher Quorum score",
      followerMiningDisabled: "⚠️ This instance is FOLLOWER (read-only), all mining modes are disabled",
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
      exportWallet: "Export Wallet",
      importWallet: "Import Wallet",
      currentWalletAddress: "Current Wallet Address",
      exportSuccess: "✅ Wallet backup exported successfully! Save the file securely.",
      importSuccess: "✅ Wallet imported successfully! Your identity has been restored.",
      addressCopied: "Address copied to clipboard!",
      exportTitle: "🔐 Export Wallet",
      importTitle: "♻️ Import Wallet",
      enterPassword: "Enter password (min 8 characters)",
      confirmPassword: "Confirm password",
      passwordsNotMatch: "Passwords do not match",
      selectBackupFile: "Select Backup File",
      enterBackupPassword: "Enter backup password",
      step1EnterPassword: "Step 1: Enter Backup Password",
      step2SelectFile: "Step 2: Select Backup File",
      passwordHint: "💡 Enter the password you used when creating the backup file.",
      fileHint: "💡 Enter your backup password, then select your .idcbackup file. Your wallet identity will be restored to this browser.",
      enterPasswordFirst: "⚠️ Please enter your password first before selecting the backup file.",
      activeWallets: "📋 Active Wallets",
      currentWallet: "Current Wallet",
      miningWallet: "Mining Wallet",
      walletList: "💼 Wallet List",
      noWallets: "No wallets yet. Create your first wallet below.",
      createFirstWallet: "No wallets yet. Create your first wallet below.",
      setAsCurrent: "Set as Current",
      setAsMining: "Set as Mining",
      rename: "Rename",
      delete: "Delete",
      export: "Export",
      createNewWallet: "Create New Wallet",
      walletName: "Wallet Name",
      create: "Create",
      deleteConfirm: "Delete wallet",
      cannotUndone: "This cannot be undone!",
      walletExported: "✅ Wallet exported successfully!",
      walletImported: "✅ Wallet imported successfully!",
      pleaseEnterPassword: "Please enter a password",
      pleaseEnterBackupPassword: "Please enter the backup password",
      failedToExport: "Failed to export wallet",
      failedToImport: "Failed to import wallet",
      failedToDelete: "Failed to delete wallet",
      pleaseEnterWalletName: "Please enter a wallet name",
      backupFileDownloaded: "✅ Backup file \"{filename}\" downloaded successfully! Address: {address}...",
      failedToReadBackup: "Failed to read backup file. Please ensure it's a valid .idcbackup file.",
      encryptionNotice: "💡 Your private key will be encrypted with PBKDF2 (200k iterations) + AES-GCM. Save the backup file securely - you'll need it to recover your wallet.",
      securityNotice: "⚠️ Security Notice:",
      securityNotice1: "Backup files are encrypted - never share your password",
      securityNotice2: "Store backups in a secure location (password manager, encrypted drive)",
      securityNotice3: "Without the backup file and password, you cannot recover your wallet",
      securityNotice4: "This is a zero-trust system - no server stores your keys",
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
      stateCommitment: "State Commitment",
      source: "Source",
      remoteHeight: "Remote Height",
      remoteStateHash: "Remote StateHash",
      needAtLeastOneBlock: "Need at least one block (after genesis) to create snapshot",
      forceSnapshot: "Force Snapshot",
      clearAllSnapshotsConfirm: "Clear all snapshots? Next startup will rebuild from genesis.",
      clearSnapshots: "Clear Snapshots",
      allSnapshotsCleared: "All snapshots cleared. Next startup will rebuild from genesis.",
      recompressedSnapshots: "Recompressed {count} snapshot(s)",
      allSnapshotsCompressed: "All snapshots are already compressed",
      recompressing: "Recompressing...",
      recompressAll: "Recompress All",
      failedToCreateSnapshot: "Failed to create snapshot",
      failedToRecompressSnapshots: "Failed to recompress snapshots",
      snapshotNotFound: "Snapshot not found or already deleted",
      snapshotVerifiedSuccess: "✅ Snapshot verified successfully!",
      snapshotCorruptedDeleted: "❌ Snapshot corrupted and deleted. Next startup will use snapshot at height {fallbackHeight} or replay from genesis.",
      failedToVerifySnapshot: "Failed to verify snapshot",
    },
    advanced: {
      title: "⚙️ Advanced",
      configChecker: "Config Checker",
      resetChain: "Reset Chain",
      resetChainDesc: "This will clear all blocks and state, starting fresh. This action is irreversible!",
      showAdvancedTabs: "Show Advanced Tabs",
      hideAdvancedTabs: "Hide Advanced Tabs",
      idcEmission: "💰 IDC Emission",
      totalMinted: "Total Minted",
      mintingProgress: "Minting Progress",
      currentEra: "Current Era",
      blockRewardNext: "Block Reward (next)",
      blocksInEra: "Blocks in Era",
      remaining: "remaining",
      lastBlocks: "last {count}",
      totalPeersTracked: "Total Peers Tracked",
      trusted: "Trusted",
      normal: "Normal",
      lowTrust: "Low Trust",
      banned: "Banned",
      peerDetails: "Peer Details",
      runtimeHelp: "🔧 Runtime & Help",
      initializing: "Initializing...",
      safetyIssuesDetected: "⚠️ Safety Issues Detected",
      eventLoopLag: "Event loop lag",
      lowFps: "Low FPS",
      highCrashRate: "High crash rate",
      multiTabConflict: "⚠️ Multi-tab Conflict",
      anotherTabMining: "Another tab is mining ({count} tab{plural})",
      considerStopping: "Consider stopping mining in other tabs to avoid resource conflicts.",
      backgroundMode: "📱 Background Mode",
      tabInBackground: "Tab is in background. Mining is automatically throttled.",
      deviceCapability: "Device Capability",
      type: "Type",
      cpuCores: "CPU Cores",
      recommendedWorkers: "Recommended Workers",
      maxWorkers: "Max Workers",
      cpuUsageControl: "CPU Usage Control",
      dutyCycle: "Duty Cycle",
      powerSave: "💾 Power Save",
      balanced: "⚖️ Balanced",
      performance: "⚡ Performance",
      extreme: "🔥 Extreme",
      workerCount: "Worker Count",
      workers: "Workers",
      workerCountExceeds: "⚠️ Worker count exceeds recommended ({recommended})",
      mayCausePerformanceIssues: "This may cause performance issues.",
      performanceMetrics: "Performance Metrics",
      workerCrashes: "Worker Crashes",
      lastCrash: "Last Crash",
      never: "Never",
      autoThrottleWhenBackground: "Auto (throttle when background)",
      manualNoAutoThrottle: "Manual (no auto-throttle)",
      persistentBackgroundMining: "Persistent Background Mining",
      releaseWakeLock: "🔒 Release Wake Lock",
      requestWakeLock: "🔓 Request Wake Lock",
      preventsBrowserPausing: "Prevents browser from pausing mining when tab is in background.",
      warning: "Warning",
      highBatteryConsumption: "High battery consumption!",
      helpTips: "💡 Help & Tips",
      dutyCycleDesc: "Duty Cycle: Controls CPU usage. Lower values reduce CPU usage but also reduce mining speed.",
      workerCountDesc: "Worker Count: More workers = more parallel mining, but higher CPU usage.",
      eventLoopLagDesc: "Event Loop Lag: Should be < 200ms. Higher values indicate UI lag.",
      fpsDesc: "FPS: Should be > 20. Lower values indicate UI stuttering.",
      multiTabConflictDesc: "Multi-tab Conflict: Only one tab should mine at a time to avoid resource conflicts.",
      wakeLockNotSupported: "Wake Lock API not supported or permission denied",
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
      privacy: "🔒 Privacy",
      tools: "🔧 Tools",
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
      localInstanceStatus: "Local Instance Status",
      role: "Role",
      leader: "Leader",
      follower: "Follower",
      leaderInstance: "Leader Instance",
      waitingForPeerConnections: "Waiting for peer connections",
      waitingForPeerConnectionsDesc: "Connected to signaling server, but no peers yet ({count} peer(s)). System is automatically requesting peers...",
      waitingForPeerConnectionsTip: "💡 Tip: If other nodes are online, they will connect automatically. If no other nodes exist, you can start mining and your node will become part of the network.",
      leaderHeight: "Leader Height",
      followerReadOnly: "⚠️ Current instance is read-only. To mine, please stop mining on other instances or close their pages.",
      syncedToLatest: "Synced to latest height",
    },
    tools: {
      title: "🔧 Tools",
      description: "Tools for handling local storage issues and chain data management",
      storageInformation: "📊 Storage Information",
      chainBlocks: "Chain Blocks:",
      snapshotsMetadata: "Snapshots Metadata:",
      snapshots: "Snapshots ({count}):",
      total: "Total:",
      chainDataManagement: "⛓️ Chain Data Management",
      resetChain: "Reset Chain",
      resetChainDesc: "Clear all chain data and snapshots, then start fresh from genesis block. Use this to fix chain state corruption or data inconsistency issues.",
      resetChainButton: "🔄 Reset Chain",
      clearSnapshots: "Clear Snapshots",
      clearSnapshotsDesc: "Clear only snapshot data, keeping chain blocks. State will be rebuilt from genesis on next startup.",
      clearSnapshotsConfirm: "Clear all snapshots? Next startup will rebuild from genesis.",
      clearSnapshotsButton: "🗑️ Clear Snapshots",
      clearSnapshotsSuccess: "✅ All snapshots cleared. Next startup will rebuild from genesis.",
      commonIssues: "🔍 Common Issues & Fixes",
      insufficientBalanceError: "Insufficient Balance Error",
      insufficientBalanceErrorDesc: "If you encounter 'Insufficient balance' errors, it usually means chain state corruption or snapshot inconsistency. Click the button below to clear all data and start fresh.",
      fixBalanceError: "Fix Balance Error",
      initializationError: "Initialization Error",
      initializationErrorDesc: "If you encounter chain initialization errors, it usually means chain data corruption. Click the button below to clear all data and start fresh.",
      fixInitializationError: "Fix Initialization Error",
      storageCleanup: "🗑️ Storage Cleanup",
      clearAllData: "Clear All Data",
      clearAllDataDesc: "Clear all chain data, snapshots, and application state. This will completely reset the application and all data will be lost.",
      clearAllDataConfirm: "Clear all data? This will completely reset the application and all data will be lost. This action is irreversible!",
      clearAllDataButton: "🗑️ Clear All Data",
      clearAllDataSuccess: "✅ All data cleared. Page will reload.",
      cleanUnusedStorage: "🧹 Clean Unused Storage",
      cleanUnusedStorageDesc: "Check and clean up unused local storage data. This won't affect chain data.",
      noUnusedStorage: "No unused storage data found.",
      foundUnusedStorage: "Found {count} non-chain storage items. Clear them?",
      clearedUnusedStorage: "✅ Cleared {count} storage items.",
      warning: "Warning",
      warningDesc: "These operations will permanently delete data. Make sure you understand the consequences. It's recommended to backup important data before proceeding.",
      prunedOldBlocks: "Pruned old blocks",
      leaderHeight: "Leader Height",
      followerReadOnly: "⚠️ Current instance is read-only. To mine, please stop mining on other instances or close their pages.",
    },
    privacy: {
      title: "🔒 Privacy",
    },
    transactionsExpanded: {
      currentBalance: "Current Balance",
      address: "Address",
      recipientAddress: "Recipient Address",
      transferAmount: "Transfer Amount",
      balanceAfterTransfer: "Balance after transfer",
      insufficientBalance: "Insufficient balance",
      pleaseEnterRecipient: "Please enter recipient address and amount",
      amountMustBePositive: "Amount must be a positive number",
      insufficientBalanceError: "Insufficient balance. Current: {current} IDC, Transfer: {amount} IDC",
      transferFailed: "Failed to add transfer transaction (may be duplicate or invalid)",
      signingTransaction: "Signing transaction with your private key...",
      transferSuccess: "Transfer transaction created and broadcast! Amount: {amount} IDC, Recipient: {recipient}...",
      pendingTransactions: "⏳ Pending Transactions",
      txId: "TxID:",
      from: "From:",
      ops: "Ops:",
    },
    networkExpanded: {
      p2pNetwork: "🌐 P2P Network",
      mode: "Mode:",
      status: "Status:",
      peers: "Peers:",
      connected: "Connected",
      disconnected: "Disconnected",
      mainnetSignalingServer: "Mainnet Signaling Server (wss://...)",
      localSignalingServer: "Local Signaling Server (ws://localhost:8080)",
      seconds: "s",
      enabled: "Enabled",
      disabled: "Disabled",
      role: "Role",
      delegator: "Delegator",
      workerNode: "Worker Node",
      activeRanges: "Active Ranges",
      totalNodes: "Total Nodes",
    },
    storageExpanded: {
      lightNodeStatus: "💡 Light Node Status",
      lightNodeWindow: "Light Node Window:",
      storedBlocks: "Stored Blocks:",
      earliestBlockHeight: "Earliest Block Height:",
      latestBlockHeight: "Latest Block Height:",
      storageReduction: "Storage Reduction:",
      clearPrunedBlocks: "Clear Pruned Blocks",
      verifyLatestSnapshot: "Verify Latest Snapshot",
      fetchRemoteSnapshot: "Fetch Remote Snapshot",
      remoteSnapshotNotEnabled: "Remote snapshot sync is not enabled. Please configure remoteSnapshotEndpoints in chain params.",
      fetchingRemoteSnapshot: "Fetching remote snapshot...",
      remoteSnapshotSynced: "✅ Remote snapshot synced successfully from height {height}!",
      reloadToApply: "Remote snapshot downloaded. Reload page to apply it?",
      failedToFetchRemoteSnapshot: "❌ Failed to fetch remote snapshot from any configured source.",
      blocks: "blocks",
      extremePruning: "(Extreme Pruning - Phase 15)",
    },
    advancedExpanded: {
      difficultyStatus: "⚙️ Difficulty Status",
      currentDifficulty: "Current Difficulty:",
      targetBlockTime: "Target Block Time:",
      blocksUntilAdjustment: "Blocks Until Adjustment:",
      averageBlockTime: "Average Block Time:",
      difficultyChange: "Difficulty Change:",
      difficultyExplanation: "Difficulty Explanation:",
    },
    commonExpanded: {
      seconds: "s",
      unknown: "Unknown",
    },
  },
};

