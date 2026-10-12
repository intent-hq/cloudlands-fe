// Source: src/lib/components/chat/ChatCliBlock.svelte.
import { TerminalIcon } from '@phosphor-icons/react';
import { notify } from '@/components/patterns/notify';
import { CopyButton } from '@/components/ui/copy-button';
import { m } from '$shared/paraglide/messages.js';

export interface ChatCliBlockProps {
  command: string;
}

export function ChatCliBlock({ command }: ChatCliBlockProps) {
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
    } catch (error) {
      notify.error(m.chat_cliBlock_copyFailed_error());
      throw error;
    }
  }

  return (
    <div className="ws-block-widget group my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)">
      <TerminalIcon
        size="0.875em"
        weight="regular"
        className="shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <code className="type-code min-w-0 flex-1 truncate bg-transparent p-0 text-foreground">
        {command}
      </code>
      <CopyButton
        copy={copyCommand}
        label={m.chat_cliBlock_copy_tooltip()}
        copiedLabel={m.chat_cliBlock_copied_tooltip()}
        className="size-7 shrink-0 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        data-testid="chat-cli-copy"
      />
    </div>
  );
}

export default ChatCliBlock;
