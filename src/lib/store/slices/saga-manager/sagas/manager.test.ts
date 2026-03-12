import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/electron/renderer", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../sagas", () => ({
  sagas: {},
}));

vi.mock("../../store-utility/store-utility-selectors", () => ({
  selectUpdatesLocked: { effect: vi.fn() },
}));

vi.mock("../../store-utility/store-utility-slice", () => ({
  unlockUpdates: vi.fn(),
}));

import { getBackOffDelay } from "./manager";

describe("getBackOffDelay", () => {
  it("keeps exponential backoff for representative lower retry counts", () => {
    expect(getBackOffDelay(0)).toBe(1000);
    expect(getBackOffDelay(1)).toBe(2000);
    expect(getBackOffDelay(3)).toBe(8000);
    expect(getBackOffDelay(9)).toBe(512000);
  });

  it("caps the restart delay at 10 minutes", () => {
    expect(getBackOffDelay(10)).toBe(600000);
    expect(getBackOffDelay(25)).toBe(600000);
  });
});