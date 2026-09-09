<script lang="ts">
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { AvatarAnchor } from './render/labels';
  import type { AgentBadge } from './render/types';

  let {
    anchors,
    regionLabels,
    transform,
    selectedAgentIds,
    onSelectAgent,
    onOpenEvidence,
  }: {
    anchors: AvatarAnchor[];
    regionLabels: ReadonlyMap<string, string>;
    transform: { x: number; y: number; scale: number };
    selectedAgentIds: ReadonlySet<string>;
    onSelectAgent?: (agentId: string, additive: boolean) => void;
    onOpenEvidence?: (agentId: string) => void;
  } = $props();

  function isWorking(badge: AgentBadge): boolean {
    return badge.kind === 'thinking' || badge.kind === 'tool';
  }

  function regionLabel(anchor: AvatarAnchor): string {
    return anchor.regionId ? (regionLabels.get(anchor.regionId) ?? anchor.regionId) : '';
  }

  function ariaLabel(badge: AgentBadge, region: string): string {
    return isWorking(badge)
      ? m.semanticMap_canvas_avatarWorking_ariaLabel({ name: badge.name, region })
      : m.semanticMap_canvas_avatarIdle_ariaLabel({ name: badge.name, region });
  }

  function tooltip(badge: AgentBadge, region: string): string {
    return isWorking(badge)
      ? m.semanticMap_canvas_avatarWorking_tooltip({ name: badge.name, region })
      : m.semanticMap_canvas_avatarIdle_tooltip({ name: badge.name, region });
  }

  function anchorKey(anchor: AvatarAnchor): string {
    return anchor.badges
      .map(({ id }) => id)
      .sort()
      .join(':');
  }

  const keyedAnchors = $derived.by(() => {
    const membershipCounts = new Map<string, number>();
    for (const anchor of anchors) {
      const membership = anchorKey(anchor);
      membershipCounts.set(membership, (membershipCounts.get(membership) ?? 0) + 1);
    }
    return anchors.map((anchor) => {
      const membership = anchorKey(anchor);
      return {
        anchor,
        key: membershipCounts.get(membership) === 1 ? membership : `${membership}:${anchor.id}`,
      };
    });
  });
</script>

{#snippet avatarButton(badge: AgentBadge, region: string)}
  <Button
    type="button"
    variant="plain"
    class={`semantic-map-avatar-button pointer-events-auto relative size-6 rounded-md p-0! outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedAgentIds.has(badge.id) ? 'semantic-map-avatar-button--selected' : ''}`}
    aria-label={ariaLabel(badge, region)}
    title={tooltip(badge, region)}
    data-semantic-map-avatar={badge.id}
    data-semantic-map-avatar-state={isWorking(badge) ? 'working' : 'idle'}
    data-semantic-map-avatar-selected={selectedAgentIds.has(badge.id)}
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => {
      event.stopPropagation();
      onSelectAgent?.(badge.id, event.shiftKey || event.metaKey || event.ctrlKey);
    }}
    ondblclick={(event) => {
      event.stopPropagation();
      onOpenEvidence?.(badge.id);
    }}
  >
    <AgentAvatarWithState
      agentId={badge.id}
      state={isWorking(badge) ? 'running' : 'idle'}
      variant="card-stack"
    />
  </Button>
{/snippet}

<div class="pointer-events-none absolute inset-0 z-10" data-semantic-map-avatar-overlay>
  {#each keyedAnchors as { anchor, key } (key)}
    {@const region = regionLabel(anchor)}
    <div
      class="semantic-map-avatar-anchor absolute left-0 top-0"
      style:transform={`translate3d(${transform.x + anchor.x * transform.scale}px, ${transform.y + anchor.y * transform.scale}px, 0) translate(-50%, -50%)`}
      data-semantic-map-avatar-anchor={anchor.id}
      data-semantic-map-avatar-region={anchor.regionId}
    >
      {#if anchor.badges.length === 1}
        {@render avatarButton(anchor.badges[0], region)}
      {:else}
        {#snippet stackAvatar(item: AgentAvatarStackItem)}
          {@const badge = anchor.badges.find(({ id }) => id === item.agentId)}
          {#if badge}{@render avatarButton(badge, region)}{/if}
        {/snippet}
        <AgentAvatarStack
          items={anchor.badges.map((badge) => ({
            key: badge.id,
            agentId: badge.id,
            state: isWorking(badge) ? 'running' : 'idle',
          }))}
          maxVisible={anchor.badges.length}
          variant="card-stack"
          interactive
          itemContent={stackAvatar}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .semantic-map-avatar-anchor {
    contain: layout paint style;
    will-change: transform;
  }

  :global(.semantic-map-avatar-button--selected) {
    box-shadow:
      0 0 0 2px hsl(var(--background)),
      0 0 0 4px hsl(var(--primary));
  }
</style>
