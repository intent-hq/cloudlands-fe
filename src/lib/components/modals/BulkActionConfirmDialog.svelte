<script lang="ts">
  import type { ButtonVariant } from '$lib/components/ui/button';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  interface Props {
    open?: boolean;
    static?: boolean;
    title?: string;
    description?: string;
    confirmText?: string;
    variant?: ButtonVariant;
    /** Streaming agents across the targeted workspaces that the action would stop. */
    activeAgentCount?: number;
    /** Active background hooks across the targeted workspaces that the action would cancel. */
    activeHookCount?: number;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title = m.modals_bulkActionConfirm_title(),
    description = '',
    confirmText = m.modals_bulkActionConfirm_confirm_label(),
    variant = 'default',
    activeAgentCount = 0,
    activeHookCount = 0,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasActiveWork = $derived(activeAgentCount > 0 || activeHookCount > 0);

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
</script>

<DestructiveConfirm
  bind:open
  static={staticPosition}
  {title}
  {description}
  confirmLabel={confirmText}
  destructive={variant === 'destructive'}
  class="max-w-sm"
  onConfirm={handleConfirm}
  onCancel={close}
>
  {#snippet details()}
    <div class="space-y-4">
      {#if hasActiveWork}
        <div class="space-y-1 rounded-md border border-border bg-muted/40 p-3">
          {#if activeAgentCount > 0}
            <p class="text-sm font-medium text-foreground">
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
            <p class="text-sm font-medium text-foreground">
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
    </div>
  {/snippet}
</DestructiveConfirm>
