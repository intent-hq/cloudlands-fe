<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { debugConfig } from '$lib/config/debug';
  import { followBottom, type FollowBottomState } from '$lib/utils/smartScroll';
  import { initAppStore, store as appStore } from '$store/renderer/store';
  import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';
  import ResponseGroup from '../ResponseGroup.svelte';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
    fixtureId?: string;
    agentCount?: number;
    finishedCount?: number;
    subscriptionMode?: 'agents' | 'mixed';
    initiallyExpanded?: boolean;
    responseStreaming?: boolean;
    responseText?: string;
    animationsEnabled?: boolean;
  }

  let {
    theme = 'light',
    width = 720,
    zoom = 1,
    fixtureId = 'mixed',
    agentCount = 8,
    finishedCount = 2,
    subscriptionMode = 'mixed',
    initiallyExpanded = true,
    responseStreaming = false,
    responseText = 'Measured production-shaped response content',
    animationsEnabled = true,
  }: Props = $props();
  const storeContext = initAppStore(appStore);
  const originalAnimationsEnabled = debugConfig.get('enableComponentTransitions');
  let follow = $state(true);
  let distance = $state(0);
  const blocks = $derived([{ type: 'text', text: responseText }] as ContentBlock[]);
  const agents = $derived(
    Array.from({ length: agentCount }, (_, index) => ({
      id: `${fixtureId}-agent-${index}`,
      name: `Fixture agent ${index}`,
      finished: index >= agentCount - finishedCount,
    })),
  );

  function report(state: FollowBottomState) {
    distance = state.distanceFromBottom;
  }

  $effect(() => {
    debugConfig.set('enableComponentTransitions', animationsEnabled);
  });

  onDestroy(() => {
    debugConfig.set('enableComponentTransitions', originalAnimationsEnabled);
    storeContext.dispose();
  });
</script>

{#snippet subscriptionPreview()}
  <div class="h-9 px-3 py-2" data-testid="fixture-hook-row">Background hook</div>
  <div class="h-9 border-t border-border px-3 py-2" data-testid="fixture-pr-row">
    Pull request monitor
  </div>
{/snippet}

{#snippet responseBody()}
  <div class="flex flex-col gap-1.5 pb-4" data-testid="prepared-response-body">
    <p data-testid="prepared-response-current">{responseText}</p>
    <p>Second measured response line keeps the intrinsic destination non-trivial.</p>
    <button type="button" data-testid="prepared-response-focus">Focusable response action</button>
  </div>
{/snippet}

<section
  class="flex h-[520px] flex-col overflow-hidden bg-background text-foreground"
  class:dark={theme === 'dark'}
  style:width="{width}px"
  style:zoom
  data-testid="disclosure-preparation-host"
>
  <header class="h-10 shrink-0 border-b border-border px-3 py-2">
    <span data-testid="disclosure-bottom-state">{follow ? 'locked' : 'unlocked'}:{distance}</span>
  </header>
  <div
    use:followBottom={{
      follow,
      threshold: 100,
      onFollowChange: (next) => (follow = next),
      onScrollStateChange: report,
    }}
    class="min-h-0 flex-1 overflow-y-auto"
    style="overflow-anchor: none;"
    data-testid="disclosure-transcript"
    role="log"
  >
    {#each Array(7) as _, index}
      <div class="h-24 border-b border-border/30 px-4 py-3">Historical turn {index}</div>
    {/each}
    <div class="h-16 px-4 py-3" data-testid="disclosure-visible-anchor">Visible anchor</div>
    <ResponseGroup
      name="Prepared response group"
      {blocks}
      isStreaming={responseStreaming}
      currentChild={responseBody}
    >
      {@render responseBody()}
    </ResponseGroup>
    <EventSubscriptionsCard
      workspaceId="fixture-workspace"
      agentId={`fixture-parent-${fixtureId}`}
      isolatedPreview={{
        count: agents.length + (subscriptionMode === 'mixed' ? 2 : 0),
        initiallyExpanded,
        mode: subscriptionMode,
        agents,
      }}
      previewContent={subscriptionPreview}
    />
  </div>
  <div class="h-16 shrink-0 border-t border-border" data-testid="disclosure-composer"></div>
</section>
