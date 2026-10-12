// Source: src/lib/components/chat/InterruptionNotice.svelte.
import { m } from '$shared/paraglide/messages.js';
import { ChatNotice, type ChatNoticeProps } from './chat-notice';

export interface InterruptionNoticeProps extends Pick<ChatNoticeProps, 'present' | 'onExit'> {
  message?: string;
  className?: string;
}

export function InterruptionNotice({
  message = m.chat_interruptionNotice_default_message(),
  className = '',
  present,
  onExit,
}: InterruptionNoticeProps) {
  return (
    <ChatNotice
      title={message}
      tone="warning"
      className={`interruption-notice ${className}`}
      present={present}
      onExit={onExit}
    />
  );
}

export default InterruptionNotice;
