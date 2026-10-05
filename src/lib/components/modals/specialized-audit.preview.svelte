<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'specialized-audit',
    title: 'Command and usage overlays',
    defaultState: 'commands',
    states: Object.fromEntries(
      ['commands', 'commands-empty', 'stats-loading', 'stats-empty', 'stats-error'].map((state) => [
        state,
        { props: { state } },
      ]),
    ),
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import CommandPalette from '../CommandPalette.svelte';
  import StatsOverlay from '$features/stats/StatsOverlay.svelte';
  import { appClient } from '$lib/client';
  import { store as appStore } from '$store/renderer/store';
  import { setStatsOverlayOpen } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { usageStatsLoaded, usageStatsFailed } from '$store/renderer/slices/stats/stats-slice';
  import type { UsageStatsResult } from '$lib/client/app-client';
  import { selectStatsLoading } from '$store/renderer/slices/stats/stats-selectors';
  import { installEmptyTranscriptSearchFixture } from './specialized-audit.fixtures';
  let { state = 'commands' }: { state?: string } = $props();
  const loading = selectStatsLoading();
  const empty: UsageStatsResult = {
    totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    runs: 0,
    sessions: 0,
    longestRunMs: 0,
    linesAdded: 0,
    linesDeleted: 0,
    byModel: [],
    byProvider: [],
    byHourOfDay: [],
    byMonth: [],
    availablePeriods: { months: [], years: [] },
  };
  onMount(() => {
    if (!state.startsWith('stats-')) {
      return installEmptyTranscriptSearchFixture();
    }
    const previous = appClient.stats.getUsage;
    appClient.stats.getUsage = async () => {
      if (state === 'stats-loading') return new Promise<UsageStatsResult>(() => {});
      if (state === 'stats-error')
        throw new Error('Unable to load usage. Check the connection and try again.');
      return empty;
    };
    appStore.dispatch(setStatsOverlayOpen(true));
    return () => {
      appClient.stats.getUsage = previous;
      appStore.dispatch(setStatsOverlayOpen(false));
    };
  });
  $effect(() => {
    if (!$loading || !state.startsWith('stats-') || state === 'stats-loading') return;
    // Reply only after the overlay's actual initial request, including in previews without sagas.
    untrack(() => {
      const { mode, periodKey } = appStore.state.stats;
      appStore.dispatch(
        state === 'stats-error'
          ? usageStatsFailed(
              mode,
              periodKey,
              'Unable to load usage. Check the connection and try again.',
            )
          : usageStatsLoaded(mode, periodKey, empty),
      );
    });
  });
</script>

{#if state.startsWith('commands')}
  <CommandPalette
    isOpen
    initialQuery={state === 'commands-empty' ? 'no-matching-command-xyz' : ''}
    onClose={() => {}}
  />
{:else}
  <StatsOverlay />
{/if}
