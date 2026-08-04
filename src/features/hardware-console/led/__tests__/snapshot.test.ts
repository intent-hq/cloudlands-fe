import { describe, expect, it } from 'vitest';
import { AgentStatus, WorkspaceStatus, type Workspace } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoredAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
import { buildHardwareLedSnapshot, type LedSnapshotState } from '../snapshot';

let nextTime = 1_000_000;

function makeWorkspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  nextTime -= 1000; // later-created workspaces sort as less recent
  const iso = new Date(nextTime).toISOString();
  return {
    id,
    title: id,
    branch: id,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: iso,
    updatedAt: iso,
    lastActivity: iso,
    ...overrides,
  } as Workspace;
}

function makeSession(id: string, overrides: Partial<StoredAgentSession> = {}): StoredAgentSession {
  return { id, status: AgentStatus.RuntimeIdle, messages: [], ...overrides } as StoredAgentSession;
}

function questionMessage(messageId: string) {
  return {
    id: messageId,
    role: 'assistant',
    contentBlocks: [
      {
        type: 'resource',
        resource: {
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          uri: 'intent-question:1',
          text: JSON.stringify({
            attachmentId: 'tar-1',
            header: 'Choice',
            question: 'Which one?',
            options: [{ label: 'A' }, { label: 'B' }],
          }),
        },
      },
    ],
  } as never;
}

interface StateInput {
  workspaces?: Workspace[];
  keyPins?: (string | null)[];
  agentsByWorkspace?: Record<string, string[]>;
  sessions?: StoredAgentSession[];
  pttRecording?: boolean;
  health?: 'healthy' | 'degraded' | 'down';
}

function makeState(input: StateInput = {}): LedSnapshotState {
  const byWorkspaceId: LedSnapshotState['workspaceAgents']['byWorkspaceId'] = {};
  for (const [wsId, agentIds] of Object.entries(input.agentsByWorkspace ?? {})) {
    byWorkspaceId[wsId] = { foregroundAgentIds: agentIds };
  }
  const byAgentId: Record<string, StoredAgentSession> = {};
  for (const session of input.sessions ?? []) byAgentId[String(session.id)] = session;
  return {
    workspace: { workspaces: createCollection('id', input.workspaces ?? []) },
    hardwareConsole: {
      keyPins: input.keyPins ?? [null, null, null, null, null, null],
      pttRecording: input.pttRecording,
    },
    workspaceAgents: { byWorkspaceId },
    agentSessions: { byAgentId },
    daemonHealth: { health: input.health ?? 'healthy' },
  };
}

