/**
 * OpenCode IPC Handlers
 *
 * IPC handlers for OpenCode CLI integration. Model listing is a thin call to
 * the daemon's per-provider catalog (`models.list { providerId }`, PROTOCOL
 * §6.7) — the daemon owns the CLI shell-out, parsing, and caching.
 */

import { ipcMain } from 'electron';
import { OPENCODE_CHANNELS } from '../../../shared/ipc/channels';
import { Logger } from '../../../shared/logger';
import { getProviderModelsEnvelope } from '../../../main/utils/daemon-model-catalog';
import { hostExec } from '../../../shared/main/host-exec';
import { resolveOpenCodeCommand } from './opencode-resolver';

const logger = new Logger('OpenCodeIPC');

/**
 * Execute an opencode command via the daemon's `host.exec` seam (PROTOCOL §5.14).
 * The daemon owns argv-based one-shot exec on the workspace's target host and
 * returns captured stdout/stderr/exit code. Rejects with the RPC error on
 * transport failure; a non-zero exit is surfaced by rejecting with a
 * stderr-derived message, matching the pre-refactor contract observed by callers.
 */
async function executeOpencodeCommand(
  args: string[],
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? 30000;
  const resolved = await resolveOpenCodeCommand();
  if (!resolved) {
    throw new Error('opencode binary not available (host.findBinary returned no result)');
  }

  logger.debug('OpenCode host.exec details', {
    opencodePath: resolved.command,
    usesNpx: resolved.usesNpx,
    args,
  });

  const result = await hostExec(resolved.command, {
    args: [...resolved.argsPrefix, ...args],
    timeoutMs: timeout,
  });

  if (result.timedOut) {
    throw new Error(`Command timed out after ${timeout}ms`);
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Command exited with code ${result.exitCode}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export function setupOpencodeIPC() {
  // Check if opencode is available
  ipcMain.handle(OPENCODE_CHANNELS.CHECK_AVAILABILITY, async () => {
    try {
      logger.debug('Checking opencode availability');
      const { stdout } = await executeOpencodeCommand(['--version'], { timeout: 5000 });
      const isAvailable = stdout.length > 0;
      logger.info('OpenCode availability check', { isAvailable, stdout: stdout.trim() });
      return { success: true, available: isAvailable };
    } catch (error) {
      logger.info('OpenCode not available', { error: (error as Error).message });
      return { success: true, available: false };
    }
  });

  // Get available models from opencode — daemon-owned catalog (PROTOCOL §6.7)
  ipcMain.handle(
    OPENCODE_CHANNELS.GET_MODELS,
    async (_event, params?: { forceRefresh?: boolean }) =>
      getProviderModelsEnvelope('opencode', params),
  );
}
