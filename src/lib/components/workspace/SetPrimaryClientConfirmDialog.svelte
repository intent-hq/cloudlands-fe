<script lang="ts">
  /**
   * Confirmation shown before the sidebar's "Set Current Client as Primary"
   * action (REV-2). Confirming pins the workspace's browser to this app and
   * the daemon migrates the workspace's claimed (agent-owned) tabs here
   * without preserving page state (PROTOCOL §5.1 workspace.setBrowserClient),
   * so the copy names the current driving client and spells that out.
   * Cancel / Escape / backdrop close without side effects. Mirrors
   * DismissProposalConfirmDialog: canonical dialog primitive, initial focus
   * on the confirm action.
   */
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    /** Display name of the client currently driving the workspace's browser. */
    currentHost: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, currentHost, onConfirm, onCancel }: Props = $props();

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
    closeLabel={m.workspace_drivingClient_setPrimaryDialog_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.workspace_drivingClient_setPrimaryDialog_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.workspace_drivingClient_setPrimaryDialog_description({ host: currentHost })}
        </Dialog.Description>
      </Dialog.Header>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={() => onCancel?.()}>
        {m.workspace_drivingClient_setPrimaryDialog_cancel_label()}
      </Button>
      <Button
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={() => onConfirm?.()}
      >
        {m.workspace_drivingClient_setPrimaryDialog_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
