/**
 * Provider Availability Service
 *
 * Aggregates availability status from all ACP providers (auggie, claude-code, codex)
 * to determine if the user has any available provider at startup.
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PROVIDERS_CHANNELS } from '../../../shared/ipc/channels';
import { ACP_PROVIDERS } from '../../../shared/config/provider-config';
import { Logger } from '../../../shared/logger';
import { featureCodesService } from '../../feature-codes/main/feature-codes.service';
import { findAuggiePathAsync } from '../../auggie/main/auggie.ipc';
import {
  clearClaudeCodeCache,
  getClaudeCodePath,
  isClaudeCodeInstalled,
} from '../../claude-code/main/claude-code-resolver';
import { clearCodexCache, getCodexPath, isCodexInstalled } from '../../codex/main/codex-resolver';
import {
  clearCortexCache,
  getCortexPath,
  isCortexInstalled,
} from '../../cortex/main/cortex-resolver';
import {
  clearOpenCodeCache,
  getOpenCodePath,
  isOpenCodeInstalled,
} from '../../opencode/main/opencode-resolver';

const logger = new Logger('ProviderAvailability');

/**
 * Status for an individual provider
 */
export interface ProviderStatus {
  available: boolean;
  error?: string;
}

/**
 * Aggregated provider availability result
 */
export interface ProviderAvailabilityResult {
  hasAnyProvider: boolean;
  providers: {
    auggie: ProviderStatus;
    claudeCode: ProviderStatus;
    codex: ProviderStatus;
    cortex: ProviderStatus;
    opencode: ProviderStatus;
  };
  /** Provider IDs that are hidden because their required env var or feature code is not set */
  hiddenProviders: string[];
}

/**
 * Check if auggie is available by checking for saved path or session
 * This is a lightweight check that doesn't spawn processes
 */
