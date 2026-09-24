<script lang="ts">
  /**
   * In-app notice for an `intent://invite` join (replaces the
   * native message boxes when a renderer window is available): either the
   * join failed (`failed`, sentence chosen by the bounded reason code) or the
   * credential had to be stored without OS encryption (`plaintext`). OK /
   * Escape / backdrop / × all acknowledge exactly once. Account failures
   * also link to Labs or Connections according to the saved GitLab choice.
   */
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
  import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    payload?: InviteNoticeShowPayload | null;
    /** Called exactly once per open when the user acknowledges the notice. */
    onAcknowledge?: () => void;
  }

  let { open = $bindable(false), payload = null, onAcknowledge }: Props = $props();

  const dialogTitleId = 'invite-notice-dialog-title';
  const dialogDescriptionId = 'invite-notice-dialog-description';

  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const needsAccountSetup = $derived(
    payload?.kind === 'failed' &&
      (payload.reason === 'proof-gitlab-not-connected' ||
        payload.reason === 'proof-gitlab-scope-missing' ||
        payload.reason === 'pin-mismatch' ||
        payload.reason === 'identity-unavailable'),
  );
  const failed = $derived(payload?.kind === 'failed');
  const title = $derived(
    failed ? m.deeplink_inviteFailed_title() : m.deeplink_invitePlaintext_title(),
  );
  const message = $derived(
    failed
      ? describeInviteFailureReason(payload?.reason ?? 'generic', {
          identityHost: payload?.identityHost,
        })
      : m.deeplink_invitePlaintext_message(),
  );
  const context = $derived(
    payload?.workspaceTitle && payload?.hostLabel
      ? m.inviteNotice_modal_context({
          workspaceTitle: payload.workspaceTitle,
          hostLabel: payload.hostLabel,
        })
      : null,
  );

  function openAccountSetup() {
    acknowledge();
    void navigateToSettings(
      $gitlabEnabled$
        ? { tab: 'connections', hash: 'integrations' }
        : { tab: 'labs', hash: 'labs-gitlab' },
    ).catch(() => {});
  }

  function acknowledge() {
    if (!open) return;
    open = false;
    onAcknowledge?.();
  }
</script>

{#if open && payload}
  <ContentDialog
    {open}
    {title}
    titleId={dialogTitleId}
    description={context ?? undefined}
    descriptionId={dialogDescriptionId}
    role="alertdialog"
    closeLabel={m.inviteConsent_modal_dismiss_ariaLabel()}
    onClose={acknowledge}
  >
    <p class="type-body break-words">{message}</p>
    {#snippet footer()}
      {#if needsAccountSetup}
        <Button variant="secondary" onclick={openAccountSetup}>
          {$gitlabEnabled$
            ? m.workspace_share_openConnections_label()
            : m.inviteNotice_modal_enableGitlab_label()}
        </Button>
      {/if}
      <Button onclick={acknowledge}>{m.deeplink_inviteFailed_ok_button()}</Button>
    {/snippet}
  </ContentDialog>
{/if}
