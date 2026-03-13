import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";

// ============================================================================
// Types
// ============================================================================

export type NotificationSettingsState = {
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: NotificationSettingsState = {
  enabled: true,
  soundEnabled: true,
  soundOnlyWhenUnfocused: true,
  volume: 0.5,
};

// ============================================================================
// Actions
// ============================================================================

export const setNotificationEnabled = createAction<[value: boolean]>(
  "notificationSettings/setNotificationEnabled"
);

export const setSoundEnabled = createAction<[value: boolean]>(
  "notificationSettings/setSoundEnabled"
);

export const setSoundOnlyWhenUnfocused = createAction<[value: boolean]>(
  "notificationSettings/setSoundOnlyWhenUnfocused"
);

export const setVolume = createAction<[value: number]>(
  "notificationSettings/setVolume"
);

export const resetNotificationSettings = createAction(
  "notificationSettings/resetNotificationSettings"
);

// ============================================================================
// Reducer
// ============================================================================

export const notificationSettingsReducer = createReducer<NotificationSettingsState>(initialState)
  .with(setNotificationEnabled, (state, { payload: [value] }) => ({
    ...state,
    enabled: value,
  }))
  .with(setSoundEnabled, (state, { payload: [value] }) => ({
    ...state,
    soundEnabled: value,
  }))
  .with(setSoundOnlyWhenUnfocused, (state, { payload: [value] }) => ({
    ...state,
    soundOnlyWhenUnfocused: value,
  }))
  .with(setVolume, (state, { payload: [value] }) => ({
    ...state,
    volume: Math.max(0, Math.min(1, value)),
  }))
  .with(resetNotificationSettings, () => ({
    ...initialState,
  }));

