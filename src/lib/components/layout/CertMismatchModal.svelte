<script lang="ts">
  /**
   * CertMismatchModal — blocking failure modal for a pinned-cert mismatch.
   *
   * A `connections:cert-mismatch` push means a (re)connect presented a cert
   * whose fingerprint differs from the pinned one. The mismatch is only
   * detectable async after the connect resolves, so this window is already
   * bound to the (disconnected) backend — there is no auto-revert. We surface
   * the stored vs presented fingerprint and offer an explicit way out:
   *   - open the local sidecar's window,
   *   - forget & re-pair the connection,
   *   - dismiss.
   *
   * The cert is never silently re-trusted.
   */

  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { FormActions } from '$lib/components/patterns/form';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { ConnectionCertMismatchEvent } from '$shared/types/connections';

  interface Props {
    static?: boolean;
    event: ConnectionCertMismatchEvent;
    onOpenLocal?: () => void;
    onForget?: (id: string) => void;
    onDismiss?: () => void;
  }

  let { static: staticPosition = false, event, onOpenLocal, onForget, onDismiss }: Props = $props();
</script>

<ContentDialog
  open
  static={staticPosition}
  title={m.modals_certMismatch_title()}
  closeLabel={m.modals_certMismatch_close_ariaLabel()}
  onClose={() => onDismiss?.()}
  dismissOnInteractOutside={false}
>
  <div class="space-y-4 min-w-0">
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
        <p class="font-mono break-all bg-danger/10 rounded p-2">{event.actualFingerprint}</p>
      </div>
    </div>
  </div>
  {#snippet footer()}
    <FormActions>
      {#snippet primary()}
        <Button variant="primary" onclick={() => onOpenLocal?.()}>
          {m.modals_certMismatch_openLocal_label()}
        </Button>
      {/snippet}
      {#snippet destructive()}
        <Button variant="ghost-danger" onclick={() => onForget?.(event.id)}>
          {m.modals_certMismatch_forget_label()}
        </Button>
      {/snippet}
      {#snippet secondary()}
        <Button variant="ghost" onclick={() => onDismiss?.()}>
          {m.modals_certMismatch_dismiss_label()}
        </Button>
      {/snippet}
    </FormActions>
  {/snippet}
</ContentDialog>
