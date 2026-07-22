/**
 * Wire-contract tests for the live drafts domain (PROTOCOL §5.16).
 *
 * `drafts.set` accepts an optional `attachments` JSON array (opaque FE-authored
 * objects, e.g. image context items with base64 `imageData`) and `drafts.get`
 * returns it when present. Asserts (a) the exact JSON-RPC requests the client
 * emits — including that text-only saves omit the `attachments` field — and
 * (b) PROTOCOL-shaped responses pass through verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveDraftsClient } from "./live-drafts-client";
import type { DraftAttachment } from "../app-client";

const mockedRequest = vi.mocked(backendRequest);

/** §5.16 attachment: opaque FE-authored image context item, `File` dropped. */
const IMAGE_ATTACHMENT: DraftAttachment = {
  id: "file-upload-1721650000000-screenshot.png",
  type: "file",
  label: "screenshot.png",
  description: "image/png • 12.3 KB",
  path: "screenshot.png",
  imageData: "iVBORw0KGgoAAAANSUhEUg==",
  imageMimeType: "image/png",
};

describe("LiveDraftsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("get forwards drafts.get with workspaceId/agentId and returns the draft verbatim", async () => {
    const draft = {
      text: "draft in progress",
      attachments: [IMAGE_ATTACHMENT],
      updatedAt: "2026-07-22T12:00:00.000Z",
    };
    mockedRequest.mockResolvedValueOnce(draft);
    const client = new LiveDraftsClient();

    const result = await client.get("ws-1", "agent-1");

    expect(mockedRequest).toHaveBeenCalledWith("drafts.get", {
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    expect(result).toEqual(draft);
  });

  it("get folds a null result (no draft) to null", async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const client = new LiveDraftsClient();

    expect(await client.get("ws-1", "agent-1")).toBeNull();
  });

  it("set sends the exact drafts.set params including attachments", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, updatedAt: "2026-07-22T12:00:00.000Z" });
    const client = new LiveDraftsClient();

    const result = await client.set("ws-1", "agent-1", "draft text", [IMAGE_ATTACHMENT]);

    expect(mockedRequest).toHaveBeenCalledWith("drafts.set", {
      workspaceId: "ws-1",
      agentId: "agent-1",
      text: "draft text",
      attachments: [IMAGE_ATTACHMENT],
    });
    expect(result).toEqual({ ok: true, updatedAt: "2026-07-22T12:00:00.000Z" });
  });

  it("set omits the attachments field entirely for text-only saves", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, updatedAt: "2026-07-22T12:00:00.000Z" });
    const client = new LiveDraftsClient();

    await client.set("ws-1", "agent-1", "text only");

    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(mockedRequest).toHaveBeenCalledWith("drafts.set", {
      workspaceId: "ws-1",
      agentId: "agent-1",
      text: "text only",
    });
    expect("attachments" in params).toBe(false);
  });

  it("set treats an empty attachments array as no attachments (field omitted)", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, updatedAt: "2026-07-22T12:00:00.000Z" });
    const client = new LiveDraftsClient();

    await client.set("ws-1", "agent-1", "", []);

    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect("attachments" in params).toBe(false);
  });

  it("set persists attachments even when text is empty (§5.16: not a clear)", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, updatedAt: "2026-07-22T12:00:00.000Z" });
    const client = new LiveDraftsClient();

    await client.set("ws-1", "agent-1", "", [IMAGE_ATTACHMENT]);

    expect(mockedRequest).toHaveBeenCalledWith("drafts.set", {
      workspaceId: "ws-1",
      agentId: "agent-1",
      text: "",
      attachments: [IMAGE_ATTACHMENT],
    });
  });

  it("clear forwards drafts.clear with workspaceId/agentId", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveDraftsClient();

    const result = await client.clear("ws-1", "agent-1");

    expect(mockedRequest).toHaveBeenCalledWith("drafts.clear", {
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    expect(result).toEqual({ ok: true });
  });
});
