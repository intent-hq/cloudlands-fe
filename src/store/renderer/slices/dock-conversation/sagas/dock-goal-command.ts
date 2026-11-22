/**
 * Conversation goal from the HUD dock: a leading `/goal` reply is a daemon
 * command (`agent.sendMessage` + `interpretCommands`), never a pending
 * submission. No optimistic row, no delivery tracking; the draft clears only
 * when the daemon accepts it, and a refusal shows inline with the text kept.
 * Context chips stay: the daemon ignores them on a command, so none was sent.
 */
import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { store as appStore } from '$store/renderer/store';
import { requestGoalCommand } from '$features/conversation-goal/goal-requests';
import type { GoalCommandOutcome } from '$features/conversation-goal/utils/goal-command';
import { goalErrorMessage } from '$features/conversation-goal/utils/goal-error-message';
import { chatDraftClearRequested } from '../../chat-drafts/chat-drafts-slice';
import {
  dockConversationCommandAdmitted,
  dockConversationSendState,
} from '../dock-conversation-slice';

export interface DockGoalCommand {
  generation: number;
  workspaceId: string;
  agentId: string;
  text: string;
  revision: number;
  composerSubmissionId: string | null;
  hasAttachments: boolean;
  isCurrent: () => boolean;
}

export function* sendDockGoalCommand(command: DockGoalCommand): SagaGenerator<void> {
  const { generation, workspaceId, agentId } = command;
  if (command.hasAttachments) {
    yield* put(
      dockConversationSendState(generation, false, goalErrorMessage({ kind: 'attachments' })),
    );
    return;
  }
  yield* put(dockConversationSendState(generation, true, null));
  let outcome: GoalCommandOutcome;
  try {
    outcome = yield* call(requestGoalCommand, workspaceId, agentId, command.text);
  } catch {
    outcome = { ok: false, error: { kind: 'failed' } };
  }
  if (!command.isCurrent()) return;
  if (!outcome.ok) {
    yield* put(dockConversationSendState(generation, false, goalErrorMessage(outcome.error)));
    return;
  }
  yield* put(dockConversationSendState(generation, false, null));
  yield* put(
    dockConversationCommandAdmitted(
      workspaceId,
      agentId,
      command.revision,
      command.composerSubmissionId,
    ),
  );
  const draft = getItem(
    appStore.state.dockConversation.drafts,
    JSON.stringify([workspaceId, agentId]),
  );
  if (draft?.clearRevision !== command.revision + 1) return;
  yield* put(chatDraftClearRequested(workspaceId, agentId));
}
