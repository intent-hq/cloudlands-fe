import { createReducer } from "@augmentcode/ag-redux-toolkit/utils/store/create-reducer";

export type AuthState = Record<string, never>;

const initialState: AuthState = {};

export const authReducer = createReducer<AuthState>(initialState);