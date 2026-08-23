<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceTokenUsage from '../WorkspaceTokenUsage.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { tokenUsageReceived } from '$store/renderer/slices/token-usage/token-usage-slice';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    placement?: 'top' | 'bottom';
    side?: 'left' | 'right';
  }

  let { theme = 'light', width = 304, placement = 'top', side = 'left' }: Props = $props();
  const workspaceId = 'token-usage-accessibility-ct';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  store.dispatch(
    tokenUsageReceived(workspaceId, {
      byAgentId: {
        'agent-alpha': {
          inputTokens: 50,
          outputTokens: 150,
          cacheReadTokens: 500,
          cacheCreationTokens: 50,
        },
        'agent-beta': {
          inputTokens: 50,
          outputTokens: 50,
          cacheReadTokens: 100,
          cacheCreationTokens: 50,
        },
      },
      totals: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 600,
        cacheCreationTokens: 100,
      },
      byModel: {
        'provider/this-is-an-extraordinarily-long-model-name-for-truncation': {
          inputTokens: 50,
          outputTokens: 150,
          cacheReadTokens: 500,
          cacheCreationTokens: 50,
        },
        'model-beta': {
          inputTokens: 50,
          outputTokens: 50,
          cacheReadTokens: 100,
          cacheCreationTokens: 50,
        },
      },
      lastScanAt: '2026-08-22T00:00:00Z',
    }),
  );

  $effect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
  });

  onDestroy(() => {
    disposeStore();
    document.documentElement.classList.remove('light', 'dark');
  });
</script>

<section
  class="workspace-page relative flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground"
  data-theme={theme}
>
  <div
    class="upper-area relative flex min-h-0 flex-1 overflow-hidden"
    class:flex-row-reverse={side === 'right'}
  >
    <aside
      class="workspace-sidebar-panel relative h-full shrink-0 bg-sidebar"
      style:width={`${width + 48}px`}
      style:max-width="100vw"
      data-testid="workspace-sidebar"
    >
      <div
        class="workspace-sidebar-content relative flex h-full flex-col overflow-y-auto bg-transparent"
        data-testid="workspace-sidebar-scroll"
      >
        {#if placement === 'bottom'}
          <div class="min-h-[calc(100vh-132px)] shrink-0" aria-hidden="true"></div>
        {/if}
        <div class="shrink-0 px-6 pb-2 pt-5" data-workspace-title-region>
          <div class="mb-3 h-8 rounded-md bg-muted/30" aria-hidden="true"></div>
          <div
            data-testid="token-usage-test-width"
            style:width={`${width}px`}
            style:max-width="100%"
          >
            <WorkspaceTokenUsage {workspaceId} />
          </div>
        </div>
        <div class="h-[480px] shrink-0" aria-hidden="true"></div>
      </div>
    </aside>
    <main
      class="main-content-area relative z-10 h-full min-w-0 flex-1 overflow-hidden bg-sidebar"
      data-testid="workspace-content"
    >
      <div
        class="absolute inset-3 rounded-xl border border-border bg-card"
        aria-hidden="true"
      ></div>
    </main>
  </div>
</section>

<style>
  .workspace-sidebar-content {
    scrollbar-width: none;
  }

  .workspace-sidebar-content::-webkit-scrollbar {
    display: none;
  }
</style>
