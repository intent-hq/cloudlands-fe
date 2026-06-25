import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";
import {
  handlePersistEvent,
  persistEvent,
} from "./persistence-saga";
import {
  handleBroadcastEvent,
  broadcastEvent,
} from "./broadcast-saga";
import {
  isDuplicateEvent,
  clearAllCaches,
} from "../dedup-cache";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeEvent = (
  id: string,
  type = "file:changed",
  workspaceId = "ws-1",
): WorkspaceEvent =>
  ({
    id,
    type,
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "user", id: "user-1", name: "Test User" },
    data: { path: "/test.ts", relativePath: "test.ts", action: "modify" },
  }) as unknown as WorkspaceEvent;

// ---------------------------------------------------------------------------
// Persistence saga
// ---------------------------------------------------------------------------

describe("handlePersistEvent", () => {
  it("calls persistEvent with the event", () => {
    const event = makeEvent("e1");
    const action = workspaceEventAccepted(event);

    return expectSaga(handlePersistEvent, action)
      .provide([[matchers.call.fn(persistEvent), undefined]])
      .call.fn(persistEvent)
      .run();
  });
});

// ---------------------------------------------------------------------------
// Broadcast saga
// ---------------------------------------------------------------------------

describe("handleBroadcastEvent", () => {
  it("calls broadcastEvent with the event", () => {
    const event = makeEvent("e1");
    const action = workspaceEventAccepted(event);

    return expectSaga(handleBroadcastEvent, action)
      .provide([[matchers.call.fn(broadcastEvent), undefined]])
      .call.fn(broadcastEvent)
      .run();
  });
});

// ---------------------------------------------------------------------------
// Filtered subscription delivery saga
// ---------------------------------------------------------------------------

describe("handleDeliverToRendererSubscriptions", () => {
  it("delivers accepted events to renderer subscription adapters", async () => {
    vi.resetModules();
    const deliverEventToSubscriptions = vi.fn();

    vi.doMock("../../../../../features/events/main/renderer-subscription-registry", () => ({
      deliverEventToSubscriptions,
    }));

    const { handleDeliverToRendererSubscriptions } = await import(
      "./renderer-subscription-saga"
    );
    const event = makeEvent("e-subscriptions");

    await expectSaga(handleDeliverToRendererSubscriptions, workspaceEventAccepted(event))
      .run();

    expect(deliverEventToSubscriptions).toHaveBeenCalledWith(event);

    vi.doUnmock("../../../../../features/events/main/renderer-subscription-registry");
  });
});

// ---------------------------------------------------------------------------
// broadcastToStdio
// ---------------------------------------------------------------------------

describe("broadcastToStdio", () => {
  it("writes JSON event to STDIO when connection is available", async () => {
    const writeMock = vi.fn();
    const mockStdio = { destroyed: false, write: writeMock };

    vi.doMock("../../../../../features/events/main/stdio-connection", () => ({
      getStdioConnection: () => mockStdio,
    }));

    // Re-import to pick up the mock
    const { broadcastToStdio: fn } = await import("./broadcast-saga");

    const event = makeEvent("e1", "file:changed", "ws-1");
    await fn(event);

    expect(writeMock).toHaveBeenCalledOnce();
    const written = JSON.parse(writeMock.mock.calls[0][0].trim());
    expect(written).toEqual({
      type: "event",
      event: "file:changed",
      data: event,
    });

    vi.doUnmock("../../../../../features/events/main/stdio-connection");
  });

  it("does nothing when STDIO connection is null", async () => {
    vi.doMock("../../../../../features/events/main/stdio-connection", () => ({
      getStdioConnection: () => null,
    }));

    const { broadcastToStdio: fn } = await import("./broadcast-saga");
    const event = makeEvent("e2");

    // Should not throw
    await fn(event);

    vi.doUnmock("../../../../../features/events/main/stdio-connection");
  });

  it("does nothing when STDIO connection is destroyed", async () => {
    const writeMock = vi.fn();
    const mockStdio = { destroyed: true, write: writeMock };

    vi.doMock("../../../../../features/events/main/stdio-connection", () => ({
      getStdioConnection: () => mockStdio,
    }));

    const { broadcastToStdio: fn } = await import("./broadcast-saga");
    const event = makeEvent("e3");
    await fn(event);

    expect(writeMock).not.toHaveBeenCalled();

    vi.doUnmock("../../../../../features/events/main/stdio-connection");
  });
});


