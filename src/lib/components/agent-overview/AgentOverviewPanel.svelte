<script lang="ts">
  import { untrack } from 'svelte';
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import {
    faCircle,
    faCircleCheck,
    faEllipsis,
    faExpand,
    faMinus,
    faPlus,
    faCircleQuestion,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { formatInteger } from '$lib/i18n/format';
  import AgentActivityGraph, {
    type GraphLayers,
    type GraphZoomAction,
  } from './AgentActivityGraph.svelte';
  import AgentOverviewLegend from './AgentOverviewLegend.svelte';
  import TimeScrubber from './TimeScrubber.svelte';
  import {
    advancePlaybackCursor,
    playbackRate,
    snapPlaybackCursor,
    type PlaybackMode,
    type PlaybackSpeed,
  } from './playback';

  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectGraphState,
    selectGraphStateAt,
  } from '$store/renderer/slices/agent-overview/agent-overview-selectors';
  import { selectGraphHistoryStatus } from '$store/renderer/slices/agent-overview/agent-overview-history-selectors';
  import { loadGraphHistoryRequested } from '$store/renderer/slices/agent-overview/agent-overview-history-slice';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { loadEventsRequested } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    onFocus?: () => void;
  }

  let { workspaceId, onFocus }: Props = $props();
  let layers = $state<GraphLayers>({
    agents: true,
    tasks: true,
    files: true,
    notes: true,
    messages: true,
  });
  let fitRequest = $state(0);
  let zoomRequest = $state<{ id: number; action: GraphZoomAction }>({ id: 0, action: 'reset' });
  let zoomScale = $state(1);
  let mode = $state<PlaybackMode>('live');
  let speed = $state<PlaybackSpeed>(1);
  let cursor = $state('');

  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const graphState$ = selectGraphState(workspaceId);
  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const graphHistoryStatus$ = selectGraphHistoryStatus(workspaceId);
  const eventTimesMs = $derived(
    ($graphState$.eventTimes ?? [])
      .map(Date.parse)
      .filter(Number.isFinite)
      .sort((a, b) => a - b),
  );
  const graphCursor = $derived.by(() => {
    const cursorMs = Date.parse(cursor || $graphState$.minTime);
    const graphCursorMs =
      mode === 'playing' ? cursorMs : snapPlaybackCursor(eventTimesMs, cursorMs);
    return new Date(graphCursorMs).toISOString();
  });
  const displayedGraph = $derived(
    mode === 'live'
      ? $graphState$
      : selectGraphStateAt.select(appStore.state, workspaceId, graphCursor),
  );
  const taskCount = $derived(
    Object.values(displayedGraph.stats.tasks).reduce((total, count) => total + count, 0),
  );
  const messageCount = $derived(
    displayedGraph.edges
      .filter((edge) => edge.type === 'message')
      .reduce((total, edge) => total + (edge.count ?? 1), 0),
  );
  const hasPrimaryNodes = $derived(
    displayedGraph.nodes.some((node) => node.type === 'agent' || node.type === 'task'),
  );
  const zoomPercent = $derived(Math.round(zoomScale * 100));

  // svelte-ignore state_referenced_locally - one-shot init-time dispatch; workspaceId doesn't change during component lifecycle
  appStore.dispatch(loadEventsRequested(workspaceId));
  // svelte-ignore state_referenced_locally - one-shot init-time dispatch; workspaceId doesn't change during component lifecycle
  appStore.dispatch(loadGraphHistoryRequested(workspaceId));

  function navigationOptions(event: MouseEvent | KeyboardEvent) {
    return {
      openInAdjacentPanel: event.metaKey || event.ctrlKey,
      sourcePanelId: findSourcePanelId(event.target),
    };
  }

  function handleAgentClick(agentId: string, event: MouseEvent | KeyboardEvent) {
    const options = navigationOptions(event);

    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId: options.sourcePanelId,
        openInAdjacentPanel: options.openInAdjacentPanel,
      }),
    );
  }

  function handleNoteClick(noteId: string, event: MouseEvent | KeyboardEvent) {
    appStore.dispatch(openWorkspaceNote(workspaceId, noteId, navigationOptions(event)));
  }

  function handleFileClick(path: string, event: MouseEvent | KeyboardEvent) {
    appStore.dispatch(openWorkspaceFile(workspaceId, path, navigationOptions(event)));
  }

  function toggleLayer(layer: keyof GraphLayers): void {
    layers = { ...layers, [layer]: !layers[layer] };
  }

  function requestZoom(action: GraphZoomAction): void {
    zoomRequest = { id: zoomRequest.id + 1, action };
  }

  function goLive(): void {
    mode = 'live';
  }

  function changeTime(time: string): void {
    cursor = time;
    mode = 'paused';
  }

  function togglePlayback(): void {
    if (mode === 'playing') {
      mode = 'paused';
      return;
    }
    if (mode === 'live' || Date.parse(cursor) >= Date.parse($graphState$.maxTime)) {
      cursor = $graphState$.minTime;
    }
    mode = 'playing';
  }

  $effect(() => {
    if (mode !== 'playing') return;
    const playbackSpeed = speed;
    const maxTimeMs = Date.parse($graphState$.maxTime);
    const minTimeMs = Date.parse($graphState$.minTime);
    const rate = playbackRate(maxTimeMs - minTimeMs);
    let currentMs = Date.parse(untrack(() => cursor || $graphState$.minTime));
    let previousFrame = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const result = advancePlaybackCursor(
        currentMs,
        now - previousFrame,
        playbackSpeed,
        maxTimeMs,
        rate,
      );
      previousFrame = now;
      currentMs = result.cursorMs;
      if (result.reachedEnd) {
        goLive();
        return;
      }
      cursor = new Date(currentMs).toISOString();
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });
</script>

