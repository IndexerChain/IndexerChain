/**
 * Snapshot Compression
 * 
 * Phase 11: Compress snapshots to reduce storage size
 * 
 * Uses browser-native CompressionStream API when available,
 * falls back to pako.js for older browsers.
 */

/**
 * Check if browser supports native CompressionStream API
 */
function supportsCompressionStream(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

/**
 * Compress data using native CompressionStream API
 */
async function compressNative(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  writer.write(data.buffer as ArrayBuffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      chunks.push(value);
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress data using native DecompressionStream API
 */
async function decompressNative(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  writer.write(data.buffer as ArrayBuffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      chunks.push(value);
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Compress data using pako.js (fallback)
 */
async function compressPako(data: Uint8Array): Promise<Uint8Array> {
  // Dynamic import to avoid loading pako if not needed
  const pako = await import("pako");
  const compressed = pako.default.deflate(data);
  return new Uint8Array(compressed);
}

/**
 * Decompress data using pako.js (fallback)
 */
async function decompressPako(data: Uint8Array): Promise<Uint8Array> {
  // Dynamic import to avoid loading pako if not needed
  const pako = await import("pako");
  const decompressed = pako.default.inflate(data);
  return new Uint8Array(decompressed);
}

/**
 * Convert string to Uint8Array
 */
function stringToUint8Array(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Convert Uint8Array to string
 */
function uint8ArrayToString(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Convert Uint8Array to Base64
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use btoa with binary string conversion
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  // Use atob to decode base64
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compress snapshot data
 * 
 * @param snapshotData JSON-serializable snapshot data
 * @returns Base64-encoded compressed string
 */
export async function compressSnapshot(snapshotData: any): Promise<string> {
  // Convert to JSON string
  const jsonString = JSON.stringify(snapshotData);
  
  // Convert to Uint8Array
  const data = stringToUint8Array(jsonString);
  
  // Compress
  let compressed: Uint8Array;
  if (supportsCompressionStream()) {
    compressed = await compressNative(data);
  } else {
    compressed = await compressPako(data);
  }
  
  // Convert to Base64
  return uint8ArrayToBase64(compressed);
}

/**
 * Decompress snapshot data
 * 
 * @param base64Compressed Base64-encoded compressed string
 * @returns Original snapshot data object
 */
export async function decompressSnapshot(base64Compressed: string): Promise<any> {
  // Convert from Base64 to Uint8Array
  const compressed = base64ToUint8Array(base64Compressed);
  
  // Decompress
  let decompressed: Uint8Array;
  if (supportsCompressionStream()) {
    decompressed = await decompressNative(compressed);
  } else {
    decompressed = await decompressPako(compressed);
  }
  
  // Convert to string and parse JSON
  const jsonString = uint8ArrayToString(decompressed);
  return JSON.parse(jsonString);
}

/**
 * Get uncompressed size estimate (for display purposes)
 * 
 * @param base64Compressed Base64-encoded compressed string
 * @returns Estimated uncompressed size in bytes
 */
export function estimateUncompressedSize(base64Compressed: string): number {
  // Base64 encoding: each 4 characters represent 3 bytes
  const compressedSize = (base64Compressed.length * 3) / 4;
  // Typical gzip compression ratio for JSON is 3-8x, use 5x as average
  // This is just an estimate for display purposes
  return Math.round(compressedSize * 5);
}

