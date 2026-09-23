/**
 * Daemon-persisted attention-request transcript notices.
 *
 * When an agent calls `ws.agent.requestDiscussion(reason)` or
 * `ws.agent.reportBlocker(reason)`, intentd appends a system-role message
 * whose text block carries `meta.kind = "discussion-request"` or
 * `"blocker-report"` with the reason as its text (same shape as the
 * `meta.kind = "interruption"` abandon-path notice). When a turn ends in a
 * terminal failure, intentd appends a `meta.kind = "turn-failure"` notice
 * carrying the failure text. The FE renders these as distinct styled
 * notices, live and after rehydration.
 */
import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import type { AgentAttentionRequest } from '$shared/utils/agent-attention';

type AttentionNoticeKind = 'discussion-request' | 'blocker-report' | 'turn-failure';

export interface AttentionNoticeInfo {
  kind: AttentionNoticeKind;
  /** The reason text carried by the notice message. */
  reason: string;
}

const ATTENTION_KINDS = new Set<AttentionNoticeKind>([
  'discussion-request',
  'blocker-report',
  'turn-failure',
]);

/**
 * Returns the attention-notice info when the system message is a
 * daemon-persisted attention-request row (discriminated on the first content
 * block's `meta.kind`), or null for every other message.
 */
export function getAttentionNotice(
  message: Pick<AgentMessage, 'role' | 'contentBlocks'> | null | undefined,
): AttentionNoticeInfo | null {
  if (!message || message.role !== 'system') return null;
  const kind = message.contentBlocks?.[0]?.meta?.['kind'];
  if (typeof kind !== 'string' || !ATTENTION_KINDS.has(kind as AttentionNoticeKind)) {
    return null;
  }
  return {
    kind: kind as AttentionNoticeKind,
    reason: extractAllContent(message as AgentMessage),
  };
}

function timestampIdentity(value: string | Date): string | null {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  if (value instanceof Date) return `${milliseconds}:`;
  const parts = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!parts) return null;
  // Date.parse truncates fractional precision beyond milliseconds.
  const remainder = (parts[1] ?? '').slice(3).replace(/0+$/, '');
  return `${milliseconds}:${remainder}`;
}

export function hasMatchingAttentionNotice(
  messages: readonly AgentMessage[],
  request: AgentAttentionRequest | null,
): boolean {
  if (!request?.timestamp) return false;
  const timestamp = timestampIdentity(request.timestamp);
  if (timestamp === null) return false;
  const kind = request.kind === 'blocker' ? 'blocker-report' : 'discussion-request';

  // The daemon uses the same saved_at for the pending request and its notice.
  return messages.some((message) => {
    const messageTimestamp = timestampIdentity(message.timestamp);
    if (messageTimestamp !== timestamp) return false;
    const notice = getAttentionNotice(message);
    return notice?.kind === kind && notice.reason === (request.reason ?? '');
  });
}
