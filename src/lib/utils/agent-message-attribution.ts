/**
 * Agent-to-agent message attribution.
 *
 * The daemon tags user-role rows that were sent by another agent with
 * `metadata: { type: 'agent_message', fromAgentId, fromAgentName? }`.
 * This util extracts that attribution metadata-first with graceful fallback:
 * absent or malformed metadata (wrong type, missing/non-string `fromAgentId`)
 * returns `null` so callers render the message exactly as before.
 */

export interface AgentMessageAttribution {
  /** Sender agent id — used to seed the avatar and open the agent tab. */
  fromAgentId: string;
  /** Display name for the sender ("Agent" fallback, truncated to ~20 chars). */
  displayName: string;
}

const MAX_NAME_LENGTH = 20;

/**
 * Extract sender attribution from an opaque message metadata object.
 * Returns `null` unless `metadata.type === 'agent_message'` and
 * `metadata.fromAgentId` is a non-empty string.
 */
export function getAgentMessageAttribution(metadata: unknown): AgentMessageAttribution | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  if (md.type !== 'agent_message') return null;
  const fromAgentId = typeof md.fromAgentId === 'string' ? md.fromAgentId.trim() : '';
  if (!fromAgentId) return null;

  const rawName = typeof md.fromAgentName === 'string' ? md.fromAgentName.trim() : '';
  const name = rawName || 'Agent';
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 2) + '…' : name;

  return { fromAgentId, displayName };
}
