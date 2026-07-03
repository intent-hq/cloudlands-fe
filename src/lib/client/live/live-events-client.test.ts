import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Each test asserts the JSON-RPC method + params the
// client emits (PROTOCOL §5.10 event.query) and how the wire response maps
// back to the seam.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveEventsClient } from "./live-events-client";

const mockedRequest = vi.mocked(backendRequest);

/** Minimal PROTOCOL-shaped workspace events, wire order (newest→oldest). */
const wireEvents = [
  {
    id: "evt-2",
    workspaceId: "ws-1",
    timestamp: "2026-06-17T12:01:00Z",
    type: "file:changed",
    actor: { type: "agent", id: "agent-1" },
    data: { relativePath: "src/b.ts" },
  },
  {
    id: "evt-1",
    workspaceId: "ws-1",
    timestamp: "2026-06-17T12:00:00Z",
    type: "file:changed",
    actor: { type: "agent", id: "agent-1" },
    data: { relativePath: "src/a.ts" },
  },
];

describe("LiveEventsClient (PROTOCOL §5.10 event.query, fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("query sends event.query with workspaceId + filter options and keeps wire order", async () => {
    mockedRequest.mockResolvedValueOnce(wireEvents);
    const client = new LiveEventsClient();

    const events = await client.query("ws-1", {
      eventType: "file:changed",
      actorType: "agent",
      limit: 100,
    });

    expect(mockedRequest).toHaveBeenCalledWith("event.query", {
      workspaceId: "ws-1",
      eventType: "file:changed",
      actorType: "agent",
      limit: 100,
    });
    expect(events.map((e) => e.id)).toEqual(["evt-2", "evt-1"]);
  });

  it("list fetches the boot snapshot and reverses to chronological order", async () => {
    mockedRequest.mockResolvedValueOnce(wireEvents);
    const client = new LiveEventsClient();

    const events = await client.list("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("event.query", {
      workspaceId: "ws-1",
      limit: 100,
    });
    expect(events.map((e) => e.id)).toEqual(["evt-1", "evt-2"]);
  });

  it("query returns [] for a non-array result", async () => {
    mockedRequest.mockResolvedValueOnce({ items: [], nextToken: null });
    const client = new LiveEventsClient();

    expect(await client.query("ws-1")).toEqual([]);
  });

  it("subscribe emits the initial snapshot once and returns an idle disposer", async () => {
    mockedRequest.mockResolvedValueOnce(wireEvents);
    const client = new LiveEventsClient();
    const handler = vi.fn();

    const off = client.subscribe("ws-1", handler);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].map((e: { id: string }) => e.id)).toEqual([
      "evt-1",
      "evt-2",
    ]);
    expect(off).toBeTypeOf("function");
    off();
  });
});
