<script lang="ts">
  /**
   * In-app GitHub identity consent dialog for an `intent://invite` join
   * (replaces the native message box when a renderer window is available).
   *
   * `mode: "sign-in-required"` (the guest's own Intent is not signed in to
   * GitHub, or its token lacks the `gist` scope): shows the device code +
   * verification URL of the guest's own sign-in, states why it is needed
   * (`reason`) and what the host learns. "Open GitHub" reports `open` and
   * keeps the dialog up in a waiting state until main dismisses it.
   *
   * `mode: "prove"` (first join on the host, signed in) and `mode: "confirm"`
   * (returning guest with a stored credential): no code or URL — an identity
   * line names the signed-in login (prove) or the login the host already
   * knows (confirm), the "what the host learns" section stays, and the
   * primary "Join" button reports `open`, keeping the dialog up in a brief
   * joining state until main dismisses it.
   *
   * In every mode Escape / backdrop / × / Cancel report `cancel` (also allowed
   * while waiting — it aborts the join until the host commits it, when main
   * dismisses the dialog and Cancel is no longer offered).
   */
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import Fa from 'svelte-fa';
  import { faShieldHalved, faUser, faXmark } from '@fortawesome/free-solid-svg-icons';
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
  const signInMode = $derived(payload?.mode === 'sign-in-required');

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
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-[1px]"
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
                {m.inviteConsent_modal_title({
                  workspaceTitle: payload.workspaceTitle,
                  hostLabel: payload.hostLabel,
                })}
              </h2>
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
          {#if payload.mode === 'sign-in-required'}
            <section class="space-y-1">
              <h3 class="text-sm font-medium text-foreground">
                {m.inviteConsent_modal_signInRequired_title()}
              </h3>
              <p class="text-xs text-subtle">
                {payload.reason === 'scope-missing'
                  ? m.inviteConsent_modal_signInScopeMissing_description()
                  : m.inviteConsent_modal_signInNotConnected_description()}
              </p>
            </section>
          {:else}
            <div class="flex items-center gap-2 text-sm text-foreground">
              <Fa icon={faUser} class="shrink-0 text-subtle" />
              <span>
                {payload.mode === 'prove'
                  ? m.inviteConsent_modal_signedInGitHub_label({ login: `@${payload.login}` })
                  : m.inviteConsent_modal_signedInAs_label({ login: `@${payload.login}` })}
              </span>
            </div>
          {/if}
          <section class="space-y-1">
            <h3 class="text-sm font-medium text-foreground">
              {m.inviteConsent_modal_hostLearns_title()}
            </h3>
            <p class="text-xs text-subtle">
              {m.inviteConsent_modal_hostLearns_description()}
            </p>
          </section>
          {#if payload.mode === 'sign-in-required'}
            <GitHubDeviceCodeCard
              userCode={payload.userCode}
              verificationUri={payload.verificationUri}
              onOpen={handleOpen}
            />
          {/if}
          {#if waiting}
            <div class="flex items-center gap-2 text-sm text-subtle">
              <IntentMarkLoader size={14} class="shrink-0" />
              <span>
                {signInMode
                  ? m.inviteConsent_modal_waiting_label()
                  : m.inviteConsent_modal_joining_label()}
              </span>
            </div>
          {/if}
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={cancel}>
            {m.inviteConsent_modal_cancelButton_label()}
          </Button>
          {#if !signInMode}
            <Button onclick={handleOpen} disabled={waiting}>
              {m.inviteConsent_modal_joinButton_label()}
            </Button>
          {/if}
        </div>
      </div>
    </div>
  </Portal>
{/if}
