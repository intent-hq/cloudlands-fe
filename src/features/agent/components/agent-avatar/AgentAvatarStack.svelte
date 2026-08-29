<script lang="ts" module>
  import type { AvatarState } from './avatar-state';
  import type { AgentAvatarVariant } from './avatar-size';

  export interface AgentAvatarStackItem {
    key: string;
    agentId: string;
    specialist?: string | null;
    /** Specialist `icon` metadata; takes precedence over the specialist-id map when valid. */
    icon?: string | null;
    state?: AvatarState;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount, tick } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import AgentAvatarWithState from './AgentAvatarWithState.svelte';
  import { agentAvatarGeometry } from './avatar-size';

  interface Props {
    items: AgentAvatarStackItem[];
    maxVisible?: number;
    adaptive?: boolean;
    align?: 'start' | 'end';
    variant?: AgentAvatarVariant;
    interactive?: boolean;
    overflowId?: string;
    overflowTestId?: string;
    itemContent?: Snippet<[AgentAvatarStackItem]>;
    class?: string;
  }

  let {
    items,
    maxVisible = 3,
    adaptive = false,
    align = 'end',
    variant = 'card-stack',
    interactive = false,
    overflowId,
    overflowTestId,
    itemContent,
    class: className = '',
  }: Props = $props();
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
  const geometry = $derived(agentAvatarGeometry[variant]);
  const itemStep = $derived(geometry.surface - geometry.overlap);
  const trackWidth = $derived(
    visibleItems.length === 0 ? 0 : geometry.surface + (visibleItems.length - 1) * itemStep,
  );
  const OVERFLOW_INLINE_PADDING = 12;

  function overflowTextWidth(remaining: number, style: CSSStyleDeclaration): number {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 20;
    context.font = `500 12px ${style.fontFamily}`;
    return context.measureText(`+${formatInteger(remaining)}`).width;
  }

  function updateVisibleCount() {
    if (!adaptive || !rootElement) return;
    const availableWidth = rootElement.clientWidth;
    if (availableWidth <= 0) {
      measuredVisibleCount = rootElement.getClientRects().length > 0 ? 0 : undefined;
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
      const overflowWidth = Math.max(
        surface,
        overflowTextWidth(remaining, style) + OVERFLOW_INLINE_PADDING,
      );
      const requiredWidth =
        avatarsWidth(count) + (remaining > 0 ? overflowWidth - (count > 0 ? overlap : 0) : 0);
      if (requiredWidth <= availableWidth) {
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
    variant;
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
  class:agent-avatar-stack--start={align === 'start'}
  data-agent-avatar-stack
  data-agent-avatar-stack-align={align}
  data-agent-avatar-stack-overlap="later-on-top"
  data-avatar-variant={variant}
  data-agent-avatar-stack-clear-space={geometry.ring}
  aria-hidden={!interactive && !overflowId ? 'true' : undefined}
>
  {#if visibleItems.length > 0}
    <span class="agent-avatar-stack-track" style:width={`${trackWidth}px`}>
      {#each visibleItems as item, index (item.key)}
        <span
          class="agent-avatar-stack-item"
          class:agent-avatar-stack-item--before-overflow={overflowCount > 0 &&
            index === visibleItems.length - 1}
          style={`inset-inline-start: ${index * itemStep}px; z-index: ${index + 1};`}
          data-agent-avatar-stack-item
          data-agent-avatar-stack-index={index}
          data-agent-avatar-stack-key={item.key}
          data-agent-avatar-stack-agent-id={item.agentId}
          data-agent-avatar-stack-specialist={item.specialist ?? undefined}
          aria-hidden={!interactive ? 'true' : undefined}
        >
          {#if itemContent}
            {@render itemContent(item)}
          {:else}
            <AgentAvatarWithState
              agentId={item.agentId}
              specialist={item.specialist}
              icon={item.icon}
              state={item.state ?? 'idle'}
              {variant}
              class="agent-avatar-stack-surface"
            />
          {/if}
        </span>
      {/each}
    </span>
  {/if}
  {#if overflowCount > 0}
    <span
      id={overflowId}
      class="agent-avatar-stack-overflow"
      style={`margin-inline-start: ${visibleItems.length > 0 ? -geometry.overlap : 0}px; z-index: ${visibleItems.length + 1};`}
      data-agent-avatar-overflow
      data-testid={overflowTestId}
    >
      +{formatInteger(overflowCount)}
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
    gap: 0;
    height: var(--agent-avatar-surface-size);
    line-height: 1;
  }

  .agent-avatar-stack--adaptive {
    width: auto;
    min-width: 0;
    flex: 1 1 0;
    justify-content: flex-end;
    overflow: hidden;
  }

  .agent-avatar-stack--start {
    justify-content: flex-start;
  }

  .agent-avatar-stack-track {
    position: relative;
    display: inline-flex;
    height: var(--agent-avatar-surface-size);
    flex: none;
  }

  .agent-avatar-stack-item {
    position: absolute;
    inset-block-start: 0;
    display: inline-flex;
    width: var(--agent-avatar-surface-size);
    height: var(--agent-avatar-surface-size);
    flex: none;
    border-radius: var(--agent-avatar-corner-radius);
  }

  .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack-item--before-overflow {
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: 100% 100%;
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: 100% 100%;
  }

  .agent-avatar-stack[data-avatar-variant='compact'] .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack[data-avatar-variant='compact'] .agent-avatar-stack-item--before-overflow {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='16' height='16' fill='white'/%3E%3Crect x='11' y='-1' width='18' height='18' rx='6' fill='black'/%3E%3C/mask%3E%3Crect width='16' height='16' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='16' height='16' fill='white'/%3E%3Crect x='11' y='-1' width='18' height='18' rx='6' fill='black'/%3E%3C/mask%3E%3Crect width='16' height='16' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
  }

  .agent-avatar-stack[data-avatar-variant='standard'] .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack[data-avatar-variant='standard'] .agent-avatar-stack-item--before-overflow {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='20' height='20' fill='white'/%3E%3Crect x='14' y='-1' width='22' height='22' rx='7' fill='black'/%3E%3C/mask%3E%3Crect width='20' height='20' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='20' height='20' fill='white'/%3E%3Crect x='14' y='-1' width='22' height='22' rx='7' fill='black'/%3E%3C/mask%3E%3Crect width='20' height='20' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
  }

  .agent-avatar-stack[data-avatar-variant='emphasized'] .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack[data-avatar-variant='emphasized'] .agent-avatar-stack-item--before-overflow,
  .agent-avatar-stack[data-avatar-variant='card-stack'] .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack[data-avatar-variant='card-stack'] .agent-avatar-stack-item--before-overflow {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='24' height='24' fill='white'/%3E%3Crect x='17' y='-1' width='26' height='26' rx='8' fill='black'/%3E%3C/mask%3E%3Crect width='24' height='24' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='24' height='24' fill='white'/%3E%3Crect x='17' y='-1' width='26' height='26' rx='8' fill='black'/%3E%3C/mask%3E%3Crect width='24' height='24' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
  }

  .agent-avatar-stack[data-avatar-variant='prominent'] .agent-avatar-stack-item:not(:last-child),
  .agent-avatar-stack[data-avatar-variant='prominent'] .agent-avatar-stack-item--before-overflow {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='40' height='40' fill='white'/%3E%3Crect x='30' y='-2' width='44' height='44' rx='14' fill='black'/%3E%3C/mask%3E%3Crect width='40' height='40' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40' preserveAspectRatio='none'%3E%3Cmask id='c'%3E%3Crect width='40' height='40' fill='white'/%3E%3Crect x='30' y='-2' width='44' height='44' rx='14' fill='black'/%3E%3C/mask%3E%3Crect width='40' height='40' fill='white' mask='url(%23c)'/%3E%3C/svg%3E");
  }

  .agent-avatar-stack-overflow {
    display: inline-flex;
    width: max-content;
    min-width: var(--agent-avatar-surface-size);
    height: var(--agent-avatar-surface-size);
    box-sizing: border-box;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--agent-avatar-corner-radius);
    background: hsl(var(--muted));
    box-shadow: none;
    color: hsl(var(--muted-foreground));
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
    padding-inline: 0.375rem;
  }
</style>