{#snippet layerToggle(layer: keyof GraphLayers, label: string)}
  <Button
    variant="ghost-light"
    size="xs"
    class={layers[layer] ? 'bg-muted text-foreground' : ''}
    aria-pressed={layers[layer]}
    onclick={() => toggleLayer(layer)}
  >
    <Fa icon={layers[layer] ? faCircleCheck : faCircle} class="size-3" />
    {label}
  </Button>
{/snippet}

{#snippet statsPill(className: string)}
  <div
    class="stats-pill pointer-events-auto items-center overflow-x-auto rounded-full border border-border bg-card/95 px-1.5 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur {className}"
    data-graph-controls
  >
    <button type="button" aria-pressed={layers.agents} onclick={() => toggleLayer('agents')}>
      {displayedGraph.stats.agents.total === 1
        ? m.chat_toolDetails_agentCount_one({ count: 1 })
        : m.chat_toolDetails_agentCount_many({ count: displayedGraph.stats.agents.total })}
    </button>
    <i>·</i>
    <button type="button" aria-pressed={layers.tasks} onclick={() => toggleLayer('tasks')}>
      {taskCount === 1
        ? m.agentOverview_toolbar_tasks_one({ count: 1 })
        : m.agentOverview_toolbar_tasks_many({ count: taskCount })}
    </button>
    <i>·</i>
    <button type="button" aria-pressed={layers.files} onclick={() => toggleLayer('files')}>
      {displayedGraph.stats.files === 1
        ? m.agentOverview_toolbar_files_one({ count: 1 })
        : m.agentOverview_toolbar_files_many({ count: displayedGraph.stats.files })}
    </button>
    <i>·</i>
    <button type="button" aria-pressed={layers.notes} onclick={() => toggleLayer('notes')}>
      {displayedGraph.stats.notes === 1
        ? m.chat_toolDetails_noteCount_one({ count: 1 })
        : m.chat_toolDetails_noteCount_many({ count: displayedGraph.stats.notes })}
    </button>
    <i>·</i>
    <button type="button" aria-pressed={layers.messages} onclick={() => toggleLayer('messages')}>
      {messageCount === 1
        ? m.agentOverview_toolbar_messages_one({ count: 1 })
        : m.agentOverview_toolbar_messages_many({ count: messageCount })}
    </button>
  </div>
{/snippet}

<div
  class="agent-overview-panel relative flex h-full flex-col overflow-hidden bg-background"
  onfocusin={onFocus}
>
  <AgentActivityGraph
    graph={displayedGraph}
    onAgentClick={handleAgentClick}
    onTaskClick={handleNoteClick}
    onNoteClick={handleNoteClick}
    onFileClick={handleFileClick}
    {layers}
    {fitRequest}
    {zoomRequest}
    onZoomChange={(scale) => (zoomScale = scale)}
    playbackSpeed={speed}
    showFitControl={false}
    showEmptyState={false}
  />

  {#if !hasPrimaryNodes}
    <div
      class="pointer-events-none absolute inset-0 z-5 flex items-center justify-center text-center"
    >
      <div class="pointer-events-auto rounded-xl bg-background/90 p-4 backdrop-blur">
        <p class="text-lg font-medium text-foreground">
          {m.agentOverview_hierarchyGraph_noAgents_title()}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {m.agentOverview_empty_delegate_description()}
        </p>
        <Button class="mt-3" size="sm" onclick={(event) => handleNoteClick('spec', event)}>
          {m.agentOverview_empty_openSpec_label()}
        </Button>
      </div>
    </div>
  {/if}

  {#if $graphHistoryStatus$ === 'loading'}
    <span
      class="pointer-events-none absolute bottom-14 left-4 z-10 text-xs text-muted-foreground"
      aria-live="polite">{m.agentOverview_timeScrubber_loadingHistory_label()}</span
    >
  {/if}

  <div
    class="scrubber-row pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-col gap-1.5"
  >
    {@render statsPill('mobile-stats hidden self-end')}
    <TimeScrubber
      currentTime={mode === 'live' ? $graphState$.currentTime : cursor}
      minTime={$graphState$.minTime}
      maxTime={$graphState$.maxTime}
      eventTimes={$graphState$.eventTimes}
      isLive={mode === 'live'}
      isPlaying={mode === 'playing'}
      {speed}
      onTimeChange={changeTime}
      onTogglePlay={togglePlayback}
      onSpeedChange={(nextSpeed) => (speed = nextSpeed)}
      onGoLive={goLive}
    />
  </div>

  <div
    class="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2"
  >
    <div
      class="desktop-toolbar pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
      role="toolbar"
      aria-label={m.agentOverview_toolbar_controls_ariaLabel()}
      data-graph-controls
    >
      {@render layerToggle('files', m.agentOverview_toolbar_files_label())}
      {@render layerToggle('notes', m.agentOverview_toolbar_notes_label())}
      {@render layerToggle('messages', m.agentOverview_toolbar_messages_label())}
      <span class="mx-0.5 h-4 w-px bg-border"></span>
      <AgentOverviewLegend />
    </div>
    <div
      class="mobile-toolbar hidden"
      role="toolbar"
      aria-label={m.agentOverview_toolbar_controls_ariaLabel()}
    >
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="default"
              size="icon-lg"
              iconOnly
              aria-label={m.ui_breadcrumb_more_label()}><Fa icon={faEllipsis} /></Button
            >
          {/snippet}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="bottom"
            sideOffset={6}
            class="z-(--layer-popover) flex min-w-40 flex-col items-stretch gap-1 rounded-lg border border-border bg-popover p-1 shadow-(--elevation-overlay) outline-none"
          >
            {@render layerToggle('files', m.agentOverview_toolbar_files_label())}
            {@render layerToggle('notes', m.agentOverview_toolbar_notes_label())}
            {@render layerToggle('messages', m.agentOverview_toolbar_messages_label())}
            <AgentOverviewLegend />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
    {@render statsPill('desktop-stats flex')}
  </div>

  <div
    class="zoom-controls pointer-events-auto absolute bottom-16 right-3 z-10 flex items-center gap-2"
    data-graph-controls
  >
    <Button
      size="icon-lg"
      iconOnly
      aria-label={m.ui_zoomPanViewport_zoomOut_ariaLabel()}
      onclick={() => requestZoom('out')}
    >
      <Fa icon={faMinus} />
    </Button>
    <Button
      size="icon-lg"
      iconOnly
      aria-label={m.ui_zoomPanViewport_resetZoom_ariaLabel()}
      tooltip={m.agentOverview_zoom_hint_tooltip()}
      onclick={() => requestZoom('reset')}
    >
      <span class="text-[10px] tabular-nums" aria-live="polite">{formatInteger(zoomPercent)}%</span>
    </Button>
    <Button
      size="icon-lg"
      iconOnly
      aria-label={m.ui_zoomPanViewport_zoomIn_ariaLabel()}
      onclick={() => requestZoom('in')}
    >
      <Fa icon={faPlus} />
    </Button>
    <Button
      size="icon-lg"
      iconOnly
      aria-label={m.agentOverview_hierarchyGraph_fitToView_tooltip()}
      onclick={() => (fitRequest += 1)}
    >
      <Fa icon={faExpand} />
    </Button>
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            size="icon-sm"
            variant="ghost-light"
            iconOnly
            aria-label={m.ui_shortcuts_keyboardShortcuts_label()}
          >
            <Fa icon={faCircleQuestion} class="size-3" />
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={6}
          class="z-(--layer-popover) w-64 rounded-lg border border-border bg-popover p-3 text-xs text-muted-foreground shadow-(--elevation-overlay) outline-none"
        >
          <p class="mb-2 font-semibold text-foreground">
            {m.ui_shortcuts_keyboardShortcuts_label()}
          </p>
          <ul class="space-y-1.5">
            <li>{m.agentOverview_keyboard_tab_description()}</li>
            <li>{m.agentOverview_keyboard_arrows_description()}</li>
            <li>{m.agentOverview_keyboard_escape_description()}</li>
            <li>{m.agentOverview_keyboard_homeEnd_description()}</li>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
</div>

<style>
  .agent-overview-panel {
    min-height: 300px;
    container: agent-overview / inline-size;
  }
  .stats-pill {
    gap: 0.375rem;
    white-space: nowrap;
  }
  .stats-pill button {
    border-radius: 9999px;
    padding: 0.125rem 0.25rem;
  }
  .stats-pill button:hover,
  .stats-pill button[aria-pressed='false'] {
    background: var(--color-muted);
    color: var(--color-foreground);
  }
  @container agent-overview (max-width: 559px) {
    .desktop-toolbar,
    .desktop-stats {
      display: none;
    }
    .mobile-toolbar,
    .mobile-stats {
      display: flex;
    }
    .zoom-controls {
      bottom: 7rem;
    }
  }
</style>
