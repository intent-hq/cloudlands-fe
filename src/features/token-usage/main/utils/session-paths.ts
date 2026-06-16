/**
 * Session Paths
 *
 * Resolves the on-disk location of auggie session files (main process only).
 */

import * as os from 'os';
import * as path from 'path';

/** Resolve `~/.augment/sessions/{sessionId}.json` for a given session id. */
export function getSessionFilePath(sessionId: string, homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.augment', 'sessions', `${sessionId}.json`);
}

