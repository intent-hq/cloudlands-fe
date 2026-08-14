/**
 * Behavioral tests for the LazyTurn height ledger (lazy-turn-scroll-ledger.ts).
 *
 * With overflow-anchor: none on the chat scroller, ANY height change of a
 * turn above the reader's viewport must be compensated via scrollTop or the
 * visible transcript jumps. The v2.37.0 one-shot swap compensation missed
 * late-settling content after the swap flush — the intermittent 20–30px
 * top-of-chat jump while scrolling through history. The ledger reconciles the
 * turn's height on every swap flush and every ResizeObserver fire.
 */
import { describe, it, expect } from 'vitest';
import { createHeightLedger, snapshotScroller } from '../lazy-turn-scroll-ledger';

interface FakeTurn {
  height: number;
  /** Turn top's fixed offset within the scroller's content (content coordinates). */
  contentTop: number;
  connected: boolean;
}

interface HarnessOptions {
  /** Total height of all content OTHER than the fake turn. */
  restHeight?: number;
  clientHeight?: number;
  initialScrollTop?: number;
}

/**
 * Physically consistent harness: the turn's viewport-relative bottom is
 * DERIVED from its content position, current height, and the scroller's
 * scrollTop (`contentTop + height - scrollTop`), exactly like real layout.
 * Every scenario therefore exercises the ledger's pre-change bottom
 * reconstruction (`rect.bottom - delta`) for real — hand-set rects cannot
 * discriminate pre- vs post-change geometry.
 *
 * The scroller models real overflow geometry too: scrollHeight is derived
 * from the turn's current height, and scrollTop writes clamp to
 * [0, scrollHeight - clientHeight] exactly like the browser. `flush()`
 * re-applies the native clamp after a height change — the browser does this
 * at layout-flush time, BEFORE the ledger's account() microtask runs.
 * Defaults keep the scroller far from its extents so classic scenarios are
 * clamp-free.
 */
function makeHarness(turn: FakeTurn, opts: HarnessOptions = {}) {
  const { restHeight = 100000, clientHeight = 600, initialScrollTop = 1000 } = opts;
  let scrollTop = initialScrollTop;
  const scroller = {
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(v: number) {
      scrollTop = Math.min(Math.max(0, v), Math.max(0, this.scrollHeight - clientHeight));
    },
    get scrollHeight() {
      return restHeight + turn.height;
    },
    clientHeight,
    getBoundingClientRect: () => ({ top: 0 }) as DOMRect,
  } as unknown as HTMLElement;

  const el = {
    get offsetHeight() {
      return turn.height;
    },
    get isConnected() {
      return turn.connected;
    },
    getBoundingClientRect: () =>
      ({ bottom: turn.contentTop + turn.height - scroller.scrollTop }) as DOMRect,
  } as unknown as HTMLElement;

  const ledger = createHeightLedger(
    () => scroller,
    () => el,
  );
  /** Simulate the browser's native scrollTop clamp at layout-flush time. */
  const flush = () => {
    scroller.scrollTop = scroller.scrollTop;
  };
  return { scroller, ledger, turn, flush };
}

describe('LazyTurn height ledger', () => {
  it('first account() seeds the ledger without shifting the scroller', () => {
    // Turn spans content [200, 700]; viewport starts at 1000 → bottom at -300.
    const { scroller, ledger } = makeHarness({ height: 500, contentTop: 200, connected: true });
    ledger.account();
    expect(scroller.scrollTop).toBe(1000);
  });

  it('compensates a growth that happened entirely above the viewport', () => {
    // Seeded bottom at -300; +28 late settle reads -272 at account() time.
    const h = makeHarness({ height: 500, contentTop: 200, connected: true });
    h.ledger.account(); // seed at 500
    h.turn.height = 528;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1028);
  });

  it('compensates a shrink above the viewport (collapse to smaller placeholder)', () => {
    // Turn spans [0, 800] → bottom -200; shrink to 500 reads -500 pre-compensation.
    const h = makeHarness({ height: 800, contentTop: 0, connected: true });
    h.ledger.account();
    h.turn.height = 500;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(700);
  });

  it('does NOT compensate when the turn straddles or sits within the viewport', () => {
    // Turn bottom pre-change is 150px below the container top: visible content;
    // its growth must flow naturally.
    const h = makeHarness({ height: 500, contentTop: 650, connected: true });
    h.ledger.account();
    h.turn.height = 530;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1000);
  });

  it('classifies by the PRE-change bottom when growth pushes the bottom past the scroller top', () => {
    // Turn ends 10px above the container top; +28 growth reads +18 (below the
    // top) at account() time — but the change happened entirely above, so it
    // must compensate. Kills a mutant that classifies by the post-change rect.
    const h = makeHarness({ height: 500, contentTop: 490, connected: true });
    h.ledger.account(); // seed, bottom at -10
    h.turn.height = 528;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1028);
  });

  it('never double-compensates: a second account() with no height change is a no-op', () => {
    const h = makeHarness({ height: 500, contentTop: 200, connected: true });
    h.ledger.account(); // seed
    h.turn.height = 530;
    h.ledger.account(); // swap-flush path consumes the +30 delta
    const after = h.scroller.scrollTop;
    h.ledger.account(); // ResizeObserver fires for the same change
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(after);
  });

  it('interleaves swap-flush and resize accounting without drift', () => {
    // Placeholder spans [700, 900] → bottom -100. The +372 swap pushes the
    // post-change bottom to +272 (well below the top), so the swap-flush path
    // exercises the pre-change reconstruction across the boundary too.
    const h = makeHarness({ height: 200, contentTop: 700, connected: true });
    h.ledger.account(); // seed at 200 (placeholder)
    h.turn.height = 572;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1372);
    // ResizeObserver fires for the same swap: no change, no drift
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1372);
    // Content settles +28 two frames later; only the resize path sees it
    h.turn.height = 600;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1400);
  });

  it('is inert when the element is disconnected or refs are missing', () => {
    const turn: FakeTurn = { height: 500, contentTop: 200, connected: true };
    const h = makeHarness(turn);
    h.ledger.account();
    turn.connected = false;
    turn.height = 900;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1000);

    const nullLedger = createHeightLedger(
      () => null,
      () => null,
    );
    expect(() => nullLedger.account()).not.toThrow();
  });
});