// ---------------------------------------------------------------------------
// Dedup cache (module-level, not Redux state)
// ---------------------------------------------------------------------------

describe("dedup cache", () => {
  beforeEach(() => {
    clearAllCaches();
  });

  it("isDuplicateEvent returns false for first occurrence", () => {
    const event = makeEvent("e1");
    const ts = Date.parse(event.timestamp);
    expect(isDuplicateEvent(event, ts)).toBe(false);
  });

  it("isDuplicateEvent returns true for duplicate within window", () => {
    const event = makeEvent("e1");
    const ts = Date.parse(event.timestamp);
    isDuplicateEvent(event, ts); // first call records it

    // Same content key, slightly later timestamp
    const dup = makeEvent("e2"); // same type, workspaceId, data.path, actor.id
    const dupTs = ts + 500; // 500ms later, within 2s window
    expect(isDuplicateEvent(dup, dupTs)).toBe(true);
  });

  it("isDuplicateEvent returns false for events outside window", () => {
    const event = makeEvent("e1");
    const ts = Date.parse(event.timestamp);
    isDuplicateEvent(event, ts);

    const later = makeEvent("e2");
    const laterTs = ts + 3000; // 3s later, outside 2s window
    expect(isDuplicateEvent(later, laterTs)).toBe(false);
  });

  it("never deduplicates agent:stream:chunk events", () => {
    const e1 = makeEvent("s1", "agent:stream:chunk");
    const e2 = makeEvent("s2", "agent:stream:chunk");
    const ts = Date.now();
    expect(isDuplicateEvent(e1, ts)).toBe(false);
    expect(isDuplicateEvent(e2, ts + 50)).toBe(false);
  });

  it("never deduplicates agent:stream:content-blocks events", () => {
    const e1 = makeEvent("s1", "agent:stream:content-blocks");
    const e2 = makeEvent("s2", "agent:stream:content-blocks");
    const ts = Date.now();
    expect(isDuplicateEvent(e1, ts)).toBe(false);
    expect(isDuplicateEvent(e2, ts + 50)).toBe(false);
  });

  it("never deduplicates agent:stream:end events", () => {
    const e1 = makeEvent("s1", "agent:stream:end");
    const e2 = makeEvent("s2", "agent:stream:end");
    const ts = Date.now();
    expect(isDuplicateEvent(e1, ts)).toBe(false);
    expect(isDuplicateEvent(e2, ts + 50)).toBe(false);
  });

  it("never deduplicates agent:user-message:sent events", () => {
    const e1 = makeEvent("m1", "agent:user-message:sent");
    const e2 = makeEvent("m2", "agent:user-message:sent");
    const ts = Date.now();
    expect(isDuplicateEvent(e1, ts)).toBe(false);
    expect(isDuplicateEvent(e2, ts + 50)).toBe(false);
  });

  it("still deduplicates regular events like file:changed", () => {
    const e1 = makeEvent("f1", "file:changed");
    const e2 = makeEvent("f2", "file:changed");
    const ts = Date.now();
    isDuplicateEvent(e1, ts);
    // Same dedup key (same type, workspaceId, data.path, actor.id)
    expect(isDuplicateEvent(e2, ts + 500)).toBe(true);
  });

  it("clearAllCaches resets dedup state", () => {
    const event = makeEvent("e1");
    const ts = Date.parse(event.timestamp);
    isDuplicateEvent(event, ts);

    clearAllCaches();

    // Should not be duplicate after cache clear
    expect(isDuplicateEvent(event, ts)).toBe(false);
  });
});

