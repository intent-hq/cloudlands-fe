<script lang="ts">
  /**
   * In-app one-button notice for an `intent://invite` join (replaces the
   * native message boxes when a renderer window is available): either the
   * join failed (`failed`, sentence chosen by the bounded reason code) or the
   * credential had to be stored without OS encryption (`plaintext`). OK /
   * Escape / backdrop / × all acknowledge exactly once.
   */
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
  import { describeInviteFailureReason } from '$shared/utils/invite-failure-text';
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
      <Button onclick={acknowledge}>{m.deeplink_inviteFailed_ok_button()}</Button>
    {/snippet}
  </ContentDialog>
{/if}
