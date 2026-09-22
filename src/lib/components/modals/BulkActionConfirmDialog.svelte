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
    /** Picks the guest-removal note: archive adds the re-invite reminder. */
    mode?: 'delete' | 'archive';
    /** Streaming agents across the targeted workspaces that the action would stop. */
    activeAgentCount?: number;
    /** Active background hooks across the targeted workspaces that the action would cancel. */
    activeHookCount?: number;
    /** Collaborators + open invites across the targeted workspaces that the action would remove. */
    guestCount?: number;
    onConfirm?: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title = m.modals_bulkActionConfirm_title(),
    description = '',
    confirmText = m.modals_bulkActionConfirm_confirm_label(),
    variant = 'default',
    mode = 'delete',
    activeAgentCount = 0,
    activeHookCount = 0,
    guestCount = 0,
    onConfirm,
    onCancel,
  }: Props = $props();

  const hasActiveWork = $derived(activeAgentCount > 0 || activeHookCount > 0 || guestCount > 0);

  function close() {
    open = false;
    onCancel?.();
  }

  async function handleConfirm() {
    await onConfirm?.();
    open = false;
  }
</script>

<DestructiveConfirm
  bind:open
  static={staticPosition}
  {title}
  confirmLabel={confirmText}
  destructive={variant === 'destructive'}
  onConfirm={handleConfirm}
  onCancel={close}
>
  {#snippet details()}
    <div class="space-y-4">
      {#if description}<p class="type-body">{description}</p>{/if}
      {#if hasActiveWork}
        <div class="space-y-2">
          {#if activeAgentCount > 0}
            <p class="type-body text-foreground font-medium">
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
            <p class="type-body text-foreground font-medium">
              {activeHookCount === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(activeHookCount),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(activeHookCount),
                  })}
            </p>
          {/if}
          {#if guestCount > 0}
            <p class="type-body text-muted-foreground font-normal">
              {guestCount === 1
                ? m.modals_bulkActionConfirm_guestsRemoved_one({
                    count: formatInteger(guestCount),
                  })
                : m.modals_bulkActionConfirm_guestsRemoved_many({
                    count: formatInteger(guestCount),
                  })}
              {#if mode === 'archive'}
                {m.modals_bulkActionConfirm_guestsReinvite_description()}
              {/if}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}
</DestructiveConfirm>
