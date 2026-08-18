import { describe, expect, it } from 'vitest';

import type { AgentMessage, AgentSession } from '$shared/types';
import {
  agentSessionReducer,
  initialState,
  bulkUpsertSessions,
  prependHistoryMessages,
  setHistoryOldestReached,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSessionState } from '$store/renderer/slices/agent-session/agent-session-types';
import {
  selectAgentHistoryMessages,
  selectAgentMessages,
  selectHistorySegmentMeta,
} from '$store/renderer/slices/agent-session/agent-session-selectors';
import {
  reconcileVirtualSpacer,
  restateFrozenSpacers,
  shouldRequestOlderHistory,
  splitUnloadedRows,
} from '../chat-scrollback-composition';

// ============================================================================
// Deterministic full-walk scrollback harness
//
// Simulates the ChatPanel scrollback pipeline end-to-end WITHOUT a DOM:
// wire-shaped rows drive the REAL reducer + selectors and the real spacer
// math (splitUnloadedRows / reconcileVirtualSpacer / restateFrozenSpacers)
// against a simulated viewport with a deterministic per-row height table.
// Ground truth is the full conversation, so extent error, blank-viewport
// overlap, and exhaustion snap are all directly assertable.
// ============================================================================

/**
 * Conversation size for the walk scenarios. Large enough that the serial
 * walk overruns HISTORY_SEGMENT_MAX (500) and cap pruning opens the
 * history→tail hole — the regime where the QA symptoms live.
 */
const CONVERSATION_ROWS = 1400;
/** Saga page size (mirrors chat-scrollback-saga PAGE_LIMIT). */
const PAGE_ROWS = 200;
/** Simulated transcript container clientHeight. */
const VIEWPORT_PX = 800;
/** Mirrors ChatPanel SCROLLBACK_TOP_THRESHOLD_PX. */
const TOP_THRESHOLD_PX = 240;
/** Extent-error bound vs ground truth (<15%). */
const EXTENT_ERROR_BOUND = 0.15;

const AGENT_ID = 'agent-walk';
const BASE_MS = Date.parse('2026-01-01T00:00:00.000Z');

/** Wire-shaped message: ordinal `i` of the ground-truth conversation. */
function wireMsg(i: number): AgentMessage {
  const role = i % 2 === 0 ? 'user' : 'assistant';
  return {
    id: `m-${String(i).padStart(5, '0')}`,
    role,
    timestamp: new Date(BASE_MS + i * 1000).toISOString(),
    contentBlocks: [{ type: 'text' as const, text: `row ${i} (${role})` }],
  };
}

/** Full ground-truth conversation, oldest → newest. */
function buildConversation(rows = CONVERSATION_ROWS): AgentMessage[] {
  return Array.from({ length: rows }, (_, i) => wireMsg(i));
}

/**
 * Deterministic row height by ordinal: mimics mixed short/long turns.
 * Values chosen to average ~72px so the EMA has real variance to chase.
 */
function rowHeight(i: number): number {
  const cycle = [48, 64, 220, 56, 96, 40, 180, 72][i % 8];
  return cycle;
}

function makeSession(tail: AgentMessage[]): AgentSession {
  return {
    id: AGENT_ID,
    backendSessionId: null,
    workspaceId: 'ws-1',
    name: 'Walk harness agent',
    status: 'idle',
    messages: tail,
    createdAt: new Date(BASE_MS).toISOString(),
    updatedAt: new Date(BASE_MS).toISOString(),
  } as unknown as AgentSession;
}

/** Seed the store with the newest `tailRows` of the conversation as the tail. */
function seedState(conversation: AgentMessage[], tailRows: number): AgentSessionState {
  const tail = conversation.slice(conversation.length - tailRows);
  return agentSessionReducer(
    initialState,
    bulkUpsertSessions([makeSession(tail)], { preserveExplicitRuntimeFlags: false }),
  );
}

/** Wrap slice state for the store-shaped selectors. */
function storeState(agentSessions: AgentSessionState) {
  return { agentSessions } as never;
}

/** Conversation ordinal encoded in the wire id (`m-00042` → 42). */
function ordinalOf(m: AgentMessage): number {
  return Number(m.id.slice(2));
}

function heightOf(rows: AgentMessage[]): number {
  return rows.reduce((sum, m) => sum + rowHeight(ordinalOf(m)), 0);
}

