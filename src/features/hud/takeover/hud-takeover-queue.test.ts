import { describe, expect, it } from 'vitest';
import {
  activeTakeoverTrigger,
  createHudTakeoverQueue,
  dismissTakeover,
  enqueueTakeover,
  HUD_TAKEOVER_ATTENTION_DWELL_BASE_MS,
  HUD_TAKEOVER_ATTENTION_DWELL_MAX_MS,
  HUD_TAKEOVER_ATTENTION_DWELL_MIN_MS,
  HUD_TAKEOVER_ATTENTION_DWELL_PER_CHAR_MS,
  HUD_TAKEOVER_BLINK_MS,
  HUD_TAKEOVER_CLOSE_MS,
  HUD_TAKEOVER_DWELL_BASE_MS,
  HUD_TAKEOVER_DWELL_MAX_MS,
  HUD_TAKEOVER_DWELL_MIN_MS,
  HUD_TAKEOVER_DWELL_PER_CHAR_MS,
  HUD_TAKEOVER_MAX_PENDING,
  HUD_TAKEOVER_MAX_TRIGGERS,
  HUD_TAKEOVER_OPEN_MS,
  nextTakeoverDeadline,
  requestImmediateTakeover,
  skipTakeoverBlink,
  takeoverCountdownSeconds,
  takeoverDwellMs,
  tickTakeoverQueue,
  type HudTakeoverTrigger,
} from './hud-takeover-queue';

const T0 = 1_000_000;
/** Most flow tests skip the pre-roll blink (covered by its own tests). */
const NO_BLINK = { blink: false };

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

/** The default 'Task done' trigger's scaled dwell (floor-clamped at 9 chars). */
const DEFAULT_DWELL_MS = takeoverDwellMs({
  workspaceId: 'ws-1',
  triggers: [trigger('ws-1')],
  isViewer: false,
});

