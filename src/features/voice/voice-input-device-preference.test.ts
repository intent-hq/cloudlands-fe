/**
 * Tests for the localStorage-backed microphone input-device preference:
 * device ids round-trip, absent/blank values fold to the system default
 * (`null`), a `null` save clears the key, storage failures degrade to a
 * session-scoped preference without throwing, and loads prefer the
 * in-session selection over the persisted value. The global test setup
 * replaces window.localStorage with vi.fn stubs, so reads are driven
 * through the mocked getItem.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadVoiceInputDevicePreference,
  resetVoiceInputDevicePreferenceSession,
  saveVoiceInputDevicePreference,
  VOICE_INPUT_DEVICE_STORAGE_KEY,
} from "./voice-input-device-preference";

const getItemMock = vi.mocked(window.localStorage.getItem);
const setItemMock = vi.mocked(window.localStorage.setItem);
const removeItemMock = vi.mocked(window.localStorage.removeItem);

afterEach(() => {
  resetVoiceInputDevicePreferenceSession();
  getItemMock.mockReset().mockReturnValue(null);
  setItemMock.mockReset();
  removeItemMock.mockReset();
});

describe("load/saveVoiceInputDevicePreference", () => {
  it("persists under the storage key and reads back the device id", () => {
    saveVoiceInputDevicePreference("mic-abc123");
    expect(setItemMock).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY, "mic-abc123");

    getItemMock.mockReturnValue("mic-abc123");
    expect(loadVoiceInputDevicePreference()).toBe("mic-abc123");
  });

  it("a null save clears the key back to the system default", () => {
    saveVoiceInputDevicePreference(null);
    expect(removeItemMock).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY);
    expect(setItemMock).not.toHaveBeenCalled();
  });

  it("folds absent and blank stored values to the system default", () => {
    getItemMock.mockReturnValue(null);
    expect(loadVoiceInputDevicePreference()).toBeNull();
    getItemMock.mockReturnValue("");
    expect(loadVoiceInputDevicePreference()).toBeNull();
  });

  it("does not throw when storage is unavailable", () => {
    setItemMock.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    removeItemMock.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    getItemMock.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveVoiceInputDevicePreference("mic-abc123")).not.toThrow();
    expect(() => saveVoiceInputDevicePreference(null)).not.toThrow();
    expect(loadVoiceInputDevicePreference()).toBeNull();
  });

  it("prefers the in-session selection when the persisted write failed", () => {
    setItemMock.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    getItemMock.mockReturnValue("mic-stale");
    saveVoiceInputDevicePreference("mic-new");
    expect(loadVoiceInputDevicePreference()).toBe("mic-new");
  });

  it("an in-session null save overrides a stale persisted value", () => {
    removeItemMock.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    getItemMock.mockReturnValue("mic-stale");
    saveVoiceInputDevicePreference(null);
    expect(loadVoiceInputDevicePreference()).toBeNull();
  });
});
