<script lang="ts">
  import AgentActivityGraph, { type GraphLayers } from './AgentActivityGraph.svelte';

  import { findSourcePanelId } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';
  import { selectGraphState } from '$store/renderer/slices/agent-overview/agent-overview-selectors';
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

  // svelte-ignore state_referenced_locally - workspaceId doesn't change during component lifecycle
  const graphState$ = selectGraphState(workspaceId);
  const taskCount = $derived(
    Object.values($graphState$.stats.tasks).reduce((total, count) => total + count, 0),
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
</script>

<div
  class="agent-overview-panel relative flex h-full flex-col overflow-hidden bg-background"
  onfocusin={onFocus}
>
  <AgentActivityGraph
    graph={$graphState$}
    onAgentClick={handleAgentClick}
    onTaskClick={handleNoteClick}
    onNoteClick={handleNoteClick}
    onFileClick={handleFileClick}
    {layers}
    {fitRequest}
    showFitControl={false}
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
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs font-medium text-subtle hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        class:bg-muted={layers.files}
        class:text-foreground={layers.files}
        aria-pressed={layers.files}
        onclick={() => toggleLayer('files')}>{m.agentOverview_toolbar_files_label()}</button
      >
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs font-medium text-subtle hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        class:bg-muted={layers.notes}
        class:text-foreground={layers.notes}
        aria-pressed={layers.notes}
        onclick={() => toggleLayer('notes')}>{m.agentOverview_toolbar_notes_label()}</button
      >
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs font-medium text-subtle hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        class:bg-muted={layers.messages}
        class:text-foreground={layers.messages}
        aria-pressed={layers.messages}
        onclick={() => toggleLayer('messages')}>{m.agentOverview_toolbar_messages_label()}</button
      >
      <span class="mx-0.5 h-4 w-px bg-border"></span>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs font-medium text-subtle hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onclick={() => (fitRequest += 1)}
        >{m.agentOverview_hierarchyGraph_fitToView_tooltip()}</button
      >

      <details class="relative">
        <summary
          class="cursor-pointer list-none rounded-md px-2 py-1 text-xs font-medium text-subtle hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >{m.agentOverview_toolbar_legend_label()}</summary
        >
        <div
          class="absolute left-0 top-full mt-2 grid min-w-52 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-3 text-xs text-subtle shadow-lg"
        >
          <span class="flex items-center gap-2"
            ><i class="size-2 rounded-full bg-primary"
            ></i>{m.agentOverview_toolbar_agents_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="size-3 rounded-full border-2 border-primary"
            ></i>{m.agentOverview_toolbar_tasks_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="size-2 rounded-sm bg-info"></i>{m.agentOverview_toolbar_files_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="size-2 rounded-sm bg-warning"
            ></i>{m.agentOverview_toolbar_notes_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="h-0.5 w-5 bg-muted-foreground"
            ></i>{m.agentOverview_toolbar_delegation_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="h-0.5 w-5 bg-info"></i>{m.agentOverview_toolbar_messages_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="w-5 border-t border-dashed border-warning"
            ></i>{m.agentOverview_toolbar_waiting_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="w-5 border-t border-dashed border-muted-foreground"
            ></i>{m.agentOverview_toolbar_read_label()}</span
          >
          <span class="flex items-center gap-2"
            ><i class="h-0.5 w-5 bg-info"></i>{m.agentOverview_toolbar_write_label()}</span
          >
        </div>
      </details>
    </div>

    <div
      class="pointer-events-auto rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-subtle shadow-sm backdrop-blur"
      data-graph-controls
    >
      {$graphState$.stats.agents.active === 1
        ? m.agentOverview_toolbar_activeAgents_one({ count: 1 })
        : m.agentOverview_toolbar_activeAgents_many({ count: $graphState$.stats.agents.active })}
      · {taskCount === 1
        ? m.agentOverview_toolbar_tasks_one({ count: 1 })
        : m.agentOverview_toolbar_tasks_many({ count: taskCount })}
      · {$graphState$.stats.files === 1
        ? m.agentOverview_toolbar_files_one({ count: 1 })
        : m.agentOverview_toolbar_files_many({ count: $graphState$.stats.files })}
    </div>
  </div>
</div>

<style>
  .agent-overview-panel {
    min-height: 300px;
  }
</style>
