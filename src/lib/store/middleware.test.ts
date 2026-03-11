import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { REDUX_DEBUG_LS_KEY } from "./constants";

const mocks = vi.hoisted(() => {
  const sagaMiddleware = Object.assign(vi.fn(), { run: vi.fn() });
  const batchingMiddleware = vi.fn();
  const sentryMiddleware = vi.fn();
  const loggerMiddleware = vi.fn();
  const refCheckMiddleware = vi.fn();
  const structuredCloneMiddleware = vi.fn();
  const reduxLoggerMiddleware = vi.fn();

  return {
    createSagaMiddleware: vi.fn(() => sagaMiddleware),
    createBatchingMiddleware: vi.fn(() => batchingMiddleware),
    createSentryBreadcrumbsMiddleware: vi.fn(() => sentryMiddleware),
    createLoggerMiddleware: vi.fn(() => loggerMiddleware),
    createReferenceChangeDetectorMiddleware: vi.fn(() => refCheckMiddleware),
    createStructuredCloneCheckerMiddleware: vi.fn(() => structuredCloneMiddleware),
    createReduxLogger: vi.fn(() => reduxLoggerMiddleware),
    sagaMiddleware,
    batchingMiddleware,
    sentryMiddleware,
    loggerMiddleware,
    reduxLoggerMiddleware,
  };
});

vi.mock("redux-saga", () => ({ default: mocks.createSagaMiddleware }));
vi.mock("redux-logger", () => ({ createLogger: mocks.createReduxLogger }));
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

const localStorageGetItem = window.localStorage.getItem as unknown as Mock;

const setLocalStorageEntries = (entries: Record<string, string | null | undefined>) => {
  localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
};

describe("store middleware Redux logger gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intentFlags?: unknown }).intentFlags;
  });

  it("does not add redux-logger when the debug flag is off", async () => {
    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
    ]);
  });

  it("adds redux-logger when intent:redux-debug is enabled in localStorage", async () => {
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: "true" });

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("");
    expect(middleware).toEqual([
      mocks.batchingMiddleware,
      mocks.sagaMiddleware,
      mocks.sentryMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("passes the intent flag webview name through to redux-logger when globally enabled", async () => {
    (window as Window & { intentFlags?: { enableReduxLogger: boolean; webviewName: string } }).intentFlags = {
      enableReduxLogger: true,
      webviewName: "composer",
    };

    const { middleware } = await import("./middleware");

    expect(mocks.createLoggerMiddleware).toHaveBeenCalledWith("composer");
    expect(middleware.at(-1)).toBe(mocks.loggerMiddleware);
  });
});

describe("createLoggerMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to redux-logger with collapsed logging and the simplified title formatter", async () => {
    const { createLoggerMiddleware } = await vi.importActual<typeof import("./middlewares/logger")>(
      "./middlewares/logger"
    );

    const middleware = createLoggerMiddleware("composer");

    expect(middleware).toBe(mocks.reduxLoggerMiddleware);
    expect(mocks.createReduxLogger).toHaveBeenCalledTimes(1);

    const [options] = mocks.createReduxLogger.mock.calls[0];
    expect(options.collapsed).toBe(true);
    expect(options.titleFormatter({ type: "TEST_ACTION" }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: "payload text" }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION payload text"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: 42 }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION 42"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: ["payload text"] }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION payload text"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: [42, 7] }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: { text: "payload text" } }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION"
    );
    expect(options.titleFormatter({ type: "TEST_ACTION", payload: [{ text: "payload text" }] }, "12:00:00", 3.456)).toBe(
      "TEST_ACTION"
    );
  });
});