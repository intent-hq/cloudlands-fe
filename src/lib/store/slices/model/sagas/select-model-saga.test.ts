import {
  beforeEach,
  describe,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";

vi.mock("typed-redux-saga", async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"));

import {
  setLocalStorageJSON,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import {
  GLOBAL_MODEL_KEY,
  PROVIDER_MODELS_KEY,
  selectModel,
  setSelectedModel,
} from "../model-slice";
import { handleSelectModel } from "./select-model-saga";

describe("selectModelSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("persists provider-specific selections using the shared storage key", async () => {
    const model = "claude-sonnet-4-5";
    const normalizedModel = "codex:claude-sonnet-4-5";

    await expectSaga(handleSelectModel, selectModel(model))
      .withState({
        providerSettings: {
          activeProviderId: "codex",
          enabledProviders: {},
        },
      })
      .put(
        setSelectedModel({ providerId: "codex", model: normalizedModel })
      )
      .call(setLocalStorageItem, GLOBAL_MODEL_KEY, normalizedModel)
      .call(setLocalStorageJSON, PROVIDER_MODELS_KEY, { codex: normalizedModel })
      .silentRun(0);
  });
});