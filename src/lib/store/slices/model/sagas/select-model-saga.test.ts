import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$features/agent/services/unified-state-store", () => ({
  unifiedStateStore: {
    selectModel: vi.fn(),
  },
}));

import { unifiedStateStore } from "$features/agent/services/unified-state-store";
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

    expect(unifiedStateStore.selectModel).toHaveBeenCalledWith(normalizedModel);
  });
});