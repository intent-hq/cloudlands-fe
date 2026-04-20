import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetReduxActionBreadcrumbsBufferForTests,
  createSentryBreadcrumbsMiddleware,
  flushReduxActionBreadcrumbs,
} from "./sentry-breadcrumbs";

type FakeEvent = { breadcrumbs?: Array<unknown> };

type ReduxBreadcrumb = {
  category: string;
  level: string;
  message: string;
  data: { actions: string[] };
  timestamp: number;
};

function makeEvent(): FakeEvent {
  return {};
}

function getReduxBreadcrumb(event: FakeEvent, index = 0): ReduxBreadcrumb {
  const crumbs = event.breadcrumbs ?? [];
  return crumbs[index] as ReduxBreadcrumb;
}

describe("createSentryBreadcrumbsMiddleware", () => {
  beforeEach(() => {
    __resetReduxActionBreadcrumbsBufferForTests();
  });

  it("does not attach a breadcrumb per dispatch; only on flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    for (let i = 0; i < 50; i++) {
      middleware({ type: `t${i}` });
    }

    expect(next).toHaveBeenCalledTimes(50);

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);
    expect(event.breadcrumbs).toHaveLength(1);
  });

  // Secrets-leak guarantee: only formatted strings (type labels + truncated
  // UUIDs) reach Sentry. Raw payload values are cleared from the buffer on
  // flush and never serialized into the breadcrumb.
  it("does not leak secret payload values into the buffered breadcrumb", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({
      type: "workspace/select",
      payload: {
        workspaceId: "super-secret-workspace-id",
        token: "super-secret-token",
        nested: { email: "user@example.com" },
      },
      meta: { source: "ui", retryCount: 2 },
    });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    const serialized = JSON.stringify(getReduxBreadcrumb(event));
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("super-secret-workspace-id");
    expect(serialized).not.toContain("user@example.com");
  });

  it("does not block dispatch or escape errors when formatting throws on flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    expect(() => {
      for (let i = 0; i < 100; i++) {
        middleware({ type: `t${i}` });
      }
      // An action whose `type` getter throws will cause formatAction to throw.
      middleware({
        get type() {
          throw new Error("format boom");
        },
      });
    }).not.toThrow();
    expect(next).toHaveBeenCalledTimes(101);

    const event1 = makeEvent();
    expect(() => flushReduxActionBreadcrumbs(event1)).not.toThrow();
    // Formatting threw, so no breadcrumb was appended, but buffers are cleared.
    expect(event1.breadcrumbs).toBeUndefined();

    const event2 = makeEvent();
    flushReduxActionBreadcrumbs(event2);
    // Second flush is a no-op: buffers were cleared in the failing call.
    expect(event2.breadcrumbs).toBeUndefined();
  });

  it("records primitive dispatched actions with the unknown-action fallback", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware("workspace/select");
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(next).toHaveBeenCalledWith("workspace/select");
    expect(event.breadcrumbs).toHaveLength(1);
    const breadcrumb = getReduxBreadcrumb(event);
    expect(breadcrumb).toMatchObject({
      category: "redux.action",
      level: "info",
      message: "1 redux actions",
    });
    expect(breadcrumb.data.actions).toEqual(["unknown-action: []"]);
  });

  it("flushReduxActionBreadcrumbs flushes a partial buffer as a single breadcrumb", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a" });
    middleware({ type: "b" });
    middleware({ type: "c" });

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    expect(getReduxBreadcrumb(event)).toMatchObject({
      category: "redux.action",
      level: "info",
      message: "3 redux actions",
      data: { actions: ["a: []", "b: []", "c: []"] },
    });
  });

  it("flushReduxActionBreadcrumbs is a no-op when the buffer is empty and does not initialize event.breadcrumbs", () => {
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);
    expect(event.breadcrumbs).toBeUndefined();
  });

  it("appends to existing event.breadcrumbs rather than replacing it", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a" });

    const preexisting = { category: "navigation", message: "existing" };
    const event: FakeEvent = { breadcrumbs: [preexisting] };
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(2);
    expect(event.breadcrumbs?.[0]).toBe(preexisting);
    expect(getReduxBreadcrumb(event, 1)).toMatchObject({
      category: "redux.action",
      message: "1 redux actions",
      data: { actions: ["a: []"] },
    });
  });

  it("initializes event.breadcrumbs to an array when undefined and appends the breadcrumb", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a" });

    const event = makeEvent();
    expect(event.breadcrumbs).toBeUndefined();
    flushReduxActionBreadcrumbs(event);

    expect(Array.isArray(event.breadcrumbs)).toBe(true);
    expect(event.breadcrumbs).toHaveLength(1);
  });

  it("double flush delivers different breadcrumb entries to different events", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a" });
    const event1 = makeEvent();
    flushReduxActionBreadcrumbs(event1);

    middleware({ type: "b" });
    const event2 = makeEvent();
    flushReduxActionBreadcrumbs(event2);

    expect(event1.breadcrumbs).toHaveLength(1);
    expect(event2.breadcrumbs).toHaveLength(1);
    expect(getReduxBreadcrumb(event1).data.actions).toEqual(["a: []"]);
    expect(getReduxBreadcrumb(event2).data.actions).toEqual(["b: []"]);
  });

  it("truncates UUID-like payload values to their last 12 characters at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({
      type: "workspace/select",
      payload: {
        workspaceId: "11111111-2222-3333-4444-aaaaaaaaaaaa",
        agentId: "agent-12345678-1234-1234-1234-bbbbbbbbbbbb",
      },
    });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("workspace/select: [workspaceId=aaaaaaaaaaaa, agentId=bbbbbbbbbbbb]");
  });

  it("represents non-UUID strings and other values by their type label at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({
      type: "workspace/select",
      payload: {
        name: "hello",
        count: 42,
        flag: true,
        data: { nested: 1 },
        items: [1, 2],
      },
    });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe(
      "workspace/select: [name=string, count=number, flag=boolean, data=object, items=array]",
    );
  });

  it("truncates payload keys beyond MAX_SUMMARY_KEYS with an ellipsis entry at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({
      type: "t",
      payload: { a: 1, b: "x", c: true, d: null, e: {}, f: 6, g: 7 },
    });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("t: [a=number, b=string, c=boolean, d=null, e=object, ...]");
  });

  it("formats primitive payloads, UUID-like payloads, missing payloads and empty objects at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a", payload: 42 });
    middleware({ type: "b", payload: "11111111-2222-3333-4444-cccccccccccc" });
    middleware({ type: "c" });
    middleware({ type: "d", payload: {} });
    middleware({ type: "e", payload: "plain-string" });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toEqual([
      "a: [number]",
      "b: [cccccccccccc]",
      "c: []",
      "d: []",
      "e: [string]",
    ]);
  });
});

