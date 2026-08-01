<script lang="ts">
  /**
   * Header FLEET OPS repo + multi-select status filter menus (mock lines
   * 47-95) — moved out of the grid area to the header per the mock. The
   * selection lives in the hud slice (`gridFilter`) so the center grid
   * filters off the same state.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectHudGridFilter,
    selectHudWorkspaceCards,
  } from '$store/renderer/slices/hud/hud-selectors';
  import {
    hudGridFilterRepoPicked,
    hudGridFilterStatesCleared,
    hudGridFilterStateToggled,
  } from '$store/renderer/slices/hud/hud-slice';
  import { HUD_CARD_STATE_KEYS, type HudCardStateKey } from '$store/renderer/slices/hud/hud-types';
  import { cardStateColor, cardStateLabel } from '../grid/hud-card-meta';
  import { repoOptions, stateCounts } from '../grid/hud-grid-filter';

  const cards$ = selectHudWorkspaceCards();
  const filter$ = selectHudGridFilter();

  let repoMenuOpen = $state(false);
  let stateMenuOpen = $state(false);

  const repos = $derived(repoOptions($cards$));
  const counts = $derived(stateCounts($cards$));
  const repoLabel = $derived($filter$.repo ?? m.hud_filter_allWorkspaces_label());
  const stateLabel = $derived(
    $filter$.states.length === 0
      ? m.hud_filter_allStatuses_label()
      : $filter$.states.map((state) => cardStateLabel(state)).join(' · '),
  );

  /** Mock's repoColor: stable oklch hue chip per repo ref. */
  function repoColor(repo: string): string {
    let hash = 0;
    for (let i = 0; i < repo.length; i++) hash = (hash * 31 + repo.charCodeAt(i)) | 0;
    return `oklch(0.55 0.09 ${Math.abs(hash) % 360} / 0.45)`;
  }

  function closeMenus() {
    repoMenuOpen = false;
    stateMenuOpen = false;
  }
  function pickRepo(repo: string | null) {
    appStore.dispatch(hudGridFilterRepoPicked(repo));
    closeMenus();
  }
  function toggleState(stateKey: HudCardStateKey) {
    appStore.dispatch(hudGridFilterStateToggled(stateKey));
  }
  function clearStates() {
    appStore.dispatch(hudGridFilterStatesCleared());
  }
</script>

<svelte:window onclick={closeMenus} />

