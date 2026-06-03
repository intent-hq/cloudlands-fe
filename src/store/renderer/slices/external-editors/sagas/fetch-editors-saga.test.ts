import { invoke } from "$lib/electron-bridge";
import { createCollection } from "ag-redux-toolkit/utils/collections/collection-utils";
import { getLocalStorageJSON } from "$store/renderer/utils/safe-local-storage-saga";
import {
  expectSaga,
  testSaga,
} from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import {
  beforeEach,
  describe,
  it,
  vi,
} from "vitest";
import {
  STORAGE_KEY,
  clearError,
  fetchEditors,
  fetchEditorsFailure,
  fetchEditorsSuccess,
  initialState,
  setLoading,
  type InstalledEditor,
} from "../external-editors-slice";
import {
  handleFetchEditors,
  loadCachedEditors,
} from "./fetch-editors-saga";

vi.mock("typed-redux-saga", async () => await import("$store/renderer/utils/test-helpers/typed-redux-saga-mock"));

vi.mock("$lib/electron-bridge", async () => await import("$store/renderer/utils/test-helpers/electron-bridge-mock"));

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

const malformedEditor = {
  id: "malformed",
  name: 42,
  shortLabel: { text: "Bad label" },
  appName: null,
  category: "unknown",
  handlerType: ["generic"],
  bundleId: 123,
  shortcut: 99,
  priority: "high",
  installed: "true",
  iconBase64: { data: "not base64" },
};

const normalizedMalformedEditor: InstalledEditor = {
  id: "malformed",
  name: "42",
  shortLabel: "malformed",
  appName: "malformed",
  category: "ide",
  handlerType: "generic",
  bundleId: "123",
  shortcut: "99",
  priority: 0,
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

  it("normalizes malformed cached editor records before dispatching", async () => {
    testSaga(loadCachedEditors)
      .next()
      .call(getLocalStorageJSON, STORAGE_KEY)
      .next({
        editors: [malformedEditor, { id: { bad: true }, name: "Dropped" }],
        timestamp: 789,
      })
      .put(fetchEditorsSuccess([normalizedMalformedEditor], 789))
      .next()
      .isDone();
  });

  it("normalizes malformed IPC detection editor records before storing and caching", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(999);

    try {
      await expectSaga(handleFetchEditors, fetchEditors(true))
        .withState({ externalEditors: initialState })
        .provide([[matchers.call.fn(invoke), { success: true, data: [malformedEditor] }]])
        .put(clearError())
        .put(setLoading(true))
        .put(fetchEditorsSuccess([normalizedMalformedEditor], 999))
        .put(setLoading(false))
        .silentRun(100);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("coerces non-string IPC detection errors before dispatching failure", async () => {
    await expectSaga(handleFetchEditors, fetchEditors(true))
      .withState({ externalEditors: initialState })
      .provide([[matchers.call.fn(invoke), { success: false, error: { message: 404 } }]])
      .put(clearError())
      .put(setLoading(true))
      .put(fetchEditorsFailure("404"))
      .put(setLoading(false))
      .silentRun(100);
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