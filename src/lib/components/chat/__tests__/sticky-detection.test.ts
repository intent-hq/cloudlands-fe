/**
 * @vitest-environment jsdom
 *
 * Behavioral regression tests for the sticky-row detection (sticky flicker).
 *
 * The pre-fix detection required the sticky element's own rect to sit within
 * the 20px enter window on EVERY pass, including for the already-pinned row.
 * Pinning compacts the row (line-clamp-6 → line-clamp-2), and Chromium scroll
 * anchoring compensated for the height shrink by shifting scrollTop — moving
 * the element's rect outside the window and un-pinning it, which re-expanded
 * the row and repeated the loop every frame (visible as top-of-chat flicker).
 *
 * These tests simulate that geometry change directly: after a row pins, its
 * own rect shrinks/moves while its conversation turn still spans the container
 * top. The fixed hysteretic detection must keep the row pinned; the pre-fix
 * logic returns null here (verified by running this file against the pre-fix
 * detection body).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { detectStickyMessageId } from '../sticky-detection';

type RectInput = { top: number; bottom: number };

function stubRect(el: Element, { top, bottom }: RectInput) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      top,
      bottom,
      height: bottom - top,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** Scroll container top sits at viewport y=0, 600px tall. */
const SCROLLER_RECT: RectInput = { top: 0, bottom: 600 };

function buildTranscript(messageIds: string[], { innerSticky = false } = {}) {
  const scroller = document.createElement('div');
  stubRect(scroller, SCROLLER_RECT);

  const rows = new Map<string, { turn: HTMLElement; sticky: HTMLElement }>();
  for (const id of messageIds) {
    const turn = document.createElement('div');
    turn.className = 'conversation-turn';

    const row = document.createElement('div');
    row.className = 'message-nav-target';
    row.setAttribute('data-message-id', id);

    let sticky: HTMLElement;
    if (innerSticky) {
      // Detection's querySelector('.sticky') branch: the sticky element is a
      // child of the row (defensive path; no current row renders this shape).
      sticky = document.createElement('div');
      sticky.className = 'sticky';
      row.appendChild(sticky);
    } else {
      // Both user messages and EventWakeupBanner rows: ChatPanel applies
      // class:sticky to the message-nav-target wrapper itself.
      row.classList.add('sticky');
      sticky = row;
    }

    turn.appendChild(row);
    scroller.appendChild(turn);
    rows.set(id, { turn, sticky });
  }
  document.body.appendChild(scroller);
  return { scroller, rows };
}

