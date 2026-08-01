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

  const cards$ = selectHudWorkspaceCards();
  const filter$ = selectHudGridFilter();

  let nowMs = $state(Date.now());

  const visibleCards = $derived(applyHudGridFilter($cards$, $filter$));

  onMount(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 1000);
    return () => clearInterval(timer);
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
          <HudWorkspaceCard {card} {nowMs} />
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
