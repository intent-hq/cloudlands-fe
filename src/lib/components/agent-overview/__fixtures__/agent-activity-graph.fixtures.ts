import type { TaskStatus } from '$shared/types';
import type {
  AgentNode,
  FileNode,
  GraphEdge,
  GraphNode,
  GraphState,
  NoteNode,
  TaskNode,
} from '../types';

const TASK_STATUSES: readonly TaskStatus[] = [
  'not_started',
  'waiting',
  'discussion_needed',
  'blocked',
  'in_progress',
  'review_required',
  'complete',
  'cancelled',
];
const physics = { x: 0, y: 0, vx: 0, vy: 0 } as const;

function timestamp(now: number, offsetMs = 0): string {
  return new Date(now + offsetMs).toISOString();
}

function agent(
  id: string,
  name: string,
  status: AgentNode['status'],
  now: number,
  overrides: Partial<AgentNode> = {},
): AgentNode {
  return {
    ...physics,
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name,
    isCoordinator: false,
    status,
    createdAt: timestamp(now, -30 * 60_000),
    ...overrides,
  };
}

function task(id: string, title: string, state: TaskStatus, dependsOn: string[] = []): TaskNode {
  return { ...physics, id: `task:${id}`, type: 'task', taskId: id, title, state, dependsOn };
}

function file(
  path: string,
  action: FileNode['lastAction'],
  now: number,
  ageMs: number,
  isExternal = false,
): FileNode {
  return {
    ...physics,
    id: `file:${path}`,
    type: 'file',
    path,
    fileName: path.split('/').at(-1) ?? path,
    isExternal,
    lastAction: action,
    lastActionTimestamp: timestamp(now, -ageMs),
  };
}

function note(id: string, title: string, action: NoteNode['lastAction'], now: number): NoteNode {
  return {
    ...physics,
    id: `note:${id}`,
    type: 'note',
    noteId: id,
    title,
    lastAction: action,
    lastActionTimestamp: timestamp(now, -900),
  };
}

function assignment(agentId: string, taskId: string, now: number): GraphEdge {
  return {
    id: `assignment:${agentId}:${taskId}`,
    type: 'task-assignment',
    sourceId: `agent:${agentId}`,
    targetId: `task:${taskId}`,
    agentId,
    taskId,
    timestamp: timestamp(now, -700),
    isActive: false,
  };
}

function delegation(parentAgentId: string, childAgentId: string, now: number): GraphEdge {
  return {
    id: `delegation:${parentAgentId}:${childAgentId}`,
    type: 'delegation',
    sourceId: `agent:${parentAgentId}`,
    targetId: `agent:${childAgentId}`,
    parentAgentId,
    childAgentId,
    timestamp: timestamp(now, -500),
    isActive: false,
  };
}

function message(
  senderAgentId: string,
  receiverAgentId: string,
  now: number,
  count = 1,
): GraphEdge {
  return {
    id: `message:${senderAgentId}:${receiverAgentId}`,
    type: 'message',
    sourceId: `agent:${senderAgentId}`,
    targetId: `agent:${receiverAgentId}`,
    senderAgentId,
    receiverAgentId,
    count,
    timestamp: timestamp(now, -250),
    isActive: true,
  };
}

function waiting(waiterAgentId: string, targetAgentId: string, now: number): GraphEdge {
  return {
    id: `waiting:${waiterAgentId}:${targetAgentId}`,
    type: 'waiting-on',
    sourceId: `agent:${waiterAgentId}`,
    targetId: `agent:${targetAgentId}`,
    waiterAgentId,
    targetAgentId,
    count: 1,
    timestamp: timestamp(now, -400),
    isActive: true,
  };
}

