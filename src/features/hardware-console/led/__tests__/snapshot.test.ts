import { describe, expect, it } from 'vitest';
import { WorkspaceStatus, type Workspace, type WorkspaceDisplayStatus } from '$shared/types';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
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

interface StateInput {
  workspaces?: Workspace[];
  keyPins?: (string | null)[];
  pttRecording?: boolean;
  health?: 'healthy' | 'degraded' | 'down';
}

function makeState(input: StateInput = {}): LedSnapshotState {
  return {
    workspace: { workspaces: createCollection('id', input.workspaces ?? []) },
    hardwareConsole: {
      keyPins: input.keyPins ?? [null, null, null, null, null, null],
      pttRecording: input.pttRecording,
    },
    daemonHealth: { health: input.health ?? 'healthy' },
  };
}

describe('buildHardwareLedSnapshot', () => {
  it('empty state → all keys unassigned, ambient dark', () => {
    const snapshot = buildHardwareLedSnapshot(makeState());
    expect(snapshot.keys).toEqual(new Array(6).fill('unassigned'));
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('assigns workspaces to slots and maps the wire displayStatus verbatim', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-idle', { displayStatus: 'idle' }),
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

  it.each<[WorkspaceDisplayStatus, string]>([
    ['failed', 'failed'],
    ['blocked', 'blocked'],
    ['needs_attention', 'attention'],
    ['in_progress', 'running'],
    ['unread', 'unread'],
    ['complete', 'complete'],
    ['pr_ready', 'complete'],
    ['pr_open', 'complete'],
    ['pr_merged', 'complete'],
    ['idle', 'idle'],
    ['not_started', 'idle'],
  ])('displayStatus %s lights the key %s', (displayStatus, keyState) => {
    const state = makeState({ workspaces: [makeWorkspace('ws-1', { displayStatus })] });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe(keyState);
  });

  it('an absent displayStatus renders idle (treat-as-absent, no local synthesis)', () => {
    const state = makeState({ workspaces: [makeWorkspace('ws-1')] });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('idle');
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('an unknown wire displayStatus renders idle', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'future_value' as never })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('idle');
  });

  it('live agent activity alone never lights running — only the BE displayStatus does', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { activity: 'agent_running', displayStatus: 'idle' })],
    });
    const snapshot = buildHardwareLedSnapshot(state);
    expect(snapshot.keys[0]).toBe('idle');
    expect(snapshot.ambient).toEqual({ kind: 'dark' });
  });

  it('the dismissible attention flag alone never lights unread — only displayStatus does', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'pr_merged', attention: 'unread' })],
    });
    expect(buildHardwareLedSnapshot(state).keys[0]).toBe('complete');
  });

  it('ambient running carries the fleet-wide running-workspace count', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-1', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-2', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-3', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-4', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-5', { displayStatus: 'idle' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'running', runningCount: 4 });
  });

  it('ambient complete when at least one workspace is complete and nothing is running', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-done', { displayStatus: 'pr_merged' }),
        makeWorkspace('ws-idle', { displayStatus: 'idle' }),
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
        makeWorkspace('ws-new', { displayStatus: 'unread' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'unread' });
  });

  it('ambient unread outranks running across workspaces', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-new', { displayStatus: 'unread' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'unread' });
  });

  it('ambient running outranks complete across workspaces', () => {
    const state = makeState({
      workspaces: [
        makeWorkspace('ws-run', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-done', { displayStatus: 'pr_merged' }),
      ],
    });
    expect(buildHardwareLedSnapshot(state).ambient).toEqual({ kind: 'running', runningCount: 1 });
  });

  it('ambient question outranks running; blocked outranks question; failed outranks blocked', () => {
    const run = makeWorkspace('ws-run', { displayStatus: 'in_progress' });
    const question = makeState({
      workspaces: [run, makeWorkspace('ws-ask', { displayStatus: 'needs_attention' })],
    });
    expect(buildHardwareLedSnapshot(question).ambient).toEqual({ kind: 'question' });
    const blocked = makeState({
      workspaces: [
        run,
        makeWorkspace('ws-ask', { displayStatus: 'needs_attention' }),
        makeWorkspace('ws-blk', { displayStatus: 'blocked' }),
      ],
    });
    expect(buildHardwareLedSnapshot(blocked).ambient).toEqual({ kind: 'blocked' });
    const failed = makeState({
      workspaces: [
        run,
        makeWorkspace('ws-blk', { displayStatus: 'blocked' }),
        makeWorkspace('ws-err', { displayStatus: 'failed' }),
      ],
    });
    expect(buildHardwareLedSnapshot(failed).ambient).toEqual({ kind: 'failed' });
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

  it('ambient blocked comes from ANY assignable workspace, not just assigned keys', () => {
    const workspaces = Array.from({ length: 7 }, (_, index) =>
      // ws-6 is 7th by recency → off-key, but its blocked status still drives ambient.
      makeWorkspace(`ws-${index}`, index === 6 ? { displayStatus: 'blocked' } : {}),
    );
    const snapshot = buildHardwareLedSnapshot(makeState({ workspaces }));
    expect(snapshot.keys).toEqual(new Array(6).fill('idle'));
    expect(snapshot.ambient).toEqual({ kind: 'blocked' });
  });

  it('an in-progress push-to-talk recording drives ambient recording, outranking blocked', () => {
    const state = makeState({
      workspaces: [makeWorkspace('ws-1', { displayStatus: 'blocked' })],
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
        makeWorkspace('ws-run', { displayStatus: 'in_progress' }),
        makeWorkspace('ws-fail', { displayStatus: 'failed' }),
      ],
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
