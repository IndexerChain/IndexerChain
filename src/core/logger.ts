/**
 * Logger Module
 * 
 * Provides centralized logging with environment-aware log levels.
 * In production, only errors are logged. In development, all logs are shown.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Check if running in production environment
 */
function isProduction(): boolean {
  // Check Vite build mode
  if (typeof import.meta !== "undefined" && (import.meta as any).env) {
    const env = (import.meta as any).env;
    if (env.PROD) {
      return true;
    }
    if (env.MODE === "production") {
      return true;
    }
  }
  
  // Check hostname (production domains)
  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname;
    if (
      hostname === "indexerchain.com" ||
      hostname === "www.indexerchain.com" ||
      hostname.endsWith(".pages.dev") // Cloudflare Pages
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get current log level based on environment
 */
function getLogLevel(): LogLevel {
  if (isProduction()) {
    return LogLevel.ERROR; // Only errors in production
  }
  
  // Development: allow all logs
  // Can be overridden by localStorage for debugging
  if (typeof window !== "undefined" && window.localStorage) {
    const logLevel = window.localStorage.getItem("indexerchain_log_level");
    if (logLevel) {
      const level = parseInt(logLevel, 10);
      if (!isNaN(level) && level >= 0 && level <= 4) {
        return level as LogLevel;
      }
    }
  }
  
  return LogLevel.INFO; // Only INFO and above in development (no DEBUG)
}

class Logger {
  private logLevel: LogLevel;
  
  constructor() {
    this.logLevel = getLogLevel();
  }
  
  /**
   * Update log level (useful for runtime changes)
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
  
  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return this.logLevel;
  }
  
  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }
  
  /**
   * Debug log (disabled - only errors are logged)
   */
  debug(..._args: any[]): void {
    // Disabled - only errors are logged
  }
  
  /**
   * Info log (disabled - only errors are logged)
   */
  info(..._args: any[]): void {
    // Disabled - only errors are logged
  }
  
  /**
   * Warning log (disabled - only errors are logged)
   */
  warn(..._args: any[]): void {
    // Disabled - only errors are logged
  }
  
  /**
   * Error log (always shown, even in production)
   */
  error(...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error("[ERROR]", ...args);
    }
  }
  
  /**
   * Log with custom prefix (disabled - only errors are logged)
   */
  log(_prefix: string, ..._args: any[]): void {
    // Disabled - only errors are logged
  }
  
  /**
   * Check if currently in production mode
   */
  isProduction(): boolean {
    return isProduction();
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions
export const log = logger.log.bind(logger);
export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);

