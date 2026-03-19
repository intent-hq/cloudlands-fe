import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import { omitKey } from "../../utils/utils";

export type HandleDropZoneType = "row-above" | "row-below" | "column-left" | "column-right";

export type SerializableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export interface HandleDropInfo {
  handleRect: SerializableRect;
  containerRect: SerializableRect;
  zoneType: HandleDropZoneType;
  label: string;
}

export type TabState = {
  isDragging: boolean;
  activeHandleDrop: HandleDropInfo | null;
  scrollPositions: Record<string, number>;
};

const initialState: TabState = {
  isDragging: false,
  activeHandleDrop: null,
  scrollPositions: {},
};

export const startDrag = createAction("tabState/startDrag");
export const endDrag = createAction("tabState/endDrag");
export const setActiveHandleDrop = createAction<[info: HandleDropInfo | null]>(
  "tabState/setActiveHandleDrop"
);
export const saveScrollPosition = createAction<[tabId: string, scrollTop: number]>(
  "tabState/saveScrollPosition"
);
export const removeScrollPosition = createAction<[tabId: string]>(
  "tabState/removeScrollPosition"
);
export const clearForWorkspace = createAction<[workspaceId: string]>(
  "tabState/clearForWorkspace"
);
export const loadScrollPositions = createAction<[positions: Record<string, number>]>(
  "tabState/loadScrollPositions"
);

export const tabStateReducer = createReducer<TabState>(initialState)
  .with(startDrag, (state) => ({
    ...state,
    isDragging: true,
  }))
  .with(endDrag, (state) => ({
    ...state,
    isDragging: false,
    activeHandleDrop: null,
  }))
  .with(setActiveHandleDrop, (state, { payload: [info] }) => ({
    ...state,
    activeHandleDrop: info,
  }))
  .with(saveScrollPosition, (state, { payload: [tabId, scrollTop] }) => {
    if (scrollTop <= 0) {
      return state;
    }

    return {
      ...state,
      scrollPositions: { ...state.scrollPositions, [tabId]: scrollTop },
    };
  })
  .with(removeScrollPosition, (state, { payload: [tabId] }) => {
    if (!(tabId in state.scrollPositions)) {
      return state;
    }

    return {
      ...state,
      scrollPositions: omitKey(state.scrollPositions, tabId),
    };
  })
  .with(clearForWorkspace, (state, { payload: [workspaceId] }) => {
    const workspaceKeyPrefix = `${workspaceId}-`;
    const keysToRemove = Object.keys(state.scrollPositions).filter((key) =>
      key.startsWith(workspaceKeyPrefix)
    );

    if (keysToRemove.length === 0) {
      return state;
    }

    const nextScrollPositions = { ...state.scrollPositions };
    for (const key of keysToRemove) {
      delete nextScrollPositions[key];
    }

    return {
      ...state,
      scrollPositions: nextScrollPositions,
    };
  })
  .with(loadScrollPositions, (state, { payload: [scrollPositions] }) => ({
    ...state,
    scrollPositions,
  }));