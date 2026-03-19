/**
 * Property-based fuzzing tests for PendingEventQueue and handler lifecycle.
 *
 * Uses manual randomized loops with fixed seeds for reproducibility.
 * Tests 7 properties that must hold for any sequence of operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PendingEventQueue } from '../utils/pending-event-queue';

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function randomEventType(rng: () => number): string {
  const types = ['chunk', 'end', 'error', 'status', 'metadata', 'tool-call', 'tool-result'];
  return types[Math.floor(rng() * types.length)];
}

function randomSessionId(rng: () => number, count: number): string {
  return `session-${Math.floor(rng() * count)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('PendingEventQueue — Property-based fuzzing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Property 1: Event order preservation ─────────────────────────────────
  it('Property 1: replay order matches queue order for 100 random events', () => {
    const rng = mulberry32(42);
    const queue = new PendingEventQueue(60_000, 200); // large limits
    const sessionId = 'order-test';
    const expected: string[] = [];

    for (let i = 0; i < 100; i++) {
      const type = `evt-${i}-${randomEventType(rng)}`;
      expected.push(type);
      queue.queue(sessionId, type, { index: i });
      vi.advanceTimersByTime(1); // unique timestamps
    }

    const replayed = queue.replay(sessionId);
    expect(replayed.map((e) => e.type)).toEqual(expected);
  });

  // ── Property 2: No event duplication ─────────────────────────────────────
  it('Property 2: each event appears exactly once across multiple replays', () => {
    const rng = mulberry32(123);
    const queue = new PendingEventQueue(60_000, 500);
    const sessionId = 'dup-test';
    const allReplayed: string[] = [];

    // Queue in batches, replay between batches
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 20; i++) {
        const type = `b${batch}-e${i}`;
        queue.queue(sessionId, type, {});
        vi.advanceTimersByTime(1);
      }
      const events = queue.replay(sessionId);
      allReplayed.push(...events.map((e) => e.type));
    }

    // Every event name is unique by construction, so check no duplicates
    const unique = new Set(allReplayed);
    expect(unique.size).toBe(allReplayed.length);
    expect(allReplayed.length).toBe(100); // 5 batches × 20
  });

  // ── Property 3: Expired event filtering ──────────────────────────────────
  it('Property 3: events older than maxAge are filtered on replay', () => {
    const maxAge = 5_000;
    const queue = new PendingEventQueue(maxAge, 500);
    const sessionId = 'expire-test';

    // Queue 50 events
    for (let i = 0; i < 50; i++) {
      queue.queue(sessionId, `evt-${i}`, {});
      vi.advanceTimersByTime(1);
    }

    // Advance past maxAge
    vi.advanceTimersByTime(maxAge + 1);

    const replayed = queue.replay(sessionId);
    expect(replayed.length).toBe(0);
  });

  // ── Property 4: Max size enforcement ─────────────────────────────────────
  it('Property 4: queue never exceeds maxSize even with 200 events', () => {
    const maxSize = 100;
    const queue = new PendingEventQueue(60_000, maxSize);
    const sessionId = 'size-test';

    for (let i = 0; i < 200; i++) {
      queue.queue(sessionId, `evt-${i}`, {});
      vi.advanceTimersByTime(1);
      // Invariant: queue size never exceeds maxSize
      expect(queue.getQueueSize(sessionId)).toBeLessThanOrEqual(maxSize);
    }

    expect(queue.getQueueSize(sessionId)).toBe(maxSize);
    const replayed = queue.replay(sessionId);
    expect(replayed.length).toBe(maxSize);
  });

  // ── Property 5: Session isolation ────────────────────────────────────────
  it('Property 5: random operations on 10 sessions never cross-contaminate', () => {
    const rng = mulberry32(999);
    const queue = new PendingEventQueue(60_000, 50);
    const sessionCount = 10;
    const perSession = new Map<string, string[]>();

    for (let s = 0; s < sessionCount; s++) {
      perSession.set(`session-${s}`, []);
    }

    // Random interleaving of queue operations across sessions
    for (let op = 0; op < 300; op++) {
      const sid = randomSessionId(rng, sessionCount);
      const type = `${sid}-evt-${op}`;
      queue.queue(sid, type, { op });
      perSession.get(sid)!.push(type);
      vi.advanceTimersByTime(1);
    }

    // Replay each session and verify isolation
    for (const [sid, expectedTypes] of perSession) {
      const replayed = queue.replay(sid);
      const replayedTypes = replayed.map((e) => e.type);

      // All replayed events belong to this session
      for (const t of replayedTypes) {
        expect(t).toContain(sid);
      }

      // No events from other sessions leaked in
      // (queue may have dropped oldest due to maxSize=50, so we check the tail)
      const expectedTail = expectedTypes.slice(-50);
      expect(replayedTypes).toEqual(expectedTail);
    }
  });

  // ── Property 6: Idempotent replay ──────────────────────────────────────
  it('Property 6: second replay returns empty (events consumed on first replay)', () => {
    const rng = mulberry32(777);
    const queue = new PendingEventQueue(60_000, 500);
    const sessionId = 'idempotent-test';

    for (let i = 0; i < 50; i++) {
      queue.queue(sessionId, randomEventType(rng), { i });
      vi.advanceTimersByTime(1);
    }

    const first = queue.replay(sessionId);
    expect(first.length).toBe(50);

    const second = queue.replay(sessionId);
    expect(second.length).toBe(0);
  });

  // ── Property 7: Handler register/unregister chaos ────────────────────────
  it('Property 7: random register/unregister/dispatch sequence never crashes', () => {
    const rng = mulberry32(314);
    const queue = new PendingEventQueue(60_000, 200);
    const registeredHandlers = new Set<string>();
    const dispatched = new Map<string, string[]>(); // sessionId → event types dispatched
    const queued = new Map<string, string[]>(); // sessionId → event types queued

    const sessions = ['s-0', 's-1', 's-2', 's-3', 's-4'];

    for (const s of sessions) {
      dispatched.set(s, []);
      queued.set(s, []);
    }

    // 500 random operations
    for (let op = 0; op < 500; op++) {
      const action = rng();
      const sid = sessions[Math.floor(rng() * sessions.length)];
      const eventType = `op-${op}`;

      if (action < 0.2) {
        // Register handler
        registeredHandlers.add(sid);
      } else if (action < 0.35) {
        // Unregister handler
        registeredHandlers.delete(sid);
      } else if (action < 0.45) {
        // Replay pending events
        const events = queue.replay(sid);
        dispatched.get(sid)!.push(...events.map((e) => e.type));
      } else {
        // Dispatch event (queue if no handler, "dispatch" if handler exists)
        if (registeredHandlers.has(sid)) {
          dispatched.get(sid)!.push(eventType);
        } else {
          queue.queue(sid, eventType, { op });
          queued.get(sid)!.push(eventType);
          vi.advanceTimersByTime(1);
        }
      }
    }

    // Verify: no crashes occurred (reaching here = success)
    // Verify: queued events can still be replayed
    for (const sid of sessions) {
      const remaining = queue.replay(sid);
      // Remaining events should all belong to this session's queued set
      for (const e of remaining) {
        expect(queued.get(sid)).toContain(e.type);
      }
    }

    // Verify: no session has negative queue size
    for (const sid of sessions) {
      expect(queue.getQueueSize(sid)).toBe(0); // all replayed above
    }
  });
});

