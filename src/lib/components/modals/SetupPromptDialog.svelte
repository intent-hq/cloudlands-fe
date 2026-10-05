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
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectCurrentConnection } from '$store/renderer/slices/connections/connections-selectors';
  import { selectShowRemoteSetupPrompt } from '$store/renderer/slices/setup-prompt/setup-prompt-selectors';
  import { setupPromptDismissed } from '$store/renderer/slices/setup-prompt/setup-prompt-slice';

  let { staticData }: { staticData?: { backendLabel: string } } = $props();
  const showPrompt = untrack(() => (staticData ? readable(true) : selectShowRemoteSetupPrompt()));
  const activeConnection = untrack(() => (staticData ? readable(null) : selectCurrentConnection()));

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
  <FormDialog
    open
    static={Boolean(staticData)}
    title={m.modals_setupPrompt_title()}
    description={m.modals_setupPrompt_description({
      backend:
        staticData?.backendLabel ??
        $activeConnection?.label ??
        m.modals_setupPrompt_backend_fallback(),
    })}
    closeLabel={m.modals_setupPrompt_close_ariaLabel()}
    submitLabel={m.modals_setupPrompt_confirm_label()}
    cancelLabel={m.modals_setupPrompt_notNow_label()}
    onSubmit={handleConfirm}
    onCancel={dismiss}
  />
{/if}