describe('sticky-row detection stability (flicker regression)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('pins a row whose top reaches the container top while its turn spans it', () => {
    const { scroller, rows } = buildTranscript(['m1']);
    const { turn, sticky } = rows.get('m1')!;
    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -1, bottom: 119 });

    expect(detectStickyMessageId(scroller, null)).toBe('m1');
  });

  it('does not pin a row outside the enter window even when its turn spans the top', () => {
    const { scroller, rows } = buildTranscript(['m1']);
    const { turn, sticky } = rows.get('m1')!;
    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -30, bottom: 90 });

    expect(detectStickyMessageId(scroller, null)).toBeNull();
  });

  it('keeps the pinned row pinned when its own compaction shrinks its rect', () => {
    const { scroller, rows } = buildTranscript(['m1']);
    const { turn, sticky } = rows.get('m1')!;

    // Frame 1: expanded row (120px tall) pins at the container top.
    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -1, bottom: 119 });
    expect(detectStickyMessageId(scroller, null)).toBe('m1');

    // Frame 2: sticky compaction shrinks the row to 40px (line-clamp-2). The
    // turn still spans the container top, so the pin must hold.
    stubRect(sticky, { top: -1, bottom: 39 });
    expect(detectStickyMessageId(scroller, 'm1')).toBe('m1');
  });

  it('keeps the pinned row pinned when scroll anchoring shifts its rect outside the enter window', () => {
    const { scroller, rows } = buildTranscript(['m1']);
    const { turn, sticky } = rows.get('m1')!;

    // Frame 1: the row pins at the container top.
    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -1, bottom: 119 });
    expect(detectStickyMessageId(scroller, null)).toBe('m1');

    // Frame 2: compaction shrank the row by 80px and scroll anchoring
    // compensated by shifting scrollTop, moving the element's own rect well
    // outside the 20px enter window while the turn still spans the top. The
    // pre-fix detection (enter window re-checked on every pass) un-pins here;
    // the hysteretic detection must keep the row pinned.
    stubRect(turn, { top: -180, bottom: 420 });
    stubRect(sticky, { top: -30, bottom: 10 });
    expect(detectStickyMessageId(scroller, 'm1')).toBe('m1');
  });

  it('never oscillates across repeated frames of the compaction/anchoring geometry loop', () => {
    const { scroller, rows } = buildTranscript(['m1']);
    const { turn, sticky } = rows.get('m1')!;

    const expandedRow: RectInput = { top: -1, bottom: 119 };
    const compactedShiftedRow: RectInput = { top: -30, bottom: 10 };
    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, expandedRow);

    let stickyId = detectStickyMessageId(scroller, null);
    expect(stickyId).toBe('m1');

    // Replay the frame loop the flicker produced: compaction + anchoring move
    // the row's rect, it re-expands, and so on. The sticky state must stay
    // stable (exactly one transition: the initial pin).
    let flips = 0;
    for (let frame = 0; frame < 10; frame++) {
      stubRect(sticky, frame % 2 === 0 ? compactedShiftedRow : expandedRow);
      const next = detectStickyMessageId(scroller, stickyId);
      if (next !== stickyId) flips++;
      stickyId = next;
    }
    expect(stickyId).toBe('m1');
    expect(flips).toBe(0);
  });

  it('releases the pin when the turn is scrolled past and hands off to the next turn', () => {
    const { scroller, rows } = buildTranscript(['m1', 'm2']);
    const first = rows.get('m1')!;
    const second = rows.get('m2')!;

    // m1 pinned, m2's turn still below the container top.
    stubRect(first.turn, { top: -400, bottom: 100 });
    stubRect(first.sticky, { top: -1, bottom: 39 });
    stubRect(second.turn, { top: 100, bottom: 700 });
    stubRect(second.sticky, { top: 100, bottom: 140 });
    expect(detectStickyMessageId(scroller, 'm1')).toBe('m1');

    // Scroll on: m1's turn bottom passes the container top and m2 reaches it.
    stubRect(first.turn, { top: -510, bottom: -10 });
    stubRect(first.sticky, { top: -50, bottom: -10 });
    stubRect(second.turn, { top: -10, bottom: 590 });
    stubRect(second.sticky, { top: -1, bottom: 39 });
    expect(detectStickyMessageId(scroller, 'm1')).toBe('m2');
  });

  it('applies the same hysteresis to event-wakeup banner rows (sticky wrapper, ChatPanel shape)', () => {
    // EventWakeupBanner rows share the user-message DOM shape: class:sticky on
    // the message-nav-target wrapper itself (ChatPanel's wake-up row markup).
    const { scroller, rows } = buildTranscript(['wake-1']);
    const { turn, sticky } = rows.get('wake-1')!;

    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -1, bottom: 59 });
    expect(detectStickyMessageId(scroller, null)).toBe('wake-1');

    // Compaction geometry change on the banner row must not un-pin.
    stubRect(turn, { top: -140, bottom: 460 });
    stubRect(sticky, { top: -30, bottom: 0 });
    expect(detectStickyMessageId(scroller, 'wake-1')).toBe('wake-1');
  });

  it('applies the same hysteresis via the inner-sticky querySelector branch', () => {
    const { scroller, rows } = buildTranscript(['inner-1'], { innerSticky: true });
    const { turn, sticky } = rows.get('inner-1')!;

    stubRect(turn, { top: -100, bottom: 500 });
    stubRect(sticky, { top: -1, bottom: 59 });
    expect(detectStickyMessageId(scroller, null)).toBe('inner-1');

    stubRect(turn, { top: -140, bottom: 460 });
    stubRect(sticky, { top: -30, bottom: 0 });
    expect(detectStickyMessageId(scroller, 'inner-1')).toBe('inner-1');
  });
});
