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
  import { FormDialog } from '$lib/components/patterns/confirm';
  import ProviderIcon, {
    hasProviderIcon,
  } from '$features/agent/components/AgentProviderIcon.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    /** Whether the target model belongs to a different provider. */
    isProviderChange?: boolean;
    fromModelLabel?: string;
    toModelLabel?: string;
    fromProviderName?: string;
    toProviderName?: string;
    fromProviderId?: string;
    toProviderId?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = false,
    static: staticPosition = false,
    isProviderChange = false,
    fromModelLabel = '',
    toModelLabel = '',
    fromProviderName = '',
    toProviderName = '',
    fromProviderId = '',
    toProviderId = '',
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

<FormDialog
  {open}
  static={staticPosition}
  title={isProviderChange
    ? m.chat_modelSwitchDialog_switchProvider_title()
    : m.chat_modelSwitchDialog_switchModel_title()}
  closeLabel={m.chat_modelSwitchDialog_close_ariaLabel()}
  submitLabel={isProviderChange
    ? m.chat_modelSwitchDialog_switchProvider_label()
    : m.chat_modelSwitchDialog_switchModel_label()}
  cancelLabel={m.chat_modelSwitchDialog_cancel_label()}
  focusSubmit
  onSubmit={() => onConfirm?.()}
  {onCancel}
>
  <div class="flex flex-wrap items-center gap-3 type-body" data-testid="model-switch-models">
    <span class="inline-flex min-w-0 items-center gap-1.5" title={fromProviderName}>
      {#if hasProviderIcon(fromProviderId)}<span aria-hidden="true"
          ><ProviderIcon providerId={fromProviderId} class="size-3.5" /></span
        >{/if}
      <span class="sr-only">{fromProviderName}</span>
      <span class="break-all">{fromModelLabel}</span>
    </span>
    <ArrowRight size={16} class="shrink-0 text-muted-foreground" aria-hidden="true" />
    <span class="inline-flex min-w-0 items-center gap-1.5" title={toProviderName}>
      {#if hasProviderIcon(toProviderId)}<span aria-hidden="true"
          ><ProviderIcon providerId={toProviderId} class="size-3.5" /></span
        >{/if}
      <span class="sr-only">{toProviderName}</span>
      <span class="break-all">{toModelLabel}</span>
    </span>
  </div>
  <p class="type-body text-muted-foreground">
    {isProviderChange
      ? m.chat_modelSwitchDialog_providerChange_description()
      : m.chat_modelSwitchDialog_modelChange_description()}
  </p>
  <p class="type-caption text-muted-foreground">
    {m.chat_modelSwitchDialog_deferred_description()}
  </p>
</FormDialog>
