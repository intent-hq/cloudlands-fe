/**
 * HUD takeover queue — a pure, timer-free state machine that sequences
 * full-screen takeover displays so event bursts play one after another.
 *
 * The caller owns the clock: it feeds `nowMs` into every transition and asks
 * `nextDeadline()` when to schedule its next `tick()`. Rules (task spec):
 *  - overlapping/burst triggers enqueue; each takeover plays its full
 *    blink → open → dwell → close cycle before the next starts;
 *  - triggers for the workspace already displayed or queued COALESCE into
 *    that entry (latest trigger wins the banner; earlier banners of the same
 *    display are kept so multi-event takeovers can stack banners, mock
 *    `ovDefs().banners`);
 *  - DISMISS skips the dwell — the close animation still plays, then the
 *    next queued entry opens;
 *  - a manual card-click opens a VIEWER entry: it dwells with NO deadline
 *    (no auto-dismiss — only DISMISS closes it) and event triggers never
 *    coalesce into it or race it, they queue behind it in pending.
 *
 * Phase timing mirrors the mock choreography: every open is preceded by a
 * card pre-roll blink (mock `ovPend`, `wsflash .3s step-end 3` inside a
 * 1050ms window — manual opens too, mock `openManual`), the wipe-in
 * completes at ~1.2s (content fade ends 0.86s + 0.3s), the dwell countdown
 * is 8s, and the reverse wipe runs ~0.95s (mock `ovClosing` window). The
 * caller passes `{ blink: false }` (reduced motion) to open instantly, and
 * `skipTakeoverBlink` bails out of a blink whose source card is missing.
 */

/** One reason a takeover opened — kept in one const per the task spec. */
export const HUD_TAKEOVER_KINDS = [
  'task_complete',
  'agent_delegated',
  'agent_started',
  'agent_failed',
  'question_asked',
  'status_update',
  'manual',
] as const;

export type HudTakeoverKind = (typeof HUD_TAKEOVER_KINDS)[number];

/** A single takeover trigger (queued verbatim; banner data is wire content). */
export interface HudTakeoverTrigger {
  workspaceId: string;
  kind: HudTakeoverKind;
  /** Wire-derived banner headline (task title / agent name); i18n-exempt. */
  detail: string;
  /** Event timestamp (epoch ms) the trigger was raised at. */
  raisedAtMs: number;
  /** Task note id to highlight/pan to on the map; null when nothing changed. */
  changedTaskId: string | null;
}

/** One queue entry: a workspace display carrying its accumulated triggers. */
export interface HudTakeoverEntry {
  workspaceId: string;
  /** Oldest-first; the newest trigger drives the primary banner. */
  triggers: HudTakeoverTrigger[];
  /**
   * Manual card-click viewer: renders without the event banner/countdown,
   * dwells with no deadline (manual DISMISS only), and event triggers queue
   * behind it instead of coalescing into or interrupting it.
   */
  isViewer: boolean;
}

export type HudTakeoverPhase = 'idle' | 'blinking' | 'opening' | 'dwelling' | 'closing';

/** Caller-supplied animation gate: `blink: false` (reduced motion) skips the pre-roll. */
export interface HudTakeoverOptions {
  blink?: boolean;
}

export interface HudTakeoverQueueState {
  phase: HudTakeoverPhase;
  /** Entry currently displayed; null iff phase is 'idle'. */
  active: HudTakeoverEntry | null;
  /** Waiting entries, oldest first. */
  pending: HudTakeoverEntry[];
  /** Epoch-ms deadline of the current phase; null when idle. */
  phaseEndsAtMs: number | null;
}

/** Mock card pre-roll: `wsflash .3s step-end 3` inside the 1050ms pend window. */
export const HUD_TAKEOVER_BLINK_MS = 1050;
/** Mock wipe-in: content fade ends at 0.86s + 0.3s ≈ 1.2s. */
export const HUD_TAKEOVER_OPEN_MS = 1200;
/** Auto-dismiss dwell (mock RETURN countdown ~8s of the 10.5s window). */
export const HUD_TAKEOVER_DWELL_MS = 8000;
/** Mock reverse wipe (`ovClosing` window ~0.95s). */
export const HUD_TAKEOVER_CLOSE_MS = 950;

/** Cap so a runaway burst cannot queue takeovers forever. */
export const HUD_TAKEOVER_MAX_PENDING = 8;

