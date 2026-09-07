import { describe, expect, it, vi } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';
import type { AgentNode, GraphEdge, GraphNode, TaskNode } from '../types';
import {
  convertToInteractionEvent,
  createTaskHullMembershipMemo,
  deriveTaskHullMemberships,
  getNodeStatus,
  getStreamingState,
  isExternalFilePath,
  mergeEdgesByPair,
} from '../graph-helpers';

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'agent-1' as any,
    backendSessionId: null,
    workspaceId: 'ws-1' as any,
    name: 'Agent',
    status: 'idle' as any,
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const staleStreamingAssistant = {
  id: 'msg-1',
  role: 'assistant' as const,
  timestamp: '2024-01-01T00:00:00.000Z',
  streamingComplete: false,
  contentBlocks: [{ type: 'text' as const, text: 'Stale response' }],
};

const physics = { x: 0, y: 0, vx: 0, vy: 0 } as const;

function hullAgent(id: string, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    ...physics,
    id: `agent:${id}`,
    type: 'agent',
    agentId: id,
    name: id,
    isCoordinator: false,
    parentAgentId: 'agent:hub',
    status: 'idle',
    createdAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

function hullTask(id: string): TaskNode {
  return {
    ...physics,
    id: `task:${id}`,
    type: 'task',
    taskId: id,
    title: id,
    state: 'in_progress',
    dependsOn: [],
  };
}

function hullAssignment(agentId: string, taskId: string): GraphEdge {
  return {
    id: `assignment:${agentId}:${taskId}`,
    type: 'task-assignment',
    sourceId: `agent:${agentId}`,
    targetId: `task:${taskId}`,
    agentId,
    taskId,
    timestamp: '2026-09-07T00:00:00.000Z',
    isActive: false,
  };
}

describe('agent overview graph helpers', () => {
  describe('task hull memberships', () => {
    it('excludes top-level hub agents from a task pool', () => {
      const memberships = deriveTaskHullMemberships(
        [
          hullTask('one'),
          hullAgent('hub', { parentAgentId: null }),
          hullAgent('coordinator', { isCoordinator: true }),
          hullAgent('worker'),
        ],
        [
          hullAssignment('hub', 'one'),
          hullAssignment('coordinator', 'one'),
          hullAssignment('worker', 'one'),
        ],
      );

      expect(memberships).toEqual([
        {
          taskId: 'task:one',
          agentIds: ['agent:worker'],
          memberIds: ['task:one', 'agent:worker'],
        },
      ]);
    });

    it('does not create a hull for a task assigned only to a hub agent', () => {
      expect(
        deriveTaskHullMemberships(
          [hullTask('one'), hullAgent('hub', { parentAgentId: null })],
          [hullAssignment('hub', 'one')],
        ),
      ).toEqual([]);
    });

    it('reuses memoised membership for position-only node updates', () => {
      const build = vi.fn(deriveTaskHullMemberships);
      const memo = createTaskHullMembershipMemo(build);
      const nodes: GraphNode[] = [hullTask('one'), hullAgent('worker')];
      const edges = [hullAssignment('worker', 'one')];
      const initial = memo(nodes, edges);
      const moved = nodes.map((node) => ({ ...node, x: node.x + 120, y: node.y - 40 }));

      expect(memo(moved, edges)).toBe(initial);
      expect(build).toHaveBeenCalledOnce();
    });
  });

  describe('mergeEdgesByPair', () => {
    const edge = (overrides: Partial<GraphEdge> = {}): GraphEdge =>
      ({
        id: 'read:a-b',
        type: 'file-read',
        sourceId: 'agent:a',
        targetId: 'file:b',
        agentId: 'a',
        filePath: 'src/b.ts',
        timestamp: '2026-09-06T00:00:00.000Z',
        isActive: false,
        count: 1,
        ...overrides,
      }) as GraphEdge;

    it('merges opposite directions into one bidirectional connection', () => {
      const [pair] = mergeEdgesByPair([
        edge(),
        edge({ id: 'read:b-a', sourceId: 'file:b', targetId: 'agent:a' }),
      ]);

      expect(pair.members).toHaveLength(2);
      expect([...pair.directions]).toEqual(['a-to-b', 'b-to-a']);
    });

    it('uses writes as the primary type for a read-write pair', () => {
      const [pair] = mergeEdgesByPair([edge(), edge({ id: 'write:a-b', type: 'file-write' })]);

      expect(pair.type).toBe('file-write');
    });

    it('keeps unrelated pairs separate', () => {
      const pairs = mergeEdgesByPair([
        edge(),
        edge({ id: 'read:a-c', targetId: 'file:c', filePath: 'src/c.ts' }),
      ]);

      expect(pairs.map((pair) => pair.key)).toEqual(['agent:a|file:b', 'agent:a|file:c']);
    });

    it('aggregates activity and uses the latest member timestamp', () => {
      const [pair] = mergeEdgesByPair(
        [
          edge(),
          edge({
            id: 'write:a-b',
            type: 'file-write',
            timestamp: '2026-09-06T00:01:00.000Z',
            isActive: true,
          }),
        ],
        Date.parse('2026-09-06T00:01:05.000Z'),
      );

      expect(pair.isActive).toBe(true);
      expect(pair.isRecentlyActive).toBe(true);
      expect(pair.timestamp).toBe('2026-09-06T00:01:00.000Z');
      expect(pair.latestEdge.id).toBe('write:a-b');
    });
  });

  describe('isExternalFilePath', () => {
    const roots = ['/repo'];

    it.each([
      ['src/internal.ts', false],
      ['/repo', false],
      ['/repo/src/internal.ts', false],
      ['/repo-x/file.ts', true],
      ['/tmp/file.ts', true],
      ['../outside.ts', true],
      ['src/../../outside.ts', true],
    ])('classifies %s', (filePath, expected) => {
      expect(isExternalFilePath(filePath, roots)).toBe(expected);
    });

    it('treats trailing slashes on roots equivalently', () => {
      expect(isExternalFilePath('/repo/src/internal.ts', ['/repo/'])).toBe(false);
    });

    it('marks nothing external without a workspace root', () => {
      expect(isExternalFilePath('/tmp/file.ts', [])).toBe(false);
      expect(isExternalFilePath('../outside.ts', [])).toBe(false);
    });
  });

  it('trusts explicit idle status over stale assistant streaming metadata', () => {
    const session = makeSession({
      status: 'idle' as any,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('idle');
    expect(getStreamingState(session).activeToolName).toBeUndefined();
  });

  it('keeps active response flags authoritative for running state', () => {
    const session = makeSession({
      status: AgentStatus.Idle,
      isProcessing: true,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('responding');
  });

  it('preserves active-message fallback for non-idle delegated sessions', () => {
    const session = makeSession({
      status: AgentStatus.Active,
      isStreaming: false,
      isProcessing: false,
      messages: [staleStreamingAssistant],
    });

    expect(getNodeStatus(session)).toBe('responding');
  });

  describe('getStreamingState wire previews (monorepo#2852)', () => {
    it('derives lastResponse from the wire lastAgentResponse, never the transcript', () => {
      const session = makeSession({
        status: AgentStatus.Active,
        lastAgentResponse: 'First line.\nClean wire line.',
        messages: [
          {
            id: 'msg-1',
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            contentBlocks: [
              {
                type: 'text' as const,
                text: 'Transcript text.\n<!-- suggested-prompts\n["p"]\n-->',
              },
            ],
          },
        ] as any,
      });

      expect(getStreamingState(session).lastResponse).toBe('Clean wire line.');
    });

    it('returns lastResponse even when the transcript is empty', () => {
      const session = makeSession({
        status: AgentStatus.Idle,
        lastAgentResponse: 'Persisted wire response',
        messages: [],
      });

      expect(getStreamingState(session).lastResponse).toBe('Persisted wire response');
    });

    it('surfaces the wire lastToolUse as the active tool only while streaming', () => {
      const toolUse = { name: 'view', input: { path: 'src/a.ts' } };
      const streaming = makeSession({
        status: AgentStatus.Processing,
        isStreaming: true,
        lastToolUse: toolUse as any,
      });
      const idle = makeSession({
        status: AgentStatus.Idle,
        isStreaming: false,
        lastToolUse: toolUse as any,
      });

      const state = getStreamingState(streaming);
      expect(state.activeToolName).toBe('view');
      expect(state.activeToolInput).toEqual({ path: 'src/a.ts' });
      expect(getStreamingState(idle).activeToolName).toBeUndefined();
    });

    it('returns an empty state for undefined sessions', () => {
      expect(getStreamingState(undefined)).toEqual({});
    });
  });

  describe('convertToInteractionEvent', () => {
    const actor = { id: 'agent-source', name: 'Source', type: 'agent' };

    function event(type: string, data: unknown, id = `event-${type}`) {
      return {
        id,
        timestamp: '2026-09-03T12:00:00.000Z',
        type,
        actor,
        data,
      };
    }

    function workspaceApiEvent(code: string) {
      return event('agent:tool:call', {
        toolName: 'workspace_api_workspace-mcp',
        toolKind: 'other',
        input: { code, summary: 'Exercise workspace operations' },
        status: 'completed',
      });
    }

    it.each(['add', 'edit', 'editLines', 'setContent'])(
      'maps ws.note.%s to a note write',
      (method) => {
        const [interaction] = convertToInteractionEvent(
          workspaceApiEvent(`await ws.note.${method}('note-${method}', {});`),
        );

        expect(interaction).toMatchObject({
          type: 'note-write',
          agentId: 'agent-source',
          targetId: `note-${method}`,
        });
      },
    );

    it('maps workspace_api note and file reads and writes in call order', () => {
      const code = [
        'const note = await ws.note.read("spec");',
        "await ws.file.read('src/read.ts');",
        'await ws.file.write(`src/write.ts`, "content");',
      ].join('\n');

      expect(
        convertToInteractionEvent(workspaceApiEvent(code)).map(({ type, targetId }) => ({
          type,
          targetId,
        })),
      ).toEqual([
        { type: 'note-read', targetId: 'spec' },
        { type: 'file-read', targetId: 'src/read.ts' },
        { type: 'file-write', targetId: 'src/write.ts' },
      ]);
    });

    it('maps literal workspace_api agent operations and skips unresolved targets', () => {
      const code = [
        'await ws.agent.send("agent-target", "hello");',
        'await ws.agent.sendToTask("task-message", "hello");',
        'await ws.agent.delegate({ taskNoteId: "task-delegate" });',
        "await ws.agent.create('Worker', 'Do it', { taskNoteId: 'task-create' });",
        'await ws.agent.watch("agent-watched");',
        'await ws.agent.send(dynamicAgentId, "not visible");',
        'await ws.agent.delegate({ taskNoteId: dynamicTaskId });',
      ].join('\n');

      expect(
        convertToInteractionEvent(workspaceApiEvent(code)).map(({ type, targetId }) => ({
          type,
          targetId,
        })),
      ).toEqual([
        { type: 'agent-message', targetId: 'agent-target' },
        { type: 'agent-message', targetId: 'task-message' },
        { type: 'delegation', targetId: 'task-delegate' },
        { type: 'delegation', targetId: 'task-create' },
        { type: 'agent-waiting', targetId: 'agent-watched' },
      ]);
    });

    it.each(['path', 'file_path', 'filePath'])('reads file tool input from %s', (pathKey) => {
      const [interaction] = convertToInteractionEvent(
        event('agent:tool:call', {
          toolName: 'view',
          toolKind: 'file',
          input: { [pathKey]: 'README' },
          status: 'completed',
        }),
      );

      expect(interaction).toMatchObject({ type: 'file-read', targetId: 'README' });
    });

    it('keeps legacy edit-tool detection and emits every filesModified write', () => {
      const interactions = convertToInteractionEvent(
        event('agent:tool:call', {
          toolName: 'str-replace-editor_workspace-mcp',
          toolKind: 'file',
          input: { file_path: 'src/edited.ts' },
          filesModified: ['src/edited.ts', 'src/generated.ts'],
          status: 'completed',
        }),
      );

      expect(interactions.map(({ type, targetId }) => ({ type, targetId }))).toEqual([
        { type: 'file-write', targetId: 'src/edited.ts' },
        { type: 'file-write', targetId: 'src/generated.ts' },
      ]);
    });

    it('deduplicates repeated queue snapshots by queue message id', () => {
      const seen = new Set<string>();
      const first = convertToInteractionEvent(
        event('agent:queue:updated', {
          agentId: 'agent-receiver',
          queue: [
            { id: 'queue-1', fromAgentId: 'agent-sender', content: 'hello' },
            { id: 'queue-1', fromAgentId: 'agent-sender', content: 'hello' },
            { id: 'user-message', content: 'from user' },
          ],
        }),
        seen,
      );
      const second = convertToInteractionEvent(
        event(
          'agent:queue:updated',
          {
            agentId: 'agent-receiver',
            queue: [
              { id: 'queue-1', fromAgentId: 'agent-sender', content: 'hello' },
              { id: 'queue-2', fromAgentId: 'agent-other', content: 'another' },
            ],
          },
          'event-queue-2',
        ),
        seen,
      );

      expect([...first, ...second].map(({ agentId, targetId }) => ({ agentId, targetId }))).toEqual(
        [
          { agentId: 'agent-sender', targetId: 'agent-receiver' },
          { agentId: 'agent-other', targetId: 'agent-receiver' },
        ],
      );
    });

    it('maps every subscription target to an agent-waiting interaction', () => {
      const interactions = convertToInteractionEvent(
        event('agent:subscriptions-changed', {
          agentId: 'agent-waiter',
          isWaitingForOtherAgents: true,
          waitingForAgentIds: ['agent-one', 'agent-two'],
        }),
      );

      expect(
        interactions.map(({ type, agentId, targetId }) => ({ type, agentId, targetId })),
      ).toEqual([
        { type: 'agent-waiting', agentId: 'agent-waiter', targetId: 'agent-one' },
        { type: 'agent-waiting', agentId: 'agent-waiter', targetId: 'agent-two' },
      ]);
    });

    it('maps task agent links to task-update interactions', () => {
      const [interaction] = convertToInteractionEvent(
        event('task:agent-linked', {
          workspaceId: 'workspace-1',
          noteId: 'task-note-1',
          taskKey: 'agent:worker',
          link: {
            taskKey: 'agent:worker',
            taskText: 'Implement graph extraction',
            agentId: 'agent-worker',
            createdAt: 1788436800000,
          },
        }),
      );

      expect(interaction).toMatchObject({
        type: 'task-update',
        agentId: 'agent-worker',
        targetId: 'task-note-1',
        targetName: 'Implement graph extraction',
      });
    });

    it('preserves lifecycle and daemon mutation mappings', () => {
      expect(
        convertToInteractionEvent(
          event('agent:created', {
            agentId: 'agent-child',
            agentName: 'Child',
            createdByAgentId: 'agent-source',
          }),
        )[0],
      ).toMatchObject({
        type: 'agent-created',
        agentId: 'agent-child',
        parentAgentId: 'agent-source',
      });
      expect(
        convertToInteractionEvent(
          event('file:changed', {
            path: '/workspace/src/file.ts',
            relativePath: 'src/file.ts',
            action: 'modify',
          }),
        )[0],
      ).toMatchObject({ type: 'file-write', targetId: '/workspace/src/file.ts' });
      expect(
        convertToInteractionEvent(
          event('note:updated', { noteId: 'spec', title: 'Spec', action: 'update' }),
        )[0],
      ).toMatchObject({ type: 'note-write', targetId: 'spec' });
    });

    it('ignores malformed timestamps and events missing required graph identities', () => {
      expect(
        convertToInteractionEvent({
          ...event('file:changed', { path: 'src/file.ts' }),
          timestamp: 'bad',
        }),
      ).toEqual([]);
      expect(
        convertToInteractionEvent({
          ...event('file:changed', { path: 'src/file.ts' }),
          actor: { type: 'agent' },
        }),
      ).toEqual([]);
      expect(convertToInteractionEvent(event('file:changed', {}))).toEqual([]);
      expect(convertToInteractionEvent(event('note:updated', {}))).toEqual([]);
      expect(
        convertToInteractionEvent({
          ...event('agent:tool:call', { toolName: 'view', toolKind: 'file', input: { path: 'x' } }),
          actor: { type: 'system' },
        }),
      ).toEqual([]);
    });
  });
});
