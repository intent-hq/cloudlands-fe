/**
 * Session trimmer: removes the last N user turns from an auggie session file
 * and writes a new trimmed session file that can be loaded via session/load.
 *
 * A "user turn" starts at an exchange whose request_nodes contains a node
 * with type 0 (text_node) and includes all subsequent exchanges until the
 * next type-0 exchange.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { homedir } from 'os';


const SESSIONS_DIR = join(homedir(), '.augment', 'sessions');

/**
 * Check whether an exchange contains a user text message (type 0 request node).
 */
function isUserTurnStart(exchange: any): boolean {
  const nodes = exchange?.exchange?.request_nodes;
  return Array.isArray(nodes) && nodes.some((n: any) => n.type === 0);
}

/**
 * Trim an auggie session by removing the last `userTurnsToRemove` user turns
 * and all exchanges after them.
 *
 * @param sessionId - The session ID (corresponds to ~/.augment/sessions/{id}.json)
 * @param userTurnsToRemove - Number of user turns to remove from the end
 * @returns The new session ID of the trimmed session file
 * @throws If the session file is not found, has no chatHistory, or if
 *         userTurnsToRemove exceeds the number of user turns available.
 */
export function trimSession(sessionId: string, userTurnsToRemove: number): string {
  const inputPath = join(SESSIONS_DIR, `${sessionId}.json`);

  if (!existsSync(inputPath)) {
    throw new Error(`Session file not found: ${inputPath}`);
  }

  if (userTurnsToRemove <= 0) {
    throw new Error(`userTurnsToRemove must be positive, got ${userTurnsToRemove}`);
  }

  const raw = readFileSync(inputPath, 'utf-8');
  const session = JSON.parse(raw);

  const chatHistory: any[] = session.chatHistory;
  if (!chatHistory || chatHistory.length === 0) {
    throw new Error('Session has no chatHistory or it is empty');
  }

  // Find indices of all exchanges that start a user turn (have type-0 request node)
  const userTurnIndices: number[] = [];
  for (let i = 0; i < chatHistory.length; i++) {
    if (isUserTurnStart(chatHistory[i])) {
      userTurnIndices.push(i);
    }
  }

  if (userTurnIndices.length === 0) {
    throw new Error('No user turns found in chatHistory (no exchanges with type-0 request nodes)');
  }

  if (userTurnsToRemove > userTurnIndices.length) {
    throw new Error(
      `Cannot remove ${userTurnsToRemove} user turn(s): only ${userTurnIndices.length} user turn(s) exist`
    );
  }

  if (userTurnsToRemove === userTurnIndices.length) {
    throw new Error(
      `Cannot remove all ${userTurnIndices.length} user turn(s): would result in an empty session`
    );
  }

  // Find the cut point: the index of the Nth-from-last user turn start
  const cutIndex = userTurnIndices[userTurnIndices.length - userTurnsToRemove];

  // Slice everything before the cut point
  session.chatHistory = chatHistory.slice(0, cutIndex);

  // Generate new session ID and update metadata
  const newSessionId = randomUUID();
  session.sessionId = newSessionId;
  session.modified = new Date().toISOString();

  // Write the trimmed session
  const outputPath = join(SESSIONS_DIR, `${newSessionId}.json`);
  writeFileSync(outputPath, JSON.stringify(session, null, 2), 'utf-8');

  return newSessionId;
}

