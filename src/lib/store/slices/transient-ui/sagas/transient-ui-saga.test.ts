import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any, ...args: any[]) {
    return yield sagaEffects.takeEvery(pattern, worker, ...args);
  },
}));

import { getLocalStorageJSON, removeLocalStorageItem } from "$lib/store/utils/safe-local-storage-saga";
import { debounceWithKeySaga } from "../../../utils/debounce-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../../workspace/workspace-slice";
import {
  clearWorkspaceTransientUi,
  persistWorkspaceTransientUi,
  SAVE_DEBOUNCE_MS,
  requestPersistWorkspaceTransientUi,
  setCommitMessage,
  setViewedFiles,
} from "../transient-ui-slice";
import {
  handlePersistWorkspace,
  handleRemovedWorkspace,
  handleWorkspaceMounted,
  queueTransientUiPersistence,
  transientUiSaga,
} from "./transient-ui-saga";
import {
  getTransientUiStorageKey,
  sanitizePersistedTransientUiState,
} from "../utils/persistence";

describe("transientUi persistence utils", () => {
  it("migrates deprecated sidebar tabs and clears stale in-progress state", () => {
    const now = 4_000_000;
    const persisted = {
      sidebarActiveTab: "activity",
      timestamp: now - (60 * 60 * 1000 + 1),
      acceptChanges: {
        isAutofillAndCommitting: true,
        pendingCommitAction: "commit",
      },
      sidebarChanges: {
        createPRWhenReady: true,
      },
    };

    const result = sanitizePersistedTransientUiState(persisted, now);

    expect(result.state?.sidebarActiveTab).toBe("agents");
    expect(result.state?.acceptChanges.isAutofillAndCommitting).toBe(false);
    expect(result.state?.acceptChanges.pendingCommitAction).toBeNull();
    expect(result.state?.sidebarChanges.createPRWhenReady).toBe(false);
    expect(result.persistSanitized).toBe(true);
  });
});

describe("transientUiSaga workers", () => {
  it("registers direct watchers and keeps only the debounce fork", () => {
    const iterator = transientUiSaga();

    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(workspaceMounted, handleWorkspaceMounted),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.takeEvery(setViewedFiles, queueTransientUiPersistence),
      done: false,
    });

    // Skip remaining debounced persist takeEvery calls (21 more),
    // persistWorkspaceTransientUi, removeWorkspaceEntity
    for (let i = 0; i < 23; i += 1) {
      iterator.next();
    }

    const debounceEffect = iterator.next().value as any;
    expect(debounceEffect.type).toBe("FORK");
    expect(debounceEffect.payload.fn).toBe(debounceWithKeySaga);
    expect(debounceEffect.payload.args[0]).toBe(requestPersistWorkspaceTransientUi);
    expect(debounceEffect.payload.args[1]).toBe(SAVE_DEBOUNCE_MS);
    expect(typeof debounceEffect.payload.args[2]).toBe("function");
  });

  it("queues debounced persistence for workspace-scoped mutations", () => {
    const iterator = queueTransientUiPersistence(setCommitMessage("ws-1", "feat: add slice"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(requestPersistWorkspaceTransientUi(persistWorkspaceTransientUi("ws-1"))),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("hydrates persisted workspace state on workspace mount", () => {
    const persisted = {
      sidebarActiveTab: "activity",
      timestamp: 123,
      acceptChanges: {
        isAutofillAndCreatingPR: true,
      },
    };
    const expectedState = sanitizePersistedTransientUiState(persisted).state;
    const iterator = handleWorkspaceMounted(workspaceMounted("ws-1"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.call(getLocalStorageJSON, getTransientUiStorageKey("ws-1")),
      done: false,
    });
    expect(iterator.next(persisted)).toEqual({
      value: sagaEffects.put({
        type: "transientUi/hydrateWorkspaceTransientUi",
        payload: ["ws-1", expectedState],
      }),
      done: false,
    });

    const persistEffect = iterator.next().value as any;
    expect(persistEffect.payload.fn.name).toBe("persistWorkspaceState");
    expect(persistEffect.payload.args).toEqual(["ws-1", expectedState]);
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("removes storage when a queued persist fires after workspace deletion", () => {
    const iterator = handlePersistWorkspace(persistWorkspaceTransientUi("ws-1"));

    const selectEffect = iterator.next().value as any;
    expect(selectEffect.type).toBe("SELECT");
    expect(typeof selectEffect.payload.selector).toBe("function");
    expect(selectEffect.payload.args).toEqual(["ws-1"]);
    expect(iterator.next(null)).toEqual({
      value: sagaEffects.call(removeLocalStorageItem, getTransientUiStorageKey("ws-1")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it("clears redux state and localStorage when a workspace is removed", () => {
    const iterator = handleRemovedWorkspace(removeWorkspaceEntity("ws-1"));

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(clearWorkspaceTransientUi("ws-1")),
      done: false,
    });
    expect(iterator.next()).toEqual({
      value: sagaEffects.call(removeLocalStorageItem, getTransientUiStorageKey("ws-1")),
      done: false,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});