describe("double-buffer behavior", () => {
  beforeEach(() => {
    __resetReduxActionBreadcrumbsBufferForTests();
  });

  it("caps the buffer at 500 entries and evicts the oldest (FIFO)", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    for (let i = 0; i < 550; i++) {
      middleware({ type: `t${i}` });
    }

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toHaveLength(500);
    expect(actions[0]).toBe("t50: []");
    expect(actions[499]).toBe("t549: []");
  });

  it("does not drop any actions while the total held across both buffers is <= 500", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    for (let i = 0; i < 500; i++) {
      middleware({ type: `t${i}` });
    }

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toHaveLength(500);
    expect(actions[0]).toBe("t0: []");
    expect(actions[499]).toBe("t499: []");
  });

  it("after a swap plus additional pushes, only the last 500 actions are attached on flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    // 501 pushes forces exactly one swap and leaves one extra item in primary.
    for (let i = 0; i < 501; i++) {
      middleware({ type: `t${i}` });
    }

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toHaveLength(500);
    expect(actions[0]).toBe("t1: []");
    expect(actions[499]).toBe("t500: []");
  });

  it("flush clears both buffers so a subsequent flush only reports new actions", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    // Push enough to trigger a swap so both primary and backup are populated before flush.
    for (let i = 0; i < 501; i++) {
      middleware({ type: `t${i}` });
    }

    const event1 = makeEvent();
    flushReduxActionBreadcrumbs(event1);
    expect(event1.breadcrumbs).toHaveLength(1);

    middleware({ type: "after-flush" });
    const event2 = makeEvent();
    flushReduxActionBreadcrumbs(event2);

    expect(event2.breadcrumbs).toHaveLength(1);
    expect(getReduxBreadcrumb(event2)).toMatchObject({
      message: "1 redux actions",
      data: { actions: ["after-flush: []"] },
    });
  });

  it("stores the raw action reference (no cloning) so later mutations are observed at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    const action = {
      type: "workspace/select",
      payload: { workspaceId: "11111111-2222-3333-4444-aaaaaaaaaaaa" },
    };
    middleware(action);

    // Mutate after dispatch — since the buffer holds the raw reference, the
    // mutated value is what gets formatted at flush.
    action.payload.workspaceId = "00000000-0000-0000-0000-000000000000";

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("workspace/select: [workspaceId=000000000000]");
  });

  it("flushes exactly once after many dispatches and reports capped length", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    for (let i = 0; i < 1_000; i++) {
      middleware({ type: `t${i}` });
    }

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    expect(event.breadcrumbs).toHaveLength(1);
    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toHaveLength(500);
  });
});

