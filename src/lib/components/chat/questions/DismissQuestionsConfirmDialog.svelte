<script lang="ts">
  /**
   * Destructive confirmation shown before the Q&A wizard's Dismiss is
   * performed. Dismissal is persistent (the host calls
   * `agent.dismissQuestions`, which survives reload), so the copy warns that
   * the questions are dismissed completely without answering and won't come
   * back. Cancel / Escape / backdrop close without side effects.
   *
   * Uses the canonical dialog primitive for focus trapping, focus restoration,
   * semantic overlay styling, Escape handling, and outside dismissal. Initial
   * focus deliberately lands on the confirm action for keyboard efficiency.
   */
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    busy?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, busy = false, onConfirm, onCancel }: Props = $props();

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) onCancel?.();
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.chat_questionWizard_dismissDialog_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.chat_questionWizard_dismissDialog_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.chat_questionWizard_dismissDialog_description()}
        </Dialog.Description>
      </Dialog.Header>
    </div>

    <Dialog.Footer
      class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0"
      aria-busy={busy}
    >
      <Button variant="ghost-light" onclick={() => onCancel?.()} disabled={busy}>
        {m.chat_questionWizard_dismissDialog_cancel_label()}
      </Button>
      <Button
        variant="destructive"
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={() => onConfirm?.()}
        loading={busy}
      >
        {m.chat_questionWizard_dismissDialog_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
