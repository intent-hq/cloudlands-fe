import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

export type AppLayoutState = Record<string, never>;

export const initialState: AppLayoutState = {};

export const createFileRequested = createAction<
  [wsId: string, folderPath: string, fileName: string]
>("appLayout/createFileRequested");

export const appLayoutReducer = createReducer<AppLayoutState>(initialState);