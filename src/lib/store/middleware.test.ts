import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { REDUX_DEBUG_LS_KEY } from "./constants";

const mocks = vi.hoisted(() => {
  const createPassthroughMiddleware = () => {
    return vi.fn(() => (next: (action: unknown) => unknown) => (action: unknown) => next(action));
  };

  const sagaMiddleware = Object.assign(createPassthroughMiddleware(), { run: vi.fn() });
  const batchingMiddleware = createPassthroughMiddleware();
  const sentryMiddleware = createPassthroughMiddleware();
  const loggerMiddleware = createPassthroughMiddleware();
  const refCheckMiddleware = createPassthroughMiddleware();
  const structuredCloneMiddleware = createPassthroughMiddleware();
  const storeGuardMiddleware = createPassthroughMiddleware();

  return {
    createSagaMiddleware: vi.fn(() => sagaMiddleware),
    createBatchingMiddleware: vi.fn(() => batchingMiddleware),
    createSentryBreadcrumbsMiddleware: vi.fn(() => sentryMiddleware),
    createLoggerMiddleware: vi.fn(() => loggerMiddleware),
    createReferenceChangeDetectorMiddleware: vi.fn(() => refCheckMiddleware),
    createStructuredCloneCheckerMiddleware: vi.fn(() => structuredCloneMiddleware),
    createStoreGuardMiddleware: vi.fn(() => storeGuardMiddleware),
    sagaMiddleware,
    batchingMiddleware,
    sentryMiddleware,
    loggerMiddleware,
    structuredCloneMiddleware,
    storeGuardMiddleware,
  };
});

vi.mock("redux-saga", () => ({ default: mocks.createSagaMiddleware }));
vi.mock("./middlewares/batch", () => ({ createBatchingMiddleware: mocks.createBatchingMiddleware }));
vi.mock("./middlewares/logger", () => ({ createLoggerMiddleware: mocks.createLoggerMiddleware }));
vi.mock("./middlewares/sentry-breadcrumbs", () => ({
  createSentryBreadcrumbsMiddleware: mocks.createSentryBreadcrumbsMiddleware,
}));
vi.mock("./middlewares/state-reference-checks", () => ({
  createReferenceChangeDetectorMiddleware: mocks.createReferenceChangeDetectorMiddleware,
}));
vi.mock("./middlewares/structured-clone-checker", () => ({
  createStructuredCloneCheckerMiddleware: mocks.createStructuredCloneCheckerMiddleware,
}));
vi.mock("../../store/utils/store-guard-middleware", () => ({
  createStoreGuardMiddleware: mocks.createStoreGuardMiddleware,
}));

const localStorageGetItem = window.localStorage.getItem as unknown as Mock;
const localStorageSetItem = window.localStorage.setItem as unknown as Mock;
const localStorageRemoveItem = window.localStorage.removeItem as unknown as Mock;

const setLocalStorageEntries = (entries: Record<string, string | null | undefined>) => {
  localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
};

async function initStoreForReduxLoggingTests() {
  const { initAppStore } = await import("./store");
  const readableState = {
    subscribe: (run: (state: Record<string, never>) => void) => {
      run({});
      return () => {};
    },
  };
  return initAppStore(undefined, {
    init: vi.fn(() => vi.fn()),
    getReadableState: vi.fn(() => readableState),
    dispatch: vi.fn((action: unknown) => action),
    state: {},
  } as any);
}

