/**
 * Workspace homes sagas (PROTOCOL `methods/nodes.md` → "Moving the home",
 * "Detached workspaces").
 *
 * - Move home: `workspace.setHome { workspaceId, to }`; the served moving
 *   home lands on the entity at once, and the move's end arrives as
 *   `workspace:updated { changes: { home } }`. A refusal keeps the dialog open
 *   with its reason.
 * - Wait: ask the backend to reconnect the home machine
 *   (`remoteMachines.refresh`, which connects on demand), then re-read the
 *   workspace so the banner shows the served state; the link coming back
 *   later still arrives as `workspace:updated`. One retry per workspace at a
 *   time.
 */
import { all, call, put, takeEvery, takeLeading, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { backendRequest } from '$lib/client/live/backend-transport';
import { parseRemoteMachine } from '$shared/types/remote-machines';
import { remoteMachineChanged } from '$features/remote-machines/remote-machines-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import type { Workspace } from '$shared/types';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import { setHomeErrorCode, workspaceHomeView } from './workspace-home';
import {
  homeWaitRequested,
  homeWaitSettled,
  moveHomeRequested,
  moveHomeSettled,
} from './workspace-home-slice';

const logger = createLogger('WorkspaceHomeSaga');

/**
 * Keep a served home unless the stored one is newer: a reply can land after
 * the `workspace:updated` event of a later change (a fast move finishing
 * before its `setHome` reply is handled), and must not roll it back.
 */
function* applyHome(workspaceId: string, home: WorkspaceHome | undefined): SagaGenerator<void> {
  const current = (yield* selectWorkspaceById.effect(workspaceId))?.home;
  if (current && home && Date.parse(current.since) > Date.parse(home.since)) return;
  yield* put(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { home })]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* moveHome(action: ReturnType<typeof moveHomeRequested>): SagaGenerator<void> {
  const [workspaceId, to] = action.payload;
  try {
    const home = yield* call([appClient.workspaces, appClient.workspaces.setHome], workspaceId, to);
    yield* call(applyHome, workspaceId, home);
    yield* put(moveHomeSettled(workspaceId, null));
  } catch (error) {
    const code = setHomeErrorCode(error);
    logger.warn('workspace.setHome failed', { workspaceId, code, error: errorMessage(error) });
    yield* put(moveHomeSettled(workspaceId, { code, message: errorMessage(error) }));
    // Another client started a move: show its moving state.
    if (code === 'home-moving') yield* call(rereadHome, workspaceId);
  }
}

/** Re-read `workspace.get` and keep its home as served (absent clears it). */
function* rereadHome(workspaceId: string): SagaGenerator<Workspace | null> {
  try {
    const served = yield* call([appClient.workspaces, appClient.workspaces.get], workspaceId);
    // An authoritative read: a workspace served without `home` has none.
    if (served) yield* call(applyHome, workspaceId, served.home);
    return served;
  } catch (error) {
    logger.warn('workspace.get after a home change failed', {
      workspaceId,
      error: errorMessage(error),
    });
    return null;
  }
}

/**
 * Wait. The reducer marks the workspace waiting before this saga sees the
 * action, so the guard against a second concurrent retry is this saga's own
 * in-flight set, created per saga run.
 */
function* waitForHome(
  waitsInFlight: Set<string>,
  action: ReturnType<typeof homeWaitRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  if (waitsInFlight.has(workspaceId)) return;
  waitsInFlight.add(workspaceId);
  try {
    const nodeId = (yield* selectWorkspaceById.effect(workspaceId))?.home?.nodeId;
    if (nodeId) {
      try {
        // Connects on demand; keep the refreshed row for the machine list.
        const result = yield* call(
          backendRequest<{ machine?: unknown }>,
          'remoteMachines.refresh',
          {
            machineId: nodeId,
          },
        );
        const machine = parseRemoteMachine(result?.machine);
        if (machine) yield* put(remoteMachineChanged(machine));
      } catch (error) {
        // A failure only means the machine is still away.
        logger.info('Home machine still unreachable', { workspaceId, error: errorMessage(error) });
      }
    }
    const served = yield* call(rereadHome, workspaceId);
    const view = workspaceHomeView(served);
    if (view?.unavailable && !view.starting) {
      yield* call(notify.info, m.workspaceHome_wait_stillUnavailable({ name: view.name }));
    }
  } finally {
    waitsInFlight.delete(workspaceId);
    yield* put(homeWaitSettled(workspaceId));
  }
}

export function* workspaceHomeSaga(): SagaGenerator<void> {
  const waitsInFlight = new Set<string>();
  yield* all([
    takeLeading(moveHomeRequested, moveHome),
    takeEvery(homeWaitRequested, waitForHome, waitsInFlight),
  ]);
}
