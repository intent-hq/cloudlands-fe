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
import { createHeightLedger } from '../lazy-turn-scroll-ledger';

interface FakeTurn {
  height: number;
  /** Turn top's fixed offset within the scroller's content (content coordinates). */
  contentTop: number;
  connected: boolean;
}

/**
 * Physically consistent harness: the turn's viewport-relative bottom is
 * DERIVED from its content position, current height, and the scroller's
 * scrollTop (`contentTop + height - scrollTop`), exactly like real layout.
 * Every scenario therefore exercises the ledger's pre-change bottom
 * reconstruction (`rect.bottom - delta`) for real — hand-set rects cannot
 * discriminate pre- vs post-change geometry.
 */
function makeHarness(turn: FakeTurn) {
  const scroller = {
    scrollTop: 1000,
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
  return { scroller, ledger, turn };
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
