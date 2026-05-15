import {
  describe,
  expect,
  it,
} from "vitest";
import {
  dismissSetupScriptBannerForWorkspace,
  dismissSetupScriptBannerGlobally,
  hydrateSetupScriptBannerDismissals,
  initialState,
  setupScriptsReducer,
} from "./setup-scripts-slice";

describe("setupScriptsReducer banner dismissal persistence", () => {
  it("hydrates global and workspace banner dismissal state", () => {
    const next = setupScriptsReducer(
      initialState,
      hydrateSetupScriptBannerDismissals(true, ["ws-1", "ws-1", ""])
    );

    expect(next.isBannerDismissedGlobally).toBe(true);
    expect(next.bannerDismissedByWorkspaceId).toEqual({ "ws-1": true });
  });

  it("records global banner dismissal", () => {
    const next = setupScriptsReducer(initialState, dismissSetupScriptBannerGlobally());

    expect(next.isBannerDismissedGlobally).toBe(true);
  });

  it("records workspace banner dismissal", () => {
    const next = setupScriptsReducer(initialState, dismissSetupScriptBannerForWorkspace("ws-1"));

    expect(next.bannerDismissedByWorkspaceId).toEqual({ "ws-1": true });
  });

  it("ignores empty workspace banner dismissals", () => {
    const next = setupScriptsReducer(initialState, dismissSetupScriptBannerForWorkspace(""));

    expect(next).toBe(initialState);
  });
});
