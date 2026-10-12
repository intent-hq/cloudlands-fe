// Source: src/lib/components/chat/DiscussionRequestNotice.svelte.
import { m } from '$shared/paraglide/messages.js';
import { ChatNotice, type ChatNoticeProps } from './chat-notice';

export interface DiscussionRequestNoticeProps extends Pick<ChatNoticeProps, 'present' | 'onExit'> {
  reason?: string;
  /** React spelling of the source's class prop. */
  className?: string;
}

export function DiscussionRequestNotice({
  reason = '',
  className = '',
  present,
  onExit,
}: DiscussionRequestNoticeProps) {
  return (
    <ChatNotice
      title={m.chat_discussionRequestNotice_title_label()}
      tone="warning"
      reason={reason}
      className={`discussion-request-notice ${className}`}
      present={present}
      onExit={onExit}
    />
  );
}

export default DiscussionRequestNotice;
