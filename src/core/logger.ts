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
    return LogLevel.ERROR;
  }
  return LogLevel.DEBUG;
}

class Logger {
  private logLevel: LogLevel;

  constructor() {
    this.logLevel = getLogLevel();
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  debug(...args: any[]): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      console.debug(...args);
    }
  }

  info(...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.info(...args);
    }
  }

  warn(...args: any[]): void {
    if (this.logLevel <= LogLevel.WARN) {
      console.warn(...args);
    }
  }

  error(...args: any[]): void {
    if (this.logLevel <= LogLevel.ERROR) {
      console.error(...args);
    }
  }

  log(prefix: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      console.log(prefix, ...args);
    }
  }

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

