import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  MINIMUM_AUGGIE_VERSION,
  MINIMUM_NODE_VERSION,
} from '../../../shared/constants/auggie';
import { AUGGIE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { checkGitVersion } from './version-checks';
import { executeAuggieCommand } from './execute-auggie-command';
import {
  findAuggiePathAsync,
  getEnhancedPath,
} from './auggie-path';
import { hostExec } from '../../../shared/main/host-exec';
import { createProviderModelCache } from '../../../main/utils/provider-model-cache';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { JsonRpcError } from '../../backend/main/json-rpc-errors';

// Re-export path helpers for backwards compatibility with existing consumers.
export { findAuggiePathAsync, getEnhancedPath };

const logger = new Logger('AuggieIPC');

// ============================================================================
// Model List Cache
// ============================================================================
//
// The auggie CLI model list is fetched by shelling out to `auggie model list`,
// which is slow enough that repeated calls (e.g., from model-override validation
// in agent-interaction-tools.ts) noticeably stall agent creation. We cache the
// most recent successful result for 5 minutes; the cache is an internal
// implementation detail of this handler.

type AuggieModel = {
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  isLegacyModel?: boolean;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
};

const auggieModelCache = createProviderModelCache<AuggieModel>({
  providerId: 'auggie',
  // Must never throw: failures are logged inside fetchAuggieModels and
  // surfaced as null so callers can distinguish "unavailable" from "empty".
  fetch: async () => {
    try {
      return await fetchAuggieModels();
    } catch (error) {
      logger.error('Auggie model fetch failed', { error: (error as Error).message });
      return null;
    }
  },
});

/**
 * Return the cached auggie model values (bare model IDs) if the cache is
 * populated and fresh, otherwise attempt to fetch the live list and cache it.
 *
 * Returns `null` when the live list is unavailable (e.g., auggie CLI not
 * installed or the shell-out failed). Callers can distinguish "unavailable"
 * from "empty" so that validation can skip with an info log rather than a
 * spurious warning.
 */
export async function getCachedAuggieModels(): Promise<string[] | null> {
  const models = await getAuggieModelsWithCache();
  if (!models) return null;
  return models.map((m) => m.value);
}

/**
 * Internal: fetch (or return cached) live auggie model list.
 * Shared between the IPC handler and the main-side cache accessor.
 * Returns `null` on failure; the cache is only populated on success.
 */
async function getAuggieModelsWithCache(): Promise<AuggieModel[] | null> {
  return auggieModelCache.get();
}

export async function hydrateAuggieModelCacheFromDisk(): Promise<void> {
  await auggieModelCache.hydrateFromDisk();
}

/**
 * Internal: shell out to auggie CLI and parse the model list. No caching here.
 * Returns `null` on both parse-failure and hard failure so callers can
 * distinguish "unavailable" from an authoritative empty list.
 */
async function fetchAuggieModels(): Promise<AuggieModel[] | null> {
  try {
    const auggiePath = await findAuggiePathAsync();
    logger.info('Found auggie path for model list', { auggiePath });

    let models: AuggieModel[] | null = null;

    // Try JSON format first
    try {
      const { stdout: jsonStdout, stderr: jsonStderr } =
        await executeAuggieCommand('model list --json');
      if (jsonStderr) {
        logger.warn('Auggie model list --json stderr output', { stderr: jsonStderr });
      }
      logger.info('Auggie model list --json stdout', { length: jsonStdout?.length });
      models = parseModelListJson(jsonStdout);
      if (models) {
        logger.info(`Parsed ${models.length} models from JSON output`);
      }
    } catch (jsonError) {
      logger.warn('Auggie model list --json failed, falling back to plain text', {
        error: (jsonError as Error).message,
      });
    }

    // Fall back to plain text format
    if (!models) {
      const { stdout, stderr } = await executeAuggieCommand('model list');
      if (stderr) {
        logger.warn('Auggie model list stderr output', { stderr });
      }
      logger.info('Auggie model list stdout', { stdout, length: stdout?.length });
      models = parseModelListOutput(stdout);
    }

    if (models && models.length > 0) {
      const filteredModels = models.filter((m) => !m.isLegacyModel);
      const sortedModels = filteredModels.sort((a, b) => {
        const aGroup = a.modelGroupPriority ?? 999;
        const bGroup = b.modelGroupPriority ?? 999;
        if (aGroup !== bGroup) return aGroup - bGroup;
        const aPriority = a.priority ?? 999;
        const bPriority = b.priority ?? 999;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.label.localeCompare(b.label);
      });
      return sortedModels;
    }

    return null;
  } catch (error) {
    const errorWithOutput = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
    };
    logger.error('Auggie model list command failed', {
      message: errorWithOutput.message,
      exitCode: errorWithOutput.code,
      killed: errorWithOutput.killed,
      stdout: errorWithOutput.stdout?.substring(0, 500),
      stderr: errorWithOutput.stderr?.substring(0, 500),
    });

    // Some platforms: auggie may crash during exit but still produce valid stdout.
    const outputToParse = errorWithOutput.stdout || errorWithOutput.stderr || '';
    if (outputToParse) {
      const parsed = parseModelListOutput(outputToParse);
      if (parsed.length > 0) {
        logger.warn('Auggie CLI exited with error but produced valid model output', {
          error: errorWithOutput.message,
          modelCount: parsed.length,
        });
        return parsed;
      }
    }
    return null;
  }
}