function fileInteraction(
  agentId: string,
  target: FileNode,
  access: 'read' | 'write',
  now: number,
  index: number,
): GraphEdge {
  return {
    id: `file-${access}:${agentId}:${target.path}`,
    type: `file-${access}`,
    sourceId: `agent:${agentId}`,
    targetId: target.id,
    agentId,
    filePath: target.path,
    count: (index % 3) + 1,
    additions: access === 'write' ? 12 + index * 3 : undefined,
    deletions: access === 'write' ? 2 + index : undefined,
    timestamp: timestamp(now, -(index % 5) * 450),
    isActive: index % 4 === 0,
  };
}

function noteInteraction(
  agentId: string,
  target: NoteNode,
  access: 'read' | 'write',
  now: number,
  index: number,
): GraphEdge {
  return {
    id: `note-${access}:${agentId}:${target.noteId}`,
    type: `note-${access}`,
    sourceId: `agent:${agentId}`,
    targetId: target.id,
    agentId,
    noteId: target.noteId,
    count: (index % 2) + 1,
    additions: access === 'write' ? 8 + index : undefined,
    deletions: access === 'write' ? 1 + (index % 3) : undefined,
    timestamp: timestamp(now, -(index % 4) * 500),
    isActive: index % 3 === 0,
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[], now: number): GraphState {
  const tasks = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const node of nodes) if (node.type === 'task') tasks[node.state] += 1;
  const agents = nodes.filter((node): node is AgentNode => node.type === 'agent');
  return {
    nodes,
    edges,
    stats: {
      agents: {
        active: agents.filter(({ status }) => status === 'responding').length,
        total: agents.length,
      },
      tasks,
      files: nodes.filter(({ type }) => type === 'file').length,
      notes: nodes.filter(({ type }) => type === 'note').length,
    },
    currentTime: timestamp(now),
    isLive: true,
    minTime: timestamp(now, -30 * 60_000),
    maxTime: timestamp(now),
  };
}

export function buildConstellationGraph(now = Date.now()): GraphState {
  const agents = [
    agent('coordinator', 'Constellation coordinator', 'responding', now, {
      isCoordinator: true,
      activeToolName: 'workspace_api',
      lastResponse: 'Coordinating the graph preview',
    }),
    agent('model', 'Graph model implementor', 'responding', now, {
      specialist: 'implementor',
      parentAgentId: 'coordinator',
      taskNoteId: 'graph-model',
      activeToolName: 'apply_patch',
    }),
    agent('canvas', 'Canvas implementor', 'completed', now, {
      specialist: 'implementor',
      parentAgentId: 'coordinator',
      taskNoteId: 'graph-canvas',
      lastResponse: 'Canvas implementation complete',
    }),
    agent('preview', 'Preview implementor', 'idle', now, {
      specialist: 'implementor',
      parentAgentId: 'coordinator',
      taskNoteId: 'graph-preview',
    }),
    agent('verifier', 'Graph verifier', 'waiting', now, {
      specialist: 'verifier',
      parentAgentId: 'model',
      waitingForAgentIds: ['model'],
      lastResponse: 'Waiting for the implementation',
    }),
  ];
  const tasks = [
    task('graph-model', 'Build graph state model', 'in_progress'),
    task('graph-canvas', 'Render constellation canvas', 'complete', ['graph-model']),
    task('graph-preview', 'Add sandbox preview', 'not_started', ['graph-canvas']),
  ];
  const files = [
    file('src/lib/components/agent-overview/types.ts', 'read', now, 4_000),
    file('src/lib/components/agent-overview/AgentActivityGraph.svelte', 'write', now, 200),
    file('src/lib/components/agent-overview/constellation-layout.ts', 'read', now, 3_200),
    file('src/lib/component-catalog/preview-definition.ts', 'read', now, 2_800),
    file('src/lib/component-catalog/catalog.ts', 'write', now, 650),
    file(
      'src/lib/components/agent-overview/__tests__/AgentActivityGraph.test.ts',
      'read',
      now,
      7_000,
    ),
    file('messages/en.json', 'read', now, 8_000),
    file('docs/fe/DEVELOPER_GUIDE.md', 'read', now, 12_000),
    file('/tmp/constellation-preview.png', 'read', now, 1_400, true),
  ];
  const notes = [
    note('spec', 'Interactive graph specification', 'read', now),
    note('graph-model', 'Graph model task', 'write', now),
    note('graph-preview', 'Sandbox preview task', 'write', now),
  ];
  const resourceOwners = [
    'coordinator',
    'model',
    'model',
    'canvas',
    'canvas',
    'preview',
    'verifier',
    'coordinator',
    'coordinator',
  ];
  const edges: GraphEdge[] = [
    assignment('model', 'graph-model', now),
    assignment('canvas', 'graph-canvas', now),
    assignment('preview', 'graph-preview', now),
    delegation('coordinator', 'model', now),
    delegation('model', 'verifier', now),
    delegation('coordinator', 'canvas', now),
    delegation('coordinator', 'preview', now),
    message('coordinator', 'model', now, 3),
    message('model', 'verifier', now, 2),
    waiting('verifier', 'model', now),
    ...files.map((target, index) =>
      fileInteraction(
        resourceOwners[index],
        target,
        index === 1 || index === 4 ? 'write' : 'read',
        now,
        index,
      ),
    ),
    noteInteraction('coordinator', notes[0], 'read', now, 0),
    noteInteraction('model', notes[1], 'write', now, 1),
    noteInteraction('preview', notes[2], 'write', now, 2),
  ];
  return graph([...agents, ...tasks, ...files, ...notes], edges, now);
}

