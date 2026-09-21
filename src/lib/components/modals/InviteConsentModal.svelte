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
   * line names the signed-in login (prove; the forge — GitHub, or GitLab with
   * its instance host — comes from `identity`) or the login the host already
   * knows (confirm), the "what the host learns" section stays (worded for the
   * forge the proof is made on), and the primary "Join" button reports
   * `open`, keeping the dialog up in a brief joining state until main
   * dismisses it.
   *
   * The `sign-in-required` state runs the GitHub device flow inline; a guest
   * who would rather join with a GitLab account is pointed at Settings →
   * Connections (the link cancels the join, which the user reopens after
   * connecting).
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
  import { FocusTrap } from '$lib/utils/accessibility';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

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
  // The forge the proof names; a `prove` payload without `identity` is GitHub.
  const gitlabIdentity = $derived(
    payload?.mode === 'prove' && payload.identity?.provider === 'gitlab' ? payload.identity : null,
  );

  // Move focus into the dialog on open (ARIA alertdialog pattern) so Escape
  // reaches the keydown handler immediately, and trap it there so Tab cycles
  // within the dialog instead of escaping behind the overlay; focus returns
  // to where it was once the dialog closes.
  $effect(() => {
    if (!open || !payload || !dialogEl) return;
    const el = dialogEl;
    const trap = new FocusTrap(el);
    trap.activate();
    if (!el.contains(document.activeElement)) el.focus();
    return () => trap.deactivate();
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

  function openConnectionsSettings() {
    cancel();
    void navigateToSettings({ tab: 'connections', hash: 'integrations' }).catch(() => {});
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
        <div class="flex items-center justify-between gap-4 px-6 pt-6">
          <div class="flex min-w-0 items-center gap-4">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20"
            >
              <Fa icon={faShieldHalved} size="lg" />
            </div>
            <div class="min-w-0">
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
            class="-mr-1 shrink-0 text-subtle hover:text-foreground"
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
              {#if payload.reason === 'not-connected'}
                <p class="text-xs text-subtle">
                  {m.inviteConsent_modal_signInGitLabInstead_before()}<Button
                    type="button"
                    variant="link"
                    class="h-auto p-0 text-xs underline underline-offset-2"
                    data-testid="invite-consent-connect-gitlab"
                    onclick={openConnectionsSettings}
                    >{m.inviteConsent_modal_signInGitLabInstead_link()}</Button
                  >{m.inviteConsent_modal_signInGitLabInstead_after()}
                </p>
              {/if}
            </section>
          {:else}
            <div class="flex items-center gap-2 text-sm text-foreground">
              <Fa icon={faUser} class="shrink-0 text-subtle" />
              <span
                data-testid="invite-consent-identity"
                data-provider={gitlabIdentity ? 'gitlab' : 'github'}
              >
                {#if payload.mode !== 'prove'}
                  {m.inviteConsent_modal_signedInAs_label({ login: `@${payload.login}` })}
                {:else if gitlabIdentity}
                  {m.inviteConsent_modal_signedInGitLab_label({
                    host: gitlabIdentity.host,
                    login: `@${payload.login}`,
                  })}
                {:else}
                  {m.inviteConsent_modal_signedInGitHub_label({ login: `@${payload.login}` })}
                {/if}
              </span>
            </div>
          {/if}
          <section class="space-y-1">
            <h3 class="text-sm font-medium text-foreground">
              {m.inviteConsent_modal_hostLearns_title()}
            </h3>
            <p class="text-xs text-subtle">
              {gitlabIdentity
                ? m.inviteConsent_modal_hostLearnsGitLab_description({ host: gitlabIdentity.host })
                : m.inviteConsent_modal_hostLearns_description()}
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
