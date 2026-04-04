import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { PaletteState } from "./palette-types";

export const initialState: PaletteState = {
  isOpen: false,
  query: "",
};

export const openPalette = createAction("palette/open");
export const closePalette = createAction("palette/close");
export const openGoToLine = createAction("palette/openGoToLine");
export const togglePalette = createAction("palette/toggle");

export const paletteReducer = createReducer<PaletteState>(initialState)
  .with(openPalette, (state) => ({
    ...state,
    isOpen: true,
    query: "",
  }))
  .with(closePalette, (state) => ({
    ...state,
    isOpen: false,
    query: "",
  }))
  .with(openGoToLine, (state) => ({
    ...state,
    isOpen: true,
    query: ":",
  }))
  .with(togglePalette, (state) => {
    if (state.isOpen) {
      return { ...state, isOpen: false, query: "" };
    }
    return { ...state, isOpen: true, query: "" };
  });