describe("store middleware Redux logging gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DEV", false);
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intentFlags?: unknown }).intentFlags;
  });

  it("adds the logger middleware automatically in the Vitest dev environment", async () => {
    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("adds the logger middleware when intent:redux-debug is enabled in localStorage", async () => {
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: "true" });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("adds the logger middleware automatically in dev mode when no explicit override is set", async () => {
    vi.stubEnv("DEV", true);

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.structuredCloneMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("keeps an explicit localStorage disable higher priority than dev mode", async () => {
    vi.stubEnv("DEV", true);
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: "false" });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });

  it("passes the intent flag webview name through to the logger middleware when globally enabled", async () => {
    (window as Window & { intentFlags?: { enableReduxLogger: boolean; webviewName: string } }).intentFlags = {
      enableReduxLogger: true,
      webviewName: "composer",
    };

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("composer");
    expect(middleware.at(-1)).toBe(mocks.loggerMiddleware);
  });

  it("does not crash store middleware initialization when reading the Redux logging flag throws", async () => {
    vi.stubEnv("DEV", true);
    localStorageGetItem.mockImplementation((key: string) => {
      if (key === REDUX_DEBUG_LS_KEY) {
        throw new Error("Storage unavailable");
      }

      return null;
    });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });
});

describe("window.intent Redux logging interface", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intent?: unknown }).intent;
    mocks.sagaMiddleware.run.mockReturnValue({ cancel: vi.fn() });
  });

  it("registers enableReduxLogging and disableReduxLogging on window.intent", async () => {
    const storeContext = await initStoreForReduxLoggingTests();

    expect(window.intent?.enableReduxLogging).toBeTypeOf("function");
    expect(window.intent?.disableReduxLogging).toBeTypeOf("function");

    storeContext.dispose();
  });

  it("persists Redux logging toggles and logs that reload is required", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const storeContext = await initStoreForReduxLoggingTests();

      window.intent?.enableReduxLogging?.();
      expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, "true");
      expect(consoleLog).toHaveBeenCalledWith("Redux logging preference updated. Reload to take effect.");

      consoleLog.mockClear();

      window.intent?.disableReduxLogging?.();
      expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, "false");
      expect(consoleLog).toHaveBeenCalledWith("Redux logging preference updated. Reload to take effect.");

      storeContext.dispose();
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("toggles Redux logging using stored boolean string values", async () => {
    const entries: Record<string, string | null> = { [REDUX_DEBUG_LS_KEY]: "false" };
    localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
    localStorageSetItem.mockImplementation((key: string, value: string) => {
      entries[key] = value;
    });
    localStorageRemoveItem.mockImplementation((key: string) => {
      entries[key] = null;
    });

    const storeContext = await initStoreForReduxLoggingTests();

    window.intent?.debug?.toggleReduxLogs?.();
    expect(localStorageSetItem).toHaveBeenLastCalledWith(REDUX_DEBUG_LS_KEY, "true");
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe("true");

    window.intent?.debug?.toggleReduxLogs?.();
    expect(localStorageSetItem).toHaveBeenLastCalledWith(REDUX_DEBUG_LS_KEY, "false");
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe("false");

    storeContext.dispose();
  });
});

type LazyLoggerPayloadForTest = {
  prevState: unknown;
  nextState: unknown;
  changes: Record<string, { prev: unknown; next: unknown }>;
};

function expectEnumerableGetter(object: unknown, property: keyof LazyLoggerPayloadForTest) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);

  expect(descriptor?.get).toEqual(expect.any(Function));
  expect(descriptor?.value).toBeUndefined();
  expect(descriptor?.enumerable).toBe(true);
}

