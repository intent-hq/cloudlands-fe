<script lang="ts">
  /**
   * LazyTurn - Performance optimization for large conversations
   *
   * Uses IntersectionObserver to defer rendering of off-screen conversation turns.
   * When a turn scrolls out of view, it's replaced with a height-preserving placeholder.
   * When it scrolls back into view, the full content is rendered.
   *
   * This significantly reduces DOM nodes and memory usage for long conversations
   * while maintaining smooth scrolling and correct scroll positions.
   *
   * PERF: Critical optimizations to avoid layout thrashing:
   * 1. Uses plain Map (not SvelteMap) to avoid O(n²) reactive updates when heights change
   * 2. Starts invisible with estimated height to avoid initial render of all turns
   * 3. Uses IntersectionObserver to only render visible turns
   * 4. Debounces ResizeObserver callbacks to batch height updates
   *
   * @example
   * ```svelte
   * <LazyTurn turnKey={turn.userMessage?.id ?? `turn-${index}`} {scrollRoot} forceVisible={isLastTurn}>
   *   {#snippet children()}
   *     <ChatMessage ... />
   *   {/snippet}
   * </LazyTurn>
   * ```
   */

  import {
  onMount,
  tick,
  type Snippet,
} from 'svelte';

  import {
    getTurnHeightCache,
    readCachedHeight,
    WIDTH_TOLERANCE_PX,
    writeCachedHeight,
  } from './lazy-turn-height-cache';
  import { createHeightLedger, snapshotScroller } from './lazy-turn-scroll-ledger';

  // PERF: Default estimated height for turns that haven't been measured yet
  // This allows us to start with placeholders instead of rendering all content
  const DEFAULT_ESTIMATED_HEIGHT = 200;

  interface Props {
    /** Unique key for this turn (used for height cache) */
    turnKey: string;
    /** Force this turn to always be visible (for streaming, last N turns) */
    forceVisible?: boolean;
    /** The scroll container element (for IntersectionObserver root) */
    scrollRoot?: HTMLElement | null;
    /** The content to render */
    children: Snippet;
  }

  let { turnKey, forceVisible = false, scrollRoot = null, children }: Props = $props();

  // PERF: Module-level width-validated height cache using a plain Map (NOT
  // SvelteMap! — O(n²) reactivity; see lazy-turn-height-cache.ts). Entries
  // carry the wrap width they were measured at and reads validate it: stale
  // widths are what fabricate phantom space at the bottom of the chat, and
  // per-entry validation stays correct across panel remounts and multiple
  // panels at different widths (a per-scroller clear stamp does not).
  const heightCache = getTurnHeightCache();

  let containerRef = $state<HTMLDivElement>();

  /** Wrap width this instance measures at; null until the DOM exists. */
  let measuredWidth: number | null = null;

  // PERF: Start invisible with placeholder - this prevents rendering ALL turns on initial load
  // The IntersectionObserver will mark visible turns when they enter the viewport
  // CRITICAL FIX: Previously this started visible when no cache, causing all turns to render initially
  // The init-time read cannot know this instance's width yet (no DOM) —
  // onMount re-validates it against the real width before it can matter.
  // svelte-ignore state_referenced_locally -- intentional one-shot cache read for the initial turnKey.
  const initialCachedHeight = readCachedHeight(heightCache, turnKey, null);
  // svelte-ignore state_referenced_locally -- initial seed only; shouldRenderContent tracks forceVisible reactively.
  let isVisible = $state(forceVisible); // Only start visible if forceVisible
  let hasBeenMeasured = $state(initialCachedHeight !== null);

  // PERF: Local copy of cached height to avoid reactive dependency on Map
  // Updated manually when we measure or when we become visible
  let localCachedHeight = $state<number | null>(initialCachedHeight);

  // Should render content?
  // PERF: Only render if forceVisible OR isVisible (IntersectionObserver said we're in view)
  // Previously had fallbacks that caused all items to render initially
  let shouldRenderContent = $derived(forceVisible || isVisible);

  // Height ledger — scroll compensation for ALL height changes of this turn
  // while it sits above the reader's viewport (native scroll anchoring is off
  // on the chat scroller; see lazy-turn-scroll-ledger.ts for the full story).
  // account() runs after every swap flush AND every ResizeObserver fire;
  // whoever runs first consumes the delta, so the paths never
  // double-compensate.
  const ledger = createHeightLedger(
    () => scrollRoot,
    () => containerRef,
  );

  function setVisibleWithScrollCompensation(next: boolean) {
    if (isVisible === next) return;
    // Snapshot the scroller BEFORE the swap flushes: when the swap shrinks
    // scrollHeight (stale overestimated placeholder collapsing to real
    // content), the browser clamps scrollTop natively at flush time — the
    // snapshot lets the ledger preserve the reader's distance-from-bottom
    // through that clamp instead of double-shifting (bottom snap-back).
    const preSwap = snapshotScroller(scrollRoot);
    isVisible = next;
    void tick().then(() => ledger.account(preSwap));
  }

  onMount(() => {
    if (!containerRef) return;

    // Skip observers for force-visible turns
    if (forceVisible) {
      hasBeenMeasured = true;
      return;
    }

    let intersectionObserver: IntersectionObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Set up IntersectionObserver for visibility detection
    // PERF: Use smaller rootMargin (50% = half viewport) to reduce rendered elements
    // Previously 200% was causing too many elements to render at once
    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting) {
          // Refresh local cache in case it was updated by another instance
          const cached = readCachedHeight(heightCache, turnKey, measuredWidth);
          if (cached !== null && cached !== localCachedHeight) {
            localCachedHeight = cached;
          }
          setVisibleWithScrollCompensation(true);
        } else if (hasBeenMeasured && localCachedHeight !== null) {
          // Only hide if we have a cached height to use for placeholder
          setVisibleWithScrollCompensation(false);
        }
      },
      {
        root: scrollRoot,
        rootMargin: '50% 0px', // PERF: Reduced from 200% - render half viewport above/below
        threshold: 0,
      },
    );

    intersectionObserver.observe(containerRef);

    // PERF: Set up ResizeObserver with debouncing to batch height updates
    // This prevents rapid-fire updates during streaming or animations
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // Ledger first (synchronous, no debounce): any height change of a turn
      // fully above the viewport must be compensated in the same frame, or
      // the visible transcript jumps (overflow-anchor is off).
      // For the swap itself this fire is always second — the tick() microtask
      // in setVisibleWithScrollCompensation consumes the swap delta before RO
      // delivery — so here account() sees delta === 0 for the flush and its
      // real job is the late settles (images, remounted blocks, re-wraps).
      ledger.account();

      // Width validation: cached heights are wrap-width-dependent, so the
      // first fire (init-time read was unvalidated — width unknown) and
      // every live width change re-validate the local placeholder height
      // against the cache at the observed width. A stale-width height is
      // dropped (placeholder falls back to the default estimate); the
      // resulting height change is a normal above-viewport settle the
      // ledger compensates on the next fire.
      const observedWidth = entry.contentRect.width;
      if (
        observedWidth > 0 &&
        (measuredWidth === null || Math.abs(measuredWidth - observedWidth) > WIDTH_TOLERANCE_PX)
      ) {
        measuredWidth = observedWidth;
        if (!shouldRenderContent) {
          const validated = readCachedHeight(heightCache, turnKey, observedWidth);
          if (validated !== localCachedHeight) {
            localCachedHeight = validated;
            hasBeenMeasured = validated !== null;
          }
        }
      }

      if (!shouldRenderContent) return;

      const height = entry.contentRect.height;
      if (height > 0) {
        // Debounce height updates to avoid layout thrashing
        if (resizeDebounceTimer) {
          clearTimeout(resizeDebounceTimer);
        }
        resizeDebounceTimer = setTimeout(() => {
          if (measuredWidth !== null) {
            writeCachedHeight(heightCache, turnKey, height, measuredWidth);
          }
          localCachedHeight = height;
          hasBeenMeasured = true;
          resizeDebounceTimer = null;
        }, 50); // 50ms debounce
      }
    });

    resizeObserver.observe(containerRef);

    // Mark as measured after initial render (with debounce)
    requestAnimationFrame(() => {
      if (containerRef) {
        const height = containerRef.offsetHeight;
        const width = containerRef.offsetWidth;
        if (height > 0) {
          // Use timeout to batch with other measurements
          setTimeout(() => {
            if (width > 0) {
              measuredWidth ??= width;
              writeCachedHeight(heightCache, turnKey, height, width);
            }
            localCachedHeight = height;
            hasBeenMeasured = true;
          }, 0);
        }
      }
    });

    return () => {
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
    };
  });

  // PERF: Compute placeholder height - use cached or estimated default
  let placeholderHeight = $derived(localCachedHeight ?? DEFAULT_ESTIMATED_HEIGHT);
</script>

<div
  bind:this={containerRef}
  class="lazy-turn"
  data-lazy-turn-key={turnKey}
  data-lazy-visible={shouldRenderContent}
>
  {#if shouldRenderContent}
    {@render children()}
  {:else}
    <!-- PERF: Placeholder with cached or estimated height - avoids rendering heavy content -->
    <div
      class="lazy-turn-placeholder"
      style="height: {placeholderHeight}px;"
      aria-hidden="true"
    ></div>
  {/if}
</div>

<style>
  .lazy-turn {
    /* Block display for proper height measurement and IntersectionObserver */
    display: block;
    /*
     * NOTE: Removed content-visibility: auto because it can cause scroll jumps
     * when the browser decides to skip rendering and changes layout unpredictably.
     * The IntersectionObserver-based lazy loading handles this more reliably.
     */
  }

  .lazy-turn-placeholder {
    /* Minimal styling - just preserve height */
    flex-shrink: 0;
    pointer-events: none;
  }
</style>
