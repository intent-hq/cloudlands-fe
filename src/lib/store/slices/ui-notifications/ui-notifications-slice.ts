import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";

export type UiNotificationsState = Record<string, never>;

export const initialState: UiNotificationsState = {};

export const uiNotificationsReducer = createReducer<UiNotificationsState>(initialState);