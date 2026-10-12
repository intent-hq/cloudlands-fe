import { emptyWorkspaceState, type TerminalOverlayState } from './terminals-slice';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';

type TerminalsProjectionState = { terminals: TerminalOverlayState };

export function getTerminalWorkspaceState(state: TerminalsProjectionState, wsId: string) {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

export const getTerminalsForWorkspace = (state: TerminalsProjectionState, wsId: string) => {
  return getItems(getTerminalWorkspaceState(state, wsId).terminals);
};
