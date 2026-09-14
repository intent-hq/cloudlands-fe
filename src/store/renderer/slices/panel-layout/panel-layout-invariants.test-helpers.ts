/**
 * Structural invariants of the panel-layout state, asserted after every
 * reducer call in the panel-layout test suites (intent-hq/intent#4569).
 *
 * `PanelState.pristine` and `activeTabId` are maintained by hand at every
 * reducer site that adds or removes tabs; wrapping the reducer under test with
 * {@link withPanelLayoutInvariants} turns a missed site into a failure of the
 * existing tests instead of relying on review.
 */

import type { PanelLayoutSliceState } from './panel-layout-types';

type PanelLayoutReducer<A extends { type: string }> = (
  state: PanelLayoutSliceState | undefined,
  action: A,
) => PanelLayoutSliceState;

class PanelLayoutInvariantError extends Error {
  constructor(
    readonly actionType: string,
    readonly violations: string[],
  ) {
    super(
      `panel-layout invariant violated after action "${actionType}":\n` +
        violations.map((violation) => `  - ${violation}`).join('\n'),
    );
    this.name = 'PanelLayoutInvariantError';
  }
}

/** Collect every violated invariant across all workspaces; empty when the state is consistent. */
function collectPanelLayoutInvariantViolations(state: PanelLayoutSliceState): string[] {
  const violations: string[] = [];
  for (const [wsId, ws] of Object.entries(state.byWorkspaceId)) {
    for (const [panelKey, panel] of Object.entries(ws.panels)) {
      const where = `workspace "${wsId}" panel "${panelKey}"`;
      if (panel.tabs.length > 0 && panel.pristine === true) {
        violations.push(`${where}: holds ${panel.tabs.length} tab(s) but pristine === true`);
      }
      if (panel.tabs.length === 0) {
        if (panel.activeTabId !== null) {
          violations.push(
            `${where}: has no tabs but activeTabId is ${JSON.stringify(panel.activeTabId)}`,
          );
        }
      } else if (panel.activeTabId === null) {
        violations.push(`${where}: holds ${panel.tabs.length} tab(s) but activeTabId is null`);
      } else if (!panel.tabs.some((tab) => tab.id === panel.activeTabId)) {
        violations.push(
          `${where}: activeTabId ${JSON.stringify(panel.activeTabId)} is not one of its tabs ` +
            JSON.stringify(panel.tabs.map((tab) => tab.id)),
        );
      }
    }
    if (ws.focusedPanelId !== null && !(ws.focusedPanelId in ws.panels)) {
      violations.push(
        `workspace "${wsId}": focusedPanelId ${JSON.stringify(ws.focusedPanelId)} names no panel ` +
          JSON.stringify(Object.keys(ws.panels)),
      );
    }
  }
  return violations;
}

/** Throw a {@link PanelLayoutInvariantError} naming `actionType` when any invariant is violated. */
function assertPanelLayoutInvariants(state: PanelLayoutSliceState, actionType: string): void {
  const violations = collectPanelLayoutInvariantViolations(state);
  if (violations.length > 0) throw new PanelLayoutInvariantError(actionType, violations);
}

/**
 * Wrap a reducer so every result is invariant-checked before it is returned.
 * Drop-in replacement for the reducer in tests: same signature, same result.
 */
export function withPanelLayoutInvariants<A extends { type: string }>(
  reducer: PanelLayoutReducer<A>,
): PanelLayoutReducer<A> {
  return (state, action) => {
    const next = reducer(state, action);
    assertPanelLayoutInvariants(next, action.type);
    return next;
  };
}
