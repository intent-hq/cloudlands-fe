/**
 * Console Log Capture
 *
 * Intercepts process.stdout and process.stderr writes to tee all main-process
 * console output into {userData}/logs/console-output.log.
 *
 * The debug-export collector already looks for this file path, so creating it
 * here makes main-process logs available in debug exports automatically.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

let logFd: number | null = null;
let logFilePath: string | null = null;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function ensureLogDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE) {
      const rotatedPath = filePath + '.1';
      // Remove old rotated file if it exists
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }
      fs.renameSync(filePath, rotatedPath);
    }
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
}

function writeToLog(text: string): void {
  if (logFd === null) return;
  try {
    const cleaned = stripAnsi(text);
    fs.writeSync(logFd, cleaned);
  } catch {
    // Ignore write errors to avoid infinite loops
  }
}

/**
 * Set up console log capture for the main process.
 *
 * Call this early in the main process entry point (after electron imports,
 * before most other initialization). It monkey-patches process.stdout.write
 * and process.stderr.write to tee output to a log file while preserving
 * normal terminal output.
 */
export function setupConsoleLogCapture(): void {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  ensureLogDir(logsDir);

  logFilePath = path.join(logsDir, 'console-output.log');
  rotateIfNeeded(logFilePath);

  // Open the log file for appending (create if it doesn't exist)
  logFd = fs.openSync(logFilePath, 'a');

  // Write a session separator
  const timestamp = new Date().toISOString();
  fs.writeSync(logFd, `\n--- Session started at ${timestamp} ---\n`);

  // Monkey-patch stdout.write
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = function (
    chunk: string | Uint8Array,
    ...args: unknown[]
  ): boolean {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    writeToLog(text);
    return (originalStdoutWrite as any)(chunk, ...args);
  };

  // Monkey-patch stderr.write
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = function (
    chunk: string | Uint8Array,
    ...args: unknown[]
  ): boolean {
    const text = typeof chunk === 'string' ? chunk : chunk.toString();
    writeToLog(text);
    return (originalStderrWrite as any)(chunk, ...args);
  };

  // Close the file descriptor on app quit
  app.on('before-quit', () => {
    if (logFd !== null) {
      try {
        const quitTimestamp = new Date().toISOString();
        fs.writeSync(logFd, `--- Session ended at ${quitTimestamp} ---\n`);
        fs.closeSync(logFd);
      } catch {
        // Ignore close errors during shutdown
      }
      logFd = null;
    }
  });
}