describe("performance", () => {
  beforeEach(() => {
    __resetReduxActionBreadcrumbsBufferForTests();
  });

  it("keeps per-dispatch overhead small over 10_000 dispatches and caps the buffer", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    // Warmup to avoid including JIT cost in the timed loop.
    for (let i = 0; i < 1_000; i++) {
      middleware({ type: "warmup", payload: { a: 1, b: "hi" } });
    }
    __resetReduxActionBreadcrumbsBufferForTests();

    const iterations = 10_000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      middleware({ type: "x", payload: { a: 1, b: "hi" } });
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(2000);

    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);
    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toHaveLength(500);
  });
});

describe("edge cases", () => {
  beforeEach(() => {
    __resetReduxActionBreadcrumbsBufferForTests();
  });

  it("renders an Error payload as [error] at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "x", payload: new Error("boom") });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [error]");
  });

  it("renders a Date payload as [date] at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "x", payload: new Date() });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [date]");
  });

  it("renders a null payload as [null] at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "x", payload: null });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [null]");
  });

  it("renders an array payload as [array] at the top level at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "x", payload: [1, 2, 3] });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [array]");
  });

  it("falls back to unknown-action when `type` is not a string", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: 42 });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("unknown-action: []");
  });

  it("labels a function (thunk-like) action as [function action] at flush", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware(() => {});
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions).toEqual(["[function action]: []"]);
  });

  it("renders near-miss UUID strings as the string kind label, not truncated", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "x", payload: { id: "not-a-uuid-12345" } });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [id=string]");
  });

  it("truncates a strict 36-char UUID payload value to its last 12 characters", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({
      type: "x",
      payload: { id: "11111111-2222-3333-4444-dddddddddddd" },
    });
    const event = makeEvent();
    flushReduxActionBreadcrumbs(event);

    const actions = getReduxBreadcrumb(event).data.actions;
    expect(actions[0]).toBe("x: [id=dddddddddddd]");
  });

  it("preserves ordering across two consecutive flush cycles", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    middleware({ type: "a" });
    middleware({ type: "b" });
    middleware({ type: "c" });
    const event1 = makeEvent();
    flushReduxActionBreadcrumbs(event1);

    middleware({ type: "d" });
    middleware({ type: "e" });
    const event2 = makeEvent();
    flushReduxActionBreadcrumbs(event2);

    expect(event1.breadcrumbs).toHaveLength(1);
    expect(event2.breadcrumbs).toHaveLength(1);
    expect(getReduxBreadcrumb(event1)).toMatchObject({
      message: "3 redux actions",
      data: { actions: ["a: []", "b: []", "c: []"] },
    });
    expect(getReduxBreadcrumb(event2)).toMatchObject({
      message: "2 redux actions",
      data: { actions: ["d: []", "e: []"] },
    });
  });

  it("recovers cleanly after a failing format on flush and only reports new actions", () => {
    const next = vi.fn((value) => value);
    const middleware = createSentryBreadcrumbsMiddleware()({} as never)(next);

    // An action whose `type` getter throws once; formatAction will throw on flush.
    let thrown = false;
    middleware({
      get type() {
        if (!thrown) {
          thrown = true;
          throw new Error("format boom");
        }
        return "recovered";
      },
    });
    middleware({ type: "b" });
    middleware({ type: "c" });
    const event1 = makeEvent();
    flushReduxActionBreadcrumbs(event1);

    // Formatting threw — no breadcrumb attached, but both buffers were cleared.
    expect(event1.breadcrumbs).toBeUndefined();

    middleware({ type: "d" });
    middleware({ type: "e" });
    const event2 = makeEvent();
    flushReduxActionBreadcrumbs(event2);

    expect(event2.breadcrumbs).toHaveLength(1);
    expect(getReduxBreadcrumb(event2)).toMatchObject({
      message: "2 redux actions",
      data: { actions: ["d: []", "e: []"] },
    });
  });
});
