<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import AgentActivityGraph, { type GraphLayers } from './AgentActivityGraph.svelte';
  import TimeScrubber from './TimeScrubber.svelte';
  import { advancePlaybackCursor, type PlaybackMode, type PlaybackSpeed } from './playback';

  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';
  import {
    selectGraphState,
    selectGraphStateAt,
  } from '$store/renderer/slices/agent-overview/agent-overview-selectors';
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
  let layers = $state<GraphLayers>({ files: true, notes: true, messages: true });
  let fitRequest = $state(0);
  let mode = $state<PlaybackMode>('live');
  let speed = $state<PlaybackSpeed>(1);
  let cursor = $state('');

  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const graphState$ = selectGraphState(workspaceId);
  const displayedGraph = $derived(
    mode === 'live'
      ? $graphState$
      : selectGraphStateAt.select(appStore.state, workspaceId, cursor || $graphState$.minTime),
  );
  const taskCount = $derived(
    Object.values(displayedGraph.stats.tasks).reduce((total, count) => total + count, 0),
  );

  // svelte-ignore state_referenced_locally - one-shot init-time dispatch; workspaceId doesn't change during component lifecycle
  appStore.dispatch(loadEventsRequested(workspaceId));

  function navigationOptions(event: MouseEvent) {
    return {
      openInAdjacentPanel: event.metaKey || event.ctrlKey,
      sourcePanelId: findSourcePanelId(event.target),
    };
  }

  function handleAgentClick(agentId: string, event: MouseEvent) {
    const options = navigationOptions(event);

    appStore.dispatch(
      openAgentTabRequested(workspaceId, {
        agentId,
        sourcePanelId: options.sourcePanelId,
        openInAdjacentPanel: options.openInAdjacentPanel,
      }),
    );
  }

  function handleNoteClick(noteId: string, event: MouseEvent) {
    appStore.dispatch(openWorkspaceNote(workspaceId, noteId, navigationOptions(event)));
  }

  function handleFileClick(path: string, event: MouseEvent) {
    appStore.dispatch(openWorkspaceFile(workspaceId, path, navigationOptions(event)));
  }

  function toggleLayer(layer: keyof GraphLayers): void {
    layers = { ...layers, [layer]: !layers[layer] };
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
    const eventTimes = ($graphState$.eventTimes ?? []).map(Date.parse).filter(Number.isFinite);
    let currentMs = Date.parse(untrack(() => cursor || $graphState$.minTime));
    let previousFrame = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const result = advancePlaybackCursor(
        currentMs,
        now - previousFrame,
        playbackSpeed,
        eventTimes,
        maxTimeMs,
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
    playbackSpeed={speed}
    showFitControl={false}
  />

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

  <div
    class="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2"
  >
    <div
      class="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
      role="toolbar"
      aria-label={m.agentOverview_toolbar_controls_ariaLabel()}
      data-graph-controls
    >
      <Button
        variant="ghost-light"
        size="xs"
        class={layers.files ? 'bg-muted text-foreground' : ''}
        aria-pressed={layers.files}
        onclick={() => toggleLayer('files')}>{m.agentOverview_toolbar_files_label()}</Button
      >
      <Button
        variant="ghost-light"
        size="xs"
        class={layers.notes ? 'bg-muted text-foreground' : ''}
        aria-pressed={layers.notes}
        onclick={() => toggleLayer('notes')}>{m.agentOverview_toolbar_notes_label()}</Button
      >
      <Button
        variant="ghost-light"
        size="xs"
        class={layers.messages ? 'bg-muted text-foreground' : ''}
        aria-pressed={layers.messages}
        onclick={() => toggleLayer('messages')}>{m.agentOverview_toolbar_messages_label()}</Button
      >
      <span class="mx-0.5 h-4 w-px bg-border"></span>
      <Button variant="ghost-light" size="xs" onclick={() => (fitRequest += 1)}
        >{m.agentOverview_hierarchyGraph_fitToView_tooltip()}</Button
      >

      <details class="relative">
        <summary
          class="cursor-pointer list-none rounded-md px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >{m.agentOverview_toolbar_legend_label()}</summary
        >
        <div
          class="absolute left-0 top-full mt-2 grid min-w-56 grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border bg-card/95 p-3 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground shadow-lg backdrop-blur"
        >
          <span class="flex items-center gap-2"
            ><i class="h-3 w-5 rounded border border-border bg-card"
            ></i>{m.agentOverview_toolbar_tasks_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="h-3 w-5 rounded border border-border bg-card"
            ></i>{m.agentOverview_toolbar_agents_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="h-2.5 w-5 rounded-full border border-border bg-card"></i><span
              >{m.agentOverview_toolbar_files_label()} · {m.agentOverview_toolbar_notes_label()}</span
            ></span
          >
          <span class="flex items-center gap-2"
            ><i class="w-5 border-t border-muted-foreground"
            ></i>{m.agentOverview_toolbar_delegation_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="w-5 border-t border-muted-foreground opacity-70"
            ></i>{m.agentOverview_toolbar_messages_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="w-5 border-t border-dashed border-muted-foreground"
            ></i>{m.agentOverview_toolbar_waiting_label()}</span
          >
        </div>
      </details>
    </div>

    <div
      class="pointer-events-auto rounded-full border border-border bg-card/95 px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground shadow-sm backdrop-blur"
      data-graph-controls
    >
      {displayedGraph.stats.agents.active === 1
        ? m.agentOverview_toolbar_activeAgents_one({ count: 1 })
        : m.agentOverview_toolbar_activeAgents_many({ count: displayedGraph.stats.agents.active })}
      · {taskCount === 1
        ? m.agentOverview_toolbar_tasks_one({ count: 1 })
        : m.agentOverview_toolbar_tasks_many({ count: taskCount })}
      · {displayedGraph.stats.files === 1
        ? m.agentOverview_toolbar_files_one({ count: 1 })
        : m.agentOverview_toolbar_files_many({ count: displayedGraph.stats.files })}
    </div>
  </div>
</div>

<style>
  .agent-overview-panel {
    min-height: 300px;
  }
</style>
