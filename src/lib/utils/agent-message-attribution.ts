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
  /**
   * Verbatim sender name from metadata (empty when absent) — untrimmed and
   * untruncated, exactly as the daemon used it in the literal sender header.
   * Used for the exact-header strip in {@link stripAgentMessageHeader}, same
   * pattern as `rawName` in `hook-wake-attribution.ts`.
   */
  rawName: string;
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

  const rawName = typeof md.fromAgentName === 'string' ? md.fromAgentName : '';
  const name = rawName.trim() || 'Agent';
  const displayName =
    name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH - 1) + '…' : name;

  return { fromAgentId, displayName, rawName };
}

/**
 * Single-line sender header the daemon prepends to agent-origin message
 * content: `[MESSAGE FROM AGENT {name} ({agent-id})]` (name-absent shape
 * `[MESSAGE FROM AGENT ({agent-id})]`), followed by a blank line. The
 * attribution chip conveys the sender instead, so the rendered body strips
 * the header (same pattern as `stripHookWakePrefix`): the exact literal
 * header rebuilt from the row's own attribution metadata is stripped first
 * — the daemon builds the header from the same fromAgentName/fromAgentId
 * it stamps into the metadata, so this is byte-exact and handles names
 * containing newlines or regex-significant text — and the regex fallback,
 * pinned to the two daemon shapes via the required `(agent-{uuid})]` tail,
 * covers rows whose metadata is unavailable to the caller. Both paths
 * consume exactly the header line plus the one blank separator line the
 * daemon emits (`{header}\n\n`), never leading whitespace belonging to the
 * body, so a user-authored lookalike first line stays byte-identical.
 * Display-only strip — the stored message text is never mutated. Returns
 * the input unchanged when no header matches.
 *
 * Note: the daemon's own idempotence guard is looser (a bare
 * `starts_with("[MESSAGE FROM AGENT")` — it never re-annotates such
 * content), so a lookalike first line on an attributed row means the
 * daemon skipped annotation and the line is user/agent-authored — which
 * is exactly why the strip requires the full daemon shape (exact literal
 * or pinned regex) before touching it.
 */
const A2A_SENDER_HEADER = /^\[MESSAGE FROM AGENT (?:[^\n]+ )?\(agent-[0-9a-f-]+\)\](?:\n\n?|$)/;

/** Consume the one blank separator line after `prefix`, never body whitespace. */
function stripLiteralHeader(text: string, prefix: string): string | null {
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length);
  if (rest === '') return '';
  if (rest.startsWith('\n\n')) return rest.slice(2);
  if (rest.startsWith('\n')) return rest.slice(1);
  return null;
}

export function stripAgentMessageHeader(
  text: string,
  attribution?: AgentMessageAttribution | null,
): string {
  if (attribution) {
    const { rawName, fromAgentId } = attribution;
    const literal = rawName
      ? `[MESSAGE FROM AGENT ${rawName} (${fromAgentId})]`
      : `[MESSAGE FROM AGENT (${fromAgentId})]`;
    const stripped = stripLiteralHeader(text, literal);
    if (stripped !== null) return stripped;
  }
  return text.replace(A2A_SENDER_HEADER, '');
}
