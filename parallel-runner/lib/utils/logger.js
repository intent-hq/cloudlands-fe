/**
 * Logger Utility
 *
 * Provides colored console output and file logging
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(name, options = {}) {
    this.name = name;
    this.verbose = options.verbose || false;
    this.logFile = options.logFile;

    // Colors
    this.colors = {
      reset: '\x1b[0m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m'
    };

    // Setup file logging if specified
    if (this.logFile) {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
    }
  }

  /**
   * Format message with timestamp and name
   */
  format(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${this.name}] [${level}]`;

    // Convert args to string
    const argStr = args.map(arg => {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    }).join(' ');

    return `${prefix} ${message}${argStr ? ' ' + argStr : ''}`;
  }

  /**
   * Write to console and file
   */
  write(level, color, message, ...args) {
    const formatted = this.format(level, message, ...args);

    // Console output with color
    console.log(`${color}${formatted}${this.colors.reset}`);

    // File output without color
    if (this.logStream) {
      this.logStream.write(formatted + '\n');
    }
  }

  /**
   * Log levels
   */
  debug(message, ...args) {
    if (this.verbose) {
      this.write('DEBUG', this.colors.gray, message, ...args);
    }
  }

  info(message, ...args) {
    this.write('INFO', this.colors.blue, message, ...args);
  }

  success(message, ...args) {
    this.write('SUCCESS', this.colors.green, message, ...args);
  }

  warning(message, ...args) {
    this.write('WARNING', this.colors.yellow, message, ...args);
  }

  error(message, ...args) {
    this.write('ERROR', this.colors.red, message, ...args);
  }

  /**
   * Close log file stream
   */
  close() {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

module.exports = { Logger };
