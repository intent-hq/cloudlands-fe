/**
 * Permission-response service — the handler behind the interactive
 * permission-flow triggers (`approvePermission`, `denyPermission`,
 * `cancelPermission`, `selectPermissionOption`) that `InlinePermissionRequest`
 * dispatches when the user chooses an option in the inline chat prompt.
 *
 * Post-saga gap: the reference `respondPermissionSaga` translated each
 * trigger into an ACP-shaped outcome (`{ outcome: "selected", optionId }` or
 * `{ outcome: "cancelled" }`) and forwarded it via the legacy Electron IPC
 * `PERMISSION.RESPOND` channel; when the saga runtime was removed the
 * triggers became no-ops, so approve/deny/cancel clicks never reached the
 * blocked agent and the 5-minute PROTOCOL §8 timeout was the only way to
 * unstick the stream.
 *
 * This restores the resolution path over the daemon-first transport WITHOUT
 * re-adding a saga: after the reducer runs the middleware picks the request
 * out of the permission collection (needed to derive `optionId` for
 * approve/deny), calls the canonical `agents.respondPermission` seam
 * (PROTOCOL §8: `{ requestId, outcome }` → `{ resolved: bool }`), and
 * dispatches `removePermissionRequest` on success so the inline prompt
 * disappears immediately even before the daemon's `agent:permission:resolved`
 * fan-out lands. The BE's own event is the authoritative convergence signal
 * (the daemon-events bridge also removes the entry on that event), so a
 * transport failure is logged but not surfaced -- the prompt stays visible
 * so the user can retry.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the configured store, permission-slice actions, the
 * collection helper for the request lookup, and the logger.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { appClient, type PermissionOutcome } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  approvePermission,
  cancelPermission,
  denyPermission,
  removePermissionRequest,
  selectPermissionOption,
  type PermissionRequest,
} from "$store/renderer/slices/permission/permission-slice";

const logger = createLogger("PermissionResponseService");

/** Look up a pending permission request straight off the current store state. */
function findRequest(requestId: string): PermissionRequest | undefined {
  return getItem(appStore.state.permission.requests, requestId);
}

/**
 * Forward one PROTOCOL §8 outcome to the daemon and optimistically clear the
 * request. A `{ resolved: false }` response means the prompt is already gone
 * (timed out or answered elsewhere); we still remove the local entry so the
 * inline UI does not stay stuck. Only a transport-level failure keeps the
 * entry around -- the prompt remains actionable and the daemon's own
 * `agent:permission:resolved` fan-out will reconcile if it eventually lands.
 */
async function dispatchOutcome(requestId: string, outcome: PermissionOutcome): Promise<void> {
  const result = await appClient.agents.respondPermission(requestId, outcome);
  if (result.success) {
    appStore.dispatch(removePermissionRequest(requestId));
  } else {
    logger.error("agent.respondPermission failed", { requestId, outcome, error: result.error });
  }
}

/**
 * "Approve" -> pick the first non-destructive option (fallback: first option,
 * then `allow_once` per PROTOCOL §8 default naming) and dispatch a `selected`
 * outcome. Mirrors the reference saga so single-tap Approve does the right
 * thing regardless of provider option naming.
 */
function handleApprove(requestId: string): void {
  const request = findRequest(requestId);
  if (!request) return;
  const option =
    request.options.find((opt) => !opt.destructive) ?? request.options[0];
  const optionId = option?.id ?? "allow_once";
  void dispatchOutcome(requestId, { outcome: "selected", optionId });
}

/**
 * "Deny" -> pick the first destructive option (fallback: last option, then
 * `reject_once`) and dispatch a `selected` outcome.
 */
function handleDeny(requestId: string): void {
  const request = findRequest(requestId);
  if (!request) return;
  const option =
    request.options.find((opt) => opt.destructive) ??
    request.options[request.options.length - 1];
  const optionId = option?.id ?? "reject_once";
  void dispatchOutcome(requestId, { outcome: "selected", optionId });
}

/** "Cancel" -> PROTOCOL §8 cancelled outcome (unblocks the agent). */
function handleCancel(requestId: string): void {
  void dispatchOutcome(requestId, { outcome: "cancelled" });
}

/** "Select" -> forward the caller-supplied optionId verbatim. */
function handleSelect(requestId: string, optionId: string): void {
  void dispatchOutcome(requestId, { outcome: "selected", optionId });
}

/**
 * Middleware that gives the permission triggers a real consumer.
 * Fire-and-forget -- dispatch stays synchronous and never throws.
 */
export function createPermissionResponseMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== "object") return result;
    const type = (action as { type?: unknown }).type;

    if (type === approvePermission.type) {
      const [requestId] = (action as { payload?: [string] }).payload ?? [];
      if (typeof requestId === "string" && requestId.length > 0) handleApprove(requestId);
    } else if (type === denyPermission.type) {
      const [requestId] = (action as { payload?: [string] }).payload ?? [];
      if (typeof requestId === "string" && requestId.length > 0) handleDeny(requestId);
    } else if (type === cancelPermission.type) {
      const [requestId] = (action as { payload?: [string] }).payload ?? [];
      if (typeof requestId === "string" && requestId.length > 0) handleCancel(requestId);
    } else if (type === selectPermissionOption.type) {
      const [requestId, optionId] =
        (action as { payload?: [string, string] }).payload ?? [];
      if (
        typeof requestId === "string" &&
        requestId.length > 0 &&
        typeof optionId === "string" &&
        optionId.length > 0
      ) {
        handleSelect(requestId, optionId);
      }
    }

    return result;
  };
}
