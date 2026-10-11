// Source: src/lib/components/modals/ReplaceAgentModal.svelte.
import { useState } from 'react';
import { FormDialog } from '@/components/patterns/confirm';
import * as Accordion from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import { m } from '$shared/paraglide/messages.js';
import { buildReplaceAgentHandoffMessage } from '$shared/utils/replace-agent-handoff';

export interface ReplaceAgentModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  /** Exact current name of the agent being replaced. */
  agentName: string;
  /** Specialist id from the session metadata, when known. */
  specialist?: string | null;
  /** The caller sends this current, possibly edited instruction through chat. */
  onSend?: (text: string) => void;
  onCancel?: () => void;
}

export function ReplaceAgentModal({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  agentName,
  specialist = null,
  onSend,
  onCancel,
}: ReplaceAgentModalProps) {
  // Like the source binding, local dismissal works without an onOpenChange consumer.
  const [isOpen, setIsOpen] = useState(open);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setIsOpen(open);
  }

  // Snapshot once at mount. Callers remount per open to build a fresh instruction.
  const [text, setText] = useState(() =>
    buildReplaceAgentHandoffMessage({ agentName, specialist }),
  );
  const canSend = text.trim().length > 0;

  function changeOpen(next: boolean) {
    setIsOpen(next);
    onOpenChange?.(next);
  }

  function handleSend() {
    if (!canSend) return;
    const message = text;
    changeOpen(false);
    onSend?.(message);
  }

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={changeOpen}
      static={staticPosition}
      title={m.modals_replaceAgent_title()}
      description={m.modals_replaceAgent_description({ name: agentName })}
      closeLabel={m.modals_replaceAgent_close_ariaLabel()}
      submitLabel={m.modals_replaceAgent_send_label()}
      cancelLabel={m.modals_replaceAgent_cancel_label()}
      canSubmit={canSend}
      enterKey="ignore"
      focusContent
      onSubmit={handleSend}
      onCancel={onCancel}
    >
      <Accordion.Root type="single">
        <Accordion.Item value="instructions">
          <Accordion.Trigger inset={false}>
            {m.modals_replaceAgent_instruction_ariaLabel()}
          </Accordion.Trigger>
          <Accordion.Content inset={false}>
            <p className="type-caption mb-3 text-muted-foreground">
              {m.modals_replaceAgent_editHint_description()}
            </p>
            <Textarea
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              aria-label={m.modals_replaceAgent_instruction_ariaLabel()}
              className="max-h-72 min-h-48 w-full type-body"
            />
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </FormDialog>
  );
}