describe("createLoggerMiddleware", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("logs the welcome message only once", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    createLoggerMiddleware("composer");
    createLoggerMiddleware("composer");

    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it("logs changed state with raw action and an expanded lazy state payload group", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const prevState = {
      count: 1,
      todos: { byId: { "todo-1": { title: "Draft", tags: ["inbox", "soon"] } } },
    };
    const nextState = {
      count: 2,
      todos: {
        byId: {
          "todo-1": { title: "Done", tags: ["inbox", "shipped"] },
          "todo-2": { title: "New", tags: ["later"] },
        },
        order: ["todo-1", "todo-2"],
      },
    };
    let currentState = prevState;
    const action = { type: "TEST_ACTION" };
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => currentState),
    };
    const next = vi.fn((receivedAction: unknown) => {
      currentState = nextState;
      return receivedAction;
    });

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith("%cTEST_ACTION", "color: inherit; font-weight: 600");
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(group).toHaveBeenCalledTimes(1);
    expect(consoleDir).not.toHaveBeenCalled();

    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const lazyPayload = group.mock.calls[0]?.[2] as LazyLoggerPayloadForTest;

    expect(consoleLog.mock.calls[0]?.slice(0, 2)).toEqual(["%c action    ", "color: #03A9F4; font-weight: bold"]);
    expect(group.mock.calls[0]?.slice(0, 2)).toEqual(["%c state    ", "color: #4CAF50; font-weight: bold"]);
    expect(actionPayload).toBe(action);
    expect(lazyPayload).not.toBe(action);
    expect(lazyPayload).not.toBe(prevState);
    expect(lazyPayload).not.toBe(nextState);
    expect(Object.keys(lazyPayload)).toEqual(["prevState", "nextState", "changes"]);
    expectEnumerableGetter(lazyPayload, "prevState");
    expectEnumerableGetter(lazyPayload, "nextState");
    expectEnumerableGetter(lazyPayload, "changes");
    expect(lazyPayload.prevState).toBe(prevState);
    expect(lazyPayload.nextState).toBe(nextState);
    expect(lazyPayload.changes).toEqual({
      count: { prev: 1, next: 2 },
      "todos.byId.todo-1.title": { prev: "Draft", next: "Done" },
      "todos.byId.todo-1.tags[1]": { prev: "soon", next: "shipped" },
      "todos.byId.todo-2": { prev: undefined, next: { title: "New", tags: ["later"] } },
      "todos.order": { prev: undefined, next: ["todo-1", "todo-2"] },
    });

    expect(groupEnd).toHaveBeenCalledTimes(2);
  });

  it("logs unchanged state without prev state and uses the no changes label", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const state = { count: 1 };
    const action = { type: "TEST_ACTION", payload: "payload text" };
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, "dir").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => state),
    };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith("%cTEST_ACTION payload text", "color: #9E9E9E; font-weight: 300");
    expect(consoleLog.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["%c action    ", "color: #03A9F4; font-weight: bold"],
    ]);
    expect(group).toHaveBeenCalledWith(
      "%c state (no changes)",
      "color: #9E9E9E; font-weight: lighter",
      expect.any(Object)
    );
    expect(consoleDir).not.toHaveBeenCalled();

    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const statePayload = group.mock.calls[0]?.[2] as LazyLoggerPayloadForTest;

    expect(actionPayload).toBe(action);
    expect(statePayload).not.toBe(action);
    expect(statePayload).not.toBe(state);
    expect(Object.keys(statePayload)).toEqual(["prevState", "nextState", "changes"]);
    expectEnumerableGetter(statePayload, "prevState");
    expectEnumerableGetter(statePayload, "nextState");
    expectEnumerableGetter(statePayload, "changes");
    expect(statePayload.prevState).toBe(state);
    expect(statePayload.nextState).toBe(state);
    expect(statePayload.changes).toEqual({});
    expect(groupEnd).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ type: "TEST_ACTION" }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: "payload text" }, "TEST_ACTION payload text"],
    [{ type: "TEST_ACTION", payload: 42 }, "TEST_ACTION 42"],
    [{ type: "TEST_ACTION", payload: ["payload text"] }, "TEST_ACTION payload text"],
    [{ type: "TEST_ACTION", payload: [42, 7] }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: { text: "payload text" } }, "TEST_ACTION"],
    [{ type: "TEST_ACTION", payload: [{ text: "payload text" }] }, "TEST_ACTION"],
  ])("preserves simplified action titles for %j", async (action, expectedTitle) => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const state = { count: 1 };
    vi.spyOn(console, "group").mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, "groupCollapsed").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});

    const middleware = createLoggerMiddleware("composer");
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => state),
    };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    middleware(storeApi as never)(next)(action);

    expect(groupCollapsed).toHaveBeenCalledWith(`%c${expectedTitle}`, "color: #9E9E9E; font-weight: 300");
  });
});