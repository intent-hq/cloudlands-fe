/**
 * Debug Files Collector
 *
 * Collects all debug log files from various locations.
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from '../../../shared/logger';
import { resolveIntentdDataDir } from '../../backend/main/intentd-data-dir';
import {
  allSamples,
  getMemoryHistory,
  logMemorySample,
  summarizeSnapshot,
  type MemorySnapshot,
} from '../../../main/memory-monitor';

const logger = new Logger('DebugFilesCollector');

export interface DebugFile {
  /** Absent for synthesized entries whose `content` is written directly. */
  sourcePath?: string;
  relativePath: string;
  /** Literal file content to write instead of copying from `sourcePath`. */
  content?: string;
  /**
   * When set, only the last `tailBytes` bytes of `sourcePath` are copied
   * (with a truncation marker line prepended). Bounds large log files.
   */
  tailBytes?: number;
}

/** Per-file tail cap for intentd daemon logs included in the bundle. */
export const INTENTD_LOG_TAIL_BYTES = 5 * 1024 * 1024;

/** How many of the newest daily-rotated intentd log files to include. */
export const INTENTD_LOG_FILE_COUNT = 2;

/**
 * The intentd daemon data dir where its tracing file appender writes
 * daily-rotated `intentd.<YYYY-MM-DD>.log` files (see intentd `init_tracing`).
 * Re-exported from the shared resolver (`features/backend/main/intentd-data-dir.ts`)
 * so the platform defaults exist in exactly one place.
 */
export { resolveIntentdDataDir };

/**
 * Materialize one collected [[DebugFile]] at `destPath`: writes `content`
 * entries directly, copies whole files, and for `tailBytes`-capped entries
 * writes only the trailing bytes with a truncation marker line prepended.
 */
export async function copyDebugFile(file: DebugFile, destPath: string): Promise<void> {
  if (file.content !== undefined) {
    await fs.writeFile(destPath, file.content);
    return;
  }
  if (!file.sourcePath) {
    logger.warn('debug file entry has neither content nor sourcePath; skipping', {
      relativePath: file.relativePath,
    });
    return;
  }
  if (file.tailBytes === undefined) {
    await fs.copyFile(file.sourcePath, destPath);
    return;
  }
  const stats = await fs.stat(file.sourcePath);
  if (stats.size <= file.tailBytes) {
    await fs.copyFile(file.sourcePath, destPath);
    return;
  }
  const handle = await fs.open(file.sourcePath, 'r');
  try {
    const tail = Buffer.alloc(file.tailBytes);
    // The file can shrink between the stat above and this read (daily
    // rotation/retention), so trust bytesRead rather than the requested
    // length to avoid padding the bundle entry with NUL bytes.
    const { bytesRead } = await handle.read(tail, 0, file.tailBytes, stats.size - file.tailBytes);
    // i18n-ignore (marker line inside a diagnostic zip, not UI)
    const marker = Buffer.from(`[truncated: last ${bytesRead} of ${stats.size} bytes]\n`, 'utf8');
    await fs.writeFile(destPath, Buffer.concat([marker, tail.subarray(0, bytesRead)]));
  } finally {
    await handle.close();
  }
}

export interface DebugFilesResult {
  files: DebugFile[];
  /**
   * Sections that could not be collected (e.g. workspace files when no local
   * checkout is known). Recorded in the export manifest so a bundle without
   * workspace files is explainable rather than silently incomplete.
   */
  omissions: string[];
  /**
   * The capture-time memory reading, so the caller can describe the same
   * processes in `system-info.json` without paying for a second process-table
   * read. `null` when the sample could not be taken.
   */
  memorySnapshot: MemorySnapshot | null;
}

/** Bumped when the shape of `memory-metrics.json` changes incompatibly. */
export const MEMORY_METRICS_SCHEMA_VERSION = 1;

/**
 * Collect all debug files from various locations
 * @param workspaceId Optional workspace ID to collect workspace-specific files
 */
