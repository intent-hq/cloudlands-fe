<script lang="ts">
  /**
   * Setup Prompt Dialog
   *
   * "Go through setup?" confirmation for REMOTE backends that have no
   * workspaces and no ready providers. Self-gates on the setup-prompt slice;
   * dismissal is session-scoped per connection. The local backend never sees
   * this dialog — it silently redirects to the setup wizard instead. It is
   * also suppressed while already on /workspace/new: boot loads on a
   * setup-needed backend redirect there (boot-route-gate), and the dialog
   * must not overlay the very wizard it would offer to open.
   */
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { FocusTrap } from '$lib/utils/accessibility';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentConnection } from '$store/renderer/slices/connections/connections-selectors';
  import { selectShowRemoteSetupPrompt } from '$store/renderer/slices/setup-prompt/setup-prompt-selectors';
  import { setupPromptDismissed } from '$store/renderer/slices/setup-prompt/setup-prompt-slice';

  let { staticData }: { staticData?: { backendLabel: string } } = $props();
  const showPrompt = untrack(() => (staticData ? readable(true) : selectShowRemoteSetupPrompt()));
  const activeConnection = untrack(() => (staticData ? readable(null) : selectCurrentConnection()));

  let dialogRef: HTMLDivElement | null = $state(null);

  // Escape layer (LIFO across stacked overlays) + focus trap while open, so
  // Escape dismisses regardless of where focus is and Tab cycles within the
  // dialog instead of escaping behind the overlay.
  $effect(() => {
    if (staticData || !$showPrompt || !dialogRef) return;
    const trap = new FocusTrap(dialogRef);
    trap.activate();
    const releaseEscape = pushEscapeLayer(() => dismiss());
    return () => {
      releaseEscape();
      trap.deactivate();
    };
  });

  function dismiss() {
    if (staticData) return;
    const connectionId = $activeConnection?.id;
    if (connectionId) appStore.dispatch(setupPromptDismissed(connectionId));
  }

  async function handleConfirm() {
    if (staticData) return;
    dismiss();
    await goto('/workspace/new');
  }
</script>

{#if staticData || ($showPrompt && $page.url.pathname !== '/workspace/new')}
  <div
    class={staticData
      ? 'flex items-center justify-center'
      : 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'}
    role="presentation"
    onclick={dismiss}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={dialogRef}
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal={staticData ? undefined : true}
      aria-labelledby="setup-prompt-title"
      aria-describedby="setup-prompt-description"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="text-primary-ink">
            <Fa icon={faWandMagicSparkles} size="lg" />
          </div>
          <h2 id="setup-prompt-title" class="text-lg font-semibold">
            {m.modals_setupPrompt_title()}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onclick={dismiss}
          aria-label={m.modals_setupPrompt_close_ariaLabel()}
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <p id="setup-prompt-description" class="text-sm text-subtle">
          {m.modals_setupPrompt_description({
            backend:
              staticData?.backendLabel ??
              $activeConnection?.label ??
              m.modals_setupPrompt_backend_fallback(),
          })}
        </p>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        <Button variant="ghost" onclick={dismiss}>{m.modals_setupPrompt_notNow_label()}</Button>
        <Button variant="primary" onclick={handleConfirm}
          >{m.modals_setupPrompt_confirm_label()}</Button
        >
      </div>
    </div>
  </div>
{/if}
