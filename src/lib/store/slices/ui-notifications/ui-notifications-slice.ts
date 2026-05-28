import { createReducer } from "../../utils/create-reducer";

export type UiNotificationsState = Record<string, never>;

export const initialState: UiNotificationsState = {};

export const uiNotificationsReducer = createReducer<UiNotificationsState>(initialState);