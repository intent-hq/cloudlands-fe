<script lang="ts">
  /**
   * In-app GitHub identity consent dialog for an `intent://invite` join
   * (replaces the native message box when a renderer window is available).
   *
   * `mode: "connect-forge"` (no forge connected at all): names enabled forges
   * and offers the choice before anything is asked of GitHub — Settings →
   * Connections for GitLab (cancels the join, reopened after connecting) or
   * the primary "Sign in to GitHub", which reports `open` and keeps the
   * dialog up in a waiting state until main replaces it with the device code.
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
   * knows (confirm), the privacy explanation stays (worded for the forge the
   * proof is made on), and the primary "Join" button reports `open`, keeping
   * the dialog up in a brief joining state until main dismisses it.
   *
   * The `sign-in-required` state runs the GitHub device flow inline; a guest
   * who enabled GitLab Labs and prefers that account is pointed at Settings →
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
  import { faUser } from '@fortawesome/free-solid-svg-icons';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import GitHubDeviceCodeCard from '$lib/components/GitHubDeviceCodeCard.svelte';
  import type { InviteConsentAction, InviteConsentShowPayload } from '$shared/ipc/invite-consent';
  import { m } from '$shared/paraglide/messages.js';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';

  interface Props {
    open?: boolean;
    payload?: InviteConsentShowPayload | null;
    /** Called with `open` (at most once per request) and/or `cancel`. */
    onRespond?: (action: InviteConsentAction) => void;
  }

  let { open = $bindable(false), payload = null, onRespond }: Props = $props();

  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const dialogTitleId = 'invite-consent-dialog-title';
  // The request that has been sent `open`; keyed by id so a new payload resets it.
  let openedRequestId = $state<string | null>(null);
  const waiting = $derived(payload !== null && openedRequestId === payload.requestId);
  const connectMode = $derived(payload?.mode === 'connect-forge');
  const signInMode = $derived(payload?.mode === 'sign-in-required');
  // The forge the proof names; a `prove` payload without `identity` is GitHub.
  const gitlabIdentity = $derived(
    payload?.mode === 'prove' && payload.identity?.provider === 'gitlab' ? payload.identity : null,
  );

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

  function openConnectionsSettings() {
    cancel();
    void navigateToSettings(
      $gitlabEnabled$
        ? { tab: 'connections', hash: 'integrations' }
        : { tab: 'labs', hash: 'labs-gitlab' },
    ).catch(() => {});
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
    {#if payload.mode === 'connect-forge'}
      <section class="space-y-1" data-testid="invite-consent-connect-forge">
        <h3 class="text-sm font-medium text-foreground">
          {$gitlabEnabled$
            ? m.inviteConsent_modal_connectForge_title()
            : m.inviteConsent_modal_signInRequired_title()}
        </h3>
        <p class="text-xs text-subtle">
          {$gitlabEnabled$
            ? m.inviteConsent_modal_connectForge_description()
            : m.inviteConsent_modal_signInNotConnected_description()}
        </p>
        {#if $gitlabEnabled$}
          <p class="text-xs text-subtle">
            {m.inviteConsent_modal_connectForgeGitLab_before()}<Button
              type="button"
              variant="link"
              class="h-auto p-0 text-xs underline underline-offset-2"
              data-testid="invite-consent-open-connections"
              onclick={openConnectionsSettings}
              >{m.inviteConsent_modal_signInGitLabInstead_link()}</Button
            >{m.inviteConsent_modal_connectForgeGitLab_after()}
          </p>
        {/if}
      </section>
    {:else if payload.mode !== 'sign-in-required'}
      <div class="flex items-start gap-2 text-sm text-foreground">
        <span class="first-line-icon"><Fa icon={faUser} class="text-subtle" /></span>
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
    <p class="text-xs text-subtle">
      {#if connectMode && $gitlabEnabled$}
        {m.inviteConsent_modal_hostLearnsForge_description()}
      {:else if gitlabIdentity}
        {m.inviteConsent_modal_hostLearnsGitLab_description({ host: gitlabIdentity.host })}
      {:else}
        {m.inviteConsent_modal_hostLearns_description()}
      {/if}
    </p>
    {#if payload.mode === 'sign-in-required'}
      <section class="space-y-4">
        <div class="space-y-1">
          <h3 class="text-sm font-medium text-foreground">
            {m.inviteConsent_modal_signInRequired_title()}
          </h3>
          <p class="text-xs text-subtle">
            {payload.reason === 'scope-missing'
              ? m.inviteConsent_modal_signInScopeMissing_description()
              : m.inviteConsent_modal_signInNotConnected_description()}
          </p>
          {#if payload.reason === 'not-connected' && $gitlabEnabled$}
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
        </div>
        <GitHubDeviceCodeCard
          userCode={payload.userCode}
          verificationUri={payload.verificationUri}
          onOpen={handleOpen}
        />
      </section>
    {/if}
    {#if waiting}
      <div class="flex items-start gap-2 text-sm text-subtle">
        <span class="first-line-icon"><IntentMarkLoader size={14} /></span>
        <span>
          {signInMode || connectMode
            ? m.inviteConsent_modal_waiting_label()
            : m.inviteConsent_modal_joining_label()}
        </span>
      </div>
    {/if}
    {#snippet footer()}
      <Button variant="ghost" onclick={cancel}>
        {m.inviteConsent_modal_cancelButton_label()}
      </Button>
      {#if connectMode}
        <Button onclick={handleOpen} disabled={waiting}>
          {m.inviteConsent_modal_signInGitHubButton_label()}
        </Button>
      {:else if !signInMode}
        <Button onclick={handleOpen} disabled={waiting}>
          {m.inviteConsent_modal_joinButton_label()}
        </Button>
      {/if}
    {/snippet}
  </ContentDialog>
{/if}
