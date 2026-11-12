<script lang="ts">
  /**
   * The buttons of the "Enter connection details" flow (`ConnectBackendForm`)
   * for each step: Cancel or Back, then Continue, Confirm, or the two iCloud
   * sync answers. Shared by `ConnectBackendModal` and the wizard.
   */
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectBackendForm, ConnectBackendStep } from './connect-backend';

  interface Props {
    step: ConnectBackendStep;
    busy: boolean;
    canContinue: boolean;
    form: ConnectBackendForm | undefined;
    /** Details step's secondary button: Cancel (modal) or Back (wizard). */
    detailsSecondaryLabel?: string;
    onDetailsSecondary: () => void;
  }

  let {
    step,
    busy,
    canContinue,
    form,
    detailsSecondaryLabel = m.modals_connect_cancel_label(),
    onDetailsSecondary,
  }: Props = $props();
</script>

{#if step === 'details'}
  <Button variant="ghost" disabled={busy} onclick={onDetailsSecondary}
    >{detailsSecondaryLabel}</Button
  >
  <Button variant="secondary" onclick={() => form?.capture()} disabled={!canContinue}>
    {busy ? m.modals_connect_connecting_label() : m.modals_connect_continue_label()}
  </Button>
{:else if step === 'confirm'}
  <Button variant="ghost" onclick={() => form?.back()} disabled={busy}
    >{m.modals_connect_back_label()}</Button
  >
  <Button variant="secondary" onclick={() => form?.confirm()} disabled={busy}>
    {busy ? m.modals_connect_connecting_label() : m.modals_connect_confirm_label()}
  </Button>
{:else}
  <Button variant="ghost" onclick={() => form?.back()} disabled={busy}
    >{m.modals_connect_back_label()}</Button
  >
  <Button variant="ghost" onclick={() => form?.declineSync()} disabled={busy}>
    {m.modals_connect_enableSync_decline_label()}
  </Button>
  <Button variant="secondary" onclick={() => form?.enableSyncAndAdd()} disabled={busy}>
    {busy ? m.modals_connect_connecting_label() : m.modals_connect_enableSync_confirm_label()}
  </Button>
{/if}