interface SimAnchor {
  id: string;
  /** rect.top - containerRect.top at capture time (docTop - scrollTop). */
  offsetFromViewport: number;
}

/**
 * Deterministic ChatPanel scrollback simulation: real reducer + selectors +
 * spacer math against a simulated viewport. Document layout mirrors the
 * template order: [above spacer][history rows][below spacer][tail rows].
 */
class WalkSim {
  state: AgentSessionState;
  above = 0;
  below = 0;
  ema: number | null = null;
  scrollTop = 0;
  /** Ordinal one past the oldest row already fetched (saga continuation). */
  fetchCursor: number;

  constructor(
    readonly conversation: AgentMessage[],
    tailRows: number,
  ) {
    this.state = seedState(conversation, tailRows);
    this.fetchCursor = conversation.length - tailRows;
  }

  get history(): AgentMessage[] {
    return selectAgentHistoryMessages.select(storeState(this.state), AGENT_ID);
  }
  get tail(): AgentMessage[] {
    return selectAgentMessages.select(storeState(this.state), AGENT_ID);
  }
  get meta() {
    return selectHistorySegmentMeta.select(storeState(this.state), AGENT_ID);
  }

  residentHeight(): number {
    return heightOf(this.history) + heightOf(this.tail);
  }
  scrollHeight(): number {
    return this.above + this.residentHeight() + this.below;
  }
  groundTruthHeight(): number {
    return heightOf(this.conversation);
  }
  extentError(): number {
    const truth = this.groundTruthHeight();
    return Math.abs(this.scrollHeight() - truth) / truth;
  }

  /** Document offset of each resident row, in template order. */
  rowDocTops(): { id: string; top: number; height: number }[] {
    const rows: { id: string; top: number; height: number }[] = [];
    let cursor = this.above;
    for (const m of this.history) {
      rows.push({ id: m.id, top: cursor, height: rowHeight(ordinalOf(m)) });
      cursor += rowHeight(ordinalOf(m));
    }
    cursor += this.below;
    for (const m of this.tail) {
      rows.push({ id: m.id, top: cursor, height: rowHeight(ordinalOf(m)) });
      cursor += rowHeight(ordinalOf(m));
    }
    return rows;
  }

  /** Mirrors captureScrollAnchor: first row whose top is inside the viewport. */
  captureAnchor(): SimAnchor | null {
    if (this.scrollHeight() - this.scrollTop - VIEWPORT_PX < 100) return null; // near-bottom skip
    for (const row of this.rowDocTops()) {
      const offset = row.top - this.scrollTop;
      if (offset >= 0 && offset < VIEWPORT_PX) return { id: row.id, offsetFromViewport: offset };
    }
    return null;
  }

  /** Mirrors restoreScrollAnchor: re-pin the anchor row's viewport offset. */
  restoreAnchor(anchor: SimAnchor | null): void {
    if (!anchor) return;
    const row = this.rowDocTops().find((r) => r.id === anchor.id);
    if (!row) return; // element no longer connected (pruned)
    const offsetDifference = row.top - this.scrollTop - anchor.offsetFromViewport;
    if (Math.abs(offsetDifference) > 5) this.scrollTop += offsetDifference;
  }

  /** The above/below unloaded split for the current segment state. */
  currentSplit(): { above: number; below: number } {
    const meta = this.meta;
    return splitUnloadedRows({
      totalMessages: this.conversation.length,
      residentCount: meta.historyCount + meta.tailCount,
      exhausted: meta.oldestReached,
      startOrdinalEstimate: meta.startOrdinalEstimate,
      gapToTail: meta.gapToTail,
      holeRowsEstimate: meta.holeRowsEstimate,
    });
  }