describe('bottom-anchored clamp compensation (phantom space snap-back)', () => {
  // Geometry shared by the clamp scenarios: content = 2000px of other turns
  // + this turn (a stale 800px-overestimated placeholder at the top of the
  // transcript), 600px viewport. scrollHeight 2800 → maxScrollTop 2200; the
  // range above the true max is the "phantom" space a stale cache fabricates.

  it('swap path: reader at the phantom max stays pinned at the bottom through the clamp (the snap-back)', () => {
    const h = makeHarness(
      { height: 800, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 2200 },
    );
    h.ledger.account(); // seed at 800
    const pre = snapshotScroller(h.scroller);
    h.turn.height = 300; // placeholder -> real content: -500
    h.flush(); // native clamp: max drops to 1700, scrollTop 2200 -> 1700
    h.ledger.account(pre);
    // Without the snapshot the raw -500 shift lands at 1200 — a 500px yank
    // up from the bottom the reader was looking at.
    expect(h.scroller.scrollTop).toBe(1700);
  });

  it('swap path: partial clamp preserves the pre-swap distance-from-bottom exactly', () => {
    // Reader 200px above the (phantom) bottom; the clamp eats 300 of the 500
    // shrink. Raw delta on top of the clamp would land 300px too high.
    const h = makeHarness(
      { height: 800, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 2000 },
    );
    h.ledger.account();
    const pre = snapshotScroller(h.scroller);
    h.turn.height = 300;
    h.flush(); // clamp: 2000 -> 1700 (new max)
    h.ledger.account(pre);
    expect(h.scroller.scrollTop).toBe(1500); // new max 1700 - preserved 200
  });

  it('swap path: off the clamp, the bottom-anchored target equals the classic shift', () => {
    // Reader 400px above the bottom; -100 shrink never hits the clamp, so
    // bottom-anchoring (new max 2100 - 400) and the classic shift
    // (1800 - 100) must agree at 1700.
    const h = makeHarness(
      { height: 800, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 1800 },
    );
    h.ledger.account();
    const pre = snapshotScroller(h.scroller);
    h.turn.height = 700;
    h.flush();
    h.ledger.account(pre);
    expect(h.scroller.scrollTop).toBe(1700);
  });

  it('swap path: far from the bottom (> one viewport) the classic shift applies unchanged', () => {
    const h = makeHarness({ height: 800, contentTop: 0, connected: true });
    h.ledger.account();
    const pre = snapshotScroller(h.scroller);
    h.turn.height = 500;
    h.flush();
    h.ledger.account(pre);
    expect(h.scroller.scrollTop).toBe(700); // identical to the snapshot-free shrink case
  });

  it('swap path: growth near the bottom flows through the classic shift (bottom stays preserved)', () => {
    // Placeholder underestimated: growth extends scrollHeight, no clamp can
    // fire, and += delta keeps the reader glued to the same content.
    const h = makeHarness(
      { height: 300, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 1700 },
    );
    h.ledger.account();
    const pre = snapshotScroller(h.scroller);
    h.turn.height = 800;
    h.flush();
    h.ledger.account(pre);
    expect(h.scroller.scrollTop).toBe(2200);
  });

  it('ResizeObserver path (no snapshot): a shrink already clamped to the new max is not re-applied', () => {
    const h = makeHarness(
      { height: 800, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 2200 },
    );
    h.ledger.account();
    h.turn.height = 500; // late settle: -300
    h.flush(); // native clamp: max 1900, scrollTop 2200 -> 1900
    h.ledger.account(); // RO fire — no pre-flush snapshot exists
    expect(h.scroller.scrollTop).toBe(1900); // raw shift would snap to 1600
  });

  it('ResizeObserver path (no snapshot): an unclamped above-viewport shrink still compensates classically', () => {
    const h = makeHarness({ height: 800, contentTop: 0, connected: true });
    h.ledger.account();
    h.turn.height = 500;
    h.flush();
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(700);
  });

  it('snapshotScroller returns null for a missing scroller and captures live geometry otherwise', () => {
    expect(snapshotScroller(null)).toBeNull();
    expect(snapshotScroller(undefined)).toBeNull();
    const h = makeHarness(
      { height: 800, contentTop: 0, connected: true },
      { restHeight: 2000, clientHeight: 600, initialScrollTop: 2200 },
    );
    expect(snapshotScroller(h.scroller)).toEqual({
      scrollTop: 2200,
      scrollHeight: 2800,
      clientHeight: 600,
    });
  });
});