describe('hud-takeover-queue', () => {
  it('starts idle with no deadline', () => {
    const state = createHudTakeoverQueue();
    expect(state.phase).toBe('idle');
    expect(state.active).toBeNull();
    expect(nextTakeoverDeadline(state)).toBeNull();
  });

  it('opens with the card pre-roll blink from idle by default', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    expect(state.phase).toBe('blinking');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_BLINK_MS);
  });

  it('keeps a fast pre-roll window in sync with the 3× 180ms card flash', () => {
    // The card's `hudwsflash` runs 0.18s step-end × 3 = 540ms; the queue's
    // blink phase must fully contain those 3 blinks (630ms window). If the CSS
    // duration changes, bump HUD_TAKEOVER_BLINK_MS to keep them aligned.
    const FLASH_MS = 180;
    const BLINKS = 3;
    expect(HUD_TAKEOVER_BLINK_MS).toBe(630);
    expect(HUD_TAKEOVER_BLINK_MS).toBeGreaterThanOrEqual(FLASH_MS * BLINKS);
  });

  it('the blink elapses into the opening phase on tick', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_BLINK_MS);
    expect(state.phase).toBe('opening');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_BLINK_MS + HUD_TAKEOVER_OPEN_MS);
  });

  it('opens immediately from idle with blink disabled (reduced motion)', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS);
  });

  it('skipTakeoverBlink bails a missing-card blink straight into opening', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    const skipped = skipTakeoverBlink(state, T0 + 10);
    expect(skipped.phase).toBe('opening');
    expect(skipped.phaseEndsAtMs).toBe(T0 + 10 + HUD_TAKEOVER_OPEN_MS);
    // No-op outside the blinking phase.
    expect(skipTakeoverBlink(skipped, T0 + 20)).toBe(skipped);
  });

  it('coalesces a duplicate workspace into the blinking display', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 100);
    expect(state.phase).toBe('blinking');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_BLINK_MS);
    expect(state.active?.triggers).toHaveLength(2);
  });

  it('the next pending entry opens with its own pre-roll blink', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    const closeEnd = T0 + HUD_TAKEOVER_OPEN_MS + DEFAULT_DWELL_MS + HUD_TAKEOVER_CLOSE_MS;
    expect(state.phaseEndsAtMs).toBe(closeEnd);
    state = tickTakeoverQueue(state, closeEnd);
    expect(state.phase).toBe('blinking');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.phaseEndsAtMs).toBe(closeEnd + HUD_TAKEOVER_BLINK_MS);
  });

  it('plays the full open → dwell → close cycle on tick', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS + DEFAULT_DWELL_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    expect(state.phase).toBe('closing');
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    expect(state.phase).toBe('idle');
    expect(state.active).toBeNull();
  });

  it('queues a second workspace and opens it after the first closes', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 100, NO_BLINK);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2']);
    // ws-1 must stay active through its full cycle (a slightly-late tick
    // re-anchors the dwell to now).
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS + 10, NO_BLINK);
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS + 10 + DEFAULT_DWELL_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('closing');
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.pending).toEqual([]);
  });

  it('a stalled clock advances at most ONE phase per tick, re-anchored to now', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 1);
    // The clock jumps far past every chained deadline (background tab).
    const stalledAt = T0 + 60_000;
    state = tickTakeoverQueue(state, stalledAt);
    // Only blinking → opening: the new deadline anchors to now, in the future.
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(stalledAt + HUD_TAKEOVER_OPEN_MS);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2']);
  });

  it('never fast-forwards past the close: a stale tick cannot switch the active workspace', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
    // One tick on a long-stalled clock must NOT hand the display to ws-2.
    const staleNow = T0 + 60_000;
    state = tickTakeoverQueue(state, staleNow, NO_BLINK);
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phase).toBe('dwelling');
    // ws-2 only opens after a full closing phase whose deadline lay in the
    // future at transition time.
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('closing');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.phaseEndsAtMs).toBe(staleNow + DEFAULT_DWELL_MS + HUD_TAKEOVER_CLOSE_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
  });

  it('the close plays in full on a stalled clock even with an empty queue', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.phase).toBe('dwelling');
    const staleNow = T0 + 60_000;
    state = tickTakeoverQueue(state, staleNow);
    expect(state.phase).toBe('closing');
    expect(state.phaseEndsAtMs).toBe(staleNow + HUD_TAKEOVER_CLOSE_MS);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!);
    expect(state.phase).toBe('idle');
  });

  it('freezes the dwelling display: a same-workspace trigger queues at the front instead', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const dwellEndsAt = state.phaseEndsAtMs;
    const later = T0 + HUD_TAKEOVER_OPEN_MS + 3000;
    state = enqueueTakeover(
      state,
      trigger('ws-1', { kind: 'agent_started', detail: 'Verifier' }),
      later,
      NO_BLINK,
    );
    expect(state.phase).toBe('dwelling');
    // The displayed entry and its dwell deadline are untouched.
    expect(state.active?.triggers).toHaveLength(1);
    expect(activeTakeoverTrigger(state)?.kind).toBe('task_complete');
    expect(state.phaseEndsAtMs).toBe(dwellEndsAt);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1']);
  });

  it('freezes the opening display: a same-workspace trigger queues instead of coalescing', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 200, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.active?.triggers).toHaveLength(1);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1']);
  });

  it('a same-workspace trigger jumps ahead of other queued workspaces and re-opens next', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    state = enqueueTakeover(
      state,
      trigger('ws-1', { kind: 'agent_failed' }),
      T0 + HUD_TAKEOVER_OPEN_MS + 100,
      NO_BLINK,
    );
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1', 'ws-2']);
    // ws-1 re-animates next, with the NEW banner only, after the close plays.
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS + DEFAULT_DWELL_MS, NO_BLINK);
    expect(state.phase).toBe('closing');
    const closeEnd = T0 + HUD_TAKEOVER_OPEN_MS + DEFAULT_DWELL_MS + HUD_TAKEOVER_CLOSE_MS;
    state = tickTakeoverQueue(state, closeEnd, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.active?.triggers).toHaveLength(1);
    expect(activeTakeoverTrigger(state)?.kind).toBe('agent_failed');
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2']);
  });

  it('a displayed workspace re-queues ahead of other entries but never ahead of a pending viewer', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    // A manual viewer for ws-2 jumps the queue; ws-3 appends FIFO behind it.
    state = requestImmediateTakeover(state, trigger('ws-2', { kind: 'manual' }), at, NO_BLINK);
    expect(state.phase).toBe('closing');
    state = enqueueTakeover(state, trigger('ws-3'), at + 10, NO_BLINK);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2', 'ws-3']);
    // The still-displayed ws-1 re-queues ahead of ws-3 but the user's manual
    // ws-2 viewer keeps precedence at the head of the queue.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), at + 20, NO_BLINK);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2', 'ws-1', 'ws-3']);
    // A further ws-1 trigger merges into that pending entry in place.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'question_asked' }), at + 30, NO_BLINK);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-2', 'ws-1', 'ws-3']);
    expect(state.pending[1].triggers).toHaveLength(2);
  });

  it('coalesces duplicates into a pending entry', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10);
    state = enqueueTakeover(state, trigger('ws-2', { kind: 'question_asked' }), T0 + 20);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].triggers).toHaveLength(2);
  });

  it('re-enqueues a closing workspace at the FRONT of pending without touching the close', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 400);
    state = dismissTakeover(state, T0 + 500);
    const closeEndsAt = state.phaseEndsAtMs;
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), T0 + 600);
    expect(state.phase).toBe('closing');
    expect(state.phaseEndsAtMs).toBe(closeEndsAt);
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1', 'ws-2']);
  });

  it('DISMISS skips the dwell and the next entry opens after the close', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const dismissAt = T0 + HUD_TAKEOVER_OPEN_MS + 1000;
    state = dismissTakeover(state, dismissAt);
    expect(state.phase).toBe('closing');
    expect(state.phaseEndsAtMs).toBe(dismissAt + HUD_TAKEOVER_CLOSE_MS);
    state = tickTakeoverQueue(state, dismissAt + HUD_TAKEOVER_CLOSE_MS, NO_BLINK);
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

  it('the displayed workspace re-queues even when pending is at the cap', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-0'), T0, NO_BLINK);
    for (let i = 1; i <= HUD_TAKEOVER_MAX_PENDING; i++) {
      state = enqueueTakeover(state, trigger(`ws-${i}`), T0 + i, NO_BLINK);
    }
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(state.phase).toBe('dwelling');
    expect(state.pending).toHaveLength(HUD_TAKEOVER_MAX_PENDING);
    // The on-screen ws-0 must not be dropped by the cap: it jumps the queue.
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    state = enqueueTakeover(state, trigger('ws-0', { kind: 'agent_failed' }), at, NO_BLINK);
    expect(state.pending).toHaveLength(HUD_TAKEOVER_MAX_PENDING + 1);
    expect(state.pending[0].workspaceId).toBe('ws-0');
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
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    expect(takeoverCountdownSeconds(state, T0)).toBe(0);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    expect(takeoverCountdownSeconds(state, T0 + HUD_TAKEOVER_OPEN_MS)).toBe(
      DEFAULT_DWELL_MS / 1000,
    );
    expect(takeoverCountdownSeconds(state, T0 + HUD_TAKEOVER_OPEN_MS + 2500)).toBe(
      DEFAULT_DWELL_MS / 1000 - 2,
    );
  });

  describe('takeoverDwellMs — text-length-scaled dwell', () => {
    const entryWith = (details: string[]) => ({
      workspaceId: 'ws-1',
      triggers: details.map((detail) => trigger('ws-1', { detail })),
      isViewer: false,
    });

    it('short text clamps to the floor', () => {
      // base 2000 + 50×5 = 2250 < floor 3000.
      expect(takeoverDwellMs(entryWith(['short']))).toBe(HUD_TAKEOVER_DWELL_MIN_MS);
      expect(takeoverDwellMs(entryWith(['']))).toBe(HUD_TAKEOVER_DWELL_MIN_MS);
      expect(takeoverDwellMs(null)).toBe(HUD_TAKEOVER_DWELL_MIN_MS);
    });

    it('long text scales linearly: base + perCharMs × length', () => {
      const text = 'x'.repeat(100);
      expect(takeoverDwellMs(entryWith([text]))).toBe(
        HUD_TAKEOVER_DWELL_BASE_MS + HUD_TAKEOVER_DWELL_PER_CHAR_MS * 100,
      );
    });

    it('very long text clamps to the ceiling', () => {
      // base 2000 + 50×500 = 27000 > ceiling 12000.
      expect(takeoverDwellMs(entryWith(['x'.repeat(500)])))
        .toBe(HUD_TAKEOVER_DWELL_MAX_MS);
    });

    it('sums the text of every stacked banner (multi-trigger entries)', () => {
      const a = 'x'.repeat(60);
      const b = 'y'.repeat(40);
      expect(takeoverDwellMs(entryWith([a, b]))).toBe(
        HUD_TAKEOVER_DWELL_BASE_MS + HUD_TAKEOVER_DWELL_PER_CHAR_MS * 100,
      );
    });

    it('attention takeovers use the longer ATTENTION tier scaled by the sub-title text', () => {
      // On attention banners `detail` IS the sub-title (the question/reason
      // text the banner renders under the agent-name matrix line) — the
      // dwell scales with it on the attention tier's longer base/rate so a
      // typical two-sentence question stays up comfortably long.
      const question = 'q'.repeat(120);
      const entry = {
        workspaceId: 'ws-1',
        triggers: [
          trigger('ws-1', {
            kind: 'question_asked' as const,
            detail: question,
            agentName: 'Coordinator',
            signal: 'question' as const,
          }),
        ],
        isViewer: false,
      };
      // 4000 + 60×120 = 11200 — vs 8000 on the routine tier.
      expect(takeoverDwellMs(entry)).toBe(
        HUD_TAKEOVER_ATTENTION_DWELL_BASE_MS + HUD_TAKEOVER_ATTENTION_DWELL_PER_CHAR_MS * 120,
      );
    });

    const attentionEntryWith = (details: string[]) => ({
      workspaceId: 'ws-1',
      triggers: details.map((detail) =>
        trigger('ws-1', {
          kind: 'question_asked' as const,
          detail,
          signal: 'question' as const,
        }),
      ),
      isViewer: false,
    });

    it('even a terse attention banner holds the attention floor', () => {
      // base 4000 + 60×5 = 4300 < attention floor 8000.
      expect(takeoverDwellMs(attentionEntryWith(['huh?!']))).toBe(
        HUD_TAKEOVER_ATTENTION_DWELL_MIN_MS,
      );
      expect(HUD_TAKEOVER_ATTENTION_DWELL_MIN_MS).toBeGreaterThan(HUD_TAKEOVER_DWELL_MAX_MS / 2);
    });

    it('a very long attention banner clamps to the attention ceiling', () => {
      // base 4000 + 60×500 = 34000 > attention ceiling 20000.
      expect(takeoverDwellMs(attentionEntryWith(['x'.repeat(500)]))).toBe(
        HUD_TAKEOVER_ATTENTION_DWELL_MAX_MS,
      );
    });

    it('a stacked routine banner never shortens an attention entry to the routine tier', () => {
      const entry = {
        workspaceId: 'ws-1',
        triggers: [
          trigger('ws-1', { kind: 'task_complete' as const, detail: 'x'.repeat(50) }),
          trigger('ws-1', {
            kind: 'question_asked' as const,
            detail: 'q'.repeat(70),
            signal: 'question' as const,
          }),
        ],
        isViewer: false,
      };
      // One signal-carrying trigger ⇒ the whole entry dwells on the
      // attention tier over the SUMMED text: 4000 + 60×120 = 11200.
      expect(takeoverDwellMs(entry)).toBe(
        HUD_TAKEOVER_ATTENTION_DWELL_BASE_MS + HUD_TAKEOVER_ATTENTION_DWELL_PER_CHAR_MS * 120,
      );
    });

    it('the dwell deadline set on tick uses the scaled duration (long status message)', () => {
      const longDetail = 'x'.repeat(150); // base + 50×150 = 9500ms.
      let state = enqueueTakeover(
        createHudTakeoverQueue(),
        trigger('ws-1', { kind: 'status_update', detail: longDetail }),
        T0,
        NO_BLINK,
      );
      state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
      expect(state.phase).toBe('dwelling');
      expect(state.phaseEndsAtMs).toBe(
        T0 +
          HUD_TAKEOVER_OPEN_MS +
          HUD_TAKEOVER_DWELL_BASE_MS +
          HUD_TAKEOVER_DWELL_PER_CHAR_MS * 150,
      );
    });
  });

  it('does not tick past a deadline that has not elapsed', () => {
    const state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    const same = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS - 1);
    expect(same).toBe(state);
  });

  it('manual open from idle plays the pre-roll blink too (mock openManual)', () => {
    const state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
    );
    expect(state.phase).toBe('blinking');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.active?.isViewer).toBe(true);
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_BLINK_MS);
  });

  it('manual open from idle starts immediately as a viewer with blink disabled', () => {
    const state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
      NO_BLINK,
    );
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.active?.isViewer).toBe(true);
  });

  it('manual open during another workspace blink swaps the pre-roll to the viewer', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    expect(state.phase).toBe('blinking');
    state = requestImmediateTakeover(state, trigger('ws-2', { kind: 'manual' }), T0 + 100);
    expect(state.phase).toBe('blinking');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.active?.isViewer).toBe(true);
    // The never-displayed ws-1 entry waits at the front of pending.
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-1']);
  });

  it('manual open jumps the queue: closes the current display and opens next', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 500;
    state = requestImmediateTakeover(state, trigger('ws-3', { kind: 'manual' }), at, NO_BLINK);
    expect(state.phase).toBe('closing');
    expect(state.pending.map((e) => e.workspaceId)).toEqual(['ws-3', 'ws-2']);
    state = tickTakeoverQueue(state, at + HUD_TAKEOVER_CLOSE_MS, NO_BLINK);
    expect(state.active?.workspaceId).toBe('ws-3');
    expect(state.active?.isViewer).toBe(true);
  });

  it('manual open of the active event display converts it to a viewer (countdown stops)', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 500;
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), at);
    expect(state.phase).toBe('dwelling');
    expect(state.active?.isViewer).toBe(true);
    expect(state.phaseEndsAtMs).toBeNull();
    expect(state.pending).toEqual([]);
    expect(takeoverCountdownSeconds(state, at)).toBe(0);
  });

  it('manual open of the blinking workspace converts the entry without restarting', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0);
    expect(state.phase).toBe('blinking');
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), T0 + 100);
    expect(state.phase).toBe('blinking');
    expect(state.active?.isViewer).toBe(true);
    expect(state.phaseEndsAtMs).toBe(T0 + HUD_TAKEOVER_BLINK_MS);
  });

  it('manual open of the already-open viewer is a no-op', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
      NO_BLINK,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const again = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), T0 + 5000);
    expect(again).toBe(state);
  });

  it('manual open dedupes an existing pending entry for that workspace', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-1'), T0, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 10, NO_BLINK);
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
      NO_BLINK,
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
      NO_BLINK,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    state = enqueueTakeover(state, trigger('ws-2'), T0 + 2000, NO_BLINK);
    const dismissAt = T0 + 60_000;
    state = dismissTakeover(state, dismissAt);
    expect(state.phase).toBe('closing');
    state = tickTakeoverQueue(state, dismissAt + HUD_TAKEOVER_CLOSE_MS, NO_BLINK);
    expect(state.phase).toBe('opening');
    expect(state.active?.workspaceId).toBe('ws-2');
    expect(state.active?.isViewer).toBe(false);
  });

  it('event triggers queue behind an open viewer; its own workspace jumps to the front', () => {
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
      NO_BLINK,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    // A different workspace queues FIFO; the viewer's own workspace (enqueued
    // LATER) jumps ahead of it. Neither coalesces into the viewer.
    state = enqueueTakeover(state, trigger('ws-2', { kind: 'agent_failed' }), T0 + 2000);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'task_complete' }), T0 + 3000);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).toBeNull();
    expect(state.active?.triggers).toHaveLength(1);
    expect(state.active?.isViewer).toBe(true);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([
      ['ws-1', false],
      ['ws-2', false],
    ]);
  });

  it('an event trigger never merges into a PENDING viewer entry (monorepo#1492)', () => {
    // ws-2 is displayed; a manual viewer for ws-1 waits at the front of pending.
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-2'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), at, NO_BLINK);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([['ws-1', true]]);
    // The event trigger must NOT coalesce into the pending viewer: the viewer
    // keeps its single manual trigger (and viewer semantics) and the event
    // gets its own non-viewer entry, appended FIFO behind it.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'task_complete' }), at + 10, NO_BLINK);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([
      ['ws-1', true],
      ['ws-1', false],
    ]);
    expect(state.pending[0].triggers.map((t) => t.kind)).toEqual(['manual']);
    expect(state.pending[1].triggers.map((t) => t.kind)).toEqual(['task_complete']);
    // A further ws-1 event trigger coalesces into the EVENT entry, not the viewer.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'agent_failed' }), at + 20, NO_BLINK);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([
      ['ws-1', true],
      ['ws-1', false],
    ]);
    expect(state.pending[0].triggers).toHaveLength(1);
    expect(state.pending[1].triggers).toHaveLength(2);
  });

  it('a pending viewer and its workspace event entry both play, in queue order', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-2'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), at, NO_BLINK);
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'task_complete' }), at + 10, NO_BLINK);
    expect(state.phase).toBe('closing');
    // The viewer opens first: deadline-free dwell, manual DISMISS only.
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('dwelling');
    expect(state.active?.isViewer).toBe(true);
    expect(state.phaseEndsAtMs).toBeNull();
    const dismissAt = at + 60_000;
    state = dismissTakeover(state, dismissAt);
    state = tickTakeoverQueue(state, dismissAt + HUD_TAKEOVER_CLOSE_MS, NO_BLINK);
    // Then the event entry plays as a normal banner takeover with a dwell.
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.active?.isViewer).toBe(false);
    expect(activeTakeoverTrigger(state)?.kind).toBe('task_complete');
    state = tickTakeoverQueue(state, state.phaseEndsAtMs!, NO_BLINK);
    expect(state.phase).toBe('dwelling');
    expect(state.phaseEndsAtMs).not.toBeNull();
  });

  it('an event trigger for the DISPLAYED workspace lands behind its pending viewer, not inside it', () => {
    // A ws-1 viewer is open, then dismissed; while its close plays, the card
    // is clicked again: a fresh ws-1 viewer waits at the front of pending
    // while ws-1 is still the displayed workspace.
    let state = requestImmediateTakeover(
      createHudTakeoverQueue(),
      trigger('ws-1', { kind: 'manual' }),
      T0,
      NO_BLINK,
    );
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS, NO_BLINK);
    expect(state.phase).toBe('dwelling');
    const dismissAt = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    state = dismissTakeover(state, dismissAt);
    expect(state.phase).toBe('closing');
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), dismissAt + 10, NO_BLINK);
    expect(state.active?.workspaceId).toBe('ws-1');
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([['ws-1', true]]);
    // The displayed-workspace event trigger takes the queue-jump path: it
    // must NOT merge into the pending viewer — it gets its own non-viewer
    // entry inserted behind it (insertBehindLeadingViewers), cap-exempt.
    state = enqueueTakeover(state, trigger('ws-1', { kind: 'task_complete' }), dismissAt + 20, NO_BLINK);
    expect(state.pending.map((e) => [e.workspaceId, e.isViewer])).toEqual([
      ['ws-1', true],
      ['ws-1', false],
    ]);
    expect(state.pending[0].triggers.map((t) => t.kind)).toEqual(['manual']);
    expect(state.pending[1].triggers.map((t) => t.kind)).toEqual(['task_complete']);
  });

  it('a non-displayed workspace with only a pending viewer still respects the pending cap', () => {
    let state = enqueueTakeover(createHudTakeoverQueue(), trigger('ws-0'), T0, NO_BLINK);
    state = tickTakeoverQueue(state, T0 + HUD_TAKEOVER_OPEN_MS);
    const at = T0 + HUD_TAKEOVER_OPEN_MS + 100;
    state = requestImmediateTakeover(state, trigger('ws-1', { kind: 'manual' }), at, NO_BLINK);
    for (let i = 2; i <= HUD_TAKEOVER_MAX_PENDING; i++) {
      state = enqueueTakeover(state, trigger(`ws-${i}`), at + i, NO_BLINK);
    }
    expect(state.pending).toHaveLength(HUD_TAKEOVER_MAX_PENDING);
    // ws-1 is not displayed and has no pending EVENT entry to coalesce into:
    // the trigger is dropped by the cap rather than merged into the viewer.
    const overflow = enqueueTakeover(state, trigger('ws-1'), at + 100, NO_BLINK);
    expect(overflow).toBe(state);
    expect(overflow.pending[0].triggers.map((t) => t.kind)).toEqual(['manual']);
  });
});
