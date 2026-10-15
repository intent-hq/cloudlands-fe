import { SquareIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { ChatOperationalRow } from '@/features/chat/components/chat-operational-row';
import {
  shouldShowStoppedIndicator,
  resolveStoppedIndicatorLabel,
  resolveFinishReasonNotice,
} from '$lib/components/chat/message-display-utils';
import type { AgentMessage } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';

/** Source ChatMessage's persisted ordinary-turn interruption and finish notices. */
export function DesktopMessageNotice({ message }: { message: AgentMessage }) {
  const stopped = shouldShowStoppedIndicator({
    message,
    isStreaming: Boolean(message.isStreaming),
  });
  const finish = message.isStreaming ? undefined : resolveFinishReasonNotice(message);
  const descriptor = resolveStoppedIndicatorLabel(message);
  let label: string;
  switch (descriptor.kind) {
    case 'preempted-by-message':
      label = m.chat_chatMessage_stoppedPreemptedByMessage_label();
      break;
    case 'preempted-by-agent':
      label = m.chat_chatMessage_stoppedPreemptedByAgent_label({ name: descriptor.name });
      break;
    case 'daemon-shutdown':
      label = m.chat_chatMessage_stoppedDaemonRestarted_label();
      break;
    case 'agent-stopped':
      label = m.chat_chatMessage_stoppedAgentTerminated_label();
      break;
    case 'system-suspend':
      label = m.chat_chatMessage_stoppedSystemSuspend_label();
      break;
    default:
      label = m.chat_chatMessage_stopped_label();
  }
  return (
    <>
      {stopped && (
        <ChatOperationalRow
          className="mt-5"
          testId="stopped-indicator"
          leading={<SquareIcon className="text-subtle opacity-50" size={12} weight="regular" />}
          summary={<span className="font-medium text-subtle">{label}</span>}
        />
      )}
      {finish && (
        <ChatOperationalRow
          className="mt-5"
          testId="finish-reason-notice"
          leading={<WarningCircleIcon className="text-subtle opacity-50" size={12} />}
          summary={
            <span className="font-medium text-subtle">
              {finish.kind === 'refusal'
                ? m.chat_chatMessage_finishReasonRefusal_label()
                : m.chat_chatMessage_finishReasonMaxTokens_label()}
            </span>
          }
        />
      )}
    </>
  );
}
