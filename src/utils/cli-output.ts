/**
 * CLI output utilities for consistent console output formatting
 */

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

/**
 * Print a standard message to the console
 */
export function cliPrint(message: string): void {
  console.log(message);
}

/**
 * Print an error message to the console
 */
export function cliError(message: string): void {
  console.error(`${COLORS.red}${message}${COLORS.reset}`);
}

/**
 * Print a warning message to the console
 */
export function cliWarning(message: string): void {
  console.warn(`${COLORS.yellow}${message}${COLORS.reset}`);
}

/**
 * Print a success message to the console
 */
export function cliSuccess(message: string): void {
  console.log(`${COLORS.green}${message}${COLORS.reset}`);
}

/**
 * Print an info message to the console
 */
export function cliInfo(message: string): void {
  console.log(`${COLORS.cyan}${message}${COLORS.reset}`);
}

/**
 * Print a debug message to the console (only if DEBUG env var is set)
 */
export function cliDebug(message: string): void {
  if (process.env.DEBUG) {
    console.log(`${COLORS.dim}[DEBUG] ${message}${COLORS.reset}`);
  }
}
