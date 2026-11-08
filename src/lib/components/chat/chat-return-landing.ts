/**
 * Pure decisions for landing a chat transcript when the user returns to it
 * (workspace switch or agent-tab switch). A return must never leave the
 * viewport parked in blank space: the switch-back skeleton collapses the
 * scroll extent, and a non-following viewport used to stay at ~0 inside the
 * unloaded-history spacer once the rows came back.
 *
 * Dependency-light: no stores, services, DOM or side effects.
 */

/**
 * `workspace`: a stop-looking boundary ran while away — land at the bottom or
 * the New messages divider. `tab`: an agent-tab switch inside the workspace —
 * restore the cached reading position when one was held.
 */
export type ChatReturnKind = 'workspace' | 'tab';

export function classifyChatReturn(input: {
  /** The panel instance survived the absence (hidden, not destroyed). */
  sameInstance: boolean;
  /** The divider session this instance latched was ended while away. */
  dividerSessionEnded: boolean;
  /** A scroll cache entry exists (the boundary clears it on workspace switch). */
  hasCachedScroll: boolean;
}): ChatReturnKind {
  if (input.sameInstance) return input.dividerSessionEnded ? 'workspace' : 'tab';
  return input.hasCachedScroll ? 'tab' : 'workspace';
}

/** Rendered divider position relative to the viewport, or `none`. */
export type ReturnDividerPosition = 'none' | 'above' | 'visible' | 'below';

export interface ReturnViewportProbe {
  kind: ChatReturnKind;
  /** The user scrolled (wheel, touch, scrollbar, keyboard) since the reveal. */
  userScrolled: boolean;
  /** A fetch, seek, search navigation or skeleton legitimately owns the viewport. */
  busy: boolean;
  following: boolean;
  /** A message row (hydrated or placeholder) intersects the viewport. */
  hasVisibleRow: boolean;
  divider: ReturnDividerPosition;
}

export type ReturnCorrection = 'none' | 'divider' | 'bottom';

/**
 * Safety net between the reveal and the first user scroll input. Never moves
 * to the top: the landing target is the divider when one is rendered, else
 * the bottom.
 */
export function decideReturnCorrection(probe: ReturnViewportProbe): ReturnCorrection {
  if (probe.userScrolled || probe.busy) return 'none';
  if (!probe.hasVisibleRow) return probe.divider === 'none' ? 'bottom' : 'divider';
  // Workspace returns only: the entry chose "unseen tail fits, follow the
  // bottom" from placeholder heights, and once the rows hydrated following
  // pushed the divider away. Agent-tab returns keep today's behavior (the
  // divider session survives the switch; a following reader stays put).
  if (probe.kind === 'workspace' && probe.following && probe.divider === 'above') return 'divider';
  return 'none';
}

/**
 * Agent-tab return with a cached reading position: apply it only once the
 * revealed transcript can hold it, otherwise retry, and after the budget fall
 * back to the landing rule (never a clamped position in the spacer).
 */
export function resolveTabReturnRestore(input: {
  restoreTop: number;
  scrollHeight: number;
  clientHeight: number;
  attempts: number;
  maxAttempts: number;
}): 'restore' | 'wait' | 'landing' {
  if (input.scrollHeight - input.clientHeight >= input.restoreTop) return 'restore';
  return input.attempts < input.maxAttempts ? 'wait' : 'landing';
}
