import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession } from '$shared/types';
import { convertToInteractionEvent, getNodeStatus, getStreamingState } from '../graph-helpers';

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

describe('agent overview graph helpers', () => {
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
  });
});
