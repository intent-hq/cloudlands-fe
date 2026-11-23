import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { GOAL_MAX_LENGTH, type GoalRequestError } from './goal-command';

/** The inline message for a failed goal request. */
export function goalErrorMessage(error: GoalRequestError): string {
  switch (error.kind) {
    case 'tooLong':
      return m.chat_goal_tooLong_error({ max: formatInteger(GOAL_MAX_LENGTH) });
    case 'attachments':
      return m.chat_goal_attachments_error();
    case 'retired':
      return m.chat_goal_retired_error();
    case 'workspaceRetired':
      return m.chat_goal_workspaceRetired_error();
    case 'invalid':
    case 'failed':
      // Daemon messages are English-only; show the localized fallback.
      return m.chat_goal_failed_error();
  }
}