/** Cap of banners kept per entry (mock stacks at most 2). */
export const HUD_TAKEOVER_MAX_TRIGGERS = 4;

export function createHudTakeoverQueue(): HudTakeoverQueueState {
  return { phase: 'idle', active: null, pending: [], phaseEndsAtMs: null };
}

function openEntry(
  state: HudTakeoverQueueState,
  entry: HudTakeoverEntry,
  nowMs: number,
  blink: boolean,
): HudTakeoverQueueState {
  return blink
    ? { ...state, phase: 'blinking', active: entry, phaseEndsAtMs: nowMs + HUD_TAKEOVER_BLINK_MS }
    : {
        ...state,
        phase: 'opening',
        active: entry,
        phaseEndsAtMs: nowMs + HUD_TAKEOVER_OPEN_MS,
      };
}

function appendTrigger(entry: HudTakeoverEntry, trigger: HudTakeoverTrigger): HudTakeoverEntry {
  return {
    ...entry,
    triggers: [...entry.triggers, trigger].slice(-HUD_TAKEOVER_MAX_TRIGGERS),
  };
}

/**
 * Enqueue a trigger. Coalesces into the active display (while it is blinking,
 * opening or dwelling — a closing one is already on its way out) or into a
 * pending entry for the same workspace; otherwise appends a new entry.
 * Coalescing into the dwelling display restarts its dwell so the new banner
 * gets a full read window. An active manual VIEWER is never coalesced into or
 * raced: event triggers (even for the same workspace) queue behind it.
 */
export function enqueueTakeover(
  state: HudTakeoverQueueState,
  trigger: HudTakeoverTrigger,
  nowMs: number,
  options: HudTakeoverOptions = {},
): HudTakeoverQueueState {
  if (state.phase === 'idle' || !state.active) {
    return openEntry(
      state,
      { workspaceId: trigger.workspaceId, triggers: [trigger], isViewer: false },
      nowMs,
      options.blink !== false,
    );
  }
  if (
    !state.active.isViewer &&
    state.active.workspaceId === trigger.workspaceId &&
    (state.phase === 'blinking' || state.phase === 'opening' || state.phase === 'dwelling')
  ) {
    const active = appendTrigger(state.active, trigger);
    return state.phase === 'dwelling'
      ? { ...state, active, phaseEndsAtMs: nowMs + HUD_TAKEOVER_DWELL_MS }
      : { ...state, active };
  }
  const pendingIndex = state.pending.findIndex(
    (entry) => entry.workspaceId === trigger.workspaceId,
  );
  if (pendingIndex >= 0) {
    const pending = state.pending.slice();
    pending[pendingIndex] = appendTrigger(pending[pendingIndex], trigger);
    return { ...state, pending };
  }
  if (state.pending.length >= HUD_TAKEOVER_MAX_PENDING) return state;
  return {
    ...state,
    pending: [
      ...state.pending,
      { workspaceId: trigger.workspaceId, triggers: [trigger], isViewer: false },
    ],
  };
}

/** Manual DISMISS: skip the dwell, play the close, then the next entry. */
export function dismissTakeover(
  state: HudTakeoverQueueState,
  nowMs: number,
): HudTakeoverQueueState {
  if (state.phase === 'idle' || state.phase === 'closing') return state;
  return { ...state, phase: 'closing', phaseEndsAtMs: nowMs + HUD_TAKEOVER_CLOSE_MS };
}

/**
 * Bail out of the pre-roll when the source card cannot blink (missing from
 * the grid): jump straight from 'blinking' to 'opening'. No-op otherwise.
 */
export function skipTakeoverBlink(
  state: HudTakeoverQueueState,
  nowMs: number,
): HudTakeoverQueueState {
  if (state.phase !== 'blinking') return state;
  return { ...state, phase: 'opening', phaseEndsAtMs: nowMs + HUD_TAKEOVER_OPEN_MS };
}

/**
 * Manual card-click open: jumps the queue as a VIEWER entry (no banner, no
 * auto-dismiss — see `HudTakeoverEntry.isViewer`), with the same card
 * pre-roll blink as event opens (mock `openManual`). Clicking the workspace
 * already displayed CONVERTS that display into a viewer (an event takeover's
 * countdown stops; an open viewer is unchanged); otherwise the current
 * display closes early (full close animation still plays) and the viewer
 * entry goes to the FRONT of pending so it opens next.
 */
