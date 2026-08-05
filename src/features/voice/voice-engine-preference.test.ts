/**
 * Tests for the localStorage-backed voice engine preference: valid values
 * round-trip, malformed/absent values fold to `daemon`, and storage failures
 * degrade without throwing. The global test setup replaces window.localStorage
 * with vi.fn stubs, so reads are driven through the mocked getItem.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceEngine,
  loadVoiceEnginePreference,
  saveVoiceEnginePreference,
  VOICE_ENGINE_STORAGE_KEY,
} from "./voice-engine-preference";

const getItemMock = vi.mocked(window.localStorage.getItem);
const setItemMock = vi.mocked(window.localStorage.setItem);

afterEach(() => {
  getItemMock.mockReset().mockReturnValue(null);
  setItemMock.mockReset();
});

describe("isVoiceEngine", () => {
  it("accepts only the two engine values", () => {
    expect(isVoiceEngine("daemon")).toBe(true);
    expect(isVoiceEngine("os")).toBe(true);
    expect(isVoiceEngine("cloud")).toBe(false);
    expect(isVoiceEngine(null)).toBe(false);
    expect(isVoiceEngine(undefined)).toBe(false);
  });
});

describe("load/saveVoiceEnginePreference", () => {
  it("persists under the storage key and reads back a valid engine", () => {
    saveVoiceEnginePreference("os");
    expect(setItemMock).toHaveBeenCalledWith(VOICE_ENGINE_STORAGE_KEY, "os");

    getItemMock.mockReturnValue("os");
    expect(loadVoiceEnginePreference()).toBe("os");
  });

  it("folds absent and malformed stored values to daemon", () => {
    getItemMock.mockReturnValue(null);
    expect(loadVoiceEnginePreference()).toBe("daemon");
    getItemMock.mockReturnValue("garbage");
    expect(loadVoiceEnginePreference()).toBe("daemon");
  });

  it("does not throw when storage is unavailable", () => {
    setItemMock.mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    getItemMock.mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveVoiceEnginePreference("os")).not.toThrow();
    expect(loadVoiceEnginePreference()).toBe("daemon");
  });
});
