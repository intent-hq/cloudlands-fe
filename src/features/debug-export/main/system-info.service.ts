/**
 * System Info Service
 *
 * Generates system information for debug bundles.
 */

import { app } from 'electron';
import os from 'os';
import { Logger } from '../../../shared/logger';

const logger = new Logger('SystemInfoService');

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
}

/**
 * Generate system information
 */
export function generateSystemInfo(): SystemInfo {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

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
  };

  logger.info('Generated system info', {
    appVersion: info.appVersion,
    platform: info.platform,
  });

  return info;
}

