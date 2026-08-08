import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

export type AuthState = Record<string, never>;

const initialState: AuthState = {};

export const authReducer = createReducer<AuthState>(initialState);