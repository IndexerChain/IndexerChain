/**
 * Basic tests for crypto utilities
 * 
 * These tests can be run in browser console or with a test framework
 */

import { sha256, hashBlockHeader } from "../crypto.js";
import { calcMerkleRoot } from "../merkle.js";
import type { BlockHeader } from "../types.js";

/**
 * Test sha256 function
 */
export async function testSha256() {
  console.log("Testing sha256...");
  
  const input = "hello world";
  const hash = await sha256(input);
  
  // Expected hash for "hello world"
  const expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
  
  if (hash === expected) {
    console.log("✓ sha256 test passed");
    return true;
  } else {
    console.error(`✗ sha256 test failed: got ${hash}, expected ${expected}`);
    return false;
  }
}

/**
 * Test hashBlockHeader function
 */
export async function testHashBlockHeader() {
  console.log("Testing hashBlockHeader...");
  
  const header: BlockHeader = {
    version: 1,
    height: 0,
    prevHash: "",
    merkleRoot: "0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1234567890,
    difficulty: 3,
    nonce: 0,
  };
  
  const hash = await hashBlockHeader(header);
  
  if (hash && hash.length === 64) {
    console.log("✓ hashBlockHeader test passed");
    console.log(`  Hash: ${hash}`);
    return true;
  } else {
    console.error(`✗ hashBlockHeader test failed: invalid hash ${hash}`);
    return false;
  }
}

/**
 * Test calcMerkleRoot function
 */
export async function testCalcMerkleRoot() {
  console.log("Testing calcMerkleRoot...");
  
  const txIds = [
    "abc123",
    "def456",
    "ghi789",
  ];
  
  const root = await calcMerkleRoot(txIds);
  
  if (root && root.length === 64) {
    console.log("✓ calcMerkleRoot test passed");
    console.log(`  Root: ${root}`);
    return true;
  } else {
    console.error(`✗ calcMerkleRoot test failed: invalid root ${root}`);
    return false;
  }
}

/**
 * Test empty Merkle root
 */
export async function testEmptyMerkleRoot() {
  console.log("Testing empty Merkle root...");
  
  const root = await calcMerkleRoot([]);
  const expected = await sha256("");
  
  if (root === expected) {
    console.log("✓ empty Merkle root test passed");
    return true;
  } else {
    console.error(`✗ empty Merkle root test failed: got ${root}, expected ${expected}`);
    return false;
  }
}

/**
 * Run all tests
 */
export async function runAllTests() {
  console.log("=== Running Crypto Tests ===\n");
  
  const results = await Promise.all([
    testSha256(),
    testHashBlockHeader(),
    testCalcMerkleRoot(),
    testEmptyMerkleRoot(),
  ]);
  
  const passed = results.filter((r) => r).length;
  const total = results.length;
  
  console.log(`\n=== Results: ${passed}/${total} tests passed ===`);
  
  return passed === total;
}

// Export for use in browser console
if (typeof window !== "undefined") {
  (window as any).testCrypto = runAllTests;
}

