import type { AgentSession, Workspace } from "$shared/types";
import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import { selectWorkspaceById } from "../../workspace/workspace-selectors";
import {
  ensureAgentSessionLoaded,
  restoreAgentSessionRequested,
} from "../workspace-agents-slice";

import { restoreSessionFromDiskWithoutBackend } from "./agent-session-restore-utils";
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

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
 * 1. If `selectAgentSession(agentId)` returns a session, no-op.
 * 2. Otherwise resolve the workspace via the explicit `selectWorkspaceById(wsId)`.
 *    If that workspace cannot be resolved, no-op rather than falling back to
 *    the current workspace.
 * 3. Load persisted session/config through the thin persistence boundary and
 *    publish the restored session via Redux actions.
 *
 * Any errors from the IPC call are swallowed to match the previous
 * component-side behaviour; the dispatch originated from a UI mount and
 * should not crash the saga tree.
 */
export function* handleEnsureAgentSessionLoaded(
  wsId: string,
  agentId: string,
) {
  const existing = yield* selectAgentSession.effect(agentId);
  if (existing) return;

  const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(wsId);
  if (!workspace) return;

  try {
    yield* call(restoreSessionFromDiskWithoutBackend, agentId, workspace);
  } catch {
    // Intentional: the legacy component path also swallowed these errors;
    // the agent service logs via its own error boundary.
  }
}

export function* handleRestoreAgentSessionRequested(
  action: ReturnType<typeof restoreAgentSessionRequested>,
) {
  const [wsId, agentId] = action.payload;
  try {
    const existing = yield* selectAgentSession.effect(agentId);
    if (existing) {
      yield* put(action.success(existing));
      return;
    }

    const workspace: Workspace | undefined = yield* selectWorkspaceById.effect(wsId);
    if (!workspace) {
      yield* put(action.success(null));
      return;
    }

    const session: AgentSession | null = yield* call(
      restoreSessionFromDiskWithoutBackend,
      agentId,
      workspace,
    );
    yield* put(action.success(session));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error.message : String(error)));
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

  yield* takeEvery(restoreAgentSessionRequested, handleRestoreAgentSessionRequested);
}


