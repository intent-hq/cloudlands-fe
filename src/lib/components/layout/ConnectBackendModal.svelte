<script lang="ts">
  /**
   * ConnectBackendModal — add a remote intentd connection (multi-backend connect).
   *
   * A dialog around `ConnectBackendForm` (details → fingerprint confirm →
   * iCloud sync confirm), which the Set up a new machine wizard shares.
   */

  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { DEFAULT_CONNECTION_ACCENT, type ConnectionAccent } from '$shared/types/connections';
  import ConnectBackendForm from './ConnectBackendForm.svelte';
  import ConnectBackendFooter from './ConnectBackendFooter.svelte';
  import type { ConnectBackendStep } from './connect-backend';

  interface Props {
    open?: boolean;
    /**
     * Prefill for the re-pair flow (token-rejected recovery): the host/port of
     * the connection being re-paired. Applied when the modal opens with empty
     * fields; the user still enters a fresh token.
     */
    prefillHost?: string | null;
    prefillPort?: number | null;
    prefillLabel?: string | null;
    prefillAccent?: ConnectionAccent;
    defaultAccent?: ConnectionAccent;
  }

  let {
    open = $bindable(false),
    prefillHost = null,
    prefillPort = null,
    prefillLabel = null,
    prefillAccent = undefined,
    defaultAccent = DEFAULT_CONNECTION_ACCENT,
  }: Props = $props();

  let form = $state<ConnectBackendForm>();
  let step = $state<ConnectBackendStep>('details');
  let busy = $state(false);
  let canContinue = $state(false);
  let firstInput = $state<HTMLInputElement | null>(null);

  function close() {
    open = false;
  }
</script>

{#if open}
  <ContentDialog
    bind:open
    title={m.modals_connect_title()}
    closeLabel={m.modals_connect_close_ariaLabel()}
    {busy}
    initialFocus={firstInput}
    onClose={close}
    dismissOnInteractOutside={false}
  >
    <ConnectBackendForm
      bind:this={form}
      bind:step
      bind:busy
      bind:canContinue
      bind:firstInput
      active={open}
      {prefillHost}
      {prefillPort}
      {prefillLabel}
      {prefillAccent}
      {defaultAccent}
      onDone={close}
    />

    {#snippet footer()}
      <ConnectBackendFooter {step} {busy} {canContinue} {form} onDetailsSecondary={close} />
    {/snippet}
  </ContentDialog>
{/if}
