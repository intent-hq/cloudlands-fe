<script lang="ts">
  /**
   * ProtocolMismatchModal — advisory (non-blocking) protocol-version notice.
   *
   * A `connections:protocol-mismatch` push means the active remote's
   * `protocolVersion` differs in major version from the local intentd's. Unlike
   * the cert-mismatch modal, this NEVER blocks: the connection is already live.
   * We surface local vs remote versions and offer:
   *   - continue anyway (dismiss — the connection stays; a persistent warning
   *     remains in the daemon-status menu),
   *   - open the local sidecar's window.
   *
   * Warn-but-allow: some features may not work correctly across a major
   * protocol gap, but the user stays in control.
   */

  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionProtocolMismatchEvent } from '$shared/types/connections';

  interface Props {
    event: ConnectionProtocolMismatchEvent;
    onOpenLocal?: () => void;
    onContinue?: () => void;
  }

  let { event, onOpenLocal, onContinue }: Props = $props();
  let open = $state(true);

  function continueAnyway() {
    if (!open) return;
    open = false;
    onContinue?.();
  }
</script>

<FormDialog
  bind:open
  title={m.modals_protocolMismatch_title()}
  closeLabel={m.modals_protocolMismatch_close_ariaLabel()}
  class="max-w-md"
  enterKey="ignore"
  modEnter="ignore"
  onSubmit={continueAnyway}
  onCancel={continueAnyway}
>
  <div class="space-y-4">
    <div class="flex items-start gap-3">
      <span class="text-warning-ink"><Fa icon={faTriangleExclamation} size="lg" /></span>
      <p class="text-sm text-subtle">{m.modals_protocolMismatch_description()}</p>
    </div>

    <div class="space-y-3 text-xs">
      <div class="flex justify-between gap-2">
        <span class="text-subtle">{m.modals_protocolMismatch_connection_label()}</span>
        <!-- i18n-ignore (host:port, not translatable copy) -->
        <span class="font-mono">{event.host}:{event.port}</span>
      </div>

      <div class="flex justify-between gap-2">
        <span class="text-subtle">{m.modals_protocolMismatch_localVersion_label()}</span>
        <!-- i18n-ignore (protocol version string) -->
        <span class="font-mono">{event.localProtocolVersion}</span>
      </div>

      <div class="flex justify-between gap-2">
        <span class="text-subtle">{m.modals_protocolMismatch_remoteVersion_label()}</span>
        <!-- i18n-ignore (protocol version string) -->
        <span class="font-mono">{event.remoteProtocolVersion}</span>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <div class="flex w-full flex-col gap-2">
      <Button variant="default" onclick={continueAnyway}>
        {m.modals_protocolMismatch_continue_label()}
      </Button>
      <Button variant="ghost" onclick={() => onOpenLocal?.()}>
        {m.modals_protocolMismatch_openLocal_label()}
      </Button>
    </div>
  {/snippet}
</FormDialog>
