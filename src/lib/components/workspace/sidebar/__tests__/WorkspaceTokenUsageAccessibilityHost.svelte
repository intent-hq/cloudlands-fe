<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceTokenUsage from '../WorkspaceTokenUsage.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { tokenUsageReceived } from '$store/renderer/slices/token-usage/token-usage-slice';

  interface Props {
    theme?: 'light' | 'dark';
  }

  let { theme = 'light' }: Props = $props();
  const workspaceId = 'token-usage-accessibility-ct';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });

  store.dispatch(
    tokenUsageReceived(workspaceId, {
      byAgentId: {},
      totals: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 600,
        cacheCreationTokens: 100,
      },
      byModel: {},
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
  <div class="w-[248px]">
    <WorkspaceTokenUsage {workspaceId} />
  </div>
</section>
