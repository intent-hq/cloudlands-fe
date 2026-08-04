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
  };
}

describe('buildHardwareLedSnapshot', () => {
  it('empty state → all keys unassigned, ambient dark', () => {
    const snapshot = buildHardwareLedSnapshot(makeState());
    expect(snapshot.keys).toEqual(new Array(6).fill('unassigned'));
    expect(snapshot.ambient).toBe('dark');
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
    expect(snapshot.ambient).toBe('breath');
  });

  it('hook-active workspace (displayStatus in_progress, agents idle) lights running + breath', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-hooks', { displayStatus: 'in_progress', activity: 'idle' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('running');
    expect(snapshot.ambient).toBe('breath');
  });

  it('displayStatus idle with no activity stays idle and ambient dark', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-quiet', { displayStatus: 'idle', activity: 'idle' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('idle');
    expect(snapshot.ambient).toBe('dark');
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

  it('attention request (discussion/blocker) turns the key yellow and outranks running', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { activity: 'agent_running' })],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { attentionRequestKind: 'blocker' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('attention');
    expect(snapshot.ambient).toBe('attention');
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

  it('failed agent turns the key red and outranks attention', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1', 'agent-2'] },
      sessions: [
        makeSession('agent-1', { status: AgentStatus.Error }),
        makeSession('agent-2', { attentionRequestKind: 'discussion' }),
      ],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('failed');
    expect(snapshot.ambient).toBe('attention');
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
    expect(snapshot.ambient).toBe('dark');
  });

  it('ambient attention comes from ANY assignable workspace, not just assigned keys', () => {
    const workspaces = Array.from({ length: 7 }, (_, index) => makeWorkspace(`ws-${index}`));
    const state = makeState({
      workspaces,
      // ws-6 is 7th by recency → off-key, but its blocker still drives ambient.
      agentsByWorkspace: { 'ws-6': ['agent-x'] },
      sessions: [makeSession('agent-x', { attentionRequestKind: 'blocker' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys).toEqual(new Array(6).fill('idle'));
    expect(snapshot.ambient).toBe('attention');
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

  it('an in-progress push-to-talk recording drives ambient recording, outranking attention', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1')],
      agentsByWorkspace: { 'ws-1': ['agent-1'] },
      sessions: [makeSession('agent-1', { attentionRequestKind: 'blocker' })],
      pttRecording: true,
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.ambient).toBe('recording');
    // Key states are unaffected by the recording indicator.
    expect(snapshot.keys[0]).toBe('attention');
  });
});
