<script lang="ts">
  /**
   * HookScriptModal Component
   *
   * Modal detail view for one background hook (PROTOCOL §5.40): a Script tab
   * with the full `hook.code` (JavaScript syntax highlighting) and a
   * "Last run logs" tab with `hook.lastLogs` / `hook.lastError`. The hook is
   * read live from the background-hooks selector; on mount it dispatches the
   * on-demand refetch trigger because `hook:*` events never carry `lastLogs`.
   */
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import Modal from '$lib/components/modals/Modal.svelte';
  import TabBar from '$lib/components/ui/TabBar.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
  import { backgroundHooksRefetchRequested } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    hookId: string;
    onClose?: () => void;
  }

  let { workspaceId, hookId, onClose }: Props = $props();

  // Writable store mirrors the prop so the Redux selector re-evaluates when
  // workspaceId changes (selector readables are init-time only).
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const hooks$ = selectBackgroundHooks(workspaceIdStore);
  const hook = $derived($hooks$.find((h) => h.hookId === hookId));

  // `hook:*` events never carry `lastLogs` (§5.40), so refresh via the
  // on-demand `hook.list` refetch when the modal opens.
  $effect(() => {
    if (!workspaceId) return;
    const currentWorkspaceId = workspaceId;
    untrack(() => appStore.dispatch(backgroundHooksRefetchRequested(currentWorkspaceId)));
  });

  let activeTab = $state('script');
  const tabs = $derived([
    { id: 'script', label: m.chat_backgroundHooks_modal_scriptTab_label() },
    { id: 'logs', label: m.chat_backgroundHooks_modal_logsTab_label() },
  ]);
</script>

<Modal
  open
  title={m.chat_backgroundHooks_modal_title({ name: hook?.name ?? '' })}
  contentClass="px-6 py-4"
  {onClose}
>
  <div class="flex min-h-0 flex-col gap-3" data-testid="hook-script-modal">
    <TabBar
      {tabs}
      {activeTab}
      onTabChange={(tabId) => (activeTab = tabId)}
      class="shrink-0 border-b border-border"
    />
    {#if activeTab === 'script'}
      <div class="min-h-0 max-h-[60vh] overflow-y-auto" data-testid="hook-script-modal-script">
        <CodeBlock code={hook?.code ?? ''} language="javascript" noMargin />
      </div>
    {:else}
      <div
        class="flex min-h-0 max-h-[60vh] flex-col gap-2 overflow-y-auto"
        data-testid="hook-script-modal-logs"
      >
        {#if hook?.lastError}
          <div class="flex flex-col gap-1">
            <span class="text-xs font-medium text-destructive"
              >{m.chat_backgroundHooks_modal_lastError_label()}</span
            >
            <pre
              class="whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 font-mono text-xs leading-snug text-destructive">{hook.lastError}</pre>
          </div>
        {/if}
        {#if hook?.lastLogs}
          <pre
            class="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-xs leading-snug text-subtle">{hook.lastLogs}</pre>
        {:else}
          <p class="text-xs text-subtle">{m.chat_backgroundHooks_modal_noLogs_description()}</p>
        {/if}
      </div>
    {/if}
  </div>
</Modal>