<div class="hud-header-filters" data-testid="hud-header-filters">
  <div class="hud-header-filter">
    <button
      class="hud-header-filter-btn"
      aria-label={m.hud_filter_repoMenu_ariaLabel()}
      aria-expanded={repoMenuOpen}
      onclick={(event) => {
        event.stopPropagation();
        stateMenuOpen = false;
        repoMenuOpen = !repoMenuOpen;
      }}
    >
      <span class="hud-header-filter-prefix">{m.hud_header_fleetOps_label()}</span>
      <span class="hud-header-filter-sep"></span>
      {#if $filter$.repo}
        <span class="hud-header-filter-avatar" style:background={repoColor($filter$.repo)}>
          {$filter$.repo[0].toUpperCase()}
        </span>
      {/if}
      <span class="hud-header-filter-label">{repoLabel}</span>
      <!-- i18n-ignore (glyph) -->
      <span class="hud-header-filter-caret">▼</span>
    </button>
    {#if repoMenuOpen}
      <div class="hud-header-menu" role="menu">
        <button class="hud-header-menu-row" role="menuitem" onclick={() => pickRepo(null)}>
          <!-- i18n-ignore (glyph) -->
          <span class="hud-header-menu-avatar hud-header-menu-avatar-all">∗</span>
          <span class="hud-header-menu-name">{m.hud_filter_allWorkspaces_label()}</span>
          <span class="hud-header-menu-count">{$cards$.length}</span>
        </button>
        <div class="hud-header-menu-sep"></div>
        {#each repos as option (option.repo)}
          <button
            class="hud-header-menu-row"
            class:hud-header-menu-row-active={$filter$.repo === option.repo}
            role="menuitem"
            onclick={() => pickRepo(option.repo)}
          >
            <span class="hud-header-menu-avatar" style:background={repoColor(option.repo)}>
              {option.repo[0].toUpperCase()}
            </span>
            <span class="hud-header-menu-name">{option.repo}</span>
            <span class="hud-header-menu-count">{option.count}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="hud-header-filter">
    <button
      class="hud-header-filter-btn"
      aria-label={m.hud_filter_statusMenu_ariaLabel()}
      aria-expanded={stateMenuOpen}
      onclick={(event) => {
        event.stopPropagation();
        repoMenuOpen = false;
        stateMenuOpen = !stateMenuOpen;
      }}
    >
      <span class="hud-header-filter-label">{stateLabel}</span>
      <!-- i18n-ignore (glyph) -->
      <span class="hud-header-filter-caret">▼</span>
    </button>
    {#if stateMenuOpen}
      <div class="hud-header-menu" role="menu">
        <button
          class="hud-header-menu-row"
          role="menuitem"
          onclick={(event) => {
            event.stopPropagation();
            clearStates();
          }}
        >
          <span class="hud-header-menu-name">{m.hud_filter_allStatuses_label()}</span>
          <span class="hud-header-menu-count">{$cards$.length}</span>
        </button>
        <div class="hud-header-menu-sep"></div>
        {#each HUD_CARD_STATE_KEYS as stateKey (stateKey)}
          <button
            class="hud-header-menu-row"
            role="menuitemcheckbox"
            aria-checked={$filter$.states.includes(stateKey)}
            onclick={(event) => {
              event.stopPropagation();
              toggleState(stateKey);
            }}
          >
            <span
              class="hud-header-menu-check"
              class:hud-header-menu-check-on={$filter$.states.includes(stateKey)}
            ></span>
            <span class="hud-header-menu-swatch" style:background={cardStateColor(stateKey)}></span>
            <span class="hud-header-menu-name">{cardStateLabel(stateKey)}</span>
            <span class="hud-header-menu-count">{counts[stateKey] ?? 0}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .hud-header-filters {
    display: flex;
    gap: 18px;
  }
  .hud-header-filter {
    position: relative;
  }
  .hud-header-filter-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    border: 1px solid hsl(var(--border));
    background: transparent;
    padding: 6px 12px;
    color: hsl(var(--foreground));
  }
  .hud-header-filter-btn:hover {
    background: hsl(var(--muted) / 0.5);
  }
  .hud-header-filter-prefix {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.2em;
    color: hsl(var(--text-subtle));
    text-transform: uppercase;
  }
  .hud-header-filter-sep {
    width: 1px;
    height: 12px;
    background: hsl(var(--border));
  }
  .hud-header-filter-avatar {
    display: inline-flex;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: hsl(var(--foreground));
    align-items: center;
    justify-content: center;
    font:
      600 9px 'JetBrains Mono',
      monospace;
  }
  .hud-header-filter-label {
    font:
      600 10px Inter,
      system-ui,
      sans-serif;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
  }
  .hud-header-filter-caret {
    font:
      500 8px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
  .hud-header-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 270px;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    box-shadow: 0 8px 24px hsl(var(--app-background) / 0.6);
    z-index: 40;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .hud-header-menu-sep {
    height: 1px;
    background: hsl(var(--border) / 0.5);
    margin: 3px 6px;
  }
  .hud-header-menu-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px;
    cursor: pointer;
    border: none;
    background: transparent;
    color: hsl(var(--foreground));
    text-align: left;
  }
  .hud-header-menu-row:hover,
  .hud-header-menu-row-active {
    background: hsl(var(--muted) / 0.5);
  }
  .hud-header-menu-avatar {
    display: inline-flex;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    align-items: center;
    justify-content: center;
    font:
      600 9px 'JetBrains Mono',
      monospace;
    color: hsl(var(--foreground));
    flex: none;
  }
  .hud-header-menu-avatar-all {
    border: 1px dashed hsl(var(--border));
    color: hsl(var(--text-ghost));
  }
  .hud-header-menu-check {
    width: 13px;
    height: 13px;
    border: 1px solid hsl(var(--border));
    flex: none;
  }
  .hud-header-menu-check-on {
    background: hsl(var(--foreground));
  }
  .hud-header-menu-swatch {
    width: 7px;
    height: 7px;
    flex: none;
  }
  .hud-header-menu-name {
    font:
      500 11.5px 'JetBrains Mono',
      monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hud-header-menu-count {
    margin-left: auto;
    font:
      500 10px 'JetBrains Mono',
      monospace;
    color: hsl(var(--text-ghost));
  }
</style>
