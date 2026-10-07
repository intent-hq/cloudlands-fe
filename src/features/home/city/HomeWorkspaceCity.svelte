<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { fade, fly } from '$lib/motion';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import {
    faArrowUpRightFromSquare,
    faArrowLeft,
    faArrowRight,
    faPlus,
    faMinus,
    faExpand,
    faCrosshairs,
    faList,
    faXmark,
    faKeyboard,
    faMagnifyingGlass,
    faCircleExclamation,
    faPlay,
    faCheck,
    faCircle,
    faCube,
    faRotateLeft,
    faRotateRight,
  } from '@fortawesome/free-solid-svg-icons';
  import type { CityBuilding, CityModel } from './home-city-model';
  import {
    allocateCityLayout,
    cityPlotPosition,
    emptyCityLayout,
    type CityLayout,
  } from './home-city-layout';
  import type { CityFrame, CityScene } from './city-scene';
  import './city.css';

  let {
    model,
    matchingIds,
    query = '',
    layout,
    onlayout,
    onsearch,
    onclear,
    onopen,
    onlist,
  }: {
    model: CityModel;
    matchingIds: readonly string[];
    query?: string;
    layout?: CityLayout;
    onlayout?: (layout: CityLayout) => void;
    onsearch: () => void;
    onclear: () => void;
    onopen: (id: string) => void;
    onlist: () => void;
  } = $props();

  let root: HTMLElement;
  let viewport: HTMLDivElement;
  let scene = $state<CityScene | null>(null);
  let allocation = $state<CityLayout>(untrack(() => layout ?? emptyCityLayout()));
  let selectedId = $state<string | null>(null);
  let indexOpen = $state(false);
  let helpOpen = $state(false);
  let failed = $state(false);
  let ready = $state(false);
  let generation = 0;
  let disposed = false;
  let frame = $state<CityFrame>({
    buildings: [],
    zoom: 1,
    draws: 0,
    triangles: 0,
    moving: false,
    yaw: 0,
    elevation: 0,
  });
  const matching = $derived(new Set(matchingIds));
  const buildings = $derived(new Map(model.buildings.map((building) => [building.id, building])));
  const repoRows = $derived(model.repositories);
  const repoById = $derived(new Map(repoRows.map((repo) => [repo.id, repo])));
  const results = $derived(model.buildings.filter((building) => matching.has(building.id)));
  const selected = $derived(selectedId ? buildings.get(selectedId) : undefined);
  const plots = $derived(
    new Map(
      allocation.plots.map((plot) => {
        const island = allocation.islands.find((item) => item.id === plot.islandId);
        return [plot.id, island ? cityPlotPosition(plot, island) : { x: 0, z: 0, angle: 0 }];
      }),
    ),
  );
  const filtering = $derived(query.trim().length > 0 || results.length !== model.buildings.length);

  function statusLabel(status: CityBuilding['status']): string {
    switch (status) {
      case 'running':
        return m.home_city_status_running();
      case 'attention':
        return m.home_city_status_attention();
      case 'blocked':
        return m.home_city_status_blocked();
      case 'complete':
        return m.home_city_status_complete();
      default:
        return m.home_city_status_idle();
    }
  }
  function statusIcon(status: CityBuilding['status']) {
    return status === 'running'
      ? faPlay
      : status === 'attention' || status === 'blocked'
        ? faCircleExclamation
        : status === 'complete'
          ? faCheck
          : faCircle;
  }

  $effect(() => {
    const next = allocateCityLayout(model, layout ?? untrack(() => allocation));
    allocation = next;
    if (next !== layout && onlayout) onlayout(next);
  });
  $effect(() => {
    if (selectedId && (!buildings.has(selectedId) || !matching.has(selectedId))) selectedId = null;
  });
  $effect(() => {
    scene?.update(model, allocation, matchingIds, selectedId);
  });
  $effect(() => {
    if (failed) indexOpen = true;
  });

  async function initialize() {
    const current = ++generation;
    scene?.dispose();
    scene = null;
    failed = false;
    ready = false;
    try {
      const { CityScene } = await import('./city-scene');
      if (disposed || current !== generation) return;
      scene = new CityScene(viewport, {
        interactionRoot: root,
        onframe: (value) => {
          frame = value;
          ready = true;
        },
        onselect: selectBuilding,
        onlost: () => {
          failed = true;
          ready = false;
        },
      });
    } catch {
      if (!disposed && current === generation) failed = true;
    }
  }
  onMount(() => {
    void initialize();
    return () => {
      disposed = true;
      generation++;
      scene?.dispose();
    };
  });

  function selectBuilding(id: string) {
    if (!matching.has(id)) return;
    selectedId = id;
    scene?.focus(id);
    if (root.clientWidth < 680) indexOpen = false;
    viewport?.focus({ preventScroll: true });
  }
  function cycle(direction = 1, attentionOnly = false) {
    const candidates = attentionOnly
      ? results.filter((building) => ['attention', 'blocked'].includes(building.status))
      : results;
    if (!candidates.length) return;
    const current = candidates.findIndex((building) => building.id === selectedId);
    const next =
      current === -1
        ? direction > 0
          ? 0
          : candidates.length - 1
        : (current + direction + candidates.length) % candidates.length;
    selectBuilding(candidates[next].id);
  }
  function overview() {
    selectedId = null;
    scene?.overview();
    viewport?.focus({ preventScroll: true });
  }
  function closeIndex() {
    indexOpen = false;
    viewport?.focus({ preventScroll: true });
  }
  async function search() {
    indexOpen = true;
    await tick();
    onsearch();
  }
  function back() {
    if (indexOpen) {
      closeIndex();
      return;
    }
    if (selectedId) {
      selectedId = null;
      scene?.back();
      return;
    }
    if (!scene?.back()) scene?.overview();
  }
  function keyboard(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      helpOpen
    )
      return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target?.closest(
        'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"]',
      )
    ) {
      if (
        event.key === 'Enter' &&
        target.matches('input[type="search"]') &&
        (root.closest('.workspace-list')?.contains(target) || target.closest('[data-city-preview]'))
      ) {
        event.preventDefault();
        cycle();
      }
      return;
    }
    if (target?.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return;
    if (
      target &&
      !root.contains(target) &&
      target !== document.body &&
      target !== document.documentElement
    )
      return;
    if (event.key === 'Enter' && target?.closest('button,a')) return;
    let handled = true;
    switch (event.key.toLowerCase()) {
      case 'n':
        cycle(event.shiftKey ? -1 : 1);
        break;
      case 'a':
        cycle(1, true);
        break;
      case 'f':
        if (selectedId) scene?.focus(selectedId);
        break;
      case 'q':
        scene?.orbit(-Math.PI / 12);
        break;
      case 'e':
        scene?.orbit(Math.PI / 12);
        break;
      case 'r':
        scene?.resetAngle();
        break;
      case '/':
        void search();
        break;
      case '?':
        helpOpen = true;
        break;
      case 'home':
      case '0':
        overview();
        break;
      case 'escape':
        back();
        break;
      case 'enter':
        if (selectedId) onopen(selectedId);
        break;
      case '+':
      case '=':
        scene?.zoom(0.8);
        break;
      case '-':
      case '_':
        scene?.zoom(1.25);
        break;
      case 'arrowleft':
        if (event.shiftKey) scene?.orbit(-Math.PI / 12);
        else scene?.pan(70, 0);
        break;
      case 'arrowright':
        if (event.shiftKey) scene?.orbit(Math.PI / 12);
        else scene?.pan(-70, 0);
        break;
      case 'arrowup':
        if (event.shiftKey) scene?.orbit(0, Math.PI / 36);
        else scene?.pan(0, 70);
        break;
      case 'arrowdown':
        if (event.shiftKey) scene?.orbit(0, -Math.PI / 36);
        else scene?.pan(0, -70);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  const shortcuts = $derived([
    { key: 'N / ⇧ N', label: m.home_city_next() + ' / ' + m.home_city_previous() },
    { key: 'A', label: m.home_city_attention_next() },
    { key: '↵', label: m.home_city_open() },
    { key: '/', label: m.home_city_search() },
    { key: 'F', label: m.home_city_focus() },
    { key: '0 / Home', label: m.home_city_overview() },
    { key: 'Esc', label: m.home_city_back() },
    { key: '↑ ↓ ← →', label: m.home_city_pan() },
    { key: 'Q / E', label: m.home_city_rotate_left() + ' / ' + m.home_city_rotate_right() },
    { key: '⇧ ↑ ↓ ← →', label: m.home_city_orbit() },
    { key: 'R', label: m.home_city_reset_angle() },
    { key: m.home_city_orbit_gesture(), label: m.home_city_orbit() },
    { key: m.home_city_pan_gesture(), label: m.home_city_pan() },
    { key: m.home_city_scroll_gesture(), label: m.home_city_pan() },
    {
      key: m.home_city_zoom_gesture(),
      label: m.home_city_zoom_in() + ' / ' + m.home_city_zoom_out(),
    },
    { key: '+ / −', label: m.home_city_zoom_in() + ' / ' + m.home_city_zoom_out() },
    { key: '?', label: m.home_city_shortcuts() },
  ]);
</script>

<svelte:window onkeydown={keyboard} />

<section
  bind:this={root}
  class="workspace-city"
  class:city-has-selection={!!selected}
  class:city-has-index={indexOpen}
  data-city
  data-city-ready={ready}
  data-city-moving={frame.moving}
  data-city-zoom={frame.zoom}
  data-city-draws={frame.draws}
  data-city-triangles={frame.triangles}
  data-city-yaw={frame.yaw}
  data-city-elevation={frame.elevation}
  aria-label={m.home_city_title()}
  in:fade={{ tier: 'slow' }}
  out:fly={{ axis: 'y', distance: -8, tier: 'moderate' }}
>
  <div
    bind:this={viewport}
    class="city-viewport"
    role="group"
    tabindex="0"
    aria-label={m.home_city_orbit()}
    aria-describedby="city-keyboard-hint"
  ></div>
  <div class="city-top-actions">
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      aria-label={m.home_city_search()}
      tooltip={m.home_city_search()}
      tooltipShortcut="/"
      onclick={search}><Fa icon={faMagnifyingGlass} /></Button
    >
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      aria-label={m.home_city_index()}
      tooltip={m.home_city_index()}
      aria-expanded={indexOpen}
      aria-controls="city-workspace-index"
      onclick={() => (indexOpen = !indexOpen)}><Fa icon={faList} /></Button
    >
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      aria-label={m.home_city_shortcuts()}
      tooltip={m.home_city_shortcuts()}
      tooltipShortcut="?"
      onclick={() => (helpOpen = true)}><Fa icon={faKeyboard} /></Button
    >
  </div>

  {#if ready && !failed}
    <div class="city-labels">
      {#each frame.buildings as label (label.id)}
        {@const building = buildings.get(label.id)}
        {#if building}
          <div
            class="city-building-anchor"
            class:city-label-visible={label.visible}
            class:city-label-selected={selectedId === label.id}
            style:left={`${label.x}px`}
            style:top={`${label.y}px`}
            data-city-plot={label.id}
            data-city-x={plots.get(label.id)?.x}
            data-city-z={plots.get(label.id)?.z}
            data-city-match={matching.has(label.id)}
          >
            <Button
              variant="ghost"
              size="sm"
              class="city-building-label"
              data-city-building={label.id}
              aria-hidden={!label.visible}
              tabindex={label.visible ? 0 : -1}
              aria-pressed={selectedId === label.id}
              aria-label={m.home_city_building_label({
                title: building.title,
                status: statusLabel(building.status),
              })}
              onclick={() => selectBuilding(label.id)}
            >
              <span class="city-marker" data-status={building.status}
                ><Fa icon={statusIcon(building.status)} /></span
              ><span class="city-building-name">{building.title}</span>
            </Button>
            <span class="city-leader" aria-hidden="true"></span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if !ready && !failed}
    <div class="city-message" role="status">
      <Fa icon={faCube} />
      <p>{m.home_city_loading()}</p>
    </div>
  {:else if failed}
    <div class="city-message city-fallback" role="status">
      <Fa icon={faCube} />
      <h3>{m.home_city_fallback_title()}</h3>
      <p>{m.home_city_fallback_description()}</p>
      <div class="city-message-actions">
        <Button variant="outline" onclick={initialize}>{m.home_city_retry()}</Button><Button
          variant="ghost"
          onclick={onlist}>{m.home_city_list()}</Button
        >
      </div>
    </div>
  {:else if model.buildings.length === 0}
    <div class="city-message">
      <Fa icon={faCube} />
      <h3>{m.home_city_no_workspaces()}</h3>
      <p>{m.home_city_empty_description()}</p>
    </div>
  {:else if results.length === 0}
    <div class="city-message">
      <h3>{m.home_no_matches()}</h3>
      <p>{m.home_no_matches_description()}</p>
      <Button variant="outline" onclick={onclear}>{m.home_clear_filters()}</Button>
    </div>
  {/if}

  {#if filtering && results.length > 0}
    <div class="city-filter-banner" role="status">
      <span>{m.home_city_matches({ count: formatInteger(results.length) })}</span><Button
        variant="ghost"
        size="icon-sm"
        aria-label={m.home_clear_filters()}
        onclick={onclear}><Fa icon={faXmark} /></Button
      >
    </div>
  {/if}

  {#if selected}
    <aside
      class="city-inspector"
      data-city-selected={selected.id}
      in:fly={{ axis: 'y', distance: 8, tier: 'moderate' }}
      out:fade={{ tier: 'fast' }}
    >
      <div class="city-inspector-top">
        <span class="city-inspector-repo">{repoById.get(selected.repositoryId)?.name}</span><Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.home_city_close()}
          onclick={() => {
            selectedId = null;
            viewport?.focus({ preventScroll: true });
          }}><Fa icon={faXmark} /></Button
        >
      </div>
      <h3>{selected.title}</h3>
      <p class="city-inspector-message">
        {selected.workspace.statusMessage || statusLabel(selected.status)}
      </p>
      <div class="city-inspector-status" data-city-status data-status={selected.status}>
        <Fa icon={statusIcon(selected.status)} /><span>{statusLabel(selected.status)}</span
        >{#if selected.agents !== null}<span class="city-agent-count"
            >{m.home_city_agents({ count: formatInteger(selected.agents) })}</span
          >{/if}
      </div>
      <p class="city-metric">
        {selected.files === null
          ? m.home_city_unknown()
          : m.home_city_files({
              count: formatInteger(selected.files),
            })}{#if selected.additions !== null}<span class="city-additions"
            >+{formatInteger(selected.additions)}</span
          >{/if}{#if selected.deletions !== null}<span class="city-deletions"
            >−{formatInteger(selected.deletions)}</span
          >{/if}
      </p>
      <p class="city-metric-source">
        {selected.metricSource === 'pull-request'
          ? m.home_city_metric_pr({
              base: selected.metricBase ?? '—',
            })
          : selected.metricSource === 'working-tree'
            ? m.home_city_metric_working()
            : m.home_city_metric_missing()}
      </p>
      <div class="city-inspector-actions">
        <Button variant="ghost" class="city-open" onclick={() => onopen(selected.id)}
          >{m.home_city_open()}<Fa icon={faArrowUpRightFromSquare} /></Button
        ><Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.home_city_focus()}
          tooltip={m.home_city_focus()}
          tooltipShortcut="F"
          onclick={() => scene?.focus(selected.id)}><Fa icon={faCrosshairs} /></Button
        >
      </div>
      {#if selected.workspace.branch}<p class="city-branch">{selected.workspace.branch}</p>{/if}
    </aside>
  {/if}

  {#if indexOpen}
    <aside
      id="city-workspace-index"
      class="city-index"
      data-city-index
      aria-label={m.home_city_index()}
      in:fly={{ axis: 'x', distance: 12, tier: 'moderate' }}
      out:fade={{ tier: 'fast' }}
    >
      <div class="city-index-header">
        <h3>{m.home_city_index()}</h3>
        <Button variant="ghost" size="icon-sm" aria-label={m.home_city_close()} onclick={closeIndex}
          ><Fa icon={faXmark} /></Button
        >
      </div>
      <div class="city-index-items">
        {#each model.repositories as repo (repo.id)}
          {@const items = results.filter((building) => building.repositoryId === repo.id)}
          {#if items.length}<div class="city-index-repo">
              <h4>
                <Button
                  variant="ghost"
                  size="sm"
                  class="city-index-repository"
                  aria-label={m.home_city_repository_label({
                    name: repo.name,
                    count: formatInteger(items.length),
                  })}
                  onclick={() => scene?.focusRepository(repo.id)}
                  >{repo.name}<span>{formatInteger(items.length)}</span></Button
                >
              </h4>
              {#each items as building (building.id)}
                <Button
                  variant="ghost"
                  class="city-index-item"
                  active={selectedId === building.id}
                  aria-pressed={selectedId === building.id}
                  data-city-index-building={building.id}
                  onclick={() => selectBuilding(building.id)}
                >
                  <span class="city-marker" data-status={building.status}
                    ><Fa icon={statusIcon(building.status)} /></span
                  ><span class="city-index-copy"
                    ><span>{building.title}</span><small>{statusLabel(building.status)}</small
                    ></span
                  >
                </Button>
              {/each}
            </div>{/if}
        {/each}
        {#if !results.length}<p class="city-index-empty">{m.home_no_matches()}</p>{/if}
      </div>
      <div class="city-index-footer">
        <Button variant="ghost" size="sm" onclick={onlist}
          >{m.home_city_list()}<Fa icon={faArrowRight} /></Button
        >
      </div>
    </aside>
  {/if}

  <div class="city-camera-controls">
    <div class="city-orbit-controls">
      <Button
        variant="ghost"
        size="icon-sm"
        class="city-tool"
        disabled={failed}
        aria-label={m.home_city_rotate_left()}
        tooltip={m.home_city_rotate_left()}
        tooltipShortcut="Q"
        onclick={() => scene?.orbit(-Math.PI / 12)}><Fa icon={faRotateLeft} /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        class="city-tool"
        disabled={failed}
        aria-label={m.home_city_reset_angle()}
        tooltip={m.home_city_reset_angle()}
        tooltipShortcut="R"
        onclick={() => scene?.resetAngle()}><Fa icon={faCrosshairs} /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        class="city-tool"
        disabled={failed}
        aria-label={m.home_city_rotate_right()}
        tooltip={m.home_city_rotate_right()}
        tooltipShortcut="E"
        onclick={() => scene?.orbit(Math.PI / 12)}><Fa icon={faRotateRight} /></Button
      >
    </div>
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      disabled={failed}
      aria-label={m.home_city_zoom_in()}
      tooltip={m.home_city_zoom_in()}
      tooltipShortcut="+"
      onclick={() => scene?.zoom(0.8)}><Fa icon={faPlus} /></Button
    >
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      disabled={failed}
      aria-label={m.home_city_zoom_out()}
      tooltip={m.home_city_zoom_out()}
      tooltipShortcut="−"
      onclick={() => scene?.zoom(1.25)}><Fa icon={faMinus} /></Button
    >
    <Button
      variant="ghost"
      size="icon-sm"
      class="city-tool"
      disabled={failed}
      aria-label={m.home_city_overview()}
      tooltip={m.home_city_overview()}
      tooltipShortcut="0"
      onclick={overview}><Fa icon={faExpand} /></Button
    >
  </div>

  <footer class="city-footer">
    <div class="city-nav-hint">
      <Button
        variant="ghost"
        size="icon-sm"
        class="city-tool"
        disabled={!results.length}
        aria-label={m.home_city_previous()}
        tooltip={m.home_city_previous()}
        tooltipShortcut="Shift+N"
        onclick={() => cycle(-1)}><Fa icon={faArrowLeft} /></Button
      ><Button
        variant="ghost"
        size="icon-sm"
        class="city-tool"
        disabled={!results.length}
        aria-label={m.home_city_next()}
        tooltip={m.home_city_next()}
        tooltipShortcut="N"
        onclick={() => cycle()}><Fa icon={faArrowRight} /></Button
      >
    </div>
  </footer>
  <p class="sr-only" id="city-keyboard-hint">{m.home_city_drag_hint()}</p>
  <p class="sr-only" aria-live="polite">
    {selected
      ? m.home_city_building_label({ title: selected.title, status: statusLabel(selected.status) })
      : ''}
  </p>
</section>

<ContentDialog
  bind:open={helpOpen}
  title={m.home_city_shortcuts()}
  description={m.home_city_help_note()}
  size="sm"
  onClose={() => viewport?.focus({ preventScroll: true })}
>
  <dl class="city-shortcuts">
    {#each shortcuts as shortcut}<div>
        <dt>{shortcut.label}</dt>
        <dd><kbd>{shortcut.key}</kbd></dd>
      </div>{/each}
  </dl>
  <p class="mt-5 type-caption text-muted-foreground">{m.home_city_touch_hint()}</p>
  <p class="mt-5 type-caption text-muted-foreground">{m.home_city_size_description()}</p>
</ContentDialog>
