<script lang="ts">
  /**
   * Go/no-go confirmation shown before a mid-conversation model/provider
   * switch is applied via `agent.setModel` (PROTOCOL §5.5). The switch only
   * commits when the next message is sent, so the copy explains the deferred
   * semantics and the case-specific pitfalls (same-provider restart vs
   * cross-provider plain-text history replay). Cancelling reverts the picker
   * selection and leaves session state untouched.
   *
   * Portaled to the document body (same pattern as EditRegenerateConfirmDialog)
   * so the fixed-position overlay escapes the chat input's overflow/stacking
   * contexts.
   */
  import { Button } from '$lib/components/ui/button';
  import Portal from '$lib/components/ui/Portal.svelte';
  import Fa from 'svelte-fa';
  import { faXmark, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    /** Whether the target model belongs to a different provider. */
    isProviderChange?: boolean;
    fromModelLabel?: string;
    toModelLabel?: string;
    fromProviderName?: string;
    toProviderName?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = false,
    isProviderChange = false,
    fromModelLabel = '',
    toModelLabel = '',
    fromProviderName = '',
    toProviderName = '',
    onConfirm,
    onCancel,
  }: Props = $props();

  let dialogRef: HTMLDivElement | null = $state(null);

  // Focus dialog when it opens so Escape key works (same deferred-microtask
  // pattern as BulkActionConfirmDialog — Portal relocation drops focus).
  $effect(() => {
    if (open && dialogRef) {
      const el = dialogRef;
      queueMicrotask(() => el.focus());
    }
  });
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="presentation"
      onclick={() => onCancel?.()}
    >
      <div
        bind:this={dialogRef}
        class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-switch-dialog-title"
        aria-describedby="model-switch-dialog-description"
        tabindex="-1"
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            onCancel?.();
          }
        }}
      >
        <div class="px-6 py-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="text-amber-600 dark:text-amber-500">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <h2 id="model-switch-dialog-title" class="text-lg font-semibold">
              {isProviderChange
                ? m.chat_modelSwitchDialog_switchProvider_title()
                : m.chat_modelSwitchDialog_switchModel_title()}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onclick={() => onCancel?.()}
            aria-label={m.chat_modelSwitchDialog_close_ariaLabel()}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id="model-switch-dialog-description" class="p-6 space-y-3 text-sm text-subtle">
          <p class="font-medium text-foreground">
            {#if isProviderChange}
              {fromProviderName} / {fromModelLabel} &rarr; {toProviderName} / {toModelLabel}
            {:else}
              {fromModelLabel} &rarr; {toModelLabel}
            {/if}
          </p>
          {#if isProviderChange}
            <p>{m.chat_modelSwitchDialog_providerChange_description()}</p>
          {:else}
            <p>{m.chat_modelSwitchDialog_modelChange_description()}</p>
          {/if}
          <p>{m.chat_modelSwitchDialog_deferred_description()}</p>
        </div>

        <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onclick={() => onCancel?.()}>
            {m.chat_modelSwitchDialog_cancel_label()}
          </Button>
          <Button variant="default" onclick={() => onConfirm?.()}>
            {isProviderChange
              ? m.chat_modelSwitchDialog_switchProvider_label()
              : m.chat_modelSwitchDialog_switchModel_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
