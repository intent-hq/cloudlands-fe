import { describe, expect, it } from 'vitest';
import {
  activeTakeoverTrigger,
  createHudTakeoverQueue,
  dismissTakeover,
  enqueueTakeover,
  HUD_TAKEOVER_CLOSE_MS,
  HUD_TAKEOVER_DWELL_MS,
  HUD_TAKEOVER_MAX_PENDING,
  HUD_TAKEOVER_MAX_TRIGGERS,
  HUD_TAKEOVER_OPEN_MS,
  nextTakeoverDeadline,
  requestImmediateTakeover,
  takeoverCountdownSeconds,
  tickTakeoverQueue,
  type HudTakeoverTrigger,
} from './hud-takeover-queue';

const T0 = 1_000_000;

function trigger(workspaceId: string, overrides: Partial<HudTakeoverTrigger> = {}): HudTakeoverTrigger {
  return {
    workspaceId,
    kind: 'task_complete',
    detail: 'Task done',
    raisedAtMs: T0,
    changedTaskId: null,
    ...overrides,
  };
}

describe('hud-takeover-queue', () => {
  it('starts idle with no deadline', () => {
    const state = createHudTakeoverQueue();
    expect(state.phase).toBe('idle');
    expect(state.active).toBeNull();
    expect(nextTakeoverDeadline(state)).toBeNull();
  });

  it('opens immediately from idle', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS);
  });

  it('plays the full open → dwell → close cycle on tick', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS + HUD_TAKEOVER_DWELL_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    expect(state.phase).toBe('closing');
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    expect(state.phase).toBe('idle');
    expect(state.active).toBeNull();
  });

  it('queues a second workspace and opens it after the first closes', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 100);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2']);
    // ws-1 must stay active through its full cycle.
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS + 10);
    expect(state.active?.workspaceId).toBe('ws-1');
    const closeEnd = T0 + HUD_TAKEOVER_OPEN_MS + HUD_TAKEOVER_DWELL_MS + HUD_TAKEOVER_CLOSE_MS;
    state = tickTakeoverQueue(state, closeEnd);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.pending).toEqual([]);
  });

  it('settles a long stall through multiple phases in one tick', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 1);
    state = tickTakeoverQueue(state, T0 + 60_000);
    // ws-1 fully played, ws-2 fully played, everything done.
    expect(state.phase).toBe('idle');
    expect(state.pending).toEqual([]);
  });

  it('coalesces a duplicate workspace into the dwelling display and restarts the dwell', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const later = T0 + HUD_TAKEOVER_OPEN_MS + 3000;
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_started', detail: 'Verifier' }), later);
    expect(state.phase).toBe('dwelling');
    expect(state.pending).toEqual([]);
    expect(state.active?.triggers).toHaveLength(2);
    expect(activeTakeoverTrigger(state)?.kind).toBe('agent_started');
    expect(state.phaseEndsAtMs).toBe(later + HUD_TAKEOVER_DWELL_MS);
  });

  it('coalesces into the opening display without restarting the open', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 200);
    expect(state.phase).toBe('opening');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.active?.triggers).toHaveLength(2);
  });

  it('coalesces duplicates into a pending entry', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10);
    state = enqueueTakeover(state, trigger('ws-2', { kind: 'question_asked' }), T0 + 20);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].triggers).toHaveLength(2);
  });

  it('re-enqueues a closing workspace as a new pending entry', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = dismissTakeover(state, T0 + 500);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 600);
    expect(state.phase).toBe('closing');
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1']);
  });

  it('DISMISS skips the dwell and the next entry opens after the close', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const dismissAt = T0 + HUD_TAKEOVER_OPEN_MS + 1000;
    state = dismissTakeover(state, dismissAt);
    expect(state.phase).toBe('closing');
    expect(state.phaseEndsAtMs).toBe(dismissAt + HUD_TAKEOVER_CLOSE_MS);
    state = tickTakeoverQueue(state, dismissAt + HUD_TAKEOVER_CLOSE_MS);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
  });

  it('DISMISS is a no-op when idle or already closing', () => {
    const idle = createHudTakeoverQueue();
    expect(dismissTakeover(idle, T0)).toBe(idle);
    let state = enqueueTakeover(idle, trigger('ws-1'), T0);
    state = dismissTakeover(state, T0 + 100);
    const again = dismissTakeover(state, T0 + 200);
    expect(again).toBe(state);
  });

  it('drops new workspaces beyond the pending cap but keeps coalescing', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-0'), T0);
    for (let i = 1; i <= HUD_TAKEOVER_MAX_PENDING; i++) {
      state = enqueueTakeover(state, trigger(`ws-${i}`), T0 + i);
    }
    expect(state.pending).toHaveLength(HUD_TAKEOVER_MAX_PENDING);
    const overflow = enqueueTakeover(state, trigger('ws-99'), T0 + 100);
    expect(overflow).toBe(state);
    const coalesced = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 101);
    expect(coalesced.pending[0].triggers).toHaveLength(2);
  });

  it('caps triggers kept per entry at the banner limit', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    for (let i = 0; i < HUD_TAKEOVER_MAX_TRIGGERS + 3; i++) {
      state = enqueueTakeover(state, trigger('ws-1', { detail: `t${i}` }), T0 + i);
    }
    expect(state.active?.triggers).toHaveLength(HUD_TAKEOVER_MAX_TRIGGERS);
    expect(activeTakeoverTrigger(state)?.detail).toBe(`t${HUD_TAKEOVER_MAX_TRIGGERS + 2}`);
  });

  it('reports the RETURN countdown only while dwelling', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    expect(takeoverCountdownSeconds(state, T0)).toBe(0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(takeoverCountdownSeconds(state, T0 + HUD_TAKEOVER_OPEN_MS)).toBe(
      HUD_TAKEOVER_DWELL_MS / 1000,
    );
    expect(takeoverCountdownSeconds(state, T0 + HUD_TAKEOVER_OPEN_MS + 2500)).toBe(
      HUD_TAKEOVER_DWELL_MS / 1000 - 2,
    );
  });

  it('does not tick past a deadline that has not elapsed', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    const same = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS - 1);
    expect(same).toBe(state);
  });

  it('manual open from idle starts immediately as a viewer', () => {
    const state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.active?.isViewer).toBe(true);
  });

  it('manual open jumps the queue: closes the current display and opens next', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 500;
    state = requestImmediateTakeover(state, trigger('ws-3', { kind: 'manual' }), at);
    expect(state.phase).toBe('closing');
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-3', 'ws-2']);
    state = tickTakeoverQueue(state, at + HUD_TAKEOVER_CLOSE_MS);
    expect(state.active?.workspaceId).toBe('ws-3');
    expect(state.active?.isViewer).toBe(true);
  });

  it('manual open of the active event display converts it to a viewer (countdown stops)', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 500;
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), at);
    expect(state.phase).toBe('dwelling');
    expect(state.active?.isViewer).toBe(true);
    expect(state.phaseEndsAtMs).toBeNull();
    expect(state.pending).toEqual([]);
    expect(takeoverCountdownSeconds(state, at)).toBe(0);
  });

  it('manual open of the already-open viewer is a no-op', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const again = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), T0 + 5000);
    expect(again).toBe(state);
  });

  it('manual open dedupes an existing pending entry for that workspace', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10);
    state = requestImmediateTakeover(state, trigger('ws-2', { kind: 'manual' }), T0 + 20);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2']);
    expect(state.pending[0].isViewer).toBe(true);
    expect(state.phase).toBe('closing');
  });

  it('a viewer dwells with no deadline: it never auto-dismisses on tick', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).toBeNull();
    expect(nextTakeoverDeadline(state)).toBeNull();
    // Hours later the viewer is still up.
    const later = tickTakeoverQueue(state, T0 + 3_600_000);
    expect(later).toBe(state);
    expect(takeoverCountdownSeconds(later, T0 + 3_600_000)).toBe(0);
  });

  it('DISMISS closes a viewer and the next pending entry opens', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 2000);
    const dismissAt = T0 + 60_000;
    state = dismissTakeover(state, dismissAt);
    expect(state.phase).toBe('closing');
    state = tickTakeoverQueue(state, dismissAt + HUD_TAKEOVER_CLOSE_MS);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.active?.isViewer).toBe(false);
  });

  it('event triggers queue behind an open viewer instead of coalescing into it', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    // Same workspace AND a different workspace: both wait in pending.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'task_complete' }), T0 + 2000);
    state = enqueueTakeover(state, trigger('ws-2', { kind: 'agent_failed' }), T0 + 3000);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).toBeNull();
    expect(state.active?.triggers).toHaveLength(1);
    expect(state.active?.isViewer).toBe(true);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([
      ['ws-1', false],
      ['ws-2', false],
    ]);
  });
});
