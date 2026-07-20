import { resetWorkspaceState } from "../workspace/workspace-slice";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";

export interface WorkspaceSwitcherState {
  selectedIndex: number;
  selectionHandled: boolean;
}

export const defaultWorkspaceSwitcherState: WorkspaceSwitcherState = {
  selectedIndex: 0,
  selectionHandled: true,
};

export const initialState: WorkspaceSwitcherState = defaultWorkspaceSwitcherState;

export const openSwitcher = createAction<
  [workspaceIds: string[], activeWorkspaceId: string | null]
>("workspaceSwitcher/openSwitcher");

export const closeSwitcher = createAction("workspaceSwitcher/closeSwitcher");

export const cycleNext = createAction<[workspaceCount: number]>("workspaceSwitcher/cycleNext");

export const cyclePrevious = createAction<[workspaceCount: number]>("workspaceSwitcher/cyclePrevious");

export const confirmSelection = createAction("workspaceSwitcher/confirmSelection");

function getInitialSwitcherSelectedIndex(
  workspaceIds: string[],
  activeWorkspaceId: string | null,
): number {
  if (
    activeWorkspaceId &&
    workspaceIds.length > 1 &&
    workspaceIds[0] === activeWorkspaceId
  ) {
    return 1;
  }

  return 0;
}

function resetSwitcherState(
  switcher: WorkspaceSwitcherState,
  selectionHandled: boolean,
): WorkspaceSwitcherState {
  return {
    ...switcher,
    selectedIndex: 0,
    selectionHandled,
  };
}

export const workspaceSwitcherReducer = createReducer<WorkspaceSwitcherState>(initialState)
  .with(openSwitcher, (state, { payload: [workspaceIds, activeWorkspaceId] }) => {
    if (workspaceIds.length === 0) {
      return state;
    }

    const selectedIndex = getInitialSwitcherSelectedIndex(workspaceIds, activeWorkspaceId);

    if (state.selectedIndex === selectedIndex && state.selectionHandled === false) {
      return state;
    }

    return {
      selectedIndex,
      selectionHandled: false,
    };
  })
  .with(closeSwitcher, (state) => {
    if (state.selectionHandled) {
      return state;
    }

    const nextSwitcher = resetSwitcherState(state, true);
    return nextSwitcher;
  })
  .with(cycleNext, (state, { payload: [workspaceCount] }) => {
    if (state.selectionHandled || workspaceCount === 0) {
      return state;
    }

    return {
      ...state,
      selectedIndex: (state.selectedIndex + 1) % workspaceCount,
    };
  })
  .with(cyclePrevious, (state, { payload: [workspaceCount] }) => {
    if (state.selectionHandled || workspaceCount === 0) {
      return state;
    }

    return {
      ...state,
      selectedIndex: (state.selectedIndex - 1 + workspaceCount) % workspaceCount,
    };
  })
  .with(confirmSelection, (state) => {
    if (state.selectionHandled) {
      return state;
    }

    return resetSwitcherState(state, true);
  })
  .with(resetWorkspaceState, () => initialState);