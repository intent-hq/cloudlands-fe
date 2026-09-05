<script lang="ts">
  /**
   * Destructive confirmation shown before an inline proposal card's Dismiss
   * action. Dismissal is persistent (the host dispatches
   * `agent.resolveProposal` outcome 'dismissed', PROTOCOL §5.5, which
   * survives reload), so the copy warns that the proposal is dismissed
   * without applying and won't pend again. Cancel / Escape / backdrop close
   * without side effects. Mirrors DismissQuestionsConfirmDialog: canonical
   * dialog primitive, initial focus on the confirm action.
   */
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, onConfirm, onCancel }: Props = $props();

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onCancel?.();
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.chat_proposalTray_dismissDialog_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.chat_proposalTray_dismissDialog_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.chat_proposalTray_dismissDialog_description()}
        </Dialog.Description>
      </Dialog.Header>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={() => onCancel?.()}>
        {m.chat_proposalTray_dismissDialog_cancel_label()}
      </Button>
      <Button
        variant="destructive"
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={() => onConfirm?.()}
      >
        {m.chat_proposalTray_dismissDialog_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