export function buildBusyGraph(now = Date.now()): GraphState {
  const coordinators = [
    agent('busy-coordinator-a', 'Frontend coordinator', 'responding', now, { isCoordinator: true }),
    agent('busy-coordinator-b', 'Release coordinator', 'waiting', now, { isCoordinator: true }),
  ];
  const workerStatuses: AgentNode['status'][] = [
    'responding',
    'waiting',
    'idle',
    'completed',
    'failed',
    'responding',
  ];
  const workers = workerStatuses.map((status, index) =>
    agent(`busy-worker-${index + 1}`, `Specialist ${index + 1}`, status, now, {
      specialist: index === 4 ? 'verifier' : 'implementor',
      parentAgentId: index < 3 ? 'busy-coordinator-a' : 'busy-coordinator-b',
      taskNoteId: `busy-task-${index + 1}`,
      activeToolName: status === 'responding' ? 'apply_patch' : undefined,
    }),
  );
  const taskStates: TaskStatus[] = [
    'in_progress',
    'in_progress',
    'complete',
    'review_required',
    'blocked',
    'not_started',
  ];
  const tasks = taskStates.map((state, index) =>
    task(`busy-task-${index + 1}`, `Activity graph milestone ${index + 1}`, state),
  );
  const files = Array.from({ length: 18 }, (_, index) =>
    file(
      `src/features/activity/resource-${index + 1}.ts`,
      index % 3 === 0 ? 'write' : 'read',
      now,
      (index % 7) * 500,
    ),
  );
  const notes = Array.from({ length: 7 }, (_, index) =>
    note(
      `busy-note-${index + 1}`,
      `Milestone note ${index + 1}`,
      index % 2 ? 'read' : 'write',
      now,
    ),
  );
  const edges: GraphEdge[] = [
    assignment('busy-coordinator-a', 'busy-task-1', now),
    assignment('busy-coordinator-b', 'busy-task-4', now),
    ...workers.map((_, index) =>
      assignment(`busy-worker-${index + 1}`, `busy-task-${index + 1}`, now),
    ),
    ...workers.map((worker, index) =>
      delegation(index < 3 ? 'busy-coordinator-a' : 'busy-coordinator-b', worker.agentId, now),
    ),
    message('busy-coordinator-a', 'busy-worker-1', now, 5),
    message('busy-worker-1', 'busy-worker-2', now, 3),
    message('busy-coordinator-b', 'busy-worker-4', now, 4),
    message('busy-worker-6', 'busy-coordinator-a', now, 2),
    waiting('busy-worker-2', 'busy-worker-1', now),
    waiting('busy-coordinator-b', 'busy-worker-4', now),
    ...files.map((target, index) =>
      fileInteraction(
        `busy-worker-${(index % workers.length) + 1}`,
        target,
        index % 3 === 0 ? 'write' : 'read',
        now,
        index,
      ),
    ),
    ...notes.map((target, index) =>
      noteInteraction(
        `busy-worker-${(index % workers.length) + 1}`,
        target,
        index % 2 === 0 ? 'write' : 'read',
        now,
        index,
      ),
    ),
  ];
  return graph([...coordinators, ...workers, ...tasks, ...files, ...notes], edges, now);
}

