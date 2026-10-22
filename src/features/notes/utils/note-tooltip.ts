import { m } from '$shared/paraglide/messages.js';

export function getNoteTooltip(title: string, status?: string | null): string {
  if (!status) return title;

  const labels: Record<string, () => string> = {
    not_started: m.tiptap_taskStatus_notStarted_label,
    todo: m.tiptap_taskStatus_notStarted_label,
    waiting: m.tiptap_taskStatus_waiting_label,
    discussion_needed: m.tiptap_taskStatus_discussionNeeded_label,
    blocked: m.tiptap_taskStatus_blocked_label,
    in_progress: m.tiptap_taskStatus_inProgress_label,
    'in-progress': m.tiptap_taskStatus_inProgress_label,
    review_required: m.tiptap_taskStatus_reviewRequired_label,
    complete: m.tiptap_taskStatus_complete_label,
    done: m.tiptap_taskStatus_complete_label,
    cancelled: m.tiptap_taskStatus_cancelled_label,
  };
  const label = (labels[status] ?? m.tiptap_taskStatus_unknown_label)();
  return `${title}\n${m.tiptap_taskStatus_status_tooltip({ status: label })}`;
}
