<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus, type AgentSession, type Note, type TaskStatus } from '$shared/types';
  import { AgentId, NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import TestTaskItemNodeView from './TestTaskItemNodeView.test.svelte';
  import WorkspaceRouteContextProvider from '$lib/components/workspace/WorkspaceRouteContextProvider.svelte';

  let {
    width = 420,
    theme = 'light',
    zoom = 1,
  }: { width?: number; theme?: 'light' | 'dark'; zoom?: number } = $props();

  const workspaceId = WorkspaceId('workspace-one-row-task');
  const note = (
    id: string,
    title: string,
    status: TaskStatus,
    agentId?: string,
    withRelations = false,
  ) =>
    ({
      id: NoteId(id),
      workspaceId,
      title,
      content: `Agent response preview for ${title} must not render.`,
      metadata: {
        task: {
          status,
          assignedAgentIds: agentId ? [agentId] : undefined,
          unmetDependsOn: withRelations ? [NoteId('task-dependency')] : undefined,
          conflictsWith: withRelations ? [NoteId('task-conflict')] : undefined,
        },
      },
    }) as Note;
  const notes = [
    note(
      'task-todo',
      'A very long assigned task title that must truncate before the fixed agent control',
      'not_started',
      'agent-loading',
    ),
    note('task-running', 'Running assigned task', 'in_progress', 'agent-active'),
    note('task-waiting', 'Waiting unassigned task', 'waiting', undefined, true),
    note('task-review', 'Review assigned task', 'review_required', 'agent-complete'),
    note('task-complete', 'Complete unassigned task', 'complete'),
    note('task-discussion', 'Discussion needed task', 'discussion_needed'),
    note('task-blocked', 'Blocked assigned task', 'blocked', 'agent-error'),
    note('task-cancelled', 'Cancelled unassigned task', 'cancelled'),
  ];
  const timestamp = '2026-08-20T00:00:00.000Z';
  const agent = (id: string, name: string, status: AgentStatus, active = false) =>
    ({
      id: AgentId(id),
      backendSessionId: null,
      workspaceId,
      name,
      status,
      isStreaming: active,
      isResponding: active,
      digest: active ? '**raw digest must stay hidden**' : undefined,
      lastAgentResponse: active ? '[raw response](https://example.com)' : undefined,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }) as AgentSession;
  const dispose = store.init();
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  store.dispatch(
    bulkUpsertSessions(
      [
        agent('agent-active', 'Active task agent', AgentStatus.Active, true),
        agent('agent-complete', 'Complete task agent', AgentStatus.Completed),
        agent('agent-error', 'Error task agent', AgentStatus.Error),
      ],
      { preserveExplicitRuntimeFlags: false },
    ),
  );

  function linkedNode(id: string, title: string) {
    const text = {
      isText: true,
      marks: [{ type: { name: 'link' }, attrs: { href: `intent://local/task/${id}` } }],
    };
    return {
      attrs: { checked: false, status: 'todo' },
      nodeSize: 10,
      textContent: title,
      content: {
        forEach: (visit: (node: unknown) => void) =>
          visit({ content: { forEach: (fn: (node: unknown) => void) => fn(text) } }),
      },
    } as any;
  }
  const missingNode = linkedNode('task-missing', 'Missing linked task');
  const optimisticNode = {
    attrs: { checked: false, status: 'in-progress', delegatedAgentId: 'agent-active' },
    nodeSize: 10,
    textContent: 'Optimistic delegated task',
    content: { forEach: () => {} },
  } as any;
  const editor = { state: { doc: { nodeAt: () => null } }, on: () => {}, off: () => {} } as any;

  onDestroy(dispose);
</script>

<WorkspaceRouteContextProvider {workspaceId}>
  <div
    data-one-row-task-surface
    data-theme={theme}
    style:width="{width}px"
    style:zoom
    class:dark={theme === 'dark'}
    class="bg-background p-4 text-foreground"
  >
    <ul class="m-0 p-0">
      {#each notes as task (task.id)}
        <TestTaskItemNodeView
          node={linkedNode(task.id, task.title)}
          {editor}
          getPos={() => 0}
          {workspaceId}
          selected={task.id === 'task-complete'}
        />
      {/each}
      <TestTaskItemNodeView node={missingNode} {editor} getPos={() => 0} {workspaceId} />
      <TestTaskItemNodeView node={optimisticNode} {editor} getPos={() => 0} {workspaceId} />
    </ul>
  </div>
</WorkspaceRouteContextProvider>
