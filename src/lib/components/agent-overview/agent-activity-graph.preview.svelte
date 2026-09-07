<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    buildBusyGraph,
    buildConstellationGraph,
    buildEmptyGraph,
    buildLargeGraph,
    buildReplayGraph as buildReplayFixture,
    buildSingleAgentGraph,
  } from './__fixtures__/agent-activity-graph.fixtures';
  import type { GraphState } from './types';

  const replayEnd = Date.now();

  export const preview = definePreview<{ graph: GraphState; replayEnd?: number }>({
    id: 'agent-activity-graph',
    title: 'Agent activity graph',
    defaultState: 'constellation',
    states: {
      constellation: { props: { graph: buildConstellationGraph() } },
      busy: { props: { graph: buildBusyGraph() } },
      empty: { props: { graph: buildEmptyGraph() } },
      large: { props: { graph: buildLargeGraph() } },
      replay: { props: { graph: buildReplayFixture(replayEnd), replayEnd } },
      'single-agent': { props: { graph: buildSingleAgentGraph() } },
    },
  });
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import AgentActivityGraph from './AgentActivityGraph.svelte';
  import type { GraphOpenEvent } from './AgentActivityGraph.svelte';
  import TimeScrubber from './TimeScrubber.svelte';
  import {
    advancePlaybackCursor,
    playbackRate,
    type PlaybackMode,
    type PlaybackSpeed,
  } from './playback';
  import { buildReplayGraph } from './__fixtures__/agent-activity-graph.fixtures';
  import { m } from '$shared/paraglide/messages.js';

  let { graph, replayEnd }: { graph: GraphState; replayEnd?: number } = $props();
  let mode = $state<PlaybackMode>('live');
  let speed = $state<PlaybackSpeed>(1);
  let cursor = $state(graph.minTime);
  const displayedGraph = $derived(
    replayEnd === undefined
      ? graph
      : buildReplayGraph(replayEnd, mode === 'live' ? replayEnd : Date.parse(cursor)),
  );

  function logClick(kind: 'agent' | 'task' | 'note' | 'file', id: string, event: GraphOpenEvent) {
    // i18n-ignore (developer-only sandbox diagnostic)
    console.info('[agent-activity-graph preview] click', { kind, id, eventType: event.type });
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
    if (mode === 'live' || Date.parse(cursor) >= Date.parse(graph.maxTime)) cursor = graph.minTime;
    mode = 'playing';
  }

  $effect(() => {
    if (mode !== 'playing' || replayEnd === undefined) return;
    const playbackSpeed = speed;
    const rate = playbackRate(replayEnd - Date.parse(graph.minTime));
    let currentMs = Date.parse(untrack(() => cursor));
    let previousFrame = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const result = advancePlaybackCursor(
        currentMs,
        now - previousFrame,
        playbackSpeed,
        replayEnd,
        rate,
      );
      previousFrame = now;
      currentMs = result.cursorMs;
      if (result.reachedEnd) return goLive();
      cursor = new Date(currentMs).toISOString();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  onMount(() => {
    if (replayEnd !== undefined && new URLSearchParams(window.location.search).get('t') === '0') {
      cursor = graph.minTime;
      mode = 'paused';
    }
  });
</script>

<div class="relative h-180 min-h-150 w-full overflow-hidden rounded-md" data-graph-preview>
  <span
    class="pointer-events-none absolute right-4 top-4 z-10 flex items-center gap-2 text-xs font-medium text-muted-foreground"
    data-external-file-legend
  >
    <i class="h-5 w-4 rounded-sm border border-dashed border-muted-foreground"></i>
    {m.agentOverview_toolbar_externalFile_label()}
  </span>
  <AgentActivityGraph
    graph={displayedGraph}
    layers={{ files: true, notes: true, messages: true }}
    onAgentClick={(id, event) => logClick('agent', id, event)}
    onTaskClick={(id, event) => logClick('task', id, event)}
    onNoteClick={(id, event) => logClick('note', id, event)}
    onFileClick={(id, event) => logClick('file', id, event)}
    playbackSpeed={speed}
    showFitControl
  />
  {#if replayEnd !== undefined}
    <TimeScrubber
      currentTime={mode === 'live' ? graph.maxTime : cursor}
      minTime={graph.minTime}
      maxTime={graph.maxTime}
      eventTimes={graph.eventTimes}
      isLive={mode === 'live'}
      isPlaying={mode === 'playing'}
      {speed}
      onTimeChange={changeTime}
      onTogglePlay={togglePlayback}
      onSpeedChange={(nextSpeed) => (speed = nextSpeed)}
      onGoLive={goLive}
    />
  {/if}
</div>
