<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceTokenUsage from '../WorkspaceTokenUsage.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { tokenUsageReceived } from '$store/renderer/slices/token-usage/token-usage-slice';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
  }

  let { theme = 'light', width = 248 }: Props = $props();
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

<section class="min-h-32 bg-background p-4 text-foreground" data-theme={theme}>
  <div data-testid="token-usage-test-width" style:width={`${width}px`}>
    <WorkspaceTokenUsage {workspaceId} />
  </div>
</section>