describe('buildHardwareLedSnapshot', () => {
  it('empty state → all keys unassigned, ambient dark', () => {
    const snapshot = buildHardwareLedSnapshot(makeState());
    expect(snapshot.keys).toEqual(new Array(6).fill('unassigned'));
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('assigns workspaces to slots and maps idle/running/complete', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { activity: 'agent_running' }),
        makeWorkspace('ws-idle'),
        makeWorkspace('ws-done', { displayStatus: 'pr_ready' }),
      ],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys).toEqual([
      'running',
      'idle',
      'complete',
      'unassigned',
      'unassigned',
      'unassigned',
    ]);
    expect(snapshot.ambient).toEqual({ kind: 'running', runningCount: 1 });
  });

  it('hook-active workspace (displayStatus in_progress, agents idle) lights running + breath', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-hooks', { displayStatus: 'in_progress', activity: 'idle' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('running');
    expect(snapshot.ambient).toEqual({ kind: 'running', runningCount: 1 });
  });

  it('displayStatus idle with no activity stays idle and ambient dark', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-quiet', { displayStatus: 'idle', activity: 'idle' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('idle');
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('attention outranks hook-driven running (displayStatus in_progress)', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'idle' })],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { attentionRequestKind: 'discussion' })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('attention');
  });

  it('failed outranks hook-driven running (displayStatus in_progress)', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'in_progress', activity: 'idle' })],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { status: AgentStatus.Error })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('failed');
  });

  it('discussion request turns the key yellow and outranks running', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { activity: 'agent_running' })],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { attentionRequestKind: 'discussion' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('attention');
    expect(snapshot.ambient).toEqual({ kind: 'question' });
  });

  it('blocker request turns the key orange (blocked) and outranks attention', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { activity: 'agent_running' })],
      agentsByWorkspace: { 'ws-1': ['agent-1', 'agent-2'] },
      sessions: [
        makeSession('agent-1', { attentionRequestKind: 'blocker' }),
        makeSession('agent-2', { attentionRequestKind: 'discussion' }),
      ],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('blocked');
    expect(snapshot.ambient).toEqual({ kind: 'blocked' });
  });

  it('pending wizard question counts as attention', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { messages: [questionMessage('msg-1')] })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('attention');
  });

  it('a dismissed question does not pend', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [
        makeSession('agent-1', {
          messages: [questionMessage('msg-1')],
          metadata: { dismissedQuestionsMessageId: 'msg-1' },
        }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('idle');
  });

  it('question does not pend while the agent turn is still active', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [
        makeSession('agent-1', { messages: [questionMessage('msg-1')], isResponding: true }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('idle');
  });

  it('failed agent turns the key red and outranks blocked', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1', 'agent-2'] },
      sessions: [
        makeSession('agent-1', { status: AgentStatus.Error }),
        makeSession('agent-2', { attentionRequestKind: 'blocker' }),
      ],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('failed');
    expect(snapshot.ambient).toEqual({ kind: 'failed' });
  });

  it('unread workspace lights the key cyan and outranks complete', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'pr_ready', attention: 'unread' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('unread');
    expect(snapshot.ambient).toEqual({ kind: 'unread' });
  });

  it('running outranks unread on the key, but ambient prefers unread', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { activity: 'agent_running', attention: 'unread' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('running');
    expect(snapshot.ambient).toEqual({ kind: 'unread' });
  });

  it('ambient running carries the fleet-wide running-workspace count', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-1', { activity: 'agent_running' }),
        makeWorkspace('ws-2', { activity: 'agent_running' }),
        makeWorkspace('ws-3', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-4', { activity: 'agent_running' }),
        makeWorkspace('ws-5'),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'running', runningCount: 4 });
  });

  it('ambient complete when at least one workspace is complete and nothing is running', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-done', { displayStatus: 'pr_merged' }),
        makeWorkspace('ws-idle'),
      ],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('complete');
    expect(snapshot.ambient).toEqual({ kind: 'complete' });
  });

  it('ambient unread outranks complete across workspaces', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-done', { displayStatus: 'pr_merged' }),
        makeWorkspace('ws-new', { attention: 'unread' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'unread' });
  });

  it('ambient unread outranks running across workspaces', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { activity: 'agent_running' }),
        makeWorkspace('ws-new', { attention: 'unread' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'unread' });
  });

  it('ambient running outranks complete across workspaces', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { activity: 'agent_running' }),
        makeWorkspace('ws-done', { displayStatus: 'pr_merged' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'running', runningCount: 1 });
  });

  it('ambient question outranks running; blocked outranks question (across workspaces)', () => {
    const base = {
      workspaces: [makeWorkspace('ws-run', { activity: 'agent_running' }), makeWorkspace('ws-ask')],
      agentsByWorkspace: { 'ws-ask': ['agent-q'] },
    };
    const question = makeState({
      ...base,
      sessions: [makeSession('agent-q', { attentionRequestKind: 'discussion' })],
    });
    expect(buildHardwareLedSnapshot(question).ambient).toEqual({ kind: 'question' });
    const blocked = makeState({
      ...base,
      sessions: [makeSession('agent-q', { attentionRequestKind: 'blocker' })],
    });
    expect(buildHardwareLedSnapshot(blocked).ambient).toEqual({ kind: 'blocked' });
  });

  it('pinned slots keep their position; unpinned auto-fill by recency', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-a'), makeWorkspace('ws-b')],
      keyPins: [null, null, 'ws-b', null, null, null],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    // ws-a (most recent unpinned) fills slot 0; ws-b stays pinned on slot 2.
    expect(snapshot.keys[0]).toBe('idle');
    expect(snapshot.keys[1]).toBe('unassigned');
    expect(snapshot.keys[2]).toBe('idle');
  });

  it('archived workspaces are not assignable and do not light keys', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-arch', { status: WorkspaceStatus.Archived })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys).toEqual(new Array(6).fill('unassigned'));
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('ambient blocked comes from a blocker in ANY assignable workspace, not just assigned keys', () => {
    const workspaces = Array.from({ length: 7 }, (_, index) => makeWorkspace(`ws-${index}`));
    const state = makeState({
      workspaces,
      // ws-6 is 7th by recency → off-key, but its blocker still drives ambient.
      agentsByWorkspace: { 'ws-6': ['agent-x'] },
      sessions: [makeSession('agent-x', { attentionRequestKind: 'blocker' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys).toEqual(new Array(6).fill('idle'));
    expect(snapshot.ambient).toEqual({ kind: 'blocked' });
  });

  it('background agents do not affect key state (foreground/top-level only)', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      // agent-bg exists in sessions but is NOT in foregroundAgentIds.
      agentsByWorkspace: { 'ws-1': [] },
      sessions: [makeSession('agent-bg', { attentionRequestKind: 'blocker' })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('idle');
  });

  it('an in-progress push-to-talk recording drives ambient recording, outranking blocked', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { attentionRequestKind: 'blocker' })],
      pttRecording: true,
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.ambient).toEqual({ kind: 'recording' });
    // Key states are unaffected by the recording indicator.
    expect(snapshot.keys[0]).toBe('blocked');
  });

  describe('daemon disconnected', () => {
    const busyInput: StateInput = {
      workspaces: [
        makeWorkspace('ws-run', { activity: 'agent_running' }),
        makeWorkspace('ws-fail'),
      ],
      agentsByWorkspace: { 'ws-fail': ['agent-1'] },
      sessions: [makeSession('agent-1', { status: AgentStatus.Error })],
    };

    it('health down → ambient disconnected and all keys blanked despite busy workspaces', () => {
      const snapshot = buildHardwareLedSnapshot(makeState({ ...busyInput, health: 'down' }));
      expect(snapshot.ambient).toEqual({ kind: 'disconnected' });
      expect(snapshot.keys).toEqual(new Array(6).fill('unassigned'));
    });

    it('recovers normal derivation when the connection returns', () => {
      const down = buildHardwareLedSnapshot(makeState({ ...busyInput, health: 'down' }));
      expect(down.keys).toEqual(new Array(6).fill('unassigned'));
      const back = buildHardwareLedSnapshot(makeState({ ...busyInput, health: 'healthy' }));
      expect(back.keys[0]).toBe('running');
      expect(back.keys[1]).toBe('failed');
      expect(back.ambient).not.toEqual({ kind: 'disconnected' });
    });

    it('degraded health (heartbeat blip while connected) keeps normal derivation', () => {
      const snapshot = buildHardwareLedSnapshot(makeState({ ...busyInput, health: 'degraded' }));
      expect(snapshot.ambient).not.toEqual({ kind: 'disconnected' });
      expect(snapshot.keys[0]).toBe('running');
    });

    it('absent daemonHealth field defaults to connected derivation', () => {
      const state = makeState(busyInput);
      delete state.daemonHealth;
      const snapshot = buildHardwareLedSnapshot(state);
      expect(snapshot.ambient).not.toEqual({ kind: 'disconnected' });
      expect(snapshot.keys[0]).toBe('running');
    });
  });
});
