import { createReducer } from "../../utils/create-reducer";

export type AutoUpdateState = Record<string, never>;

const initialState: AutoUpdateState = {};

export const autoUpdateReducer = createReducer<AutoUpdateState>(initialState);