export function requestImmediateTakeover(
  state: HudTakeoverQueueState,
  trigger: HudTakeoverTrigger,
  nowMs: number,
  options: HudTakeoverOptions = {},
): HudTakeoverQueueState {
  const entry: HudTakeoverEntry = {
    workspaceId: trigger.workspaceId,
    triggers: [trigger],
    isViewer: true,
  };
  if (state.phase === 'idle' || !state.active) {
    return openEntry(state, entry, nowMs, options.blink !== false);
  }
  if (
    state.active.workspaceId === trigger.workspaceId &&
    (state.phase === 'blinking' || state.phase === 'opening' || state.phase === 'dwelling')
  ) {
    if (state.active.isViewer) return state;
    const active = { ...state.active, isViewer: true };
    return state.phase === 'dwelling'
      ? { ...state, active, phaseEndsAtMs: null }
      : { ...state, active };
  }
  if (state.phase === 'blinking') {
    // The blinking entry never displayed: it returns to the FRONT of pending
    // (no close to play) and the viewer takes over the pre-roll immediately.
    const pending = [
      state.active,
      ...state.pending.filter((e) => e.workspaceId !== trigger.workspaceId),
    ];
    return { ...openEntry(state, entry, nowMs, options.blink !== false), pending };
  }
  const pending = [entry, ...state.pending.filter((e) => e.workspaceId !== trigger.workspaceId)];
  return { ...dismissTakeover(state, nowMs), pending };
}

/**
 * Advance past any elapsed phase deadlines. Loops so a long-stalled clock
 * (e.g. a background tab) settles in one call: blinking → opening → dwelling
 * → closing → next entry (or idle). A VIEWER dwells with NO deadline: its
 * opening phase ends into a deadline-free dwell that only `dismissTakeover`
 * leaves. `options.blink` also gates the pre-roll of entries chained in from
 * pending after a close.
 */
export function tickTakeoverQueue(
  state: HudTakeoverQueueState,
  nowMs: number,
  options: HudTakeoverOptions = {},
): HudTakeoverQueueState {
  let current = state;
  while (current.phase !== 'idle' && current.phaseEndsAtMs !== null) {
    if (nowMs < current.phaseEndsAtMs) break;
    const endedAt = current.phaseEndsAtMs;
    if (current.phase === 'blinking') {
      current = { ...current, phase: 'opening', phaseEndsAtMs: endedAt + HUD_TAKEOVER_OPEN_MS };
    } else if (current.phase === 'opening') {
      current = {
        ...current,
        phase: 'dwelling',
        phaseEndsAtMs: current.active?.isViewer ? null : endedAt + HUD_TAKEOVER_DWELL_MS,
      };
    } else if (current.phase === 'dwelling') {
      current = { ...current, phase: 'closing', phaseEndsAtMs: endedAt + HUD_TAKEOVER_CLOSE_MS };
    } else {
      const [next, ...rest] = current.pending;
      const blink = options.blink !== false;
      current = next
        ? {
            phase: blink ? 'blinking' : 'opening',
            active: next,
            pending: rest,
            phaseEndsAtMs: endedAt + (blink ? HUD_TAKEOVER_BLINK_MS : HUD_TAKEOVER_OPEN_MS),
          }
        : { phase: 'idle', active: null, pending: [], phaseEndsAtMs: null };
    }
  }
  return current;
}

/** Epoch-ms of the next phase transition; null when idle (no timer needed). */
export function nextTakeoverDeadline(state: HudTakeoverQueueState): number | null {
  return state.phaseEndsAtMs;
}

/** The newest trigger of the active entry (drives the primary banner). */
export function activeTakeoverTrigger(state: HudTakeoverQueueState): HudTakeoverTrigger | null {
  const triggers = state.active?.triggers;
  return triggers && triggers.length > 0 ? triggers[triggers.length - 1] : null;
}

/** Remaining dwell seconds for the RETURN countdown (0 outside the dwell). */
export function takeoverCountdownSeconds(state: HudTakeoverQueueState, nowMs: number): number {
  if (state.phase !== 'dwelling' || state.phaseEndsAtMs === null) return 0;
  return Math.max(0, Math.ceil((state.phaseEndsAtMs - nowMs) / 1000));
}
