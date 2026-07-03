/**
 * Wire-contract tests for the live setup-scripts domain (PROTOCOL §5.25).
 *
 * Regression: setup-script generation spawned a local AugmentCLI with a
 * hardcoded prompt over unbridged Electron IPC. Asserts the exact JSON-RPC
 * requests for `workspace.getSetupScript/saveSetupScript/detectProjectType/
 * generateSetupScript` and that the `{ setupScript }` / `{ projectType }`
 * envelopes unwrap verbatim.
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
import { LiveSetupScriptsClient } from "./live-setup-scripts-client";
import type { WorkspaceSetupScript } from "../app-client";

const mockedRequest = vi.mocked(backendRequest);

/** §5.25 SetupScript record as the daemon returns it. */
const RUST_DRAFT: WorkspaceSetupScript = {
  script: "#!/usr/bin/env bash\nset -euo pipefail\ncargo fetch\n",
  projectType: "rust",
  updatedAt: 1750000000000,
  generatedBy: "agent",
};

describe("LiveSetupScriptsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("get forwards workspace.getSetupScript and unwraps the setupScript envelope", async () => {
    mockedRequest.mockResolvedValueOnce({ setupScript: RUST_DRAFT });
    const client = new LiveSetupScriptsClient();

    const record = await client.get("ws-abc");

    expect(mockedRequest).toHaveBeenCalledWith("workspace.getSetupScript", {
      workspaceId: "ws-abc",
    });
    expect(record).toEqual(RUST_DRAFT);
  });

  it("save forwards workspace.saveSetupScript with the body and returns the stored record", async () => {
    const stored: WorkspaceSetupScript = { ...RUST_DRAFT, generatedBy: "user" };
    mockedRequest.mockResolvedValueOnce({ setupScript: stored });
    const client = new LiveSetupScriptsClient();

    const record = await client.save("ws-abc", RUST_DRAFT.script);

    expect(mockedRequest).toHaveBeenCalledWith("workspace.saveSetupScript", {
      workspaceId: "ws-abc",
      script: RUST_DRAFT.script,
    });
    expect(record).toEqual(stored);
  });

  it("detectProjectType forwards the request and surfaces the projectType (null when unknown)", async () => {
    const client = new LiveSetupScriptsClient();
    mockedRequest.mockResolvedValueOnce({ projectType: "rust" });
    expect(await client.detectProjectType("ws-abc")).toBe("rust");
    expect(mockedRequest).toHaveBeenCalledWith("workspace.detectProjectType", {
      workspaceId: "ws-abc",
    });

    mockedRequest.mockResolvedValueOnce({ projectType: null });
    expect(await client.detectProjectType("ws-abc")).toBeNull();
  });

  it("generate forwards workspace.generateSetupScript and unwraps the draft", async () => {
    mockedRequest.mockResolvedValueOnce({ setupScript: RUST_DRAFT });
    const client = new LiveSetupScriptsClient();

    const draft = await client.generate("ws-abc");

    expect(mockedRequest).toHaveBeenCalledWith("workspace.generateSetupScript", {
      workspaceId: "ws-abc",
    });
    expect(draft).toEqual(RUST_DRAFT);
  });

  it("folds malformed envelopes and transport failures to null", async () => {
    const client = new LiveSetupScriptsClient();
    mockedRequest.mockResolvedValueOnce({});
    expect(await client.get("ws-abc")).toBeNull();
    mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
    expect(await client.generate("ws-abc")).toBeNull();
    mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
    expect(await client.detectProjectType("ws-abc")).toBeNull();
  });

  it("list/subscribe resolve empty — the saved-script library is local UI state", async () => {
    const client = new LiveSetupScriptsClient();
    expect(await client.list()).toEqual([]);
    const handler = vi.fn();
    client.subscribe(handler);
    expect(handler).toHaveBeenCalledWith([]);
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
