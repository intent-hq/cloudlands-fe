<script lang="ts">
  import type { Snippet } from 'svelte';
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
    initialFocus?: 'confirm' | 'cancel';
    body?: Snippet;
    /** Streaming agents across the targeted workspaces that the action would stop. */
    activeAgentCount?: number;
    /** Active background hooks across the targeted workspaces that the action would cancel. */
    activeHookCount?: number;
    /** Open pull requests across the targeted workspaces. */
    openPrCount?: number;
    /** Whether active-work preflight has resolved for the current target snapshot. */
    preflightReady?: boolean;
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
    initialFocus = 'confirm',
    body,
    activeAgentCount = 0,
    activeHookCount = 0,
    openPrCount = 0,
    preflightReady = true,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasActiveWork = $derived(activeAgentCount > 0 || activeHookCount > 0 || openPrCount > 0);

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
  confirmLabel={confirmText}
  submitBusy={!preflightReady}
  canSubmit={preflightReady}
  focusSubmit={preflightReady && initialFocus === 'confirm'}
  focusCancel={!preflightReady || initialFocus === 'cancel'}
  enterKey={initialFocus === 'cancel' ? 'ignore' : 'submit'}
  modEnter={initialFocus === 'cancel' ? 'ignore' : 'submit'}
  destructive={variant === 'destructive'}
  onConfirm={handleConfirm}
  onCancel={close}
>
  {#snippet details()}
    <div class="space-y-4">
      {#if description}<p class="type-body">{description}</p>{/if}
      {#if hasActiveWork}
        <div class="space-y-4 rounded-md border border-border bg-muted/40 p-3">
          {#if activeAgentCount > 0}
            <p class="type-body text-muted-foreground font-normal">
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
            <p class="type-body text-muted-foreground font-normal">
              {activeHookCount === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(activeHookCount),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(activeHookCount),
                  })}
            </p>
          {/if}
          {#if openPrCount > 0}
            <p class="type-body text-muted-foreground font-normal">
              {openPrCount === 1
                ? m.modals_deleteWarning_openPrs_one({ count: formatInteger(openPrCount) })
                : m.modals_deleteWarning_openPrs_many({ count: formatInteger(openPrCount) })}
            </p>
          {/if}
        </div>
      {/if}

      {@render body?.()}
    </div>
  {/snippet}
</DestructiveConfirm>
