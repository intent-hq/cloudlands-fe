<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowUp } from '@fortawesome/free-solid-svg-icons';
  import PencilSimpleLineIcon from 'phosphor-svelte/lib/PencilSimpleLineIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  let {
    permissions,
    editDisabled,
    sendDisabled,
    removeDisabled,
    sending,
    sendLabel = m.chat_queuedMessages_sendImmediately_label(),
    sendTooltip = m.chat_queuedMessages_sendNow_tooltip(),
    onedit,
    onsendnow,
    onremove,
  }: {
    permissions: { edit: boolean; sendNow: boolean; remove: boolean };
    editDisabled: boolean;
    sendDisabled: boolean;
    removeDisabled: boolean;
    sending: boolean;
    sendLabel?: string;
    sendTooltip?: string;
    onedit: () => void;
    onsendnow?: () => void;
    onremove: () => void;
  } = $props();
</script>

{#if permissions.edit}
  <Button
    variant="ghost-light"
    size="icon-compact"
    iconOnly
    class="-my-1"
    aria-label={m.chat_queuedMessages_edit_tooltip()}
    disabled={editDisabled}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => {
      event.stopPropagation();
      onedit();
    }}
    tooltip={m.chat_queuedMessages_edit_tooltip()}
  >
    <PencilSimpleLineIcon size={16} weight="regular" aria-hidden="true" />
  </Button>
{/if}
{#if onsendnow && permissions.sendNow}
  <Button
    variant="ghost-light"
    size="icon-compact"
    iconOnly
    class="-my-1"
    aria-label={sending ? m.chat_queuedMessages_sending_label() : sendLabel}
    loading={sending}
    disabled={sendDisabled}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={onsendnow}
    tooltip={sendTooltip}
  >
    <Fa icon={faArrowUp} class="w-3 h-3" />
  </Button>
{/if}
{#if permissions.remove}
  <Button
    variant="ghost-light"
    size="icon-compact"
    iconOnly
    class="-my-1"
    aria-label={m.chat_queuedMessages_remove_tooltip()}
    disabled={removeDisabled}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={onremove}
    tooltip={m.chat_queuedMessages_remove_tooltip()}
  >
    <XIcon size={13} weight="regular" aria-hidden="true" />
  </Button>
{/if}
