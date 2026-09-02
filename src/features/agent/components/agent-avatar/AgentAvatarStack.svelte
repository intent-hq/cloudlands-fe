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

  const FALLBACK_OVERFLOW_TEXT_WIDTH = 20;
  const OVERFLOW_INLINE_PADDING = 12;
  let overflowMeasureContext: CanvasRenderingContext2D | null | undefined;
  let overflowFont: string | undefined;
  const overflowTextWidths = new Map<string, number>();
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { formatInteger } from '$lib/i18n/format';
  import AgentAvatarWithState from './AgentAvatarWithState.svelte';
  import { agentAvatarGeometry } from './avatar-size';
  import { computeAdaptiveVisibleCount, createDeferredWidthApplier } from './avatar-stack-fit';

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
  // Fed by the ResizeObserver but applied one animation frame later: the
  // observer's initial delivery lands inside the mount/reveal frame, so
  // consuming the width there (fit computation, overflow text measurement,
  // re-render) would extend that frame's long task. Until the deferred width
  // lands, the stack renders up to `maxVisible` items, clipped by the
  // container's `overflow: hidden`.
  let availableWidth: number | undefined = $state();
  const geometry = $derived(agentAvatarGeometry[variant]);
  const measuredVisibleCount = $derived(
    adaptive && availableWidth !== undefined
      ? computeAdaptiveVisibleCount({
          itemCount: items.length,
          maxVisible,
          availableWidth,
          surface: geometry.surface,
          overlap: geometry.overlap,
          overflowOverlap: geometry.overlap,
          measureOverflowText: (remaining) =>
            Math.max(geometry.surface, overflowTextWidth(remaining) + OVERFLOW_INLINE_PADDING),
        })
      : undefined,
  );
  const visibleCount = $derived(
    Math.min(
      items.length,
      Math.max(0, adaptive ? (measuredVisibleCount ?? maxVisible) : maxVisible),
    ),
  );
  const visibleItems = $derived(items.slice(0, visibleCount));
  const overflowCount = $derived(Math.max(0, items.length - visibleItems.length));
  const itemStep = $derived(geometry.surface - geometry.overlap);
  const trackWidth = $derived(
    visibleItems.length === 0 ? 0 : geometry.surface + (visibleItems.length - 1) * itemStep,
  );

  function overflowTextWidth(remaining: number): number {
    const text = `+${formatInteger(remaining)}`;
    const cached = overflowTextWidths.get(text);
    if (cached !== undefined) return cached;
    if (overflowMeasureContext === undefined) {
      overflowMeasureContext = document.createElement('canvas').getContext('2d');
    }
    if (!overflowMeasureContext || !rootElement) return FALLBACK_OVERFLOW_TEXT_WIDTH;
    overflowFont ??= `500 12px ${getComputedStyle(rootElement).fontFamily}`;
    overflowMeasureContext.font = overflowFont;
    const width = overflowMeasureContext.measureText(text).width;
    overflowTextWidths.set(text, width);
    return width;
  }

  $effect(() => {
    if (!adaptive || !rootElement || typeof ResizeObserver === 'undefined') return;
    const deferredWidth = createDeferredWidthApplier((width) => {
      availableWidth = width;
    });
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      deferredWidth.set(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(rootElement);
    return () => {
      observer.disconnect();
      deferredWidth.cancel();
    };
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
