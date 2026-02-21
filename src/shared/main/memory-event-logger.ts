/**
 * Memory Event Logger
 *
 * Lightweight instrumentation for tracking memory at key points.
 * Writes JSONL format for easy querying with DuckDB/grep.
 *
 * Query examples:
 *   duckdb -c "SELECT * FROM read_json_auto('.augment/memory/memory-events.jsonl') ORDER BY ts DESC LIMIT 20"
 *   duckdb -c "SELECT event, avg(heapUsedMB) as avgHeap, avg(deltaMB) as avgDelta FROM read_json_auto('.augment/memory/memory-events.jsonl') GROUP BY event"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { app } from 'electron';

export interface MemoryEvent {
  ts: string;
  event: string;
  agentId?: string;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rssMB: number;
  deltaMB?: number;
  context?: Record<string, any>;
}

// Track last heap for delta calculation
let lastHeapUsed = 0;

// Log file path - will be set on first write
let logFilePath: string | null = null;

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getLogFilePath(): string {
  if (logFilePath) return logFilePath;

  let baseDir: string | null = null;

  // In packaged Electron apps, use userData directory
  // This avoids trying to write to the read-only app.asar
  try {
    if (app && typeof app.getPath === 'function') {
      // Check if we're in a packaged app (app.asar in path)
      if (__filename.includes('app.asar') || app.isPackaged) {
        baseDir = app.getPath('userData');
      }
    }
  } catch {
    // app.getPath may throw if called too early, fall through to file-based detection
  }

  // In development, find workspace root by walking up from current file
  if (!baseDir) {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
          if (pkg.name === 'intent') {
            baseDir = dir;
            break;
          }
        } catch {
          // Ignore parse errors
        }
      }
      dir = path.dirname(dir);
    }
  }

  // Fallback to home directory for packaged apps that couldn't detect earlier
  if (!baseDir) {
    if (process.resourcesPath?.includes('app.asar')) {
      baseDir = path.join(os.homedir(), '.intent');
    } else {
      baseDir = process.cwd();
    }
  }

  const memoryDir = path.join(baseDir, '.augment', 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  logFilePath = path.join(memoryDir, 'memory-events.jsonl');
  return logFilePath;
}

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

export function logMemoryEvent(
  event: string,
  agentId?: string,
  context?: Record<string, any>,
): MemoryEvent {
  const mem = process.memoryUsage();
  const heapUsedMB = toMB(mem.heapUsed);
  const delta = lastHeapUsed > 0 ? heapUsedMB - toMB(lastHeapUsed) : undefined;
  lastHeapUsed = mem.heapUsed;

  const entry: MemoryEvent = {
    ts: new Date().toISOString(),
    event,
    agentId,
    heapUsedMB,
    heapTotalMB: toMB(mem.heapTotal),
    externalMB: toMB(mem.external),
    rssMB: toMB(mem.rss),
    deltaMB: delta,
    context,
  };

  // Append to file
  try {
    const filePath = getLogFilePath();
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    // Silent fail - don't break the app for logging
    console.error('[MemoryEventLogger] Failed to write:', err);
  }

  return entry;
}

// Convenience functions for common events
export const memEvents = {
  agentTurnStart: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('agent_turn_start', agentId, ctx),

  agentTurnComplete: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('agent_turn_complete', agentId, ctx),

  cleanupStart: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('cleanup_start', agentId, ctx),

  cleanupComplete: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('cleanup_complete', agentId, ctx),

  streamStart: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('stream_start', agentId, ctx),

  streamEnd: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('stream_end', agentId, ctx),

  providerCleanup: (agentId: string, ctx?: Record<string, any>) =>
    logMemoryEvent('provider_cleanup', agentId, ctx),

  custom: logMemoryEvent,
};

export function getMemoryLogPath(): string {
  return getLogFilePath();
}

export function clearMemoryLog(): void {
  const filePath = getLogFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
