import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStructuredCloneCheckerMiddleware, CHECK_INTERVAL_MS } from "./structured-clone-checker";

/**
 * Helper: dispatches an action through the middleware, simulating a state
 * transition from `initialState` to `nextState`.
 */
function dispatchThrough(
  middleware: ReturnType<typeof createStructuredCloneCheckerMiddleware>,
  initialState: Record<string, unknown>,
  nextState: Record<string, unknown>,
  action: { type: string } = { type: "test/action" },
) {
  let current = initialState;
  const store = { getState: () => current, dispatch: vi.fn() };
  const next = vi.fn((a: unknown) => {
    current = nextState;
    return a;
  });
  return (middleware as any)(store)(next)(action);
}

/** Flush the batched timer so violations are reported. */
function flush() {
  vi.advanceTimersByTime(CHECK_INTERVAL_MS);
}

describe("createStructuredCloneCheckerMiddleware", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleGroup: ReturnType<typeof vi.spyOn>;
  let consoleGroupEnd: ReturnType<typeof vi.spyOn>;

  /** Collect all console output across error/warn/group calls. */
  function allMessages(): string[] {
    return [
      ...consoleError.mock.calls.map((c) => c[0] as string),
      ...consoleWarn.mock.calls.map((c) => c[0] as string),
      ...consoleGroup.mock.calls.map((c) => c[0] as string),
    ];
  }

  beforeEach(() => {
    vi.useFakeTimers();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleGroup = vi.spyOn(console, "group").mockImplementation(() => {});
    consoleGroupEnd = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not report primitives, plain objects, and arrays", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, {
      slice: { str: "hello", num: 42, bool: true, nil: null, arr: [1, 2, 3], nested: { a: 1 } },
    });
    flush();

    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("detects Date objects in state", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, { slice: { createdAt: new Date() } });
    flush();

    expect(consoleError).toHaveBeenCalledOnce();
    const msgs = allMessages();
    expect(msgs.some((m) => m.includes("Date"))).toBe(true);
    expect(msgs.some((m) => m.includes("slice.createdAt"))).toBe(true);
  });

  it("detects Map and Set in state", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { a: {}, b: {} }, { a: { m: new Map() }, b: { s: new Set() } });
    flush();

    expect(consoleError).toHaveBeenCalledOnce(); // single header
    const msgs = allMessages();
    expect(msgs.some((m) => m.includes("Map"))).toBe(true);
    expect(msgs.some((m) => m.includes("Set"))).toBe(true);
  });

  it("detects functions in state", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, { slice: { callback: () => {} } });
    flush();

    expect(consoleError).toHaveBeenCalledOnce();
    const msgs = allMessages();
    expect(msgs.some((m) => m.includes("function"))).toBe(true);
  });

  it("detects class instances in state", () => {
    class MyModel {
      value = 1;
    }
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, { slice: { model: new MyModel() } });
    flush();

    expect(consoleError).toHaveBeenCalledOnce();
    const msgs = allMessages();
    expect(msgs.some((m) => m.includes("MyModel"))).toBe(true);
  });

  it("only walks changed slices (unchanged slices are skipped)", () => {
    const middleware = createStructuredCloneCheckerMiddleware();
    const sharedBadSlice = { bad: new Date() };

    dispatchThrough(
      middleware,
      { unchanged: sharedBadSlice, changed: {} },
      { unchanged: sharedBadSlice, changed: { ok: "fine" } },
    );
    flush();

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not report the same path twice across flushes", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    // First batch — should report
    dispatchThrough(middleware, { slice: {} }, { slice: { bad: new Date() } });
    flush();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockClear();
    consoleWarn.mockClear();
    consoleGroup.mockClear();

    // Second batch with same path — should NOT report again
    dispatchThrough(middleware, { slice: {} }, { slice: { bad: new Date() } });
    flush();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("includes all action types from the batch", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    let state: Record<string, unknown> = { s: {} };
    const store = { getState: () => state, dispatch: vi.fn() };
    const chain = (middleware as any)(store);
    const next = vi.fn((a: unknown) => {
      state = { s: { d: new Date() } };
      return a;
    });

    chain(next)({ type: "first/action" });
    chain(next)({ type: "second/action" });
    flush();

    const msgs = allMessages();
    expect(msgs.some((m) => m.includes("first/action"))).toBe(true);
    expect(msgs.some((m) => m.includes("second/action"))).toBe(true);
  });

  it("does not flush until the timer fires", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, { slice: { bad: new Date() } });

    // Before timer fires — no error yet
    expect(consoleError).not.toHaveBeenCalled();

    flush();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("groups violations by slice", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(
      middleware,
      { agents: {}, workspace: {} },
      { agents: { cb: () => {}, d: new Date() }, workspace: { m: new Map() } },
    );
    flush();

    // Should have group calls for both slices
    const groupCalls = consoleGroup.mock.calls.map((c) => c[0] as string);
    expect(groupCalls.some((m) => m.includes('Slice: "agents"'))).toBe(true);
    expect(groupCalls.some((m) => m.includes('Slice: "workspace"'))).toBe(true);

    // Violations logged via console.warn
    const warnCalls = consoleWarn.mock.calls.map((c) => c[0] as string);
    expect(warnCalls.some((m) => m.includes("agents.cb") && m.includes("function"))).toBe(true);
    expect(warnCalls.some((m) => m.includes("agents.d") && m.includes("Date"))).toBe(true);
    expect(warnCalls.some((m) => m.includes("workspace.m") && m.includes("Map"))).toBe(true);
  });

  it("deduplicates actions with counts", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    let state: Record<string, unknown> = { s: {} };
    const store = { getState: () => state, dispatch: vi.fn() };
    const chain = (middleware as any)(store);
    const next = vi.fn((a: unknown) => {
      state = { s: { d: new Date() } };
      return a;
    });

    chain(next)({ type: "agents/setAgent" });
    chain(next)({ type: "agents/setAgent" });
    chain(next)({ type: "agents/setAgent" });
    chain(next)({ type: "workspace/update" });
    flush();

    const msgs = allMessages();
    // Should show count for repeated action
    expect(msgs.some((m) => m.includes("agents/setAgent") && m.includes("×3"))).toBe(true);
    // Single occurrence should NOT have a count
    expect(msgs.some((m) => m.includes("workspace/update") && !m.includes("×"))).toBe(true);
    // Header should mention total dispatches
    expect(msgs.some((m) => m.includes("4 dispatches"))).toBe(true);
  });

  it("includes a copy-pasteable summary line", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(
      middleware,
      { agents: {}, workspace: {} },
      { agents: { cb: () => {} }, workspace: { m: new Map() } },
    );
    flush();

    const warnCalls = consoleWarn.mock.calls.map((c) => c[0] as string);
    const summary = warnCalls.find((m) => m.includes("Summary:"));
    expect(summary).toBeDefined();
    expect(summary).toContain("2 non-serializable values");
    expect(summary).toContain("slices [agents, workspace]");
    expect(summary).toContain("actions [test/action]");
    expect(summary).toContain("agents.cb (function)");
    expect(summary).toContain("workspace.m (Map)");
  });

  it("uses console.group/groupEnd for collapsible sections", () => {
    const middleware = createStructuredCloneCheckerMiddleware();

    dispatchThrough(middleware, { slice: {} }, { slice: { bad: new Date() } });
    flush();

    // At least two groups: one for the slice, one for actions
    expect(consoleGroup.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(consoleGroupEnd.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

