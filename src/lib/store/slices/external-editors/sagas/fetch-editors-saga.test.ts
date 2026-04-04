import { invoke } from "$lib/electron-bridge";
import { createCollection } from "$lib/store/utils/collection-utils";
import { getLocalStorageJSON } from "$lib/store/utils/safe-local-storage-saga";
import { expectSaga, testSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { beforeEach, describe, it, vi } from "vitest";
import {
  STORAGE_KEY,
  clearError,
  fetchEditors,
  fetchEditorsSuccess,
  initialState,
  setLoading,
  type InstalledEditor,
} from "../external-editors-slice";
import { handleFetchEditors, loadCachedEditors } from "./fetch-editors-saga";

vi.mock("typed-redux-saga", async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"));

vi.mock("$lib/electron-bridge", async () => await import("$lib/store/utils/test-helpers/electron-bridge-mock"));

const mockEditor: InstalledEditor = {
  id: "vscode",
  name: "Visual Studio Code",
  shortLabel: "VS Code",
  appName: "Visual Studio Code",
  category: "ide",
  handlerType: "vscode",
  priority: 100,
  installed: true,
};

describe("fetchEditorsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("loads cached editors from legacy array cache", async () => {
    testSaga(loadCachedEditors)
      .next()
      .call(getLocalStorageJSON, STORAGE_KEY)
      .next({ editors: [mockEditor], timestamp: 123 })
      .put(fetchEditorsSuccess([mockEditor], 123))
      .next()
      .isDone();
  });

  it("loads cached editors from collection-shaped cache", async () => {
    testSaga(loadCachedEditors)
      .next()
      .call(getLocalStorageJSON, STORAGE_KEY)
      .next(
        {
          editors: createCollection<InstalledEditor, "id">("id", [mockEditor]),
          timestamp: 456,
        }
      )
      .put(fetchEditorsSuccess([mockEditor], 456))
      .next()
      .isDone();
  });

  it("clears loading when detection returns neither data nor an error", async () => {
    await expectSaga(handleFetchEditors, fetchEditors(true))
      .withState({ externalEditors: initialState })
      .provide([[matchers.call.fn(invoke), { success: false }]])
      .put(clearError())
      .put(setLoading(true))
      .put(setLoading(false))
      .silentRun(100);
  });
});