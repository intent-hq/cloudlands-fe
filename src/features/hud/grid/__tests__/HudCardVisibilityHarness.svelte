<script lang="ts">
  /**
   * Real-browser harness for `createCardVisibilityGate`, used by
   * `hud-card-visibility.ct.spec.ts`.
   *
   * It reproduces the shape that makes the gate's root choice matter: a
   * fixed-height `overflow-y: auto` scroller whose children are the observed
   * card slots, exactly like `.hud-ws-grid` and its `.hud-ws-grid-slot`
   * children. Chromium's own `IntersectionObserver` then decides what
   * intersects, so the preload margin is measured rather than asserted.
   *
   * This cannot be done under vitest: jsdom implements no layout (every
   * `getBoundingClientRect` is zero) and no `IntersectionObserver` — the unit
   * suite stubs it — so a jsdom test can only check how the observer was
   * configured, never that the margin is live.
   */
  import { createCardVisibilityGate } from '../hud-card-visibility';

  interface Props {
    /** Scroller height; cards past this are below the fold. */
    viewportHeight?: number;
    /** Height of each card slot. */
    cardHeight?: number;
    /** How many cards to render. */
    count?: number;
  }

  let { viewportHeight = 300, cardHeight = 100, count = 12 }: Props = $props();

  let scroller = $state<HTMLDivElement | undefined>();
  let seen = $state<string[]>([]);

  const gate = createCardVisibilityGate((workspaceId) => {
    if (!seen.includes(workspaceId)) seen = [...seen, workspaceId];
  });
  const observeCard = gate.observe;

  $effect(() => gate.setRoot(scroller ?? null));

  const ids = $derived(Array.from({ length: count }, (_, index) => `ws-${index}`));
</script>

<!-- Mirrors `.hud-ws-grid`: the element that actually clips the cards. -->
<div
  class="scroller"
  data-testid="scroller"
  bind:this={scroller}
  style="height: {viewportHeight}px"
>
  {#each ids as id (id)}
    <div class="slot" data-testid={id} use:observeCard={id} style="height: {cardHeight}px">
      {id}
    </div>
  {/each}
</div>

<!-- Workspace ids the gate has reported, in the order it reported them. -->
<div data-testid="seen">{seen.join(',')}</div>

<style>
  .scroller {
    overflow-y: auto;
    width: 200px;
  }
  .slot {
    box-sizing: border-box;
    border: 1px solid #ccc;
  }
</style>
