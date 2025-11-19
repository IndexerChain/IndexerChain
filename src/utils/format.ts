/**
 * Formatting utilities for numbers and addresses
 */

/**
 * Format a number with thousand separators and optional decimal places
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted number string
 */
export function formatNumber(
  value: number | string,
  decimals: number = 2,
  locale: string = "en-US"
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  
  // Use toLocaleString for thousand separators
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  
  return num.toLocaleString(locale, options);
}

/**
 * Format a large number with appropriate units (K, M, B, T)
 * @param value - The number to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted number string with unit
 */
export function formatLargeNumber(
  value: number | string,
  decimals: number = 2
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  
  if (absNum >= 1e12) {
    return `${sign}${(absNum / 1e12).toFixed(decimals)}T`;
  } else if (absNum >= 1e9) {
    return `${sign}${(absNum / 1e9).toFixed(decimals)}B`;
  } else if (absNum >= 1e6) {
    return `${sign}${(absNum / 1e6).toFixed(decimals)}M`;
  } else if (absNum >= 1e3) {
    return `${sign}${(absNum / 1e3).toFixed(decimals)}K`;
  } else {
    return num.toFixed(decimals);
  }
}

/**
 * Format a blockchain address with ellipsis
 * @param address - The address to format
 * @param startLength - Number of characters to show at the start (default: 6)
 * @param endLength - Number of characters to show at the end (default: 4)
 * @returns Formatted address string (e.g., "0x1234...5678")
 */
export function formatAddress(
  address: string | null | undefined,
  startLength: number = 6,
  endLength: number = 4
): string {
  if (!address) return "";
  
  if (address.length <= startLength + endLength) {
    return address;
  }
  
  return `${address.substring(0, startLength)}...${address.substring(address.length - endLength)}`;
}

/**
 * Format a percentage value
 * @param value - The percentage value (0-100)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string
 */
export function formatPercent(
  value: number | string,
  decimals: number = 2
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";
  
  return `${num.toFixed(decimals)}%`;
}

/**
 * Format file size in bytes to human-readable format
 * @param bytes - Size in bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted file size string
 */
export function formatFileSize(
  bytes: number,
  decimals: number = 2
): string {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

/**
 * Format a number with locale-aware thousand separators (no decimals)
 * @param value - The number to format
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted number string without decimals
 */
export function formatInteger(
  value: number | string,
  locale: string = "en-US"
): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  
  return Math.floor(num).toLocaleString(locale);
}

