// Source: src/lib/components/chat/BlockerReportNotice.svelte.
import { m } from '$shared/paraglide/messages.js';
import { ChatNotice, type ChatNoticeProps } from './chat-notice';

export interface BlockerReportNoticeProps extends Pick<ChatNoticeProps, 'present' | 'onExit'> {
  reason?: string;
  className?: string;
}

export function BlockerReportNotice({
  reason = '',
  className = '',
  present,
  onExit,
}: BlockerReportNoticeProps) {
  return (
    <ChatNotice
      title={m.chat_blockerReportNotice_title_label()}
      tone="danger"
      reason={reason}
      className={`blocker-report-notice ${className}`}
      present={present}
      onExit={onExit}
    />
  );
}

export default BlockerReportNotice;
