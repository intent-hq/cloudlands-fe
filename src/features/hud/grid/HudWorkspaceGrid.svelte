<script lang="ts">
  /**
   * HUD center column — the auto-fill grid of square workspace cards (mock
   * lines 146-197) with the bottom fade gradient. The repo/status filter
   * menus live in the header (mock lines 47-95, `HudHeaderFilters`); the
   * shared selection is read from the hud slice. Cards come from
   * `selectHudWorkspaceCards`; per-workspace task and token rollups are
   * requested once per workspace id (the daemon-events bridge keeps them
   * fresh afterwards). A 1s ticker drives the elapsed timers.
   */
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import { cubicOut, quintOut } from 'svelte/easing';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectHudGridFilter,
    selectHudWorkspaceCards,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { fetchWorkspaceTokenUsage } from '$store/renderer/slices/token-usage/token-usage-slice';
  import HudWorkspaceCard from './HudWorkspaceCard.svelte';
  import { applyHudGridFilter } from './hud-grid-filter';
  import { watchReducedMotion } from '../right-column/hud-slide.svelte';

  const cards$ = selectHudWorkspaceCards();
  const filter$ = selectHudGridFilter();

  const reducedMotion = watchReducedMotion();

  let nowMs = $state(Date.now());

  const visibleCards = $derived(applyHudGridFilter($cards$, $filter$));

  // Mock `flipRoster` timings: entering cards scale in (420ms), leaving cards
  // scale out (260ms), the rest FLIP-slide into place (480ms, ~the mock's
  // cubic-bezier(0.16,1,0.3,1)). Reduced motion snaps (0ms).
  const flipDuration = $derived(reducedMotion.current ? 0 : 480);
  const enterDuration = $derived(reducedMotion.current ? 0 : 420);
  const leaveDuration = $derived(reducedMotion.current ? 0 : 260);

  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 1000);
    return () => {
      clearInterval(timer);
      reducedMotion.cleanup();
    };
  });

  // Request the per-workspace rollups the cards join in (task stats §5.4,
  // token usage §5.23) once per workspace id; both triggers are
  // dispatch-safely idempotent (ensure* no-ops when loaded/loading, the
  // read-service coalesces in-flight token fetches).
  const requested = new Set<string>();
  $effect(() => {
    for (const card of $cards$) {
      if (requested.has(card.workspaceId)) continue;
      requested.add(card.workspaceId);
      appStore.dispatch(ensureWorkspaceTasksLoaded(card.workspaceId));
      appStore.dispatch(fetchWorkspaceTokenUsage(card.workspaceId));
    }
  });
</script>

<div class="hud-ws-grid-root" data-testid="hud-ws-grid">
  <div class="hud-ws-grid-viewport">
    {#if visibleCards.length === 0}
      <div class="hud-ws-grid-empty">{m.hud_grid_empty_label()}</div>
    {:else}
      <div class="hud-ws-grid">
        {#each visibleCards as card (card.workspaceId)}
          <div
            class="hud-ws-grid-slot"
            animate:flip={{ duration: flipDuration, easing: quintOut }}
            in:scale={{ duration: enterDuration, start: 0.86, easing: quintOut }}
            out:scale={{ duration: leaveDuration, start: 0.88, easing: cubicOut }}
          >
            <HudWorkspaceCard {card} {nowMs} />
          </div>
        {/each}
      </div>
    {/if}
    <div class="hud-ws-grid-fade" aria-hidden="true"></div>
  </div>
</div>

<style>
  .hud-ws-grid-root {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    height: 100%;
  }
  .hud-ws-grid-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .hud-ws-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    grid-auto-rows: max-content;
    gap: 12px;
    height: 100%;
    align-content: start;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .hud-ws-grid::-webkit-scrollbar {
    display: none;
  }
  /* Roster-animation wrapper: the slot is the grid item; the card button
     fills it (its own aspect-ratio drives the square height). */
  .hud-ws-grid-slot {
    min-height: 0;
  }
  .hud-ws-grid-slot :global([data-testid='hud-ws-card']) {
    width: 100%;
  }
  .hud-ws-grid-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.18em;
    color: hsl(var(--text-ghost));
  }
  .hud-ws-grid-fade {
    position: absolute;
    left: -4px;
    right: -4px;
    bottom: 0;
    height: 120px;
    background: linear-gradient(180deg, transparent, hsl(var(--app-background)));
    pointer-events: none;
  }
</style>
