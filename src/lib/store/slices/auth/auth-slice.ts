import { createReducer } from "../../utils/create-reducer";

export type AuthState = Record<string, never>;

const initialState: AuthState = {};

export const authReducer = createReducer<AuthState>(initialState);