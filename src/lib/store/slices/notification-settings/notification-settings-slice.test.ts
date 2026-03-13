import { describe, it, expect } from "vitest";
import {
  notificationSettingsReducer,
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  resetNotificationSettings,
  type NotificationSettingsState,
} from "./notification-settings-slice";

describe("notificationSettingsReducer", () => {
  const initialState: NotificationSettingsState = {
    enabled: true,
    soundEnabled: true,
    soundOnlyWhenUnfocused: true,
    volume: 0.5,
  };

  it("should return initial state", () => {
    const state = notificationSettingsReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("setNotificationEnabled", () => {
    it("should set enabled to false", () => {
      const state = notificationSettingsReducer(initialState, setNotificationEnabled(false));
      expect(state.enabled).toBe(false);
    });

    it("should set enabled to true", () => {
      const disabled = { ...initialState, enabled: false };
      const state = notificationSettingsReducer(disabled, setNotificationEnabled(true));
      expect(state.enabled).toBe(true);
    });
  });

  describe("setSoundEnabled", () => {
    it("should set soundEnabled to false", () => {
      const state = notificationSettingsReducer(initialState, setSoundEnabled(false));
      expect(state.soundEnabled).toBe(false);
    });

    it("should set soundEnabled to true", () => {
      const disabled = { ...initialState, soundEnabled: false };
      const state = notificationSettingsReducer(disabled, setSoundEnabled(true));
      expect(state.soundEnabled).toBe(true);
    });
  });

  describe("setSoundOnlyWhenUnfocused", () => {
    it("should set soundOnlyWhenUnfocused to false", () => {
      const state = notificationSettingsReducer(initialState, setSoundOnlyWhenUnfocused(false));
      expect(state.soundOnlyWhenUnfocused).toBe(false);
    });

    it("should set soundOnlyWhenUnfocused to true", () => {
      const disabled = { ...initialState, soundOnlyWhenUnfocused: false };
      const state = notificationSettingsReducer(disabled, setSoundOnlyWhenUnfocused(true));
      expect(state.soundOnlyWhenUnfocused).toBe(true);
    });
  });

  describe("setVolume", () => {
    it("should set volume", () => {
      const state = notificationSettingsReducer(initialState, setVolume(0.8));
      expect(state.volume).toBe(0.8);
    });

    it("should clamp volume to 0 minimum", () => {
      const state = notificationSettingsReducer(initialState, setVolume(-0.5));
      expect(state.volume).toBe(0);
    });

    it("should clamp volume to 1 maximum", () => {
      const state = notificationSettingsReducer(initialState, setVolume(1.5));
      expect(state.volume).toBe(1);
    });

    it("should allow volume at boundaries", () => {
      const state0 = notificationSettingsReducer(initialState, setVolume(0));
      expect(state0.volume).toBe(0);
      const state1 = notificationSettingsReducer(initialState, setVolume(1));
      expect(state1.volume).toBe(1);
    });
  });

  describe("resetNotificationSettings", () => {
    it("should reset all settings to defaults", () => {
      const modified: NotificationSettingsState = {
        enabled: false,
        soundEnabled: false,
        soundOnlyWhenUnfocused: false,
        volume: 0.2,
      };
      const state = notificationSettingsReducer(modified, resetNotificationSettings());
      expect(state).toEqual(initialState);
    });
  });
});

