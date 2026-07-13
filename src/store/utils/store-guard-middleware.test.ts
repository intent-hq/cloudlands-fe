import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createStoreGuardMiddleware } from "./store-guard-middleware";

describe("createStoreGuardMiddleware", () => {
  it("throws when an action tagged for the renderer store is dispatched to the main store", () => {
    const next = vi.fn((action) => action);
    const middleware = createStoreGuardMiddleware("main");
    const action = { type: "test/action", __store: "renderer" as const };

    expect(() => middleware({} as never)(next)(action)).toThrowError(
      'Action "test/action" is tagged for "renderer" store but was dispatched to "main" store'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through untagged actions", () => {
    const next = vi.fn((action) => ({ ...action, forwarded: true }));
    const middleware = createStoreGuardMiddleware("main");
    const action = { type: "test/action" };

    const result = middleware({} as never)(next)(action);

    expect(next).toHaveBeenCalledWith(action);
    expect(result).toEqual({ ...action, forwarded: true });
  });
});