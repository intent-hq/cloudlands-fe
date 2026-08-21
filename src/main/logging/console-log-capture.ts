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

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

let logFd: number | null = null;
let logFilePath: string | null = null;
let logSize = 0;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

function ensureLogDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function openLogFile(): boolean {
  if (logFilePath === null) return false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(logFilePath, 'a');
    logSize = fs.fstatSync(fd).size;
    logFd = fd;
    return true;
  } catch {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor cannot be recovered.
      }
    }
    logFd = null;
    logSize = 0;
    return false;
  }
}

function rotateLogFile(): boolean {
  if (logFd === null || logFilePath === null) return false;

  try {
    if (logSize > MAX_LOG_SIZE) {
      fs.ftruncateSync(logFd, MAX_LOG_SIZE);
      logSize = MAX_LOG_SIZE;
    }
    fs.closeSync(logFd);
  } catch {
    logFd = null;
    logSize = 0;
    return false;
  }
  logFd = null;
  logSize = 0;

  try {
    const rotatedPath = logFilePath + '.1';
    if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
    fs.renameSync(logFilePath, rotatedPath);
  } catch {
    // Keep capture usable after a failed rotation, but skip the pending write.
    openLogFile();
    return false;
  }

  return openLogFile();
}

function boundedLogBytes(text: string): Buffer {
  const bytes = Buffer.from(stripAnsi(text));
  if (bytes.length <= MAX_LOG_SIZE) return bytes;

  // Each retained file is at most MAX_LOG_SIZE. For one oversized chunk, keep
  // its newest bytes and move past a partial UTF-8 character at the boundary.
  let start = bytes.length - MAX_LOG_SIZE;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start);
}

function writeToLog(text: string): void {
  if (logFd === null) return;
  const bytes = boundedLogBytes(text);
  if (bytes.length === 0) return;

  if (logSize + bytes.length > MAX_LOG_SIZE && !rotateLogFile()) return;
  if (logFd === null) return;

  try {
    logSize += fs.writeSync(logFd, bytes);
  } catch {
    // Never report capture failures through the console streams being captured.
    try {
      fs.closeSync(logFd);
    } catch {
      // The descriptor is no longer safe to use.
    }
    logFd = null;
    logSize = 0;
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
  if (openLogFile() && logSize >= MAX_LOG_SIZE) rotateLogFile();

  // Write a session separator
  const timestamp = new Date().toISOString();
  writeToLog(`\n--- Session started at ${timestamp} ---\n`);

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
        // i18n-ignore (log file marker)
        writeToLog(`--- Session ended at ${quitTimestamp} ---\n`);
        if (logFd !== null) fs.closeSync(logFd);
      } catch {
        // Ignore close errors during shutdown
      }
      logFd = null;
    }
  });
}
