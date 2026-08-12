<script lang="ts" module>
  type VisibilityCallback = (visible: boolean) => void;

  const callbacks = new WeakMap<Element, VisibilityCallback>();
  const observedElements = new Set<Element>();
  const heightCache = new Map<string, number>();
  let sharedObserver: IntersectionObserver | null = null;

  function observeVisibility(element: Element, callback: VisibilityCallback): () => void {
    if (typeof IntersectionObserver === 'undefined') {
      callback(true);
      return () => {};
    }

    sharedObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin: '100% 0px', threshold: 0 },
    );
    callbacks.set(element, callback);
    observedElements.add(element);
    sharedObserver.observe(element);

    return () => {
      callbacks.delete(element);
      observedElements.delete(element);
      sharedObserver?.unobserve(element);
      if (observedElements.size === 0) {
        sharedObserver?.disconnect();
        sharedObserver = null;
      }
    };
  }
</script>

<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';

  type Props = ComponentProps<typeof AgentCard> & {
    cacheKey: string;
    estimatedHeight?: number;
  };

  let { cacheKey, estimatedHeight = 48, ...agentCardProps }: Props = $props();
  let container = $state<HTMLDivElement | null>(null);
  let isVisible = $state(false);
  // svelte-ignore state_referenced_locally -- initial placeholder height is intentionally read once.
  let measuredHeight = $state(heightCache.get(cacheKey) ?? estimatedHeight);

  onMount(() => {
    if (!container) return;
    return observeVisibility(container, (visible) => {
      isVisible = visible;
    });
  });

  $effect(() => {
    if (!isVisible || !container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (!height || height === measuredHeight) return;
      measuredHeight = height;
      heightCache.set(cacheKey, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={container}
  data-lazy-agent-card={cacheKey}
  style:height={isVisible ? undefined : `${measuredHeight}px`}
  style:overflow={isVisible ? undefined : 'hidden'}
>
  {#if isVisible}
    <AgentCard {...agentCardProps} />
  {/if}
</div>
