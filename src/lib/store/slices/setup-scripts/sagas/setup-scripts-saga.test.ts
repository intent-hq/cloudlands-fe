import { describe, it } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  hydrateSetupScriptBannerDismissals,
  SETUP_SCRIPT_BANNER_DISMISSED_KEY,
} from "../setup-scripts-slice";
import { selectSetupScriptBannerDismissalRecord } from "../setup-scripts-selectors";
import { initSetupScripts, persistSetupScriptBannerDismissals } from "./setup-scripts-saga";

describe("setupScripts persistence sagas", () => {
  it("hydrates setup-script banner dismissal through safe storage helpers", () => {
    testSaga(initSetupScripts)
      .next()
      .call(getLocalStorageItem, "setup-scripts")
      .next(null)
      .call(getLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY)
      .next({ _global: true, "ws-1": true, ignored: false })
      .put(hydrateSetupScriptBannerDismissals(true, ["ws-1"]))
      .next()
      .isDone();
  });

  it("ignores malformed setup-script banner dismissal hydration data", () => {
    testSaga(initSetupScripts)
      .next()
      .call(getLocalStorageItem, "setup-scripts")
      .next(null)
      .call(getLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY)
      .next(["not", "a", "record"])
      .isDone();
  });

  it("falls back when setup-script banner dismissal storage hydration throws", () => {
    testSaga(initSetupScripts)
      .next()
      .call(getLocalStorageItem, "setup-scripts")
      .next(null)
      .call(getLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY)
      .throw(new Error("storage failure"))
      .isDone();
  });

  it("persists setup-script banner dismissal state", () => {
    const dismissalRecord = { _global: true, "ws-1": true };

    testSaga(persistSetupScriptBannerDismissals)
      .next()
      .select(selectSetupScriptBannerDismissalRecord.select)
      .next(dismissalRecord)
      .call(setLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY, dismissalRecord)
      .next()
      .isDone();
  });

  it("swallows setup-script banner dismissal persistence storage failure", () => {
    const dismissalRecord = { "ws-1": true };

    testSaga(persistSetupScriptBannerDismissals)
      .next()
      .select(selectSetupScriptBannerDismissalRecord.select)
      .next(dismissalRecord)
      .call(setLocalStorageJSON, SETUP_SCRIPT_BANNER_DISMISSED_KEY, dismissalRecord)
      .throw(new Error("storage failure"))
      .isDone();
  });
});