// ============================================================================
// Auggie CLI Version Requirements
// ============================================================================

/**
 * Parse a semver version string into its components.
 * Prerelease suffixes (e.g., -beta.1, -rc.1) are ignored for comparison purposes.
 * Returns null if the version string is invalid.
 */
function parseVersion(
  versionString: string,
): { major: number; minor: number; patch: number } | null {
  // Extract version number from strings like "auggie version 0.14.0-beta.1 (commit abc123)"
  // The regex captures major.minor.patch, ignoring any prerelease suffix
  const match = versionString.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/**
 * Compare two version strings.
 * Returns:
 *   -1 if version1 < version2
 *    0 if version1 === version2
 *    1 if version1 > version2
 *   null if either version is invalid
 */
function compareVersions(version1: string, version2: string): number | null {
  const v1 = parseVersion(version1);
  const v2 = parseVersion(version2);

  if (!v1 || !v2) return null;

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  return 0;
}

/**
 * Check if a version meets the minimum required version.
 */
function meetsMinimumVersion(version: string, minimum: string = MINIMUM_AUGGIE_VERSION): boolean {
  const comparison = compareVersions(version, minimum);
  // If comparison is null (invalid version), assume it doesn't meet requirements
  return comparison !== null && comparison >= 0;
}

// ============================================================================
// Node.js Version Check
// ============================================================================

/**
 * Check the installed Node.js version via the daemon's `host.exec`
 * (PROTOCOL §5.14).
 *
 * Post-P2 the daemon owns agent spawning (`agent.create` → `spawn.rs`) and
 * PATH resolution (`host.env`), so the `node` that `host.exec` resolves —
 * with the daemon's PATH-enriched env — is exactly the runtime the agent
 * will use. The earlier `rawExec(process.env)` workaround (which avoided
 * the app's enhanced PATH to match the launcher's PATH) is obsolete.
 */
async function checkNodeVersion(): Promise<{
  nodeVersion?: string;
  nodeVersionOk: boolean;
}> {
  try {
    const result = await hostExec('node', {
      args: ['--version'],
      timeoutMs: 5000,
    });
    if (result.timedOut) {
      logger.warn('Node version probe (host.exec) timed out');
      return { nodeVersionOk: false };
    }
    if (result.exitCode !== 0) {
      logger.warn('Node not found on PATH (host.exec)', {
        exitCode: result.exitCode,
        stderr: result.stderr,
      });
      return { nodeVersionOk: false };
    }
    const version = (result.stdout || '').trim();
    if (!version) {
      return { nodeVersionOk: false };
    }
    const versionOk = meetsMinimumVersion(version, MINIMUM_NODE_VERSION);
    logger.info('Node.js version check (host.exec)', { version, versionOk });
    return { nodeVersion: version, nodeVersionOk: versionOk };
  } catch (err) {
    logger.warn('Node version probe (host.exec) failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { nodeVersionOk: false };
  }
}

// ============================================================================
// Model Parsing Helper
// ============================================================================

/**
 * Parse auggie model list output and extract model information.
 * Returns an array of models with value and label, or empty array if parsing fails.
 *
 * Expected CLI output format:
 *   Available models:
 *    - Display Name [model-id]
 *    - Default Model [model-id]  (default)
 *        Description text on next line
 */
export function parseModelListOutput(
  stdout: string,
): Array<{ value: string; label: string; description?: string }> {
  const models: Array<{ value: string; label: string; description?: string }> = [];
  const lines = stdout.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();

    // Skip empty lines and headers
    if (!trimmedLine || trimmedLine.startsWith('Available models')) {
      continue;
    }

    // Match the format: " - Model Name [model-id]" with optional trailing content like "(default)"
    const modelMatch = trimmedLine.match(/^-\s+(.+?)\s*\[([^\]]+)\]/);
    if (modelMatch) {
      const label = modelMatch[1].trim();
      const value = modelMatch[2].trim();

      // Check if the next line is a description (indented, doesn't start with -)
      let description: string | undefined;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('-') && !nextLine.startsWith('Available')) {
          description = nextLine;
          i++; // Skip the description line
        }
      }

      models.push({ value, label, ...(description ? { description } : {}) });
    }
  }

  return models;
}