export function buildLargeGraph(now = Date.now()): GraphState {
  const coordinator = agent('large-coordinator', 'Large workspace coordinator', 'responding', now, {
    isCoordinator: true,
    activeToolName: 'workspace_api',
  });
  const workers = Array.from({ length: 12 }, (_, index) =>
    agent(
      `large-worker-${index + 1}`,
      `Workspace specialist ${index + 1}`,
      index < 3 ? 'responding' : index < 6 ? 'waiting' : 'completed',
      now,
      {
        specialist: 'implementor',
        parentAgentId: 'large-coordinator',
        taskNoteId: `large-task-${index + 1}`,
        activeToolName: index < 3 ? 'apply_patch' : undefined,
      },
    ),
  );
  const tasks = Array.from({ length: 66 }, (_, index) =>
    task(
      `large-task-${index + 1}`,
      `Large workspace task ${index + 1}`,
      index < 3 ? 'in_progress' : index < 12 ? 'complete' : 'not_started',
    ),
  );
  const files = Array.from({ length: 24 }, (_, index) =>
    file(
      `src/features/large-workspace/resource-${index + 1}.ts`,
      index % 3 === 0 ? 'write' : 'read',
      now,
      (index % 8) * 500,
    ),
  );
  const edges: GraphEdge[] = [
    ...workers.map((_, index) =>
      assignment(`large-worker-${index + 1}`, `large-task-${index + 1}`, now),
    ),
    ...workers.map((worker) => delegation('large-coordinator', worker.agentId, now)),
    ...files.map((target, index) =>
      fileInteraction(
        `large-worker-${(index % workers.length) + 1}`,
        target,
        index % 3 === 0 ? 'write' : 'read',
        now,
        index,
      ),
    ),
    message('large-coordinator', 'large-worker-1', now, 6),
    waiting('large-worker-4', 'large-worker-1', now),
  ];
  return graph([coordinator, ...workers, ...tasks, ...files], edges, now);
}

export function buildEmptyGraph(now = Date.now()): GraphState {
  return graph([], [], now);
}

export function buildSingleAgentGraph(now = Date.now()): GraphState {
  const solo = agent('solo', 'Solo investigator', 'idle', now, {
    isCoordinator: true,
    lastResponse: 'Exploring the component architecture',
  });
  const files = [
    file('src/lib/components/agent-overview/types.ts', 'read', now, 2_000),
    file('src/lib/components/agent-overview/graph-helpers.ts', 'read', now, 3_000),
    file('src/lib/components/agent-overview/constants.ts', 'write', now, 800),
  ];
  const edges = files.map((target, index) =>
    fileInteraction('solo', target, index === 2 ? 'write' : 'read', now, index),
  );
  return graph([solo, ...files], edges, now);
}

