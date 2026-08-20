/**
 * System Info Service
 *
 * Generates system information for debug bundles.
 */

import { app } from 'electron';
import os from 'os';
import { Logger } from '../../../shared/logger';
import { allSamples, type MemorySnapshot, type ProcessKind } from '../../../main/memory-monitor';

const logger = new Logger('SystemInfoService');

/** One process Intent is responsible for, at the moment the bundle was created. */
interface SystemProcessInfo {
  pid: number;
  /** Which part of Intent this is: main/renderer/gpu/utility/sidecar/agent/other. */
  type: ProcessKind;
  /** Resident set size, in bytes. */
  rss: number;
  /** Short label (Electron service name, or executable basename). */
  name?: string;
}

interface SystemInfo {
  timestamp: string;
  appVersion: string;
  electronVersion: string;
  platform: string;
  arch: string;
  osVersion: string;
  nodeVersion: string;
  memory: {
    totalMemory: number;
    freeMemory: number;
    usedMemory: number;
  };
  cpuCount: number;
  /**
   * Every process Intent is responsible for at capture time — Electron's own
   * processes plus the intentd daemon and its descendants. Empty when the
   * reading could not be taken; the reason is then recorded in
   * `export-manifest.json`. Added after 2.26.x, so readers of older bundles
   * must treat it as optional.
   */
  processes: SystemProcessInfo[];
}

/**
 * Generate system information
 * @param memorySnapshot Capture-time process reading, or `null` when unavailable
 */
export function generateSystemInfo(memorySnapshot: MemorySnapshot | null = null): SystemInfo {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  const processes: SystemProcessInfo[] = memorySnapshot
    ? allSamples(memorySnapshot).map((sample) => ({
        pid: sample.pid,
        type: sample.kind,
        rss: sample.rssBytes,
        ...(sample.name === undefined ? {} : { name: sample.name }),
      }))
    : [];

  const info: SystemInfo = {
    timestamp: new Date().toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    osVersion: os.release(),
    nodeVersion: process.versions.node,
    memory: {
      totalMemory,
      freeMemory,
      usedMemory: totalMemory - freeMemory,
    },
    cpuCount: os.cpus().length,
    processes,
  };

  logger.info('Generated system info', {
    appVersion: info.appVersion,
    platform: info.platform,
    processCount: processes.length,
  });

  return info;
}
