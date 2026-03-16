import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
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

vi.mock("$lib/stores/active-provider.store.svelte", () => ({
  activeProviderStore: {
    activeProviderId: "codex",
  },
}));

import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import {
  GLOBAL_MODEL_KEY,
  PROVIDER_MODELS_KEY,
  selectModel,
  setProviderModel,
  setSelectedModel,
} from "../model-slice";
import { handleSelectModel } from "./select-model-saga";

describe("selectModelSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("persists provider-specific selections using the shared storage key", () => {
    const model = "claude-sonnet-4-5";
    const iterator = handleSelectModel(selectModel(model));

    expect(iterator.next()).toEqual({ value: sagaEffects.put(setSelectedModel(model)), done: false });
    expect(iterator.next()).toEqual({
      value: sagaEffects.call([localStorage, localStorage.setItem], GLOBAL_MODEL_KEY, model),
      done: false,
    });

    iterator.next();

    expect(unifiedStateStore.selectModel).toHaveBeenCalledWith("claude-sonnet-4-5");
    expect(iterator.next("codex")).toEqual({
      value: sagaEffects.put(setProviderModel({ providerId: "codex", model })),
      done: false,
    });

    iterator.next();

    expect(iterator.next(JSON.stringify({ auggie: "gpt5.4" }))).toEqual({
      value: sagaEffects.call(
        [localStorage, localStorage.setItem],
        PROVIDER_MODELS_KEY,
        JSON.stringify({ auggie: "gpt5.4", codex: model }),
      ),
      done: false,
    });
  });
});