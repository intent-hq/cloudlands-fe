// Source: src/lib/components/chat/QueuedMessageActions.svelte.
import { ArrowUpIcon, PencilSimpleLineIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';

export interface QueuedMessageActionsProps {
  permissions: { edit: boolean; sendNow: boolean; remove: boolean };
  editDisabled: boolean;
  sendDisabled: boolean;
  removeDisabled: boolean;
  sending: boolean;
  onedit: () => void;
  onsendnow?: () => void;
  onremove: () => void;
}

export function QueuedMessageActions({
  permissions,
  editDisabled,
  sendDisabled,
  removeDisabled,
  sending,
  onedit,
  onsendnow,
  onremove,
}: QueuedMessageActionsProps) {
  return (
    <>
      {permissions.edit && (
        <Button
          variant="ghost-light"
          size="icon-compact"
          iconOnly
          className="-my-1"
          aria-label={m.chat_queuedMessages_edit_tooltip()}
          disabled={editDisabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            // Only edit stops click propagation in the source component.
            event.stopPropagation();
            onedit();
          }}
          tooltip={m.chat_queuedMessages_edit_tooltip()}
        >
          <PencilSimpleLineIcon size={16} weight="regular" aria-hidden="true" />
        </Button>
      )}
      {onsendnow && permissions.sendNow && (
        <Button
          variant="ghost-light"
          size="icon-compact"
          iconOnly
          className="-my-1"
          aria-label={
            sending
              ? m.chat_queuedMessages_sending_label()
              : m.chat_queuedMessages_sendImmediately_label()
          }
          loading={sending}
          disabled={sendDisabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onsendnow}
          tooltip={m.chat_queuedMessages_sendNow_tooltip()}
        >
          <ArrowUpIcon size={12} weight="regular" aria-hidden="true" />
        </Button>
      )}
      {permissions.remove && (
        <Button
          variant="ghost-light"
          size="icon-compact"
          iconOnly
          className="-my-1"
          aria-label={m.chat_queuedMessages_remove_tooltip()}
          disabled={removeDisabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onremove}
          tooltip={m.chat_queuedMessages_remove_tooltip()}
        >
          <XIcon size={13} weight="regular" aria-hidden="true" />
        </Button>
      )}
    </>
  );
}

export default QueuedMessageActions;