/**
 * Parse auggie model list --json output.
 * Returns an array of models with rich metadata, or null if parsing fails.
 */
function parseModelListJson(stdout: string): Array<{
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  isLegacyModel?: boolean;
  costTier?: number;
  badges?: Array<{ color: string; label: string; variant?: string }>;
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}> | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.models)) {
      return null;
    }

    return parsed.models
      .filter(
        (m: Record<string, unknown>) =>
          typeof m.shortName === 'string' && typeof m.displayName === 'string',
      )
      .map((m: Record<string, unknown>) => ({
        value: m.shortName as string,
        label: m.displayName as string,
        ...(m.description ? { description: m.description as string } : {}),
        ...(m.modelGroupPriority != null
          ? { modelGroupPriority: m.modelGroupPriority as number }
          : {}),
        ...(m.isLegacyModel ? { isLegacyModel: true } : {}),
        ...(m.costTier != null ? { costTier: m.costTier as number } : {}),
        ...(Array.isArray(m.badges) && m.badges.length > 0 ? { badges: m.badges } : {}),
        ...(Array.isArray(m.effortLevels) && m.effortLevels.length > 0
          ? { effortLevels: m.effortLevels }
          : {}),
        ...(m.isDefault ? { isDefault: true } : {}),
        ...(m.priority != null ? { priority: m.priority as number } : {}),
      }));
  } catch {
    return null;
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupAuggieIPC() {
  // Check if auggie is available
  ipcMain.handle(AUGGIE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking auggie availability');

      // Try to run auggie --version
      try {
        const { stdout, stderr } = await executeAuggieCommand('--version');

        // Check if we got a version output
        const isAvailable =
          (stdout &&
            (stdout.includes('auggie') ||
              stdout.includes('version') ||
              /\d+\.\d+\.\d+/.test(stdout))) ||
          (stderr && (stderr.includes('auggie') || stderr.includes('version')));

        logger.info('Auggie availability check', { isAvailable, stdout, stderr });

        return {
          success: true,
          available: isAvailable,
        };
      } catch (error) {
        const errnoError = error as NodeJS.ErrnoException;
        const errorMessage = (error as Error).message;
        // If command fails with ENOENT, auggie is not installed
        if (errnoError.code === 'ENOENT' || errorMessage.includes('not found')) {
          logger.info('Auggie not found in PATH');
          return {
            success: true,
            available: false,
          };
        }

        // For other errors, still try to determine if auggie exists
        logger.warn('Error checking auggie, but may still be available', { error: errorMessage });
        return {
          success: true,
          available: false,
        };
      }
    } catch (error) {
      logger.error('Failed to check auggie availability', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Get the resolved auggie path (for displaying in settings)
  ipcMain.handle(AUGGIE_CHANNELS.GET_PATH, async () => {
    try {
      const resolvedPath = await findAuggiePathAsync();
      return {
        success: true,
        path: resolvedPath,
      };
    } catch (error) {
      logger.error('Failed to get auggie path', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Get installation/authentication status for Auggie CLI
  ipcMain.handle(AUGGIE_CHANNELS.STATUS, async () => {
    // Install/version detection is delegated to the daemon (`host.checkAuggie`,
    // PROTOCOL §5.14 companion); the FE-local binary download flow is retired
    // (Decision 3), so `binaryInstallAvailable`/`managedBinaryInstalled` remain
    // in the payload for renderer compatibility but are always false — install
    // is now a manual step surfaced by AUGGIE_CHANNELS.INSTALL instructions.
    const status: {
      installed: boolean;
      authenticated: boolean;
      version?: string;
      versionOk: boolean;
      minimumVersion: string;
      authDetails?: string;
      nodeVersion?: string;
      nodeVersionOk: boolean;
      gitInstalled: boolean;
      gitVersion?: string;
      binaryInstallAvailable: boolean;
      managedBinaryInstalled: boolean;
    } = {
      installed: false,
      authenticated: false,
      versionOk: false,
      minimumVersion: MINIMUM_AUGGIE_VERSION,
      nodeVersionOk: false,
      gitInstalled: false,
      binaryInstallAvailable: false,
      managedBinaryInstalled: false,
    };

    try {
      // Node.js and Git checks stay FE-local — they describe the host that
      // will run auggie (the daemon's host from the FE's PoV) and are used by
      // the setup UI to render the platform-support instructions text.
      const [nodeSettled, gitSettled] = await Promise.allSettled([
        checkNodeVersion(),
        checkGitVersion(),
      ]);

      if (nodeSettled.status === 'fulfilled') {
        status.nodeVersion = nodeSettled.value.nodeVersion;
        status.nodeVersionOk = nodeSettled.value.nodeVersionOk;
        if (!status.nodeVersionOk) {
          if (status.nodeVersion) {
            logger.warn('Node.js version is below minimum required', {
              current: status.nodeVersion,
              minimum: MINIMUM_NODE_VERSION,
            });
          } else {
            logger.warn('Node.js not found on system', {
              minimum: MINIMUM_NODE_VERSION,
            });
          }
        }
      } else {
        logger.debug('Failed to check Node.js version', { error: nodeSettled.reason });
      }

      if (gitSettled.status === 'fulfilled') {
        status.gitInstalled = gitSettled.value.gitInstalled;
        status.gitVersion = gitSettled.value.gitVersion;
      } else {
        logger.debug('Failed to check Git version', { error: gitSettled.reason });
      }

      // Install + version detection via the daemon. `host.checkAuggie` applies
      // the settings precedence and canonical PATH scan; failures are logged
      // and surfaced as "not installed" (honest degradation, no local probe).
      let auggiePath: string | null = null;
      try {
        const check = await getBackendClient().request<{
          available: boolean;
          path?: string;
          version?: string;
        }>('host.checkAuggie');
        status.installed = Boolean(check?.available);
        if (typeof check?.version === 'string' && check.version.trim()) {
          status.version = check.version.trim();
        }
        if (typeof check?.path === 'string' && check.path.trim()) {
          auggiePath = check.path.trim();
        }
        if (status.installed && status.version) {
          status.versionOk = meetsMinimumVersion(status.version);
          if (!status.versionOk) {
            logger.warn('Auggie CLI version is below minimum required', {
              current: status.version,
              minimum: MINIMUM_AUGGIE_VERSION,
            });
          }
        }
      } catch (error) {
        logger.warn('host.checkAuggie failed during status', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: `Auggie CLI check failed: ${
            error instanceof Error ? error.message : String(error)
          }. Please try again.`,
          data: status,
        };
      }

      if (!status.installed || !status.versionOk || !auggiePath) {
        return {
          success: true,
          data: status,
        };
      }

      // Auth probe via `host.exec`: `auggie model list` is fast and its stderr
      // contains a stable "not logged in" marker. Mirrors the existing pattern
      // in provider-availability.service#checkAuggieAuth. On RPC failure we
      // report unauthenticated + a debug log rather than falling back locally.
      try {
        const probe = await hostExec(auggiePath, {
          args: ['model', 'list'],
          timeoutMs: 8000,
        });
        if (probe.timedOut) {
          logger.debug('Auggie auth probe timed out');
        } else {
          const output = `${probe.stdout}\n${probe.stderr}`;
          const isUnauthenticated =
            /not currently logged in|not logged in|not authenticated|login required|please log in/i.test(
              output,
            );
          if (probe.exitCode === 0 && !isUnauthenticated) {
            status.authenticated = true;
            status.authDetails = 'auggie model list succeeded (host.exec probe)';
          } else if (isUnauthenticated) {
            status.authDetails = 'auggie reports not logged in';
          }
        }
      } catch (probeError) {
        logger.debug('Auggie auth probe (host.exec) failed', {
          error: probeError instanceof Error ? probeError.message : String(probeError),
        });
      }

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logger.error('Failed to get auggie status', { error: (error as Error).message });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Install auggie. Local install (npm-install / binary download / codesign)
  // is retired per Decision 3: the FE returns platform-specific instructions
  // for the user to run in their own terminal. The envelope shape
  // ({ success, error, errorType, data }) is preserved so existing renderers
  // keep functioning; `data.instructions` / `data.command` carry the
  // actionable payload for callers that render the new UX.
  ipcMain.handle(AUGGIE_CHANNELS.INSTALL, async () => {
    const platform = process.platform;
    const command =
      platform === 'win32'
        ? 'npm install -g @augmentcode/auggie'
        : 'npm install -g @augmentcode/auggie';
    const nodeCheck = await checkNodeVersion();

    const instructions: string[] = [];
    if (!nodeCheck.nodeVersionOk) {
      const versionInfo = nodeCheck.nodeVersion
        ? ` (found ${nodeCheck.nodeVersion})`
        : ' (not found)';
      instructions.push(
        `Install Node.js ${MINIMUM_NODE_VERSION.split('.')[0]}+ from https://nodejs.org${versionInfo}.`,
      );
    }
    instructions.push(
      `Run \`${command}\` in your terminal (see https://docs.augmentcode.com/cli for details).`,
      `After install, verify with \`auggie --version\` (must be >= ${MINIMUM_AUGGIE_VERSION}).`,
    );

    const errorMessage = instructions.join(' ');
    logger.info('Auggie install: returning manual-install instructions', {
      platform,
      nodeVersionOk: nodeCheck.nodeVersionOk,
    });

    return {
      success: false,
      error: errorMessage,
      errorType: 'manual_install_required' as const,
      data: {
        instructions,
        command,
        platform,
        minimumAuggieVersion: MINIMUM_AUGGIE_VERSION,
        minimumNodeVersion: MINIMUM_NODE_VERSION,
      },
    };
  });

  // Authenticate with Augment. The FE-side interactive OAuth flow
  // (spawning `auggie login`, stdout scraping, JSON paste, direct token
  // exchange) is retired per Decision 3. The FE now detects auth via
  // `host.checkAuggie` + a `host.exec` probe and returns instructions for
  // the user to run `auggie login` themselves.
  //
  // The `{ action }` param is preserved for renderer compat: `start` and
  // `complete` return the instruction payload; `poll` re-runs detection so
  // the setup UI can show "logged in" once the user finishes the flow.
  ipcMain.handle(
    AUGGIE_CHANNELS.AUTHENTICATE,
    async (
      _,
      _params?: { action?: 'start' | 'complete' | 'poll'; authResponse?: string },
    ) => {
      // Re-check via the daemon so callers get the current install state.
      let auggiePath: string | null = null;
      let installed = false;
      try {
        const check = await getBackendClient().request<{
          available: boolean;
          path?: string;
          version?: string;
        }>('host.checkAuggie');
        installed = Boolean(check?.available);
        if (typeof check?.path === 'string' && check.path.trim()) {
          auggiePath = check.path.trim();
        }
      } catch (error) {
        logger.warn('host.checkAuggie failed during authenticate', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          error: 'Could not reach the daemon to check for the Auggie CLI. Please try again.',
        };
      }

      if (!installed || !auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Install it first, then click Login again.',
          errorType: 'not_installed' as const,
          data: {
            instructions: [
              'Install the Auggie CLI first (npm install -g @augmentcode/auggie).',
              'Then run `auggie login` in your terminal.',
            ],
            command: 'auggie login',
          },
        };
      }

      // Probe auth state. If already logged in, tell the renderer so it can
      // skip the login step. Otherwise return the instruction to run
      // `auggie login` interactively (host.exec is buffered and cannot host
      // the OAuth interactive TTY session; the user runs it in their own
      // terminal).
      let authenticated = false;
      try {
        const probe = await hostExec(auggiePath, {
          args: ['model', 'list'],
          timeoutMs: 8000,
        });
        if (!probe.timedOut) {
          const output = `${probe.stdout}\n${probe.stderr}`;
          const isUnauthenticated =
            /not currently logged in|not logged in|not authenticated|login required|please log in/i.test(
              output,
            );
          authenticated = probe.exitCode === 0 && !isUnauthenticated;
        }
      } catch (probeError) {
        logger.debug('Auggie auth probe (host.exec) failed', {
          error: probeError instanceof Error ? probeError.message : String(probeError),
        });
      }

      if (authenticated) {
        return {
          success: true,
          data: { authenticated: true, completed: true },
        };
      }

      return {
        success: false,
        error: 'Run `auggie login` in your terminal to sign in, then click Login again.',
        errorType: 'manual_login_required' as const,
        data: {
          authenticated: false,
          instructions: [
            `Run \`${auggiePath} login\` (or just \`auggie login\`) in your terminal.`,
            'Complete the browser flow, then return here and click Login again.',
          ],
          command: 'auggie login',
          auggiePath,
        },
      };
    },
  );

  // Get available models from auggie CLI. Caching is handled in
  // getAuggieModelsWithCache() (defined at module scope) so that the main-side
  // model-override validator can reuse the same cache without re-shelling.
  ipcMain.handle(AUGGIE_CHANNELS.GET_MODELS, async () => {
    try {
      logger.info('Getting models from auggie CLI');
      const models = await getAuggieModelsWithCache();
      if (models && models.length > 0) {
        logger.info(`Successfully retrieved ${models.length} models from auggie CLI`);
        return { success: true, data: models };
      }
      const auggiePath = await findAuggiePathAsync();
      if (!auggiePath) {
        return {
          success: false,
          error: 'Auggie CLI not found. Please install auggie first.',
        };
      }
      if (models && models.length === 0) {
        logger.warn('Auggie model list returned no parseable models');
        return {
          success: false,
          error: 'Could not parse auggie model list output. Please try again.',
        };
      }
      // models === null: hard failure inside fetchAuggieModels
      return {
        success: false,
        error: 'Auggie CLI failed to return a model list. Please try again.',
      };
    } catch (error) {
      logger.error('Error getting models', error as Error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get models',
      };
    }
  });

  // Get the latest session file
  ipcMain.handle(AUGGIE_CHANNELS.GET_LATEST_SESSION, async () => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');

      // Check if sessions directory exists
      try {
        await fs.access(sessionsDir);
      } catch {
        return {
          success: false,
          error: 'Sessions directory not found',
        };
      }

      // Read all session files
      const files = await fs.readdir(sessionsDir);
      if (files.length === 0) {
        return {
          success: false,
          error: 'No session files found',
        };
      }

      // Get the most recent session file
      let latestFile = files[0];
      let latestTime = 0;

      for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestFile = file;
        }
      }

      // Extract session ID from filename (format: session-{id}.json)
      const sessionId = latestFile.replace('session-', '').replace('.json', '');

      return {
        success: true,
        data: {
          sessionId,
          filePath: path.join(sessionsDir, latestFile),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || 'Failed to get latest session',
      };
    }
  });

  // Extract file changes from a session
  ipcMain.handle(AUGGIE_CHANNELS.EXTRACT_FILE_CHANGES, async (_, { sessionId }) => {
    try {
      const sessionsDir = path.join(os.homedir(), '.auggie', 'sessions');
      const sessionFile = path.join(sessionsDir, `session-${sessionId}.json`);

      // Check if session file exists
      try {
        await fs.access(sessionFile);
      } catch {
        return {
          success: true,
          data: [], // Return empty array if session file doesn't exist yet
        };
      }

      // Read session file
      const content = await fs.readFile(sessionFile, 'utf-8');
      const sessionData = JSON.parse(content);

      // Extract file changes from the session
      const fileChanges: any[] = [];

      // Look for file changes in the session data
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
        for (const message of sessionData.messages) {
          if (message.contentBlocks && Array.isArray(message.contentBlocks)) {
            for (const block of message.contentBlocks) {
              // Look for tool use blocks that indicate file changes
              if (block.type === 'tool_use' && block.name === 'edit_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.old_str || '',
                  newContent: input.new_str || '',
                  type: 'edit',
                });
              } else if (block.type === 'tool_use' && block.name === 'create_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: '',
                  newContent: input.content || '',
                  type: 'create',
                });
              } else if (block.type === 'tool_use' && block.name === 'delete_file') {
                const input = block.input || {};
                fileChanges.push({
                  path: input.path,
                  oldContent: input.content || '',
                  newContent: '',
                  type: 'delete',
                });
              }
            }
          }
        }
      }

      return {
        success: true,
        data: fileChanges,
      };
    } catch (error) {
      logger.error('Error extracting file changes', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || 'Failed to extract file changes',
      };
    }
  });

  // Get the current user, derived from the daemon's GitHub identity.
  // The login is surfaced as `id` for the existing analytics consumer.
  // email/tenantId/tenantName have no GitHub equivalent and are null (see
  // BE hand-off note d1df7466).
  ipcMain.handle(AUGGIE_CHANNELS.GET_USER_INFO, async () => {
    try {
      const response = await getBackendClient().request<{
        user?: { login?: string; avatarUrl?: string; htmlUrl?: string } | null;
      }>('github.getUser');
      const user = response?.user;
      if (user?.login) {
        return {
          success: true,
          data: {
            id: user.login,
            email: null,
            tenantId: null,
            tenantName: null,
            login: user.login,
            avatarUrl: user.avatarUrl ?? null,
            htmlUrl: user.htmlUrl ?? null,
          },
        };
      }
      return {
        success: false,
        error: 'No user info available',
      };
    } catch (error) {
      // Daemon not configured / method missing: treat as no user, not a crash.
      if (error instanceof JsonRpcError && error.rpcCode === -32601) {
        return {
          success: false,
          error: 'No user info available',
        };
      }
      logger.error('Error getting user info', error instanceof Error ? error : undefined);
      return {
        success: false,
        error: (error as Error).message || 'Failed to get user info',
      };
    }
  });

  // Setup MCP for Pi
  //
  // Uninstall MCP from Claude Code
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CLAUDE_CODE, async () => {
    try {
      logger.info('Uninstalling MCP from Claude Code');

      const { getClaudeCodePath } =
        await import('../../../features/claude-code/main/claude-code-resolver');
      const claudePath = await getClaudeCodePath();

      if (!claudePath) {
        return {
          success: false,
          error: 'Claude CLI not found. Please install the Claude CLI first.',
        };
      }

      const command = `${claudePath} mcp remove auggie --scope user`;

      logger.info('Executing Claude Code MCP uninstall', { command });

      const uninstallResult = await hostExec(claudePath, {
        args: ['mcp', 'remove', 'auggie', '--scope', 'user'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Claude Code MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Claude Code', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Codex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CODEX, async () => {
    try {
      logger.info('Uninstalling MCP from Codex');

      const { getCodexPath } = await import('../../../features/codex/main/codex-resolver');
      const codexPath = await getCodexPath();

      if (!codexPath) {
        return {
          success: false,
          error: 'Codex CLI not found. Please install the Codex CLI first.',
        };
      }

      const command = `${codexPath} mcp remove codebase-retrieval`;

      logger.info('Executing Codex MCP uninstall', { command });

      const uninstallResult = await hostExec(codexPath, {
        args: ['mcp', 'remove', 'codebase-retrieval'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Codex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Codex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Cortex
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_CORTEX, async () => {
    try {
      logger.info('Uninstalling MCP from Cortex');

      const { getCortexPath } = await import('../../../features/cortex/main/cortex-resolver');
      const cortexPath = await getCortexPath();

      if (!cortexPath) {
        return {
          success: false,
          error: 'Cortex CLI not found. Please install the Cortex CLI first.',
        };
      }

      const command = `${cortexPath} mcp remove augment-context-engine`;

      logger.info('Executing Cortex MCP uninstall', { command });

      const uninstallResult = await hostExec(cortexPath, {
        args: ['mcp', 'remove', 'augment-context-engine'],
        timeoutMs: 30000,
      });
      if (uninstallResult.timedOut || uninstallResult.exitCode !== 0) {
        throw new Error(
          uninstallResult.stderr || `host.exec exited with code ${uninstallResult.exitCode}`,
        );
      }
      const { stdout, stderr } = uninstallResult;

      logger.info('Cortex MCP uninstall completed', { stdout, stderr });

      return {
        success: true,
      };
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Cortex', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from OpenCode
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_OPENCODE, async () => {
    try {
      logger.info('Uninstalling MCP from OpenCode');

      const configFile = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcp && config.mcp['augment-context-engine']) {
          delete config.mcp['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('OpenCode MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in OpenCode config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('OpenCode config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse OpenCode config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: `Failed to parse OpenCode config: ${(readOrParseError as Error).message}`,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from OpenCode', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Pi
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_PI, async () => {
    try {
      logger.info('Uninstalling MCP from Pi');

      const configFile = path.join(os.homedir(), '.pi', 'agent', 'mcp.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcpServers && config.mcpServers['augment-context-engine']) {
          delete config.mcpServers['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('Pi MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in Pi config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('Pi MCP config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse Pi MCP config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: `Failed to parse Pi config: ${(readOrParseError as Error).message}`,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Pi', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });

  // Uninstall MCP from Droid
  ipcMain.handle(AUGGIE_CHANNELS.UNINSTALL_MCP_DROID, async () => {
    try {
      logger.info('Uninstalling MCP from Droid');

      const configFile = path.join(os.homedir(), '.factory', 'mcp.json');

      try {
        const content = await fs.readFile(configFile, 'utf-8');
        const config = JSON.parse(content);

        if (config.mcpServers && config.mcpServers['augment-context-engine']) {
          delete config.mcpServers['augment-context-engine'];
          await fs.writeFile(configFile, JSON.stringify(config, null, 2), 'utf-8');
          logger.info('Droid MCP uninstall completed', { configFile });
        } else {
          logger.info('augment-context-engine not found in Droid config, nothing to uninstall');
        }

        return {
          success: true,
        };
      } catch (readOrParseError) {
        const errCode = (readOrParseError as NodeJS.ErrnoException).code;
        if (errCode === 'ENOENT') {
          logger.info('Droid MCP config file not found, nothing to uninstall');
          return { success: true };
        }
        logger.warn('Failed to read/parse Droid MCP config file during uninstall', {
          error: (readOrParseError as Error).message,
        });
        return {
          success: false,
          error: `Failed to parse Droid MCP config: ${(readOrParseError as Error).message}`,
        };
      }
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      logger.error('Failed to uninstall MCP from Droid', { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
      };
    }
  });
}
