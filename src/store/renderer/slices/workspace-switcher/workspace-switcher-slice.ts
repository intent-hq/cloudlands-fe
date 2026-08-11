import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { resetWorkspaceState } from '../workspace/workspace-slice';

export interface WorkspaceSwitcherState {
  selectedIndex: number;
  selectionHandled: boolean;
}

export const initialState: WorkspaceSwitcherState = {
  selectedIndex: 0,
  selectionHandled: true,
};

export const openSwitcher = createAction<
  [workspaceIds: string[], activeWorkspaceId: string | null]
>('workspaceSwitcher/openSwitcher');
export const closeSwitcher = createAction('workspaceSwitcher/closeSwitcher');
export const cycleNext = createAction<[workspaceCount: number]>('workspaceSwitcher/cycleNext');
export const cyclePrevious = createAction<[workspaceCount: number]>(
  'workspaceSwitcher/cyclePrevious',
);
export const confirmSelection = createAction('workspaceSwitcher/confirmSelection');

function resetSwitcher(selectionHandled: boolean): WorkspaceSwitcherState {
  return { selectedIndex: 0, selectionHandled };
}

export const workspaceSwitcherReducer = createReducer<WorkspaceSwitcherState>(initialState);
workspaceSwitcherReducer.with(
  openSwitcher,
  (state, { payload: [workspaceIds, activeWorkspaceId] }) => {
    if (workspaceIds.length === 0) return state;
    const selectedIndex =
      activeWorkspaceId && workspaceIds.length > 1 && workspaceIds[0] === activeWorkspaceId ? 1 : 0;
    if (state.selectedIndex === selectedIndex && !state.selectionHandled) return state;
    return { selectedIndex, selectionHandled: false };
  },
);
workspaceSwitcherReducer.with(closeSwitcher, (state) =>
  state.selectionHandled ? state : resetSwitcher(true),
);
workspaceSwitcherReducer.with(cycleNext, (state, { payload: [workspaceCount] }) => {
  if (state.selectionHandled || workspaceCount === 0) return state;
  return { ...state, selectedIndex: (state.selectedIndex + 1) % workspaceCount };
});
workspaceSwitcherReducer.with(cyclePrevious, (state, { payload: [workspaceCount] }) => {
  if (state.selectionHandled || workspaceCount === 0) return state;
  return { ...state, selectedIndex: (state.selectedIndex - 1 + workspaceCount) % workspaceCount };
});
workspaceSwitcherReducer.with(confirmSelection, (state) =>
  state.selectionHandled ? state : resetSwitcher(true),
);
workspaceSwitcherReducer.with(resetWorkspaceState, () => initialState);
