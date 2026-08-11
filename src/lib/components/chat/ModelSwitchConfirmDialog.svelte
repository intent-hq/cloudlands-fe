<script lang="ts">
  /**
   * Go/no-go confirmation shown before a mid-conversation model/provider
   * switch is applied via `agent.setModel` (PROTOCOL §5.5). The switch only
   * commits when the next message is sent, so the copy explains the deferred
   * semantics and the case-specific pitfalls (same-provider restart vs
   * cross-provider plain-text history replay). Cancelling reverts the picker
   * selection and leaves session state untouched.
   *
   * Uses the canonical portaled dialog primitive so it escapes the chat input's
   * overflow/stacking contexts while preserving focus and dismissal semantics.
   */
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
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

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && onCancel?.()}>
  <Dialog.Content
    class="max-w-md gap-0 overflow-hidden p-0"
    closeLabel={m.chat_modelSwitchDialog_close_ariaLabel()}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>
          {isProviderChange
            ? m.chat_modelSwitchDialog_switchProvider_title()
            : m.chat_modelSwitchDialog_switchModel_title()}
        </Dialog.Title>
      </Dialog.Header>

      <div class="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium">
        {#if isProviderChange}
          {fromProviderName} / {fromModelLabel} &rarr; {toProviderName} / {toModelLabel}
        {:else}
          {fromModelLabel} &rarr; {toModelLabel}
        {/if}
      </div>

      <Dialog.Description class="space-y-2 leading-5">
        <span class="block">
          {isProviderChange
            ? m.chat_modelSwitchDialog_providerChange_description()
            : m.chat_modelSwitchDialog_modelChange_description()}
        </span>
        <span class="block">{m.chat_modelSwitchDialog_deferred_description()}</span>
      </Dialog.Description>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={() => onCancel?.()}>
        {m.chat_modelSwitchDialog_cancel_label()}
      </Button>
      <Button
        variant="default"
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={() => onConfirm?.()}
      >
        {isProviderChange
          ? m.chat_modelSwitchDialog_switchProvider_label()
          : m.chat_modelSwitchDialog_switchModel_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
