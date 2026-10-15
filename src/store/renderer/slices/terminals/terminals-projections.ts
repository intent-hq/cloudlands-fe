import { emptyWorkspaceState, type TerminalOverlayState } from './terminals-slice';
import { getItems, getItem } from '@themislib/themis/utils/collections/collection-utils';

type TerminalsProjectionState = { terminals: TerminalOverlayState };

export function getTerminalWorkspaceState(state: TerminalsProjectionState, wsId: string) {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

export const getTerminalsForWorkspace = (state: TerminalsProjectionState, wsId: string) => {
  return getItems(getTerminalWorkspaceState(state, wsId).terminals);
};

export const getTerminalOperations = (state: TerminalsProjectionState, workspaceId: string) =>
  state.terminals.operations
    ? getItems(state.terminals.operations).filter((entry) => entry.workspaceId === workspaceId)
    : [];
export const getTerminalOperation = (state: TerminalsProjectionState, id: string) =>
  state.terminals.operations ? getItem(state.terminals.operations, id) : undefined;
export const getTerminalRead = (state: TerminalsProjectionState, workspaceId: string) =>
  state.terminals.reads?.[workspaceId];
