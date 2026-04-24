import { agentService } from "$features/agent/agent-ipc-bridge";
import type { Workspace } from "$shared/types";
import { call, takeEvery } from "typed-redux-saga";
import {
  selectCurrentWorkspace,
  selectWorkspaceById,
} from "../../workspace/workspace-selectors";
import { ensureAgentSessionLoaded } from "../workspace-agents-slice";
import { selectAgentById } from "../workspace-agents-selectors";

/**
 * Saga-local in-flight guard. Debounces rapid re-dispatches per `(wsId, agentId)`
 * so a component that re-mounts (and re-dispatches `ensureAgentSessionLoaded`)
 * while the IPC round-trip is still pending does not fire a second load.
 *
 * This is a runtime coordination map — it is NOT stored in Redux (per
 * src/lib/store/AGENTS.md §2: store only serializable values in Redux).
 */
const inFlightEnsureKeys = new Set<string>();

/** @internal Exposed for test cleanup only — do not use in production code. */
export function _resetInFlightEnsureKeysForTest(): void {
  inFlightEnsureKeys.clear();
}

function makeKey(wsId: string, agentId: string): string {
  return JSON.stringify([wsId, agentId]);
}

/**
 * Loads a single agent session into Redux if it is not already present.
 *
 * Flow:
 * 1. If `selectAgentById(agentId)` returns a session, no-op.
 * 2. Otherwise resolve the workspace via `selectWorkspaceById(wsId)` with a
 *    fallback to `selectCurrentWorkspace` (matches the legacy subscription
 *    behaviour that would use the active workspace when a caller did not
 *    have a full Workspace object handy).
 * 3. Call `agentService.restoreSessionWithoutBackend(agentId, workspace)`.
 *    The IPC bridge dispatches `upsertAgentSession` on success, so no extra
 *    dispatch is required here.
 *
 * Any errors from the IPC call are swallowed to match the previous
 * component-side behaviour; the dispatch originated from a UI mount and
 * should not crash the saga tree.
 */
export function* handleEnsureAgentSessionLoaded(
  wsId: string,
  agentId: string,
) {
  const existing = yield* selectAgentById.effect(agentId);
  if (existing) return;

  const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(wsId);
  const resolvedWorkspace: Workspace | undefined =
    workspace ?? (yield* selectCurrentWorkspace.effect());

  if (!resolvedWorkspace) return;

  try {
    yield* call(
      [agentService, agentService.restoreSessionWithoutBackend],
      agentId,
      resolvedWorkspace,
    );
  } catch {
    // Intentional: the legacy component path also swallowed these errors;
    // the agent service logs via its own error boundary.
  }
}

/**
 * Watcher: debounce per `(wsId, agentId)` while a restore is in flight.
 * `takeEvery` forks a worker per dispatched action; the in-flight Set ensures
 * that a second worker for the same key returns immediately instead of
 * duplicating the IPC call.
 */
export function* watchEnsureAgentSessionLoadedSaga() {
  // Reset module-level state on (re)start so stale keys from a previous run
  // do not suppress the first load after a saga restart.
  inFlightEnsureKeys.clear();

  yield* takeEvery(
    ensureAgentSessionLoaded,
    function* (action: ReturnType<typeof ensureAgentSessionLoaded>) {
      const [wsId, agentId] = action.payload;
      const key = makeKey(wsId, agentId);

      if (inFlightEnsureKeys.has(key)) return;

      inFlightEnsureKeys.add(key);
      try {
        yield* call(handleEnsureAgentSessionLoaded, wsId, agentId);
      } finally {
        inFlightEnsureKeys.delete(key);
      }
    },
  );
}


