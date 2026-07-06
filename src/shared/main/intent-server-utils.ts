/**
 * Intent-server utilities shared across main-process features.
 *
 * Extracted from the deleted features/agent/main/agent-providers/acp-provider.ts
 * as part of G2 (delete acp-provider + spawn machinery) so the workspace IPC
 * and service layers can locate the remote intent-server bundle and escape
 * shell args without pulling in the ACP spawn code.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { Logger } from '$shared/logger';

const logger = new Logger('IntentServerUtils');

/**
 * Escape a value for safe inclusion in a POSIX shell command.
 * Uses single quotes and escapes any embedded single quotes.
 */
export function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/**
 * Resolve the path to the intent-server.cjs bundle used for remote
 * workspace deployment.
 *
 * Development: __dirname is dist/shared/main; the bundle lives at
 *   dist/features/agent/main/remote-server/intent-server.cjs (two levels up,
 *   then into the agent feature remote-server subtree).
 * Packaged:   the file is unpacked from app.asar into app.asar.unpacked.
 */
export function getIntentServerPath(): string {
  const distRoot = path.resolve(__dirname, '..', '..');
  const devPath = path.join(
    distRoot,
    'features',
    'agent',
    'main',
    'remote-server',
    'intent-server.cjs',
  );

  logger.info('Intent server path resolution starting', {
    __dirname,
    distRoot,
    devPath,
    isPackaged: app.isPackaged,
  });

  if (app.isPackaged) {
    const unpackedPath = devPath.replace('app.asar', 'app.asar.unpacked');

    logger.info('Intent server path resolution (packaged)', {
      isPackaged: true,
      devPath,
      unpackedPath,
      devPathExists: fs.existsSync(devPath),
      unpackedPathExists: fs.existsSync(unpackedPath),
    });

    if (fs.existsSync(unpackedPath)) {
      logger.info('Using unpacked intent server path', { unpackedPath });
      return unpackedPath;
    }

    logger.warn('Intent server unpacked path not found, falling back to dev path', {
      unpackedPath,
      devPath,
    });
  } else {
    logger.info('Using dev intent server path', {
      devPath,
      exists: fs.existsSync(devPath),
    });
  }

  return devPath;
}
