<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ButtonVariant } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    confirmText?: string;
    variant?: ButtonVariant;
    body?: Snippet;
    /** Streaming agents across the targeted workspaces that the action would stop. */
    activeAgentCount?: number;
    /** Active background hooks across the targeted workspaces that the action would cancel. */
    activeHookCount?: number;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    title = m.modals_bulkActionConfirm_title(),
    description = '',
    confirmText = m.modals_bulkActionConfirm_confirm_label(),
    variant = 'default',
    body,
    activeAgentCount = 0,
    activeHookCount = 0,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasActiveWork = $derived(activeAgentCount > 0 || activeHookCount > 0);

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function close() {
    open = false;
    onCancel?.();
  }

  async function handleConfirm() {
    try {
      await onConfirm?.();
    } catch (error) {
      console.error('Confirm action failed:', error);
    }
    open = false;
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-sm gap-0 overflow-hidden p-0"
    closeLabel={m.modals_bulkActionConfirm_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="min-w-0 space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description class="leading-5">{description}</Dialog.Description>
      </Dialog.Header>

      {#if hasActiveWork}
        <div class="space-y-1">
          {#if activeAgentCount > 0}
            <p class="text-sm text-muted-foreground">
              {activeAgentCount === 1
                ? m.modals_deleteWarning_agentsStopped_one({
                    count: formatInteger(activeAgentCount),
                  })
                : m.modals_deleteWarning_agentsStopped_many({
                    count: formatInteger(activeAgentCount),
                  })}
            </p>
          {/if}
          {#if activeHookCount > 0}
            <p class="text-sm text-muted-foreground">
              {activeHookCount === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(activeHookCount),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(activeHookCount),
                  })}
            </p>
          {/if}
        </div>
      {/if}

      {@render body?.()}
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={close}>
        {m.modals_bulkActionConfirm_cancel_label()}
      </Button>
      <Button
        {variant}
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={handleConfirm}
      >
        {confirmText}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
