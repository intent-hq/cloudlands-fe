/**
 * Daemon-persisted auto-unarchive transcript notice. When a turn start
 * auto-unarchives an archived workspace, intentd persists an informational
 * `role: "system"` row with metadata
 * `{ type: "auto_unarchived", reason: "agent_activity" }`. The FE renders it
 * as a subtle centered inline divider (like the model-change notice) — never
 * as an attention notice, interruption banner, or regular bubble. Absent or
 * different metadata returns `null` so every other message renders unchanged.
 */

interface MessageLike {
  role?: string;
  metadata?: Record<string, unknown> | null;
}

export interface AutoUnarchivedNoticeInfo {
  /** Unarchive reason from the row metadata (e.g. "agent_activity"). */
  reason?: string;
}

/**
 * Returns the notice info when the message is a daemon-persisted
 * auto-unarchive notice row, or null for every other message. Discriminates
 * purely on `metadata.type === "auto_unarchived"` so the FE stays tolerant of
 * the exact role the daemon persists (system by contract).
 */
export function getAutoUnarchivedNotice(
  message: MessageLike | null | undefined,
): AutoUnarchivedNoticeInfo | null {
  const metadata = message?.metadata;
  if (!metadata || metadata['type'] !== 'auto_unarchived') return null;
  const reason = metadata['reason'];
  return { reason: typeof reason === 'string' && reason.length > 0 ? reason : undefined };
}