export async function collectDebugFiles(workspaceId?: string): Promise<DebugFilesResult> {
  const files: DebugFile[] = [];
  const omissions: string[] = [];
  const userDataPath = app.getPath('userData');
  const homeDir = os.homedir();

  // Helper to safely add files
  async function addFile(sourcePath: string, relativePath: string) {
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isFile()) {
        files.push({ sourcePath, relativePath });
      }
    } catch {
      logger.debug('File not found or not accessible', { sourcePath });
    }
  }

  // Helper to add the first existing file among several candidate locations
  // (e.g. current .intent path first, then legacy .augment fallback)
  async function addFirstExistingFile(candidates: string[], relativePath: string) {
    for (const sourcePath of candidates) {
      try {
        const stats = await fs.stat(sourcePath);
        if (stats.isFile()) {
          files.push({ sourcePath, relativePath });
          return;
        }
      } catch {
        // try the next candidate
      }
    }
    logger.debug('No candidate file found', { candidates });
  }

  // Helper to safely add directory contents
  async function addDirectory(sourcePath: string, relativePath: string) {
    try {
      const entries = await fs.readdir(sourcePath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(sourcePath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isFile()) {
          files.push({ sourcePath: fullPath, relativePath: relPath });
        }
      }
    } catch {
      logger.debug('Directory not found or not accessible', { sourcePath });
    }
  }

  // Helper to recursively add directory contents
  async function addDirectoryRecursive(sourcePath: string, relativePath: string) {
    try {
      const entries = await fs.readdir(sourcePath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(sourcePath, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isFile()) {
          files.push({ sourcePath: fullPath, relativePath: relPath });
        } else if (entry.isDirectory()) {
          await addDirectoryRecursive(fullPath, relPath);
        }
      }
    } catch {
      logger.debug('Directory not found or not accessible', { sourcePath });
    }
  }

  // Global logs
  await addDirectory(path.join(userDataPath, 'logs'), 'logs');
  // Memory events: packaged apps use ~/.intent as the base dir and write under
  // <base>/.intent/memory (see memory-event-logger); older builds used ~/.augment
  await addFirstExistingFile(
    [
      path.join(homeDir, '.intent', '.intent', 'memory', 'memory-events.jsonl'),
      path.join(homeDir, '.augment', 'memory', 'memory-events.jsonl'),
    ],
    'logs/memory-events.jsonl',
  );

  // IPC debug files: written under userData/.intent/ipc-debug (see ipc-debug-tracker);
  // older builds used ~/.augment
  const ipcDebugCount = files.length;
  await addDirectory(path.join(userDataPath, '.intent', 'ipc-debug'), 'ipc-debug');
  if (files.length === ipcDebugCount) {
    await addDirectory(path.join(homeDir, '.augment', 'ipc-debug'), 'ipc-debug');
  }

  // Error tracking (dev only): written under <root>/.intent/errors where <root>
  // is userData for packaged apps or ~/.intent as a fallback (see
  // agent-error-tracker); older builds used ~/.augment
  await addFirstExistingFile(
    [
      path.join(userDataPath, '.intent', 'errors', 'tracked-errors.json'),
      path.join(homeDir, '.intent', '.intent', 'errors', 'tracked-errors.json'),
      path.join(homeDir, '.augment', 'errors', 'tracked-errors.json'),
    ],
    'logs/tracked-errors.json',
  );

  // intentd daemon logs: the daemon's tracing file appender writes
  // daily-rotated `intentd.<YYYY-MM-DD>.log` files into its data dir (kept to
  // ~5 files by the daemon). Include the newest few, tail-capped so the
  // bundle stays bounded; the daemon wedge cannot be root-caused without
  // daemon-side logs.
  const intentdDataDir = resolveIntentdDataDir();
  try {
    const entries = await fs.readdir(intentdDataDir, { withFileTypes: true });
    const logStats = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.startsWith('intentd') && e.name.endsWith('.log'))
        .map(async (e) => {
          const sourcePath = path.join(intentdDataDir, e.name);
          try {
            const stats = await fs.stat(sourcePath);
            return { name: e.name, sourcePath, mtimeMs: stats.mtimeMs };
          } catch {
            // Deleted between readdir and stat (daily rotation/retention
            // race) — skip it without dropping the other readable logs.
            logger.debug('intentd log file vanished before stat', { sourcePath });
            return null;
          }
        }),
    );
    const newest = logStats
      .filter((s): s is NonNullable<(typeof logStats)[number]> => s !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, INTENTD_LOG_FILE_COUNT);
    if (newest.length === 0) {
      // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
      omissions.push(
        `intentd/: skipped — no intentd daemon log files found in "${intentdDataDir}"`,
      );
    } else {
      for (const log of newest) {
        files.push({
          sourcePath: log.sourcePath,
          relativePath: path.join('intentd', log.name),
          tailBytes: INTENTD_LOG_TAIL_BYTES,
        });
      }
    }
  } catch {
    logger.debug('intentd data dir not found or not accessible', { intentdDataDir });
    // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
    omissions.push(`intentd/: skipped — intentd data dir not accessible at "${intentdDataDir}"`);
  }

  // Last sidecar run record (spawn timing, exit code/signal, stdout+stderr
  // tail) — in-memory in the main process, serialized into the bundle.
  try {
    const { getSidecarRunLog } = await import('../../backend/main/intentd-sidecar');
    const runLog = getSidecarRunLog();
    if (runLog.available) {
      files.push({
        relativePath: path.join('intentd', 'sidecar-run-log.json'),
        content: JSON.stringify(runLog, null, 2),
      });
    } else {
      // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
      omissions.push(
        'intentd/sidecar-run-log.json: skipped — no sidecar run captured this app session (remote backend or externally managed daemon)',
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to collect sidecar run log', { error: message });
    // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
    omissions.push(`intentd/sidecar-run-log.json: collection failed — ${message}`);
  }

  // Memory timeline: the sampler's retained window (see main/memory-monitor)
  // plus a snapshot taken now. The peaks matter more than the snapshot — an
  // overshoot has usually drained back to normal by the time a user reaches
  // for "export debug bundle", so a capture-time reading alone reports nothing.
  let memorySnapshot: MemorySnapshot | null = null;
  try {
    const capturedAt = new Date().toISOString();
    // Samples, retains and logs in one go, so the capture-time reading is also
    // the newest entry in the retained window below.
    memorySnapshot = await logMemorySample();
    const history = getMemoryHistory();

    // The window can be empty while peaks are not: peaks outlive the retention
    // window, so a session suspended past the 24 h cap keeps "how big did this
    // get" long after the timeline itself has expired. Emit the file for either.
    if (history.samples.length === 0 && !history.peaks.total) {
      // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
      omissions.push(
        'memory-metrics.json: skipped — no memory samples retained (sampler never ran and the capture-time sample failed)',
      );
    } else {
      if (history.samples.length === 0) {
        // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
        omissions.push(
          'memory-metrics.json: retained timeline is empty (every sample aged out of the 24 h window) — peaks are still reported',
        );
      }
      const captured = memorySnapshot ? summarizeSnapshot(memorySnapshot, capturedAt) : null;
      files.push({
        relativePath: 'memory-metrics.json',
        content: JSON.stringify(
          {
            schemaVersion: MEMORY_METRICS_SCHEMA_VERSION,
            ...history,
            // Unlike a retained sample, the capture-time entry keeps every
            // process rather than only the largest few.
            capturedAt: captured
              ? {
                  at: captured.at,
                  totalRssBytes: captured.totalRssBytes,
                  processCount: captured.processCount,
                  byKind: captured.byKind,
                  processTableUnavailable: captured.processTableUnavailable,
                  processes: allSamples(memorySnapshot as MemorySnapshot),
                }
              : null,
          },
          null,
          2,
        ),
      });
      if (!captured) {
        // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
        omissions.push(
          'memory-metrics.json: capture-time snapshot unavailable — the file holds the retained window and peaks only',
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('Failed to collect memory metrics', { error: message });
    // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
    omissions.push(`memory-metrics.json: collection failed — ${message}`);
  }

  // Workspace-specific files — the checkout directory comes from the daemon
  // only (monorepo#1759); when no local checkout is known (virtual/unknown
  // workspace or remote backend), the section is skipped and the omission is
  // recorded for the export manifest.
  if (workspaceId) {
    try {
      const { getWorkspacePath } = await import('../../workspace/main/workspace-path.service');
      const workspacePath = await getWorkspacePath(workspaceId);

      if (!workspacePath) {
        logger.info('Skipping workspace files: no local checkout known', { workspaceId });
        // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
        omissions.push(
          `workspace/: skipped — no local checkout directory is known for workspace "${workspaceId}" (virtual/unknown workspace or remote backend)`,
        );
      } else {
        // Collect workspace events
        await addFile(
          path.join(workspacePath, '.workspace', 'events.jsonl'),
          'workspace/events.jsonl',
        );

        // Collect workspace agents
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'agents'),
          'workspace/agents',
        );

        // Collect workspace notes
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'notes'),
          'workspace/notes',
        );

        // Collect workspace logs (agent stderr logs)
        await addDirectoryRecursive(
          path.join(workspacePath, '.workspace', 'logs'),
          'workspace/logs',
        );

        logger.info('Collected workspace-specific files', { workspaceId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to collect workspace files', { workspaceId, error: message });
      // i18n-ignore (manifest entry inside a diagnostic zip, not UI)
      omissions.push(`workspace/: collection failed for workspace "${workspaceId}" — ${message}`);
    }
  }

  logger.info('Collected debug files', { count: files.length, workspaceId });
  return { files, omissions, memorySnapshot };
}
