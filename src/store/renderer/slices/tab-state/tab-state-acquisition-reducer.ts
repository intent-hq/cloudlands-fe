// This opt-in composition uses the canonical reducer exactly once; it copies no handlers.
import { loadWorkspaceTabsState, tabStateReducer } from './tab-state-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { AcquiredTabState, WorkspaceTabAcquisitions } from './tab-state-acquisition-types';

const initialState: AcquiredTabState = {
  ...tabStateReducer.initialState,
  workspaceTabAcquisitions: { lastSerial: 0, serialByWorkspaceId: {} },
};

function reduceAcquiredTabs(
  state: AcquiredTabState = initialState,
  action: Parameters<typeof tabStateReducer>[1],
): AcquiredTabState {
  const next = tabStateReducer(state, action) as AcquiredTabState;
  const before = state.workspaceTabAcquisitions;
  const reset = action.type === loadWorkspaceTabsState.type && next !== state;
  const deletedId =
    action.type === workspaceDeleted.type
      ? (action as ReturnType<typeof workspaceDeleted>).payload[0]
      : undefined;
  let serials = before.serialByWorkspaceId;
  let lastSerial = before.lastSerial;
  const edit = () => {
    if (serials === before.serialByWorkspaceId) serials = { ...serials };
  };

  // Clear first. Deletion retires an acquisition even while the strip awaits reconciliation.
  // A repeated delete or rejected open may not regrant the missing acquisition.
  for (const id of Object.keys(serials)) {
    if (reset || next.openTabs[id] !== true || id === deletedId) {
      edit();
      delete serials[id];
    }
  }
  for (const id of Object.keys(next.openTabs)) {
    if (next.openTabs[id] !== true || id === deletedId) continue;
    if (!reset && state.openTabs[id] === true) continue;
    const serial = lastSerial + 1;
    // Never reuse an ordinal. Exhaustion refuses this tracked dispatch instead of wrapping.
    // Exhaustion affects this opt-in composition only; the source reducer is unchanged.
    if (!Number.isSafeInteger(serial)) throw new RangeError('Workspace tab acquisition exhausted');
    edit();
    serials[id] = serial;
    lastSerial = serial;
  }
  if (serials === before.serialByWorkspaceId) return next;
  const workspaceTabAcquisitions: WorkspaceTabAcquisitions = {
    lastSerial,
    serialByWorkspaceId: serials,
  };
  return { ...next, workspaceTabAcquisitions };
}

/** Later React registration only. The source tabStateReducer export is unchanged. */
export const acquiredTabStateReducer = Object.assign(reduceAcquiredTabs, {
  initialState,
});
