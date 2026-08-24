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
        'alpha-01': {
          inputTokens: 50,
          outputTokens: 150,
          cacheReadTokens: 500,
          cacheCreationTokens: 50,
        },
        'beta-02': {
          inputTokens: 30,
          outputTokens: 70,
          cacheReadTokens: 40,
          cacheCreationTokens: 10,
        },
        'gamma-03': {
          inputTokens: 15,
          outputTokens: 35,
          cacheReadTokens: 20,
          cacheCreationTokens: 5,
        },
        'production-final': {
          inputTokens: 5,
          outputTokens: 5,
          cacheReadTokens: 10,
          cacheCreationTokens: 5,
        },
      },
      totals: {
        inputTokens: 100,
        outputTokens: 260,
        cacheReadTokens: 570,
        cacheCreationTokens: 70,
      },
      byModel: {
        'provider/this-is-an-extraordinarily-long-model-name-for-truncation': {
          inputTokens: 50,
          outputTokens: 150,
          cacheReadTokens: 360,
          cacheCreationTokens: 40,
        },
        'model-beta': {
          inputTokens: 30,
          outputTokens: 60,
          cacheReadTokens: 140,
          cacheCreationTokens: 20,
        },
        'model-gamma': {
          inputTokens: 15,
          outputTokens: 35,
          cacheReadTokens: 45,
          cacheCreationTokens: 5,
        },
        'model-production-final': {
          inputTokens: 5,
          outputTokens: 15,
          cacheReadTokens: 25,
          cacheCreationTokens: 5,
        },
      },
      byAgentModel: [
        {
          agentId: 'alpha-01',
          model: 'model-beta',
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 140,
            cacheCreationTokens: 10,
          },
          humanMessages: 1,
          agentMessages: 2,
        },
        {
          agentId: 'alpha-01',
          model: 'provider/this-is-an-extraordinarily-long-model-name-for-truncation',
          totals: {
            inputTokens: 50,
            outputTokens: 150,
            cacheReadTokens: 360,
            cacheCreationTokens: 40,
          },
          humanMessages: 3,
          agentMessages: 5,
        },
        {
          agentId: 'beta-02',
          model: 'model-beta',
          totals: {
            inputTokens: 30,
            outputTokens: 60,
            cacheReadTokens: 0,
            cacheCreationTokens: 10,
          },
          humanMessages: 2,
          agentMessages: 4,
        },
        {
          agentId: 'beta-02',
          model: 'model-gamma',
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 40,
            cacheCreationTokens: 0,
          },
          humanMessages: 1,
          agentMessages: 1,
        },
        {
          agentId: 'beta-02',
          model: 'model-production-final',
          totals: {
            inputTokens: 0,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
          humanMessages: 0,
          agentMessages: 1,
        },
        {
          agentId: 'gamma-03',
          model: 'model-gamma',
          totals: {
            inputTokens: 15,
            outputTokens: 35,
            cacheReadTokens: 5,
            cacheCreationTokens: 5,
          },
          humanMessages: 1,
          agentMessages: 2,
        },
        {
          agentId: 'gamma-03',
          model: 'model-production-final',
          totals: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 15,
            cacheCreationTokens: 0,
          },
          humanMessages: 0,
          agentMessages: 1,
        },
        {
          agentId: 'production-final',
          model: 'model-production-final',
          totals: {
            inputTokens: 5,
            outputTokens: 5,
            cacheReadTokens: 10,
            cacheCreationTokens: 5,
          },
          humanMessages: 1,
          agentMessages: 1,
        },
      ],
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
          <div class="sidebar-placement-spacer shrink-0" aria-hidden="true"></div>
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
        <div class="sidebar-content-spacer shrink-0" aria-hidden="true"></div>
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

  .sidebar-placement-spacer {
    min-height: calc(100vh - 132px);
  }

  .sidebar-content-spacer {
    height: 480px;
  }
</style>
