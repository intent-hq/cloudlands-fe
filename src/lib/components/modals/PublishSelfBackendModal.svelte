<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    /** Whether iCloud-keychain sync is already on; when off, the modal explains confirming also enables it. */
    syncEnabled?: boolean;
    /** Disables both actions while the confirm flow is in flight. */
    busy?: boolean;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    syncEnabled = false,
    busy = false,
    onConfirm,
    onCancel,
  }: Props = $props();

  function close() {
    if (busy) return;
    open = false;
    onCancel?.();
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.settings_wsApi_publishSelf_close_ariaLabel()}
  >
    <div class="space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.settings_wsApi_publishSelf_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.settings_wsApi_publishSelf_rationale()}
        </Dialog.Description>
      </Dialog.Header>

      {#if !syncEnabled}
        <p class="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
          {m.settings_wsApi_publishSelf_syncOffNote()}
        </p>
      {/if}
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" disabled={busy} onclick={close}>
        {m.settings_wsApi_publishSelf_cancel_label()}
      </Button>
      <Button disabled={busy} onclick={() => void onConfirm?.()}>
        {m.settings_wsApi_publishSelf_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
