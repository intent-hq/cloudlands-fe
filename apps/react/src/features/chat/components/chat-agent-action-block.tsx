// Source: src/lib/components/chat/ChatAgentActionBlock.svelte.
import { RobotIcon } from '@phosphor-icons/react';

export interface ChatAgentActionBlockProps {
  goal: string;
}

export function ChatAgentActionBlock({ goal }: ChatAgentActionBlockProps) {
  return (
    <div className="ws-block-widget type-body my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)">
      <RobotIcon
        size="0.875em"
        weight="regular"
        data-icon="robot"
        data-weight="regular"
        aria-hidden="true"
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{goal}</span>
    </div>
  );
}

export default ChatAgentActionBlock;
