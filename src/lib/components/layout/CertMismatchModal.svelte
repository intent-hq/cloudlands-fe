<script lang="ts">
  /**
   * CertMismatchModal — blocking failure modal for a pinned-cert mismatch.
   *
   * A `connections:cert-mismatch` push means a (re)connect presented a cert
   * whose fingerprint differs from the pinned one. The mismatch is only
   * detectable async after the switch resolves, so the app is already parked on
   * the (disconnected) new backend — there is no auto-revert. We surface the
   * stored vs presented fingerprint and offer an explicit way out:
   *   - switch back to the local sidecar,
   *   - forget & re-pair the connection,
   *   - dismiss.
   *
   * The cert is never silently re-trusted.
   */

  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionCertMismatchEvent } from '$shared/types/connections';

  interface Props {
    event: ConnectionCertMismatchEvent;
    onSwitchBack?: () => void;
    onForget?: (id: string) => void;
    onDismiss?: () => void;
  }

  let { event, onSwitchBack, onForget, onDismiss }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onDismiss?.();
    } else {
      e.stopPropagation();
    }
  }
</script>

<div
  class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
  role="presentation"
  onclick={() => onDismiss?.()}
  onkeydown={handleKeydown}
>
  <div
    class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby="cert-mismatch-title"
    tabindex="-1"
  >
    <!-- Header -->
    <div class="px-6 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="text-red-600 dark:text-red-500"
          ><Fa icon={faExclamationTriangle} size="lg" /></span
        >
        <h2 id="cert-mismatch-title" class="text-lg font-semibold">
          {m.modals_certMismatch_title()}
        </h2>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onclick={() => onDismiss?.()}
        aria-label={m.modals_certMismatch_close_ariaLabel()}
      >
        <Fa icon={faXmark} />
      </Button>
    </div>

    <!-- Content -->
    <div class="p-6 space-y-4">
      <p class="text-sm text-subtle">{m.modals_certMismatch_description()}</p>

      <div class="space-y-3 text-xs">
        <div class="flex justify-between gap-2">
          <span class="text-subtle">{m.modals_certMismatch_connection_label()}</span>
          <!-- i18n-ignore (host:port, not translatable copy) -->
          <span class="font-mono">{event.host}:{event.port}</span>
        </div>

        <div class="space-y-1">
          <span class="text-subtle">{m.modals_certMismatch_expected_label()}</span>
          <!-- i18n-ignore (cert fingerprint hex) -->
          <p class="font-mono break-all bg-muted/50 rounded p-2">{event.expectedFingerprint}</p>
        </div>

        <div class="space-y-1">
          <span class="text-subtle">{m.modals_certMismatch_presented_label()}</span>
          <!-- i18n-ignore (cert fingerprint hex) -->
          <p class="font-mono break-all bg-red-500/10 rounded p-2">{event.actualFingerprint}</p>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="px-6 py-4 border-t border-border flex flex-col gap-2">
      <Button variant="default" onclick={() => onSwitchBack?.()}>
        {m.modals_certMismatch_switchBack_label()}
      </Button>
      <Button variant="destructive" onclick={() => onForget?.(event.id)}>
        {m.modals_certMismatch_forget_label()}
      </Button>
      <Button variant="ghost" onclick={() => onDismiss?.()}>
        {m.modals_certMismatch_dismiss_label()}
      </Button>
    </div>
  </div>
</div>
