<script lang="ts">
  /**
   * In-app GitHub identity consent dialog for an `intent://invite` join
   * (replaces the native message box when a renderer window is available).
   * Shows the device code + verification URL and explains why the sign-in is
   * needed and what the host learns. "Open GitHub" reports `open` and keeps the
   * dialog up in a waiting state until main dismisses it; Escape / backdrop /
   * × / Cancel report `cancel` (also allowed while waiting — it aborts the join).
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faShieldHalved, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import type { InviteConsentAction, InviteConsentShowPayload } from '$shared/ipc/invite-consent';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    payload?: InviteConsentShowPayload | null;
    /** Called with `open` (at most once per request) and/or `cancel`. */
    onRespond?: (action: InviteConsentAction) => void;
  }

  let { open = $bindable(false), payload = null, onRespond }: Props = $props();

  const dialogTitleId = 'invite-consent-dialog-title';
  const dialogDescriptionId = 'invite-consent-dialog-description';

  let dialogEl = $state<HTMLDivElement | null>(null);
  // The request that has been sent `open`; keyed by id so a new payload resets it.
  let openedRequestId = $state<string | null>(null);
  const waiting = $derived(payload !== null && openedRequestId === payload.requestId);

  // Move focus into the dialog on open (ARIA alertdialog pattern) so Escape
  // reaches the keydown handler immediately.
  $effect(() => {
    if (open && payload && dialogEl) {
      dialogEl.focus();
    }
  });

  function handleOpen() {
    if (!open || !payload || waiting) return;
    openedRequestId = payload.requestId;
    onRespond?.('open');
  }

  function cancel() {
    if (!open) return;
    open = false;
    openedRequestId = null;
    onRespond?.('cancel');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }
</script>

{#if open && payload}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={cancel}
    >
      <div
        bind:this={dialogEl}
        class="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-black/20 max-h-[85vh] outline-none"
        onclick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabindex="-1"
        onkeydown={handleKeydown}
      >
        <div class="flex items-start justify-between gap-4 px-6 pt-6">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20"
            >
              <Fa icon={faShieldHalved} size="lg" />
            </div>
            <div>
              <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">
                {m.inviteConsent_modal_title({ workspaceTitle: payload.workspaceTitle })}
              </h2>
              <p class="mt-1 text-sm text-subtle">
                {m.inviteConsent_modal_description({ hostLabel: payload.hostLabel })}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={m.inviteConsent_modal_dismiss_ariaLabel()}
            onclick={cancel}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id={dialogDescriptionId} class="flex-1 overflow-auto px-6 py-5 space-y-5">
          <p class="text-sm text-foreground">
            {m.inviteConsent_modal_hostLearns_description()}
          </p>
          <GitHubDeviceCodeCard
            userCode={payload.userCode}
            verificationUri={payload.verificationUri}
            onOpen={handleOpen}
          />
          {#if waiting}
            <div class="flex items-center gap-2 text-sm text-subtle" role="status">
              <span
                aria-hidden="true"
                class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              ></span>
              <span>{m.inviteConsent_modal_waiting_label()}</span>
            </div>
          {/if}
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={cancel}>
            {m.inviteConsent_modal_cancelButton_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
