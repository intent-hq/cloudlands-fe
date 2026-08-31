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

  import { onMount, tick, type Snippet } from 'svelte';

  import { WIDTH_TOLERANCE_PX, type LazyTurnHeightCache } from './lazy-turn-height-cache';
  import { observeLazyTurnVisibility } from './lazy-turn-observer';
  import { createHeightLedger, snapshotScroller } from './lazy-turn-scroll-ledger';
  import type { MessageHydrationPolicy } from './message-hydration-policy';

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
    /** Panel-scoped, bounded, width-aware height cache. */
    heightCache: LazyTurnHeightCache;
    /** Optional transcript-level controller for message-granular hydration. */
    hydrationController?: MessageHydrationPolicy;
    /** Controller-owned hydration decision for this row. */
    hydrated?: boolean;
    /** Placeholder height before the first measurement (row-type specific). */
    estimatedHeight?: number;
    /** The content to render */
    children: Snippet;
  }

  let {
    turnKey,
    forceVisible = false,
    scrollRoot = null,
    heightCache,
    hydrationController,
    hydrated,
    estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
    children,
  }: Props = $props();

  let containerRef = $state<HTMLDivElement>();

  /** Wrap width this instance measures at; null until the DOM exists. */
  let measuredWidth: number | null = null;

  // PERF: Start invisible with placeholder - this prevents rendering ALL turns on initial load
  // The IntersectionObserver will mark visible turns when they enter the viewport
  // CRITICAL FIX: Previously this started visible when no cache, causing all turns to render initially
  // The init-time read cannot know this instance's width yet (no DOM) —
  // onMount re-validates it against the real width before it can matter.
  // svelte-ignore state_referenced_locally -- intentional one-shot cache read for the initial turnKey.
  const initialCachedHeight = heightCache.get(turnKey, null);
  // svelte-ignore state_referenced_locally -- initial seed only; shouldRenderContent tracks forceVisible reactively.
  // svelte-ignore state_referenced_locally -- initial seed only; reactive changes are handled below.
  let isVisible = $state(forceVisible || hydrated === true);
  let hasBeenMeasured = $state(initialCachedHeight !== undefined);
  let isIntersecting = $state(true);

  // PERF: Local copy of cached height to avoid reactive dependency on Map
  // Updated manually when we measure or when we become visible
  let localCachedHeight = $state<number | null>(initialCachedHeight ?? null);

  // Should render content?
  // PERF: Only render if forceVisible OR isVisible (IntersectionObserver said we're in view)
  // Previously had fallbacks that caused all items to render initially
  let shouldRenderContent = $derived(forceVisible || isVisible);
  let shouldStayVisible = $derived(
    forceVisible || (hydrationController ? hydrated === true : isIntersecting),
  );

  // A row can mount as force-visible and age out of that window without a new
  // intersection notification. In message mode the transcript-level policy
  // owns the asymmetric frontier; in legacy mode use the last observer state.
  $effect(() => {
    if (shouldStayVisible) {
      cancelPendingSwapOut();
      setVisibleWithScrollCompensation(true);
    } else if (hasBeenMeasured && localCachedHeight !== null) {
      requestSwapOut();
    }
  });

  // Swap-out settle window: while follow-bottom re-pins the scroller every
  // streaming frame, a turn sitting at the IntersectionObserver boundary
  // (rootMargin '100% 0px') can be reported alternately inside/outside on
  // consecutive frames. Swapping out immediately on each notification turns
  // that jitter into a per-frame content↔placeholder DOM swap (60fps
  // flicker). Instead every swap-out is deferred through this window and a
  // re-entry cancels it, so only a turn that stays out of the extended
  // viewport actually swaps. Swap-ins remain immediate. The window also
  // exceeds the ResizeObserver debounce (50ms), so a deferred swap-out uses
  // a freshly recorded content height and stays geometry-neutral.
  const SWAP_OUT_SETTLE_MS = 250;
  let swapOutTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingSwapOut() {
    if (swapOutTimer !== null) {
      clearTimeout(swapOutTimer);
      swapOutTimer = null;
    }
  }

  function requestSwapOut() {
    if (swapOutTimer !== null) return;
    swapOutTimer = setTimeout(() => {
      swapOutTimer = null;
      // Conditions re-checked at fire time: the turn may have re-entered,
      // re-entered the force-visible window, or lost its measurement.
      if (!shouldStayVisible && hasBeenMeasured && localCachedHeight !== null) {
        setVisibleWithScrollCompensation(false);
      }
    }, SWAP_OUT_SETTLE_MS);
  }

  // Height ledger — fallback compensation for height changes above the reader
  // when native scroll anchoring is unavailable. It yields to native anchoring
  // while the reader is unlocked; see lazy-turn-scroll-ledger.ts.
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
    void tick().then(() => ledger.request(preSwap));
  }

  onMount(() => {
    if (!containerRef) return;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let initialMeasureAnimationFrame: number | null = null;
    let initialMeasureTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const mountedContainer = containerRef;
    const mountedTurnKey = turnKey;

    // Observer ownership is shared per scroll root, so a long transcript does
    // not allocate one IntersectionObserver for every turn.
    const stopObserving = hydrationController
      ? hydrationController.observe(turnKey, containerRef, scrollRoot)
      : observeLazyTurnVisibility(containerRef, scrollRoot, (next) => {
          isIntersecting = next;
          if (next) {
            // Re-entry cancels any pending swap-out (boundary jitter must not
            // mature into a swap while the turn keeps touching the viewport).
            cancelPendingSwapOut();
            const cached = heightCache.get(turnKey, measuredWidth);
            if (cached !== undefined && cached !== localCachedHeight) localCachedHeight = cached;
            setVisibleWithScrollCompensation(true);
          } else if (!forceVisible && hasBeenMeasured && localCachedHeight !== null) {
            requestSwapOut();
          }
        });

    // PERF: Set up ResizeObserver with debouncing to batch height updates
    // This prevents rapid-fire updates during streaming or animations
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      // Coalesce same-frame swap and resize notifications. The shared ledger
      // batch measures every affected turn before applying scroll writes.
      ledger.request();

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
          const validated = heightCache.get(turnKey, observedWidth) ?? null;
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
            heightCache.set(turnKey, height, measuredWidth);
          }
          localCachedHeight = height;
          hasBeenMeasured = true;
          if (!shouldStayVisible) requestSwapOut();
          resizeDebounceTimer = null;
        }, 50); // 50ms debounce
      }
    });

    resizeObserver.observe(containerRef);

    // Mark as measured after initial render (with debounce)
    initialMeasureAnimationFrame = requestAnimationFrame(() => {
      initialMeasureAnimationFrame = null;
      if (!disposed && containerRef === mountedContainer && turnKey === mountedTurnKey) {
        const height = mountedContainer.offsetHeight;
        const width = mountedContainer.offsetWidth;
        if (height > 0) {
          // Use timeout to batch with other measurements
          initialMeasureTimer = setTimeout(() => {
            initialMeasureTimer = null;
            if (disposed || containerRef !== mountedContainer || turnKey !== mountedTurnKey) return;
            if (width > 0) {
              measuredWidth ??= width;
              heightCache.set(mountedTurnKey, height, width);
            }
            localCachedHeight = height;
            hasBeenMeasured = true;
            if (!shouldStayVisible) requestSwapOut();
          }, 0);
        }
      }
    });

    return () => {
      disposed = true;
      ledger.cancel();
      stopObserving();
      cancelPendingSwapOut();
      resizeObserver?.disconnect();
      if (initialMeasureAnimationFrame !== null) {
        cancelAnimationFrame(initialMeasureAnimationFrame);
      }
      if (initialMeasureTimer !== null) {
        clearTimeout(initialMeasureTimer);
      }
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
    };
  });

  // PERF: Compute placeholder height - use cached or estimated default
  let placeholderHeight = $derived(localCachedHeight ?? estimatedHeight);
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
