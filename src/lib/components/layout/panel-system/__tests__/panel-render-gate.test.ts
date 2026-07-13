import { describe, expect, it } from "vitest";

import {
  EMPTY_LAYOUT_LOADING_TIMEOUT_MS,
  isLayoutSettledNow,
  shouldRenderPanelContainer,
} from "../panel-render-gate";

describe("shouldRenderPanelContainer", () => {
  it("renders when backend reports the layout was restored", () => {
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "restored",
        totalTabs: 0,
        hasSettled: false,
      }),
    ).toBe(true);
  });

  it("renders when backend reports the persisted layout was invalid", () => {
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "invalid",
        totalTabs: 0,
        hasSettled: false,
      }),
    ).toBe(true);
  });

  it("hides on initial idle load with no tabs and no settle yet", () => {
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "idle",
        totalTabs: 0,
        hasSettled: false,
      }),
    ).toBe(false);
  });

  it("renders on idle when tabs are present", () => {
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "idle",
        totalTabs: 1,
        hasSettled: false,
      }),
    ).toBe(true);
  });

  it("keeps rendering after the last tab closes if the layout already settled", () => {
    // Regression test for the last-tab-close blank flash: once settled, the
    // container must not unmount when totalTabs drops back to 0.
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "idle",
        totalTabs: 0,
        hasSettled: true,
      }),
    ).toBe(true);
  });

  it("renders on empty restore status once the loading window has elapsed", () => {
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "empty",
        totalTabs: 0,
        hasSettled: true,
      }),
    ).toBe(true);
  });

  it("still gates when restoreStatus is pending regardless of settle latch", () => {
    // "pending" is an in-flight restore — the container must wait for the
    // backend to resolve, we never fall through to the settled branch here.
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "pending",
        totalTabs: 0,
        hasSettled: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderPanelContainer({
        restoreStatus: "pending",
        totalTabs: 3,
        hasSettled: false,
      }),
    ).toBe(false);
  });
});

describe("isLayoutSettledNow", () => {
  it("is settled synchronously when the backend has restored", () => {
    expect(isLayoutSettledNow("restored", 0)).toBe(true);
    expect(isLayoutSettledNow("invalid", 0)).toBe(true);
  });

  it("is settled synchronously when tabs are already present", () => {
    expect(isLayoutSettledNow("idle", 1)).toBe(true);
    expect(isLayoutSettledNow("empty", 2)).toBe(true);
  });

  it("is not settled while unresolved with no tabs", () => {
    expect(isLayoutSettledNow("idle", 0)).toBe(false);
    expect(isLayoutSettledNow("empty", 0)).toBe(false);
  });

  it("is not settled while a restore is pending", () => {
    expect(isLayoutSettledNow("pending", 0)).toBe(false);
  });
});

describe("EMPTY_LAYOUT_LOADING_TIMEOUT_MS", () => {
  it("exposes a positive fallback window", () => {
    expect(EMPTY_LAYOUT_LOADING_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
