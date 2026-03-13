import { createSelector } from "../../utils/create-selector";

export const selectNotificationEnabled = createSelector((state) => {
  return state.notificationSettings.enabled;
});

export const selectSoundEnabled = createSelector((state) => {
  return state.notificationSettings.soundEnabled;
});

export const selectSoundOnlyWhenUnfocused = createSelector((state) => {
  return state.notificationSettings.soundOnlyWhenUnfocused;
});

export const selectNotificationVolume = createSelector((state) => {
  return state.notificationSettings.volume;
});

