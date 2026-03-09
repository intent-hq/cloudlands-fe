import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type HandleDropZoneType = "row-above" | "row-below" | "column-left" | "column-right";

/**
 * Serializable replacement for DOMRect.
 * Redux state must be fully serializable — DOMRect is a class instance.
 */
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
  /** Bounding rect of the handle element */
  handleRect: SerializableRect;
  /** Bounding rect of the parent container (for full-width/height overlays) */
  containerRect: SerializableRect;
  /** Type of drop zone */
  zoneType: HandleDropZoneType;
  /** Label to show */
  label: string;
}

// ============================================================================
// State
// ============================================================================

export type TabDragState = {
  isDragging: boolean;
  activeHandleDrop: HandleDropInfo | null;
};

const initialState: TabDragState = {
  isDragging: false,
  activeHandleDrop: null,
};

// ============================================================================
// Actions
// ============================================================================

export const startDrag = createAction("tabDrag/startDrag");
export const endDrag = createAction("tabDrag/endDrag");
export const setActiveHandleDrop = createAction<[info: HandleDropInfo | null]>(
  "tabDrag/setActiveHandleDrop"
);

// ============================================================================
// Reducer
// ============================================================================

export const tabDragReducer = createReducer<TabDragState>(initialState)
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
  }));

