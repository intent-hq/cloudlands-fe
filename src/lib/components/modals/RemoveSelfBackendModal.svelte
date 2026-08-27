<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    /** Disables both actions while the confirm flow is in flight. */
    busy?: boolean;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let { open = $bindable(false), busy = false, onConfirm, onCancel }: Props = $props();

  function close() {
    if (busy) return;
    open = false;
    onCancel?.();
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.settings_wsApi_unpublishSelf_close_ariaLabel()}
  >
    <div class="space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.settings_wsApi_unpublishSelf_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.settings_wsApi_unpublishSelf_rationale()}
        </Dialog.Description>
      </Dialog.Header>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" disabled={busy} onclick={close}>
        {m.settings_wsApi_unpublishSelf_cancel_label()}
      </Button>
      <Button disabled={busy} onclick={() => void onConfirm?.()}>
        {m.settings_wsApi_unpublishSelf_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
