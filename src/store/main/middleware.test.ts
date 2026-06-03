import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const createPassthroughMiddleware = () => {
    return vi.fn(() => (next: (action: unknown) => unknown) => (action: unknown) => next(action));
  };

  const storeGuardMiddleware = createPassthroughMiddleware();
  const loggerMiddleware = createPassthroughMiddleware();

  return {
    createStoreGuardMiddleware: vi.fn(() => storeGuardMiddleware),
    createMainLoggerMiddleware: vi.fn(() => loggerMiddleware),
    loggerMiddleware,
    storeGuardMiddleware,
  };
});

vi.mock("../utils/store-guard-middleware", () => ({
  createStoreGuardMiddleware: mocks.createStoreGuardMiddleware,
}));

vi.mock("./middlewares/logger", () => ({
  createMainLoggerMiddleware: mocks.createMainLoggerMiddleware,
}));

describe("main store middleware", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("adds the logger middleware in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { middleware } = await import("./middleware");

    expect(mocks.createStoreGuardMiddleware).toHaveBeenCalledWith("main");
    expect(mocks.createMainLoggerMiddleware).toHaveBeenCalledOnce();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.loggerMiddleware,
    ]);
  });

  it("omits the logger middleware outside development", async () => {
    vi.stubEnv("NODE_ENV", "test");

    const { middleware } = await import("./middleware");

    expect(mocks.createStoreGuardMiddleware).toHaveBeenCalledWith("main");
    expect(mocks.createMainLoggerMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([mocks.storeGuardMiddleware]);
  });
});