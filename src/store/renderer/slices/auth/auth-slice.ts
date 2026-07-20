import { createReducer } from "$lib/store-shim/utils/store/create-reducer";

export type AuthState = Record<string, never>;

const initialState: AuthState = {};

export const authReducer = createReducer<AuthState>(initialState);