export function buildReplayGraph(endTime = Date.now(), cursorTime = endTime): GraphState {
  const start = endTime - 10 * 60_000;
  const cursor = Math.min(endTime, Math.max(start, cursorTime));
  const at = (offsetMs: number) => start + offsetMs;
  const visible = (time: number) => time <= cursor;
  const active = (time: number) => visible(time) && cursor - time < 10_000;
  const eventOffsets = [
    0, 20_000, 60_000, 85_000, 120_000, 145_000, 180_000, 220_000, 260_000, 305_000, 360_000,
    405_000, 470_000, 530_000, 570_000, 600_000,
  ];
  const workerSpecs = [
    { id: 'replay-model', name: 'Model implementor', created: at(60_000), done: at(360_000) },
    { id: 'replay-canvas', name: 'Canvas implementor', created: at(120_000), done: at(470_000) },
    { id: 'replay-tests', name: 'Test implementor', created: at(180_000), done: at(570_000) },
  ];
  const coordinator = agent(
    'replay-coordinator',
    'Playback coordinator',
    cursor < at(590_000) ? 'responding' : 'idle',
    endTime,
    {
      isCoordinator: true,
      createdAt: timestamp(start),
      activeToolName: cursor < at(590_000) ? 'workspace_api' : undefined,
    },
  );
  const workers = workerSpecs
    .filter(({ created }) => visible(created))
    .map(({ id, name, created, done }, index) =>
      agent(id, name, cursor < done ? 'responding' : 'completed', endTime, {
        parentAgentId: 'replay-coordinator',
        taskNoteId: `replay-task-${index + 1}`,
        specialist: 'implementor',
        createdAt: timestamp(created),
        activeToolName: cursor < done ? 'apply_patch' : undefined,
      }),
    );
  const tasks = workerSpecs.map(({ done }, index) => ({
    ...task(
      `replay-task-${index + 1}`,
      ['Build graph model', 'Render constellation', 'Verify playback'][index],
      cursor < done
        ? visible(workerSpecs[index].created)
          ? 'in_progress'
          : 'not_started'
        : 'complete',
    ),
    lastActionTimestamp: timestamp(start),
  }));
  const resources = [
    { path: 'src/lib/components/agent-overview/types.ts', time: at(85_000), owner: 0 },
    {
      path: 'src/store/renderer/slices/agent-overview/agent-overview-selectors.ts',
      time: at(145_000),
      owner: 0,
    },
    {
      path: 'src/lib/components/agent-overview/AgentActivityGraph.svelte',
      time: at(220_000),
      owner: 1,
    },
    { path: 'src/lib/components/agent-overview/TimeScrubber.svelte', time: at(305_000), owner: 1 },
    {
      path: 'src/lib/components/agent-overview/__tests__/playback.test.ts',
      time: at(405_000),
      owner: 2,
    },
    { path: 'messages/en.json', time: at(530_000), owner: 2 },
    { path: '/tmp/replay-frame.png', time: at(470_000), owner: 2, isExternal: true },
  ].filter(({ time }) => visible(time));
  const fileNodes = resources.map(({ path, time, isExternal }) =>
    file(path, 'write', endTime, endTime - time, isExternal),
  );
  const timed = (edge: GraphEdge, time: number): GraphEdge => ({
    ...edge,
    timestamp: timestamp(time),
    isActive: active(time),
  });
  const edges: GraphEdge[] = [];
  workerSpecs.forEach(({ id, created }, index) => {
    if (!visible(created)) return;
    edges.push(timed(delegation('replay-coordinator', id, endTime), created));
    edges.push(timed(assignment(id, `replay-task-${index + 1}`, endTime), created));
  });
  resources.forEach(({ owner, time }, index) => {
    edges.push(
      timed(
        fileInteraction(workerSpecs[owner].id, fileNodes[index], 'write', endTime, index),
        time,
      ),
    );
  });
  [at(260_000), at(405_000), at(530_000)].forEach((time, index) => {
    if (visible(time)) {
      edges.push(timed(message(workerSpecs[index].id, 'replay-coordinator', endTime), time));
    }
  });
  const result = graph([coordinator, ...workers, ...tasks, ...fileNodes], edges, cursor);
  return {
    ...result,
    currentTime: timestamp(cursor),
    isLive: cursor >= endTime,
    minTime: timestamp(start),
    maxTime: timestamp(endTime),
    eventTimes: eventOffsets.map((offset) => timestamp(start + offset)),
  };
}
