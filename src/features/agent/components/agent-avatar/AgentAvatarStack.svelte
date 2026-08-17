<script lang="ts" module>
  import type { AvatarState } from './avatar-state';

  export interface AgentAvatarStackItem {
    key: string;
    agentId: string;
    specialist?: string | null;
    state?: AvatarState;
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AgentAvatarWithState from './AgentAvatarWithState.svelte';

  interface Props {
    items: AgentAvatarStackItem[];
    maxVisible?: number;
    adaptive?: boolean;
    class?: string;
  }

  let { items, maxVisible = 3, adaptive = false, class: className = '' }: Props = $props();
  let rootElement: HTMLElement | undefined = $state();
  let measuredVisibleCount: number | undefined = $state();
  const visibleCount = $derived(
    Math.min(
      items.length,
      Math.max(0, adaptive ? (measuredVisibleCount ?? maxVisible) : maxVisible),
    ),
  );
  const visibleItems = $derived(items.slice(0, visibleCount));
  const overflowCount = $derived(Math.max(0, items.length - visibleItems.length));

  function overflowTextWidth(remaining: number, style: CSSStyleDeclaration): number {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 20;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return context.measureText(`+${remaining}`).width + 4;
  }

  function updateVisibleCount() {
    if (!adaptive || !rootElement) return;
    const availableWidth = rootElement.clientWidth;
    if (availableWidth <= 0) {
      measuredVisibleCount = 0;
      return;
    }
    const style = getComputedStyle(rootElement);
    const surface = Number.parseFloat(style.getPropertyValue('--agent-avatar-surface-size')) || 24;
    const overlap = Number.parseFloat(style.getPropertyValue('--agent-avatar-stack-overlap')) || 6;
    const step = surface - overlap;
    const cap = Math.min(items.length, Math.max(0, maxVisible));
    const avatarsWidth = (count: number) => (count === 0 ? 0 : surface + (count - 1) * step);

    if (items.length <= cap && avatarsWidth(items.length) <= availableWidth) {
      measuredVisibleCount = items.length;
      return;
    }
    for (let count = cap; count >= 0; count -= 1) {
      const remaining = items.length - count;
      if (avatarsWidth(count) + overflowTextWidth(remaining, style) <= availableWidth) {
        measuredVisibleCount = count;
        return;
      }
    }
    measuredVisibleCount = 0;
  }

  $effect(() => {
    items.length;
    maxVisible;
    adaptive;
    void tick().then(updateVisibleCount);
  });

  onMount(() => {
    if (!adaptive || !rootElement || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateVisibleCount);
    observer.observe(rootElement);
    updateVisibleCount();
    return () => observer.disconnect();
  });
</script>

<span
  bind:this={rootElement}
  class="agent-avatar-stack {className}"
  class:agent-avatar-stack--adaptive={adaptive}
  data-agent-avatar-stack
  data-avatar-variant="card-stack"
  aria-hidden="true"
>
  {#each visibleItems as item, index (item.key)}
    <span
      class="agent-avatar-stack-item"
      style:z-index={visibleItems.length - index}
      data-agent-avatar-stack-item
    >
      <AgentAvatarWithState
        agentId={item.agentId}
        specialist={item.specialist}
        state={item.state ?? 'idle'}
        variant="card-stack"
        class="agent-avatar-stack-surface"
      />
    </span>
  {/each}
  {#if overflowCount > 0}
    <span class="agent-avatar-stack-overflow" data-agent-avatar-overflow>
      +{overflowCount}
    </span>
  {/if}
</span>

<style>
  .agent-avatar-stack {
    display: inline-flex;
    width: max-content;
    min-width: 0;
    flex: none;
    align-items: center;
    height: var(--agent-avatar-surface-size);
    line-height: 1;
  }

  .agent-avatar-stack--adaptive {
    width: auto;
    min-width: 1.5rem;
    flex: 1 1 0;
    justify-content: flex-end;
    overflow: hidden;
  }

  .agent-avatar-stack-item {
    position: relative;
    display: inline-flex;
    width: var(--agent-avatar-surface-size);
    height: var(--agent-avatar-surface-size);
    flex: none;
    border-radius: var(--agent-avatar-corner-radius);
  }

  .agent-avatar-stack-item + .agent-avatar-stack-item {
    margin-inline-start: calc(-1 * var(--agent-avatar-stack-overlap));
  }

  .agent-avatar-stack-item:not(:first-child) {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' preserveAspectRatio='none'%3E%3Cmask id='cutout'%3E%3Crect width='24' height='24' fill='white'/%3E%3Crect x='-17.5' y='.5' width='23' height='23' rx='6.5' fill='black'/%3E%3C/mask%3E%3Crect width='24' height='24' fill='white' mask='url(%23cutout)'/%3E%3C/svg%3E");
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: 100% 100%;
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' preserveAspectRatio='none'%3E%3Cmask id='cutout'%3E%3Crect width='24' height='24' fill='white'/%3E%3Crect x='-17.5' y='.5' width='23' height='23' rx='6.5' fill='black'/%3E%3C/mask%3E%3Crect width='24' height='24' fill='white' mask='url(%23cutout)'/%3E%3C/svg%3E");
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: 100% 100%;
  }

  .agent-avatar-stack-overflow {
    display: inline-flex;
    width: max-content;
    height: var(--agent-avatar-surface-size);
    flex: none;
    align-items: center;
    justify-content: center;
    margin-inline-start: 0.25rem;
    border: 0;
    background: transparent;
    box-shadow: none;
    color: hsl(var(--muted-foreground));
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1;
  }
</style>
