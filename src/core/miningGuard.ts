/**
 * Phase 30: Mining Guard - Pre-mining Health Checks
 * 
 * Ensures mining only happens when node is:
 * - Synchronized with network
 * - Connected to sufficient peers
 * - On the correct network (mainnet)
 * - Has finalized blocks up to date
 */

import type { ChainContext } from "./chain.js";
import type { P2PNode } from "./p2p.js";
import { validateMainnetParams, isMainnet } from "./networkParams.js";

/**
 * Mining guard result
 */
export interface MiningGuardResult {
  ok: boolean;
  reason?: string;
  code?: 
    | "NOT_SYNCED"
    | "INSUFFICIENT_PEERS"
    | "NOT_FINALIZED"
    | "NETWORK_MISMATCH"
    | "PARAMS_MISMATCH"
    | "NO_VALID_WALLET"
    | "FOLLOWER_MODE";
  details?: {
    localHeight?: number;
    networkHeight?: number;
    peerCount?: number;
    requiredPeers?: number;
    finalizedHeight?: number;
    tipHeight?: number;
  };
}

/**
 * Mining Guard
 * 
 * Performs health checks before allowing mining
 */
export class MiningGuard {
  /**
   * Check if mining is safe to start
   */
  static async canMineNow(
    chainContext: ChainContext,
    p2pNode: P2PNode | null,
    finalityManager?: any,
    localInstanceRole?: "LEADER" | "FOLLOWER",
    miningWalletAddress?: string
  ): Promise<MiningGuardResult> {
    // Check 1: P2P connection
    if (!p2pNode || !p2pNode.isConnected) {
      return {
        ok: false,
        code: "INSUFFICIENT_PEERS",
        reason: "Not connected to P2P network",
        details: {
          peerCount: 0,
          requiredPeers: 3,
        },
      };
    }

    const peerCount = p2pNode.getPeerCount();
    const minPeers = 3;
    
    if (peerCount < minPeers) {
      return {
        ok: false,
        code: "INSUFFICIENT_PEERS",
        reason: `Insufficient peers: ${peerCount} < ${minPeers}`,
        details: {
          peerCount,
          requiredPeers: minPeers,
        },
      };
    }

    // Check 2: Local instance role (mainnet mode)
    if (isMainnet(chainContext.params)) {
      if (localInstanceRole === "FOLLOWER") {
        return {
          ok: false,
          code: "FOLLOWER_MODE",
          reason: "This instance is a follower. Only the leader instance can mine on mainnet.",
          details: {},
        };
      }
    }

    // Check 3: Valid mining wallet
    if (!miningWalletAddress || !miningWalletAddress.startsWith("idc_")) {
      return {
        ok: false,
        code: "NO_VALID_WALLET",
        reason: "No valid mining wallet selected. Please select a wallet in the Wallet panel.",
        details: {},
      };
    }

    // Check 4: Network parameters validation (mainnet)
    if (isMainnet(chainContext.params)) {
      const networkValidation = await validateMainnetParams(chainContext.params);
      if (!networkValidation.valid) {
        return {
          ok: false,
          code: "NETWORK_MISMATCH",
          reason: networkValidation.reason || "Network parameters do not match mainnet",
          details: {},
        };
      }
    }

    // Check 5: Synchronization status
    const localTip = chainContext.storage.getTip();
    if (!localTip) {
      return {
        ok: false,
        code: "NOT_SYNCED",
        reason: "No local tip block found",
        details: {
          localHeight: 0,
        },
      };
    }

    const localHeight = localTip.header.height;
    
    // Get network height from peers (if available via global sentinel)
    // For now, we'll use a simpler check: if we have peers and recent blocks
    // In a real implementation, you'd query the global sentinel for network height
    // Note: Sync drift check is handled by GlobalStateSentinel, so we don't need to check it here
    
    // Check 6: Finality status (if finality is enabled)
    if (chainContext.params.finalityEnabled && finalityManager) {
      const finalityStats = finalityManager.getStats();
      if (finalityStats) {
        const finalizedHeight = finalityStats.finalizedHeight || 0;
        const finalityLag = localHeight - finalizedHeight;
        const maxFinalityLag = 5; // Allow up to 5 blocks unfinalized
        
        if (finalityLag > maxFinalityLag) {
          return {
            ok: false,
            code: "NOT_FINALIZED",
            reason: `Too many unfinalized blocks: ${finalityLag} > ${maxFinalityLag}`,
            details: {
              localHeight,
              finalizedHeight,
              tipHeight: localHeight,
            },
          };
        }
      }
    }

    // Check 7: Verify we have consensus on tip hash from multiple peers
    // This would require integration with GlobalStateSentinel
    // For now, we'll just check if we have enough peers
    
    // All checks passed
    return {
      ok: true,
      details: {
        localHeight,
        peerCount,
        requiredPeers: minPeers,
      },
    };
  }

  /**
   * Get human-readable status message
   */
  static getStatusMessage(result: MiningGuardResult, locale: string = "en"): string {
    const isZh = locale === "zh";
    
    if (result.ok) {
      return isZh ? "✅ 挖矿就绪：安全" : "✅ Mining Ready: SAFE";
    }

    switch (result.code) {
      case "NOT_SYNCED":
        return isZh 
          ? `🚫 挖矿就绪：已阻止 - 节点未同步（本地高度: ${result.details?.localHeight || 0}）`
          : `🚫 Mining Ready: BLOCKED - Node not synced (local height: ${result.details?.localHeight || 0})`;
      
      case "INSUFFICIENT_PEERS":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 对等节点不足（${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3}）`
          : `🚫 Mining Ready: BLOCKED - Insufficient peers (${result.details?.peerCount || 0} < ${result.details?.requiredPeers || 3})`;
      
      case "NOT_FINALIZED":
        return isZh
          ? `⚠️ 挖矿就绪：降级 - 未最终确认的区块过多`
          : `⚠️ Mining Ready: DEGRADED - Too many unfinalized blocks`;
      
      case "NETWORK_MISMATCH":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 网络参数不匹配`
          : `🚫 Mining Ready: BLOCKED - Network parameters mismatch`;
      
      case "NO_VALID_WALLET":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 未选择有效的挖矿钱包`
          : `🚫 Mining Ready: BLOCKED - No valid mining wallet selected`;
      
      case "FOLLOWER_MODE":
        return isZh
          ? `🚫 挖矿就绪：已阻止 - 本窗口为只读模式（Follower）`
          : `🚫 Mining Ready: BLOCKED - This window is read-only (Follower)`;
      
      default:
        return result.reason || (isZh ? "🚫 挖矿就绪：已阻止" : "🚫 Mining Ready: BLOCKED");
    }
  }
}

