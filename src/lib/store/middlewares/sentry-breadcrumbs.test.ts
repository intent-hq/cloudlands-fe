import * as Sentry from "@sentry/electron/renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSentryBreadcrumbsMiddleware } from "./sentry-breadcrumbs";

vi.mock("@sentry/electron/renderer", () => ({
  addBreadcrumb: vi.fn(),
}));

describe("createSentryBreadcrumbsMiddleware", () => {
  const addBreadcrumbMock = vi.mocked(Sentry.addBreadcrumb);

  beforeEach(() => {
    addBreadcrumbMock.mockReset();
  });

  it("records sanitized breadcrumb metadata for redux actions", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);
    const action = {
      type: "workspace/select",
      payload: {
        workspaceId: "ws-123",
        token: "super-secret-token",
        nested: { email: "user@example.com" },
      },
      meta: { source: "ui", retryCount: 2 },
    };

    middleware(action);

    expect(next).toHaveBeenCalledWith(action);
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);

    const breadcrumb = addBreadcrumbMock.mock.calls[0][0];
    expect(breadcrumb).toMatchObject({
      category: "redux.action",
      message: "workspace/select",
      level: "info",
      data: {
        actionType: "workspace/select",
        actionKind: "object",
        actionKeys: ["type", "payload", "meta"],
        payload: {
          kind: "object",
          keyCount: 3,
          keys: ["workspaceId", "token", "nested"],
          valueKinds: ["string", "object"],
        },
        meta: {
          kind: "object",
          keyCount: 2,
          keys: ["source", "retryCount"],
          valueKinds: ["string", "number"],
        },
      },
    });
    expect(JSON.stringify(breadcrumb)).not.toContain("super-secret-token");
    expect(JSON.stringify(breadcrumb)).not.toContain("user@example.com");
  });

  it("does not block dispatch when Sentry breadcrumb capture throws", () => {
    addBreadcrumbMock.mockImplementation(() => {
      throw new Error("Sentry unavailable");
    });

    const action = { type: "workspace/select", payload: "value" };
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    expect(() => middleware(action)).not.toThrow();
    expect(next).toHaveBeenCalledWith(action);
  });

  it("records breadcrumbs for primitive dispatched actions without inspecting object fields", () => {
    const action = "workspace/select";
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    expect(() => middleware(action)).not.toThrow();
    expect(next).toHaveBeenCalledWith(action);
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(1);
    expect(addBreadcrumbMock.mock.calls[0][0]).toMatchObject({
      category: "redux.action",
      message: "unknown-action",
      level: "info",
      data: {
        actionType: "unknown-action",
        actionKind: "string",
      },
    });
  });
});