async function checkAuggieAvailability(): Promise<ProviderStatus> {
  // Helper to check if a path exists without throwing
  const pathExists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  try {
    const homeDir = os.homedir();

    // Check for saved auggie path (fastest check)
    const savedPathFile = path.join(homeDir, '.augment', 'auggie-path');
    try {
      const savedPath = (await fs.readFile(savedPathFile, 'utf8')).trim();
      if (savedPath && (await pathExists(savedPath))) {
        return { available: true };
      }
    } catch {
      // File doesn't exist or can't be read
    }

    // Check for auggie session file (indicates auggie was used before)
    const sessionPath = path.join(homeDir, '.augment', 'session.json');
    if (await pathExists(sessionPath)) {
      // Session exists, auggie was likely installed and used
      return { available: true };
    }

    // Check common auggie installation paths (comprehensive list matching async-utils.ts)
    const commonPaths =
      process.platform === 'win32'
        ? [
            path.join(process.env.APPDATA || '', 'npm', 'auggie.cmd'),
            path.join(process.env.APPDATA || '', 'npm', 'auggie'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'auggie.cmd'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'auggie'),
            path.join(process.env.APPDATA || '', 'nvm', 'auggie.cmd'),
            path.join(process.env.LOCALAPPDATA || '', 'Volta', 'bin', 'auggie.exe'),
          ]
        : [
            '/usr/local/bin/auggie',
            '/usr/bin/auggie',
            '/opt/homebrew/bin/auggie',
            path.join(homeDir, '.npm-global', 'bin', 'auggie'),
            path.join(homeDir, '.npm-packages', 'bin', 'auggie'),
            path.join(homeDir, '.local', 'bin', 'auggie'),
            path.join(homeDir, 'npm', 'bin', 'auggie'),
            path.join(homeDir, '.volta', 'bin', 'auggie'),
            path.join(homeDir, '.fnm', 'aliases', 'default', 'bin', 'auggie'),
            path.join(homeDir, '.asdf', 'shims', 'auggie'),
            path.join(homeDir, 'n', 'bin', 'auggie'),
            '/usr/local/n/bin/auggie',
            '/usr/local/opt/node/bin/auggie',
            '/opt/homebrew/opt/node/bin/auggie',
          ];

    for (const p of commonPaths) {
      if (p && (await pathExists(p))) {
        return { available: true };
      }
    }

    // Dynamically scan nvm directories (file system only, no process spawning)
    try {
      const nvmDir = path.join(homeDir, '.nvm', 'versions', 'node');
      const nodeDirs = (await fs.readdir(nvmDir)).filter((d) => d.startsWith('v'));
      for (const dir of nodeDirs) {
        const auggiePath = path.join(nvmDir, dir, 'bin', 'auggie');
        if (await pathExists(auggiePath)) {
          return { available: true };
        }
      }
    } catch {
      // nvm directory doesn't exist or can't be read
    }

    // Dynamically scan fnm directories
    try {
      const fnmDir = path.join(homeDir, '.fnm', 'node-versions');
      const nodeDirs = await fs.readdir(fnmDir);
      for (const dir of nodeDirs) {
        const auggiePath = path.join(fnmDir, dir, 'installation', 'bin', 'auggie');
        if (await pathExists(auggiePath)) {
          return { available: true };
        }
      }
    } catch {
      // fnm directory doesn't exist or can't be read
    }

    return { available: false };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if claude-code is available by checking if claude-code-acp is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkClaudeCodeAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isClaudeCodeInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if codex is available by checking if codex-acp is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCodexAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isCodexInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if cortex is available by checking if cortex is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkCortexAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isCortexInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Check if opencode is available by checking if opencode is installed.
 * Does not fall back to npx - we want accurate "is installed" status.
 */
async function checkOpenCodeAvailability(): Promise<ProviderStatus> {
  try {
    const installed = await isOpenCodeInstalled();
    return { available: installed };
  } catch (error) {
    return { available: false, error: (error as Error).message };
  }
}

/**
 * Get aggregated availability status for all providers
 */
export async function getProviderAvailability(): Promise<ProviderAvailabilityResult> {
  logger.info('Checking all provider availability');

  // Determine which providers are hidden due to missing env vars or feature codes
  const hiddenProviders: string[] = [];
  for (const [providerId, config] of Object.entries(ACP_PROVIDERS)) {
    // Check legacy env var gating
    if (config.requiresEnvVar && !process.env[config.requiresEnvVar]) {
      hiddenProviders.push(providerId);
      continue;
    }
    // Check feature code gating
    if (config.requiresFeatureCode && !featureCodesService.isFeatureEnabled(config.requiresFeatureCode)) {
      hiddenProviders.push(providerId);
    }
  }

  if (hiddenProviders.length > 0) {
    logger.info('Providers hidden due to missing env vars or feature codes', { hiddenProviders });
  }

  // Clear caches to ensure fresh detection (important for refresh button)
  clearClaudeCodeCache();
  clearCodexCache();
  clearCortexCache();
  clearOpenCodeCache();

  // Check all providers in parallel for faster startup
  // For hidden providers, skip the actual check and return unavailable
  const isCortexHidden = hiddenProviders.includes('cortex');
  const [auggieResult, claudeCodeResult, codexResult, cortexResult, opencodeResult] =
    await Promise.all([
      checkAuggieAvailability(),
      checkClaudeCodeAvailability(),
      checkCodexAvailability(),
      isCortexHidden
        ? Promise.resolve({ available: false } as ProviderStatus)
        : checkCortexAvailability(),
      checkOpenCodeAvailability(),
    ]);

  const result: ProviderAvailabilityResult = {
    hasAnyProvider:
      auggieResult.available ||
      claudeCodeResult.available ||
      codexResult.available ||
      cortexResult.available ||
      opencodeResult.available,
    providers: {
      auggie: auggieResult,
      claudeCode: claudeCodeResult,
      codex: codexResult,
      cortex: cortexResult,
      opencode: opencodeResult,
    },
    hiddenProviders,
  };

  logger.info('Provider availability check complete', {
    hasAnyProvider: result.hasAnyProvider,
    auggie: auggieResult.available,
    claudeCode: claudeCodeResult.available,
    codex: codexResult.available,
    cortex: cortexResult.available,
    opencode: opencodeResult.available,
    hiddenProviders,
  });

  return result;
}

/**
 * Get resolved CLI paths for all providers
 */
export async function getProviderPaths(): Promise<{
  auggie: string | null;
  'claude-code': string | null;
  codex: string | null;
  cortex: string | null;
  opencode: string | null;
}> {
  const [auggiePath, claudeCodePath, codexPath, cortexPath, opencodePath] = await Promise.all([
    findAuggiePathAsync(),
    getClaudeCodePath(),
    getCodexPath(),
    getCortexPath(),
    getOpenCodePath(),
  ]);

  return {
    auggie: auggiePath,
    'claude-code': claudeCodePath,
    codex: codexPath,
    cortex: cortexPath,
    opencode: opencodePath,
  };
}

/**
 * Setup IPC handlers for provider availability
 */
export function setupProviderAvailabilityIPC(): void {
  ipcMain.handle(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => {
    try {
      const result = await getProviderAvailability();
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error('Failed to get provider availability', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  ipcMain.handle(PROVIDERS_CHANNELS.GET_PATHS, async () => {
    try {
      const paths = await getProviderPaths();
      return {
        success: true,
        data: paths,
      };
    } catch (error) {
      logger.error('Failed to get provider paths', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  logger.info('Provider availability IPC handlers registered');
}
