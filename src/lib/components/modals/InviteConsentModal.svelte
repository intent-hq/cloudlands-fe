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
  import { faUser } from '@fortawesome/free-solid-svg-icons';
  import { ContentDialog } from '$lib/components/patterns/confirm';
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
  // The request that has been sent `open`; keyed by id so a new payload resets it.
  let openedRequestId = $state<string | null>(null);
  const waiting = $derived(payload !== null && openedRequestId === payload.requestId);
  const signInMode = $derived(payload?.mode === 'sign-in-required');

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
</script>

{#if open && payload}
  <ContentDialog
    {open}
    role="alertdialog"
    titleId={dialogTitleId}
    title={m.inviteConsent_modal_title({
      workspaceTitle: payload.workspaceTitle,
      hostLabel: payload.hostLabel,
    })}
    closeLabel={m.inviteConsent_modal_dismiss_ariaLabel()}
    onClose={cancel}
  >
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
      <div class="flex items-start gap-2 text-sm text-foreground">
        <span class="first-line-icon"><Fa icon={faUser} class="text-subtle" /></span>
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
      <div class="flex items-start gap-2 text-sm text-subtle">
        <span class="first-line-icon"><IntentMarkLoader size={14} /></span>
        <span>
          {signInMode
            ? m.inviteConsent_modal_waiting_label()
            : m.inviteConsent_modal_joining_label()}
        </span>
      </div>
    {/if}
    {#snippet footer()}
      <Button variant="ghost" onclick={cancel}>
        {m.inviteConsent_modal_cancelButton_label()}
      </Button>
      {#if !signInMode}
        <Button onclick={handleOpen} disabled={waiting}>
          {m.inviteConsent_modal_joinButton_label()}
        </Button>
      {/if}
    {/snippet}
  </ContentDialog>
{/if}
