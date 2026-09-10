<script lang="ts">
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { EDGE_STYLES } from './constants';
  import { HULL_FILL_OPACITIES } from './hull-geometry';
  import AgentOrbNode from './nodes/AgentOrbNode.svelte';
  import ResourceNode from './nodes/ResourceNode.svelte';
  import TaskAnchorNode from './nodes/TaskAnchorNode.svelte';
  import type { AgentNode, FileNode, NoteNode, TaskNode } from './types';

  let { compact = false }: { compact?: boolean } = $props();

  const base = { x: 0, y: 0, vx: 0, vy: 0 };
  const task: TaskNode = {
    ...base,
    id: 'legend-task',
    type: 'task',
    taskId: 'legend-task',
    title: m.agentOverview_toolbar_tasks_label(),
    state: 'in_progress',
    dependsOn: [],
  };
  const agent = (status: AgentNode['status'], name: string): AgentNode => ({
    ...base,
    id: `legend-agent-${status}`,
    type: 'agent',
    agentId: `legend-agent-${status}`,
    name,
    isCoordinator: false,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const file = (external = false): FileNode => ({
    ...base,
    id: external ? 'legend-external' : 'legend-file',
    type: 'file',
    path: external ? '/external/example.ts' : 'src/example.ts',
    fileName: external ? 'external.ts' : 'example.ts',
    isExternal: external,
    lastAction: 'read',
    lastActionTimestamp: '9999-01-01T00:00:00.000Z',
  });
  const note: NoteNode = {
    ...base,
    id: 'legend-note',
    type: 'note',
    noteId: 'legend-note',
    title: m.chat_shared_note_fallback(),
    lastAction: 'read',
    lastActionTimestamp: '9999-01-01T00:00:00.000Z',
  };
  const agentExamples: Array<{ node: AgentNode; label: string }> = [
    {
      node: agent('idle', m.agentOverview_hierarchyGraph_statusIdle_label()),
      label: m.agentOverview_hierarchyGraph_statusIdle_label(),
    },
    {
      node: agent('responding', m.agentOverview_legend_working_label()),
      label: m.agentOverview_legend_working_label(),
    },
    {
      node: agent('waiting', m.agentOverview_hierarchyGraph_statusWaiting_label()),
      label: m.agentOverview_hierarchyGraph_statusWaiting_label(),
    },
  ];
  const resourceExamples: Array<{ node: FileNode | NoteNode; label: string }> = [
    { node: file(), label: m.agentOverview_toolbar_files_label() },
    { node: note, label: m.agentOverview_toolbar_notes_label() },
    { node: file(true), label: m.agentOverview_toolbar_externalFile_label() },
  ];

  const edgeGroups = [
    {
      label: m.agentOverview_legend_structural_label(),
      edges: [
        ['task-assignment', m.agentOverview_legend_assignment_label()],
        ['delegation', m.agentOverview_toolbar_delegation_label()],
      ],
    },
    {
      label: m.agentOverview_legend_resource_label(),
      edges: [
        ['file-read', m.agentOverview_toolbar_read_label()],
        ['file-write', m.agentOverview_toolbar_write_label()],
      ],
    },
    {
      label: m.agentOverview_legend_communication_label(),
      edges: [['message', m.agentOverview_toolbar_messages_label()]],
    },
    {
      label: m.agentOverview_legend_temporal_label(),
      edges: [['waiting-on', m.agentOverview_toolbar_waiting_label()]],
    },
  ] as const;
</script>

<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      {#if compact}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-sm"
          iconOnly
          aria-label={m.agentOverview_toolbar_legend_label()}
        >
          <Fa icon={faCircleInfo} class="size-3" />
        </Button>
      {:else}
        <Button {...props} variant="ghost-light" size="xs">
          <Fa icon={faCircleInfo} class="size-3" />
          {m.agentOverview_toolbar_legend_label()}
        </Button>
      {/if}
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      role="dialog"
      aria-label={m.agentOverview_toolbar_legend_label()}
      align="start"
      side="bottom"
      sideOffset={6}
      collisionPadding={8}
      class="legend-popover z-(--layer-popover) grid grid-cols-2 gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-(--elevation-overlay) outline-none"
      data-agent-overview-legend
    >
      <section>
        <h3 class="type-caption mb-2 font-semibold text-muted-foreground">
          {m.agentOverview_legend_nodes_label()}
        </h3>
        <div class="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div class="legend-item">
            <span class="node-preview task" aria-hidden="true" inert
              ><TaskAnchorNode node={task} tabindex={-1} /></span
            >
            <span>{m.agentOverview_toolbar_tasks_label()}</span>
          </div>
          {#each agentExamples as { node, label } (node.id)}
            <div class="legend-item">
              <span class="node-preview agent" aria-hidden="true" inert
                ><AgentOrbNode {node} tabindex={-1} /></span
              >
              <span>{label}</span>
            </div>
          {/each}
          {#each resourceExamples as { node, label } (node.id)}
            <div class="legend-item">
              <span class="node-preview resource" aria-hidden="true" inert>
                <ResourceNode {node} access="read" tabindex={-1} />
              </span>
              <span>{label}</span>
            </div>
          {/each}
          {#each [[HULL_FILL_OPACITIES.idle, m.agentOverview_hierarchyGraph_statusIdle_label()], [HULL_FILL_OPACITIES.working, m.agentOverview_legend_working_label()]] as [opacity, label]}
            <div class="legend-item">
              <svg class="h-8 w-14" viewBox="0 0 56 32" aria-hidden="true">
                <path
                  d="M4 18C5 5 17 2 29 6S51 7 52 19 39 31 25 27 3 31 4 18Z"
                  fill="currentColor"
                  fill-opacity={opacity}
                />
              </svg>
              <span>{m.agentOverview_legend_hull_label()} · {label}</span>
            </div>
          {/each}
        </div>
      </section>
      <section>
        <h3 class="type-caption mb-2 font-semibold text-muted-foreground">
          {m.agentOverview_legend_edges_label()}
        </h3>
        <div class="space-y-3 text-xs text-muted-foreground">
          {#each edgeGroups as group}
            <div>
              <p class="mb-1 font-semibold text-foreground">{group.label}</p>
              <div class="grid grid-cols-2 gap-2">
                {#each group.edges as [type, label]}
                  {@const style = EDGE_STYLES[type]}
                  <span class="flex items-center gap-2">
                    <svg class="h-3 w-10 overflow-visible" viewBox="0 0 40 12" aria-hidden="true">
                      <line
                        x1="1"
                        y1="6"
                        x2="39"
                        y2="6"
                        stroke={style.stroke}
                        stroke-width={style.strokeWidth}
                        stroke-dasharray={style.strokeDasharray}
                        opacity={style.opacity}
                      />
                    </svg>
                    {label}
                  </span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.legend-popover) {
    width: min(38rem, calc(100vw - 1rem));
  }
  .legend-item {
    display: grid;
    grid-template-columns: 3.5rem 1fr;
    min-height: 2rem;
    align-items: center;
    gap: 0.5rem;
  }
  .node-preview {
    position: relative;
    display: block;
    height: 2rem;
    width: 3.5rem;
    overflow: hidden;
    pointer-events: none;
  }
  .node-preview :global(button) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: center;
  }
  .node-preview.task :global(button) {
    transform: translate(-50%, -50%) scale(0.3);
  }
  .node-preview.agent :global(button) {
    transform: translate(-50%, -50%) scale(0.36);
  }
  .node-preview.resource :global(button) {
    transform: translate(-50%, -50%) scale(0.36);
  }
</style>
