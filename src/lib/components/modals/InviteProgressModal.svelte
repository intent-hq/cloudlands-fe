<script lang="ts">
  /**
   * In-app progress dialog for the silent phases of an `intent://invite`
   * join: a spinner, a phase-specific message (`connecting` to the host, or
   * `opening` the joined workspace) and a single Cancel button. Cancel /
   * Escape / backdrop / × all cancel exactly once per open. Main moves the
   * dialog between phases with an update (no remount) and closes it with a
   * dismiss once the phase ends.
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { FocusTrap } from '$lib/utils/accessibility';
  import type { InviteProgressShowPayload } from '$shared/ipc/invite-progress';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    payload?: InviteProgressShowPayload | null;
    /** Called exactly once per open when the user cancels the join. */
    onCancel?: () => void;
  }

  let { open = $bindable(false), payload = null, onCancel }: Props = $props();

  const dialogTitleId = 'invite-progress-dialog-title';
  const dialogDescriptionId = 'invite-progress-dialog-description';

  let dialogEl = $state<HTMLDivElement | null>(null);

  const opening = $derived(payload?.phase === 'opening');
  const title = $derived(
    opening ? m.inviteProgress_modal_opening_title() : m.inviteProgress_modal_connecting_title(),
  );
  const message = $derived.by(() => {
    if (opening) {
      return payload?.workspaceTitle
        ? m.inviteProgress_modal_opening_message({ workspaceTitle: payload.workspaceTitle })
        : m.inviteProgress_modal_opening_generic_message();
    }
    return payload?.hostLabel
      ? m.inviteProgress_modal_connecting_message({ hostLabel: payload.hostLabel })
      : m.inviteProgress_modal_connecting_generic_message();
  });

  // Move focus into the dialog on open so Escape reaches the keydown handler
  // immediately, and trap it there so Tab cycles within the dialog; focus
  // returns to where it was once the dialog closes.
  $effect(() => {
    if (!open || !payload || !dialogEl) return;
    const el = dialogEl;
    const trap = new FocusTrap(el);
    trap.activate();
    if (!el.contains(document.activeElement)) el.focus();
    return () => trap.deactivate();
  });

  function cancel() {
    if (!open) return;
    open = false;
    onCancel?.();
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
        class="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-black/20 outline-none"
        onclick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabindex="-1"
        onkeydown={handleKeydown}
      >
        <div class="flex items-start justify-between gap-4 px-6 pt-6">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/40 text-foreground ring-1 ring-border"
            >
              <IntentMarkLoader size={20} class="shrink-0" />
            </div>
            <div>
              <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">{title}</h2>
              <p id={dialogDescriptionId} class="mt-1 text-sm text-subtle">{message}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={m.inviteProgress_modal_dismiss_ariaLabel()}
            onclick={cancel}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div
          class="mt-5 flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" class="sm:min-w-[6rem]" onclick={cancel}>
            {m.inviteProgress_modal_cancelButton_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