  /**
   * One older-history page: capture anchor, prepend through the real
   * reducer, frozen-phase COUNT-derived restatement of both spacers
   * (split x frozen EMA, with the ChatPanel effect's same-frame scrollTop
   * compensation), then anchor restore — the ChatPanel effect order.
   */
  fetchOlderPage(): void {
    const end = this.fetchCursor;
    const start = Math.max(0, end - PAGE_ROWS);
    const page = this.conversation.slice(start, end);
    const anchor = this.captureAnchor();
    this.state = agentSessionReducer(this.state, prependHistoryMessages(AGENT_ID, page));
    this.fetchCursor = start;
    if (start === 0) {
      this.state = agentSessionReducer(this.state, setHistoryOldestReached(AGENT_ID));
    }
    if (this.above > 0 || this.below > 0) {
      const restated = restateFrozenSpacers(this.currentSplit(), this.ema);
      const previousAbove = this.above;
      const previousBelow = this.below;
      let compensation = 0;
      // Above delta shifts content above the viewport — unless the viewport
      // is parked INSIDE the above spacer (resident window must rise to it).
      if (this.scrollTop >= previousAbove) compensation += restated.above - previousAbove;
      const spacerTopDoc = restated.above + heightOf(this.history);
      if (previousBelow > 0 && this.scrollTop > spacerTopDoc) {
        compensation += restated.below - previousBelow;
      }
      this.above = restated.above;
      this.below = restated.below;
      if (compensation !== 0) this.scrollTop = Math.max(0, this.scrollTop + compensation);
    }
    this.restoreAnchor(anchor);
  }

  /** Mirrors runSpacerReconcile (quiet-point dual-spacer reconcile). */
  reconcile(): void {
    const totalMessages = this.conversation.length;
    const meta = this.meta;
    const residentCount = meta.historyCount + meta.tailCount;
    const exhausted = meta.oldestReached;
    const split = splitUnloadedRows({
      totalMessages,
      residentCount,
      exhausted,
      startOrdinalEstimate: meta.startOrdinalEstimate,
      gapToTail: meta.gapToTail,
      holeRowsEstimate: meta.holeRowsEstimate,
    });
    const residentContentHeight = this.residentHeight();
    const result = reconcileVirtualSpacer({
      totalMessages,
      residentCount,
      exhausted,
      residentContentHeight,
      currentSpacerHeight: this.above,
      rowHeightEma: this.ema,
      viewportHeight: VIEWPORT_PX,
      unloadedRows: split.above,
    });
    this.ema = result.rowHeightEma;
    const belowResult = reconcileVirtualSpacer({
      totalMessages,
      residentCount,
      exhausted: false,
      residentContentHeight: 0,
      currentSpacerHeight: this.below,
      rowHeightEma: this.ema,
      viewportHeight: VIEWPORT_PX,
      unloadedRows: split.below,
    });
    if (!result.applied && !belowResult.applied) return;
    const previousScrollTop = this.scrollTop;
    let compensation = result.applied ? result.scrollTopDelta : 0;
    if (belowResult.applied && this.below > 0) {
      const spacerTopDoc = this.above + heightOf(this.history);
      if (previousScrollTop > spacerTopDoc) compensation += belowResult.scrollTopDelta;
    }
    if (result.applied) this.above = result.spacerHeight;
    if (belowResult.applied) this.below = belowResult.spacerHeight;
    if (compensation !== 0) this.scrollTop = Math.max(0, previousScrollTop + compensation);
  }

  /**
   * Pixels of the viewport [scrollTop, scrollTop + VIEWPORT_PX) covered by
   * spacer territory (above spacer + below spacer) — blank space on screen.
   */
  spacerOverlapPx(): number {
    const viewTop = this.scrollTop;
    const viewBottom = Math.min(this.scrollTop + VIEWPORT_PX, this.scrollHeight());
    const overlap = (top: number, bottom: number) =>
      Math.max(0, Math.min(viewBottom, bottom) - Math.max(viewTop, top));
    const aboveOverlap = overlap(0, this.above);
    const belowTop = this.above + heightOf(this.history);
    const belowOverlap = overlap(belowTop, belowTop + this.below);
    return aboveOverlap + belowOverlap;
  }

  /** Fraction of the viewport that is blank spacer (0..1). */
  blankFraction(): number {
    return this.spacerOverlapPx() / VIEWPORT_PX;
  }

  /** The ChatPanel older-history trigger guard at the current position. */
  triggerFires(): boolean {
    const meta = this.meta;
    return shouldRequestOlderHistory({
      scrollTop: this.scrollTop,
      threshold: TOP_THRESHOLD_PX,
      canScroll: this.scrollHeight() > VIEWPORT_PX,
      fetching: false,
      exhausted: meta.oldestReached,
      historyCount: meta.historyCount,
      tailCount: meta.tailCount,
      tailTruncated: this.fetchCursor > 0 || meta.historyCount > 0,
      totalMessages: this.conversation.length,
      spacerAbove: this.above,
    });
  }
}

