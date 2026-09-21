<script lang="ts">
  /**
   * In-app one-button notice for an `intent://invite` join (replaces the
   * native message boxes when a renderer window is available): either the
   * join failed (`failed`, sentence chosen by the bounded reason code) or the
   * credential had to be stored without OS encryption (`plaintext`). OK /
   * Escape / backdrop / × all acknowledge exactly once.
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faCircleExclamation,
    faExclamationTriangle,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
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

  let dialogEl = $state<HTMLDivElement | null>(null);

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

  // Move focus into the dialog on open (ARIA alertdialog pattern) so Escape
  // reaches the keydown handler immediately.
  $effect(() => {
    if (open && payload && dialogEl) {
      dialogEl.focus();
    }
  });

  function acknowledge() {
    if (!open) return;
    open = false;
    onAcknowledge?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      acknowledge();
    }
  }
</script>

{#if open && payload}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={acknowledge}
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
            {#if failed}
              <div
                class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-background/10 text-danger ring-1 ring-danger/25"
              >
                <Fa icon={faCircleExclamation} size="lg" />
              </div>
            {:else}
              <div
                class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-ink ring-1 ring-warning/20"
              >
                <Fa icon={faExclamationTriangle} size="lg" />
              </div>
            {/if}
            <div>
              <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">{title}</h2>
              {#if context}
                <p class="mt-1 text-sm text-subtle">{context}</p>
              {/if}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={m.inviteConsent_modal_dismiss_ariaLabel()}
            onclick={acknowledge}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id={dialogDescriptionId} class="flex-1 overflow-auto px-6 py-5">
          <p class="text-sm text-foreground">{message}</p>
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button class="sm:min-w-[6rem]" onclick={acknowledge}>
            {m.deeplink_inviteFailed_ok_button()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
