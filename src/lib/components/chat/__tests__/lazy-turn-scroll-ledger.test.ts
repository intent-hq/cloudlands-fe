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
  /** Turn bottom's offset from the scroller's viewport top (after current height). */
  bottomOffsetFromScrollerTop: number;
  connected: boolean;
}

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
    getBoundingClientRect: () => ({ bottom: turn.bottomOffsetFromScrollerTop }) as DOMRect,
  } as unknown as HTMLElement;

  const ledger = createHeightLedger(
    () => scroller,
    () => el,
  );
  return { scroller, ledger, turn };
}

describe('LazyTurn height ledger', () => {
  it('first account() seeds the ledger without shifting the scroller', () => {
    const { scroller, ledger } = makeHarness({
      height: 500,
      bottomOffsetFromScrollerTop: -300,
      connected: true,
    });
    ledger.account();
    expect(scroller.scrollTop).toBe(1000);
  });

  it('compensates a growth that happened entirely above the viewport', () => {
    const h = makeHarness({ height: 500, bottomOffsetFromScrollerTop: -300, connected: true });
    h.ledger.account(); // seed at 500
    // Late settle: +28px, turn still fully above (bottom pre-change was -328)
    h.turn.height = 528;
    h.turn.bottomOffsetFromScrollerTop = -300;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1028);
  });

  it('compensates a shrink above the viewport (collapse to smaller placeholder)', () => {
    const h = makeHarness({ height: 800, bottomOffsetFromScrollerTop: -200, connected: true });
    h.ledger.account();
    h.turn.height = 500;
    h.turn.bottomOffsetFromScrollerTop = -500;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(700);
  });

  it('does NOT compensate when the turn straddles or sits within the viewport', () => {
    // Turn bottom pre-change is 150px below the container top: visible content;
    // its growth must flow naturally.
    const h = makeHarness({ height: 500, bottomOffsetFromScrollerTop: 150, connected: true });
    h.ledger.account();
    h.turn.height = 530;
    h.turn.bottomOffsetFromScrollerTop = 180;
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(1000);
  });

  it('never double-compensates: a second account() with no height change is a no-op', () => {
    const h = makeHarness({ height: 500, bottomOffsetFromScrollerTop: -300, connected: true });
    h.ledger.account(); // seed
    h.turn.height = 530;
    h.ledger.account(); // swap-flush path consumes the +30 delta
    const after = h.scroller.scrollTop;
    h.ledger.account(); // ResizeObserver fires for the same change
    h.ledger.account();
    expect(h.scroller.scrollTop).toBe(after);
  });

  it('interleaves swap-flush and resize accounting without drift', () => {
    const h = makeHarness({ height: 200, bottomOffsetFromScrollerTop: -100, connected: true });
    h.ledger.account(); // seed at 200 (placeholder)
    // Swap placeholder(200) -> content(572); flush path accounts
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
    const turn: FakeTurn = { height: 500, bottomOffsetFromScrollerTop: -300, connected: true };
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