describe('full-walk scrollback harness', () => {
  it('drives one older-history page through the real reducer', () => {
    const conversation = buildConversation();
    const tailRows = 20;
    let state = seedState(conversation, tailRows);

    expect(selectAgentMessages.select(storeState(state), AGENT_ID)).toHaveLength(tailRows);
    expect(rowHeight(0)).toBeGreaterThan(0);

    // The saga's older-history worker pages backwards from the oldest
    // resident row: fetch the PAGE_ROWS rows preceding the tail.
    const oldestResident = conversation.length - tailRows;
    const page = conversation.slice(oldestResident - PAGE_ROWS, oldestResident);
    state = agentSessionReducer(state, prependHistoryMessages(AGENT_ID, page));

    const history = selectAgentHistoryMessages.select(storeState(state), AGENT_ID);
    expect(history).toHaveLength(PAGE_ROWS);
    expect(history[0].id).toBe(conversation[oldestResident - PAGE_ROWS].id);

    const meta = selectHistorySegmentMeta.select(storeState(state), AGENT_ID);
    expect(meta.historyCount).toBe(PAGE_ROWS);
    expect(meta.tailCount).toBe(tailRows);
    expect(meta.gapToTail).toBe(false);
    expect(meta.oldestReached).toBe(false);
  });

  it('serial walk tail→top keeps extent error under 15% at every quiet point', () => {
    const conversation = buildConversation();
    const sim = new WalkSim(conversation, 20);

    // Initial hydration settles: first reconcile seeds the EMA + spacer.
    sim.scrollTop = Math.max(0, sim.scrollHeight() - VIEWPORT_PX);
    sim.reconcile();
    expect(sim.above).toBeGreaterThan(0);
    expect(sim.extentError()).toBeLessThan(EXTENT_ERROR_BOUND);

    const extentErrors: { step: number; error: number }[] = [];
    let steps = 0;
    const MAX_STEPS = 2000;
    while (!sim.meta.oldestReached && steps < MAX_STEPS) {
      steps += 1;
      // User scrolls up one viewport per step.
      sim.scrollTop = Math.max(0, sim.scrollTop - VIEWPORT_PX);
      // Edge-trigger + settle chaining: keep paging while the guard fires
      // (mirrors shouldChainOlderHistoryOnSettle re-running the same guard).
      let chain = 0;
      while (sim.triggerFires() && chain < 50) {
        chain += 1;
        sim.fetchOlderPage();
      }
      // Transcript goes quiet → reconcile runs.
      sim.reconcile();
      extentErrors.push({ step: steps, error: sim.extentError() });
    }

    expect(sim.meta.oldestReached).toBe(true);
    expect(steps).toBeLessThan(MAX_STEPS);
    const worst = extentErrors.reduce((a, b) => (b.error > a.error ? b : a));
    expect(
      worst.error,
      `worst extent error ${(worst.error * 100).toFixed(1)}% at step ${worst.step}`,
    ).toBeLessThan(EXTENT_ERROR_BOUND);
  });

  it('serial walk never leaves the settled viewport resting in blank spacer territory', () => {
    const conversation = buildConversation();
    const sim = new WalkSim(conversation, 20);
    sim.scrollTop = Math.max(0, sim.scrollHeight() - VIEWPORT_PX);
    sim.reconcile();

    interface StepTrace {
      step: number;
      scrollTop: number;
      above: number;
      below: number;
      blankFraction: number;
      historyCount: number;
      holeRowsEstimate: number | null;
      gapToTail: boolean;
      pagesFetched: number;
      triggerStillFires: boolean;
    }
    const violations: StepTrace[] = [];
    let steps = 0;
    const MAX_STEPS = 2000;
    while (!sim.meta.oldestReached && steps < MAX_STEPS) {
      steps += 1;
      sim.scrollTop = Math.max(0, sim.scrollTop - VIEWPORT_PX);
      let pagesFetched = 0;
      while (sim.triggerFires() && pagesFetched < 50) {
        pagesFetched += 1;
        sim.fetchOlderPage();
      }
      sim.reconcile();
      // Settled: no fetch in flight, chain guard is quiet. The viewport must
      // now show real rows — any spacer overlap is a persistent blank swath.
      if (sim.spacerOverlapPx() > 0) {
        const meta = sim.meta;
        violations.push({
          step: steps,
          scrollTop: sim.scrollTop,
          above: sim.above,
          below: sim.below,
          blankFraction: Number(sim.blankFraction().toFixed(3)),
          historyCount: meta.historyCount,
          holeRowsEstimate: meta.holeRowsEstimate,
          gapToTail: meta.gapToTail,
          pagesFetched,
          triggerStillFires: sim.triggerFires(),
        });
      }
    }

    expect(
      violations,
      `settled viewport rested in blank spacer territory at ${violations.length}/${steps} steps; ` +
        `first: ${JSON.stringify(violations[0])}; last: ${JSON.stringify(violations.at(-1))}`,
    ).toEqual([]);
  });

  // ── Frozen-phase walk: the QA repro ─────────────────────────────────────
  // Continuous scrolling keeps the interaction quiet-window open, so
  // runSpacerReconcile early-returns and re-arms for the WHOLE walk: the
  // only spacer mutation is the frozen-phase count-derived restatement in
  // the prepend effect. The forced boundary reconcile (exhausted &&
  // spacer > 0) is the first reconcile that actually applies — at the very
  // top of the walk.
  it('continuous-scroll (frozen) walk: no blank viewport mid-walk, no thumb snap at exhaustion', () => {
    const conversation = buildConversation();
    const sim = new WalkSim(conversation, 20);
    // Seed like the real panel: the transcript settles once BEFORE the user
    // starts the gesture, sizing the spacer + seeding the EMA.
    sim.scrollTop = Math.max(0, sim.scrollHeight() - VIEWPORT_PX);
    sim.reconcile();
    expect(sim.above).toBeGreaterThan(0);

    interface StepTrace {
      step: number;
      scrollTop: number;
      above: number;
      below: number;
      blankFraction: number;
      historyCount: number;
      holeRowsEstimate: number | null;
      gapToTail: boolean;
      pagesFetched: number;
    }
    const blankViolations: StepTrace[] = [];
    let steps = 0;
    const MAX_STEPS = 2000;
    let previousAbove = sim.above;
    let maxAboveGrowth = 0;
    let maxStepThumbDelta = 0;
    while (!sim.meta.oldestReached && steps < MAX_STEPS) {
      steps += 1;
      const thumbBeforeStep = sim.scrollTop / Math.max(1, sim.scrollHeight() - VIEWPORT_PX);
      sim.scrollTop = Math.max(0, sim.scrollTop - VIEWPORT_PX);
      // ONE page per step: a saga fetch + render + settle takes about as
      // long as a scroll tick, so the walk lands pages at fetch latency
      // while the user keeps scrolling — unlike the idealized test above,
      // pages do not land synchronously under the gesture.
      let pagesFetched = 0;
      if (sim.triggerFires()) {
        pagesFetched = 1;
        sim.fetchOlderPage();
      }
      // NO reconcile: the user is still scrolling, the quiet window never
      // elapses (runSpacerReconcile re-arms). EMA stays locked; the
      // restatement in fetchOlderPage is the only spacer mutation.
      maxAboveGrowth = Math.max(maxAboveGrowth, sim.above - previousAbove);
      previousAbove = sim.above;
      // Thumb movement per step beyond the user's own scroll: restatement
      // must not fling the thumb around mid-walk (micro-jump guard). The
      // user's own step moves the thumb by ~VIEWPORT_PX of extent.
      const thumbAfterStep = sim.scrollTop / Math.max(1, sim.scrollHeight() - VIEWPORT_PX);
      const userOwnDelta = VIEWPORT_PX / Math.max(1, sim.scrollHeight() - VIEWPORT_PX);
      maxStepThumbDelta = Math.max(
        maxStepThumbDelta,
        Math.abs(thumbAfterStep - thumbBeforeStep) - userOwnDelta,
      );
      if (sim.spacerOverlapPx() > 0) {
        const meta = sim.meta;
        blankViolations.push({
          step: steps,
          scrollTop: sim.scrollTop,
          above: sim.above,
          below: sim.below,
          blankFraction: Number(sim.blankFraction().toFixed(3)),
          historyCount: meta.historyCount,
          holeRowsEstimate: meta.holeRowsEstimate,
          gapToTail: meta.gapToTail,
          pagesFetched,
        });
      }
    }
    expect(sim.meta.oldestReached).toBe(true);

    // Monotonic convergence: the frozen above spacer never grows mid-walk.
    expect(maxAboveGrowth, `above spacer grew ${maxAboveGrowth}px mid-walk`).toBeLessThanOrEqual(0);
    // No micro-jumps: per-step thumb movement beyond the user's own scroll
    // stays within a few percent of the bar.
    expect(
      maxStepThumbDelta,
      `restatement moved the thumb ${(maxStepThumbDelta * 100).toFixed(1)}% beyond the user's own step`,
    ).toBeLessThan(0.05);

    // Exhaustion boundary: the effect forces a reconcile (target exact 0 for
    // the above spacer). Measure the apparent thumb position across it — a
    // snap is a discontinuity the user sees as the thumb jumping to the top.
    const thumbBefore = sim.scrollTop / Math.max(1, sim.scrollHeight() - VIEWPORT_PX);
    const extentBefore = sim.scrollHeight();
    sim.reconcile();
    const thumbAfter = sim.scrollTop / Math.max(1, sim.scrollHeight() - VIEWPORT_PX);
    const extentAfter = sim.scrollHeight();
    const thumbJump = Math.abs(thumbAfter - thumbBefore);

    const summary =
      `walk: ${steps} steps; blank-viewport violations: ${blankViolations.length} ` +
      `(first: ${JSON.stringify(blankViolations[0])}; last: ${JSON.stringify(blankViolations.at(-1))}); ` +
      `exhaustion: above ${sim.above}px below ${sim.below}px, ` +
      `extent ${extentBefore}→${extentAfter} (truth ${sim.groundTruthHeight()}), ` +
      `thumb ${thumbBefore.toFixed(3)}→${thumbAfter.toFixed(3)} (jump ${thumbJump.toFixed(3)})`;

    // Symptom 1 — blank swaths: the frozen spacer must never swallow the
    // viewport mid-walk.
    expect(blankViolations, summary).toEqual([]);
    // Symptom 2 — snap at exhaustion: the boundary reconcile must not move
    // the apparent thumb position by more than a whisker.
    expect(thumbJump, summary).toBeLessThan(0.05);
  });

  // Symptom 1 in isolation: the viewport parked INSIDE the above spacer
  // (a short thumb nudge / fast flick still classified serial — no anchor
  // row is visible, so no restore repositions the viewport). Serial pages
  // land at the resident top edge; the count-derived restatement shrinks
  // the above spacer with every page (no scrollTop compensation while the
  // viewport is inside it), so the resident window rises to meet the
  // parked viewport — the blank clears within one landed page.
  it('viewport parked inside the spacer is reached by landing pages (no persistent blank)', () => {
    const conversation = buildConversation();
    const sim = new WalkSim(conversation, 20);
    sim.scrollTop = Math.max(0, sim.scrollHeight() - VIEWPORT_PX);
    sim.reconcile();

    // Serial-walk until cap pruning has opened the hole (frozen regime).
    let guard = 0;
    while (!sim.meta.gapToTail && guard < 20) {
      guard += 1;
      sim.fetchOlderPage();
    }
    expect(sim.meta.gapToTail).toBe(true);

    // Park the viewport just above the resident top edge — inside the
    // spacer, but well within the serial classification band (< 2 pages).
    sim.scrollTop = Math.max(0, sim.above - 2 * VIEWPORT_PX);
    expect(sim.spacerOverlapPx()).toBeGreaterThan(0);
    expect(sim.captureAnchor()).toBeNull();

    // Let the serial chain land page after page while the user holds still
    // (still inside the interaction freeze — no reconcile).
    const trace: { page: number; above: number; blankFraction: number }[] = [];
    let pages = 0;
    while (sim.spacerOverlapPx() > 0 && !sim.meta.oldestReached && pages < 20) {
      pages += 1;
      sim.fetchOlderPage();
      trace.push({
        page: pages,
        above: sim.above,
        blankFraction: Number(sim.blankFraction().toFixed(3)),
      });
    }

    expect(
      sim.spacerOverlapPx(),
      `viewport still blank after ${pages} landed pages (oldestReached=${sim.meta.oldestReached}); ` +
        `trace: ${JSON.stringify(trace)}`,
    ).toBe(0);
    // The blank must clear within ONE landed page (a page's worth of rows
    // far exceeds the serial band the viewport can park in).
    expect(pages, `blank persisted through ${pages} pages: ${JSON.stringify(trace)}`).toBe(1);
  });
});
