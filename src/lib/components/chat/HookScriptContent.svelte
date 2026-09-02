<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { selectBackgroundHooks } from '$store/renderer/slices/background-hooks/background-hooks-selectors';
  import {
    backgroundHooksRefetchRequested,
    backgroundHooksSubscribeRequested,
    backgroundHooksUnsubscribeRequested,
  } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import { store as appStore } from '$store/renderer/store';

  let { workspaceId, hookId }: { workspaceId: string; hookId: string } = $props();
  // svelte-ignore state_referenced_locally -- intentional selector construction snapshot.
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const hooks$ = selectBackgroundHooks(workspaceIdStore);
  const hook = $derived($hooks$.find((candidate) => candidate.hookId === hookId));

  $effect(() => {
    if (!workspaceId) return;
    const currentWorkspaceId = workspaceId;
    untrack(() => {
      appStore.dispatch(backgroundHooksSubscribeRequested(currentWorkspaceId));
      appStore.dispatch(backgroundHooksRefetchRequested(currentWorkspaceId));
    });
    return () => appStore.dispatch(backgroundHooksUnsubscribeRequested(currentWorkspaceId));
  });

  let activeTab = $state<'script' | 'logs'>('script');
</script>

<div
  class="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden"
  data-testid="hook-script-content"
>
  <div class="flex shrink-0 border-b border-border" role="tablist">
    <Button
      variant="ghost"
      role="tab"
      aria-selected={activeTab === 'script'}
      class="border-b-2 px-3 py-1.5 text-sm {activeTab === 'script'
        ? 'border-primary text-primary'
        : 'border-transparent text-subtle'}"
      onclick={() => (activeTab = 'script')}
      >{m.chat_backgroundHooks_modal_scriptTab_label()}</Button
    >
    <Button
      variant="ghost"
      role="tab"
      aria-selected={activeTab === 'logs'}
      class="border-b-2 px-3 py-1.5 text-sm {activeTab === 'logs'
        ? 'border-primary text-primary'
        : 'border-transparent text-subtle'}"
      onclick={() => (activeTab = 'logs')}>{m.chat_backgroundHooks_modal_logsTab_label()}</Button
    >
  </div>
  {#if activeTab === 'script'}
    <div class="min-h-0 min-w-0 flex-1 overflow-auto" data-testid="hook-script-content-script">
      <CodeBlock code={hook?.code ?? ''} language="javascript" noMargin />
    </div>
  {:else}
    <div
      class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-auto"
      data-testid="hook-script-content-logs"
    >
      {#if hook?.lastError}
        <span class="text-xs font-medium text-danger"
          >{m.chat_backgroundHooks_modal_lastError_label()}</span
        >
        <pre
          class="whitespace-pre-wrap break-all rounded bg-danger-background/10 p-2 font-mono text-xs text-danger">{hook.lastError}</pre>
      {/if}
      {#if hook?.lastLogs}
        <pre
          class="whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-xs text-subtle">{hook.lastLogs}</pre>
      {:else}
        <p class="text-xs text-subtle">{m.chat_backgroundHooks_modal_noLogs_description()}</p>
      {/if}
    </div>
  {/if}
</div>
