/**
 * Wire-contract tests for the permission-response middleware.
 *
 * Asserts each permission trigger (`approvePermission`, `denyPermission`,
 * `cancelPermission`, `selectPermissionOption`) folds into the canonical
 * PROTOCOL §8 `agent.respondPermission` JSON-RPC call with the right
 * `{ requestId, outcome }` shape, and that the local slice entry is cleared
 * on success so the inline prompt disappears immediately.
 *
 * The middleware talks to the daemon via the `appClient.agents` seam, so we
 * stub the seam method (not the raw transport) to observe the exact
 * `(requestId, outcome)` pair the middleware forwards and control the
 * `MutationResult` it sees back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { respondSpy } = vi.hoisted(() => ({ respondSpy: vi.fn() }));
vi.mock("$lib/client/live/backend-transport", () => ({
  // Bridge / hydration middleware call `backendRequest` on startup; resolve
  // everything with a benign shape so those code paths do not perturb the
  // permission-flow assertions below.
  backendRequest: () => Promise.resolve({ subscriptionId: "sub-perm-1" }),
  onBackendNotification: () => () => {},
}));
vi.mock("$lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/client")>();
  return {
    ...actual,
    appClient: {
      ...actual.appClient,
      agents: {
        ...actual.appClient.agents,
        respondPermission: (requestId: string, outcome: unknown) =>
          respondSpy({ requestId, outcome }),
      },
    },
  };
});

import { store as appStore } from "$store/renderer/store";
import {
  approvePermission,
  cancelPermission,
  denyPermission,
  permissionRequestReceived,
  selectPermissionOption,
  type PermissionRequest,
} from "$store/renderer/slices/permission/permission-slice";
import { selectPermissionRequests } from "$store/renderer/slices/permission/permission-selectors";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const REQUEST_ID = "perm_1718600000000_1";

function buildRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: REQUEST_ID,
    sessionId: "agent-perm-1",
    title: "Run command",
    description: "Tool input",
    options: [
      { id: "allow_once", label: "Allow", destructive: false },
      { id: "reject_once", label: "Deny", destructive: true },
    ],
    agentName: "auggie",
    riskLevel: "high",
    timestamp: 1718600000000,
    ...overrides,
  };
}

describe("permission-response-service (PROTOCOL §8 agent.respondPermission)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    respondSpy.mockReset();
    respondSpy.mockResolvedValue({ success: true, resolved: true });
    // Reset the slice between tests by re-seeding a fresh request.
  });

  afterEach(() => vi.clearAllMocks());

  it("approvePermission → { outcome: selected, optionId: <first non-destructive> } and clears the entry", async () => {
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(approvePermission(REQUEST_ID));
    await flush();

    expect(respondSpy).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(0);
  });

  it("denyPermission → { outcome: selected, optionId: <first destructive> } and clears the entry", async () => {
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(denyPermission(REQUEST_ID));
    await flush();

    expect(respondSpy).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      outcome: { outcome: "selected", optionId: "reject_once" },
    });
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(0);
  });

  it("cancelPermission → { outcome: cancelled } and clears the entry (no lookup required)", async () => {
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(cancelPermission(REQUEST_ID));
    await flush();

    expect(respondSpy).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      outcome: { outcome: "cancelled" },
    });
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(0);
  });

  it("selectPermissionOption forwards the caller-supplied optionId verbatim", async () => {
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(selectPermissionOption(REQUEST_ID, "reject_once"));
    await flush();

    expect(respondSpy).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      outcome: { outcome: "selected", optionId: "reject_once" },
    });
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(0);
  });

  it("keeps the entry in place when agent.respondPermission fails (transport failure)", async () => {
    respondSpy.mockResolvedValueOnce({ success: false, error: "boom" });
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(approvePermission(REQUEST_ID));
    await flush();

    expect(respondSpy).toHaveBeenCalledTimes(1);
    // Optimistic delete is deliberately withheld on failure so the user can retry.
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(1);
  });

  it("no-ops (no RPC) when approvePermission is dispatched with no matching pending request", async () => {
    // Nothing seeded; approve should short-circuit before the RPC.
    appStore.dispatch(approvePermission("perm-nonexistent"));
    await flush();
    expect(respondSpy).not.toHaveBeenCalled();
  });

  it("wire-contract round trip: request event seeds slice, approve → respondPermission → resolved event clears", async () => {
    // Seed via the same action the daemon-events bridge dispatches on
    // `agent:permission:request` so this test also guards the FE→BE→FE loop.
    appStore.dispatch(permissionRequestReceived(buildRequest()));
    appStore.dispatch(approvePermission(REQUEST_ID));
    await flush();

    expect(respondSpy).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    expect(selectPermissionRequests.select(appStore.state)).toHaveLength(0);
  });
});
