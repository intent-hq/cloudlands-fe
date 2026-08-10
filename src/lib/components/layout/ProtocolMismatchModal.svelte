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
   *   - switch back to the local sidecar.
   *
   * Warn-but-allow: some features may not work correctly across a major
   * protocol gap, but the user stays in control.
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionProtocolMismatchEvent } from '$shared/types/connections';

  interface Props {
    event: ConnectionProtocolMismatchEvent;
    onSwitchBack?: () => void;
    onContinue?: () => void;
  }

  let { event, onSwitchBack, onContinue }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onContinue?.();
    } else {
      e.stopPropagation();
    }
  }
</script>

<div
  class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
  role="presentation"
  onclick={() => onContinue?.()}
  onkeydown={handleKeydown}
>
  <div
    class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="protocol-mismatch-title"
    tabindex="-1"
  >
    <!-- Header -->
    <div class="px-6 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-yellow-600 dark:text-yellow-500"
          ><Fa icon={faTriangleExclamation} size="lg" /></span
        >
        <h2 id="protocol-mismatch-title" class="text-lg font-semibold">
          {m.modals_protocolMismatch_title()}
        </h2>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onclick={() => onContinue?.()}
        aria-label={m.modals_protocolMismatch_close_ariaLabel()}
      >
        <Fa icon={faXmark} />
      </Button>
    </div>

    <!-- Content -->
    <div class="p-6 space-y-4">
      <p class="text-sm text-subtle">{m.modals_protocolMismatch_description()}</p>

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

    <!-- Footer -->
    <div class="px-6 py-4 border-t border-border flex flex-col gap-2">
      <Button variant="default" onclick={() => onContinue?.()}>
        {m.modals_protocolMismatch_continue_label()}
      </Button>
      <Button variant="ghost" onclick={() => onSwitchBack?.()}>
        {m.modals_protocolMismatch_switchBack_label()}
      </Button>
    </div>
  </div>
</div>
