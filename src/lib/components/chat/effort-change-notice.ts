import { reasoningEffortLabel } from '$features/agent/utils/reasoning-effort-label';
import { m } from '$shared/paraglide/messages.js';

export interface EffortChangeNoticeInfo {
  /** Null is Auto; undefined means incomplete metadata and requires the text fallback. */
  from: string | null | undefined;
  to: string | null | undefined;
}

/** Daemon-owned effort-change transcript row (PROTOCOL §5.5). */
export function getEffortChangeNotice(
  message: { metadata?: Record<string, unknown> | null } | null | undefined,
): EffortChangeNoticeInfo | null {
  const metadata = message?.metadata;
  if (metadata?.['type'] !== 'effort_changed') return null;

  const effort = (value: unknown): string | null | undefined =>
    value === null || (typeof value === 'string' && value.trim().length > 0) ? value : undefined;
  return { from: effort(metadata['from']), to: effort(metadata['to']) };
}

export function formatEffortChangeLabel(
  notice: EffortChangeNoticeInfo,
  fallbackText: string,
): string {
  if (notice.from === undefined || notice.to === undefined) return fallbackText;
  return m.chat_effortChangeNotice_changed_label({
    from: reasoningEffortLabel(notice.from),
    to: reasoningEffortLabel(notice.to),
  });
}
