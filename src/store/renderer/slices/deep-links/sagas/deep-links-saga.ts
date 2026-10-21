/**
 * Deep-links saga — the renderer half of `intent://` link delivery.
 *
 * The main process queues each renderer-bound action for its target window
 * (`src/features/deeplink/main/pending-deep-links.ts`) and nudges the window
 * over the `deep-link` channel. This saga drains its window's queue through
 * `deep-link:consume-pending` once on start (cold start / a just-opened
 * window) and again on every nudge, handling actions one at a time so two
 * links for the same folder cannot race into two workspaces.
 *
 * - `open?path=` (the `intent` CLI): open the workspace working in that folder,
 *   or create one directly on the folder (`skipIsolation`, no worktree).
 * - `open?id=`: open that workspace.
 * - `create` / `clone`: open the New Space form prefilled from the link. The
 *   link never creates a workspace by itself (`autoCreate` is ignored).
 * - `settings?beta=`: switch the update channel; `settings` alone opens Settings.
 */

import { call, delay, put, race, take, type SagaGenerator } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { invoke, isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { DEEP_LINK_CHANNELS } from '$shared/ipc/channels';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import { createElectronChannel } from '../../../utils/ipc-channel';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import {
  hostMembershipChanged,
  principalContextChanged,
  principalIdentityChanged,
  principalReceived,
} from '../../principal/principal-slice';
import { selectShowCreateModal } from '../../sidebar-nav/sidebar-nav-selectors';
import { setShowCreateModal } from '../../sidebar-nav/sidebar-nav-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { selectUpdateChannel } from '../../user-preferences/user-preferences-selectors';
import { setUpdateChannel } from '../../user-preferences/user-preferences-slice';
import { workspaceClient } from '../../workspace/utils/workspace.client';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import type { DeepLinkActionPayload } from '../deep-links-types';
import {
  WORKSPACE_PREFILL_KEY,
  buildCreatePrefill,
  findWorkspaceForFolder,
  folderTitle,
  normalizeFolderPath,
} from '../utils/deep-link-workspace';

const logger = createLogger('DeepLinksSaga');
let running = false;

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
}

function* listWorkspaces(): SagaGenerator<Workspace[]> {
  const result = yield* call([workspaceClient, workspaceClient.list], { lite: true });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function* showWorkspace(workspaceId: string): SagaGenerator<void> {
  yield* put(openWorkspaceTab(workspaceId));
  yield* call(navigateToRoute, `/workspace/${encodeURIComponent(workspaceId)}`);
}

function* openFolder(rawPath: string, alias?: string): SagaGenerator<void> {
  const folder = normalizeFolderPath(rawPath);
  try {
    const existing = findWorkspaceForFolder(yield* call(listWorkspaces), [folder, alias ?? '']);
    if (existing) {
      yield* call(showWorkspace, existing.id);
      return;
    }
    const created = yield* call([workspaceClient, workspaceClient.create], {
      title: folderTitle(folder),
      repositoryPath: folder,
      skipIsolation: true,
    });
    if (!created.ok) throw new Error(created.error);
    yield* put(setWorkspaceEntity(created.data.workspace));
    yield* call(showWorkspace, created.data.workspace.id);
  } catch (error) {
    logger.warn('Failed to open folder from deep link', { folder, error });
    yield* call(notify.error, m.deeplink_links_openFolderFailed_error({ folder }), {
      description: errorDetail(error),
    });
  }
}

function* openWorkspaceById(workspaceId: string): SagaGenerator<void> {
  try {
    const workspaces = yield* call(listWorkspaces);
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      yield* call(notify.error, m.deeplink_links_workspaceNotFound_error());
      return;
    }
    yield* call(showWorkspace, workspaceId);
  } catch (error) {
    logger.warn('Failed to open workspace from deep link', { workspaceId, error });
    yield* call(notify.error, m.deeplink_links_workspaceNotFound_error(), {
      description: errorDetail(error),
    });
  }
}

function* openCreateForm(params: Record<string, string>): SagaGenerator<void> {
  const prefill = buildCreatePrefill(params);
  yield* call(() => sessionStorage.setItem(WORKSPACE_PREFILL_KEY, JSON.stringify(prefill)));
  // The New Space modal applies the prefill when it opens; if it is already
  // open, close it for a beat so the new link's prefill is applied instead of
  // lingering in sessionStorage until the next open.
  if (yield* selectShowCreateModal.effect()) {
    yield* put(setShowCreateModal(false));
    yield* delay(50);
  }
  yield* put(setShowCreateModal(true));
}

function* switchUpdateChannel(beta: string): SagaGenerator<void> {
  const target = beta === 'true' ? 'beta' : beta === 'false' ? 'stable' : null;
  if (!target) {
    yield* call(notify.error, m.deeplink_links_unsupported_error());
    return;
  }
  // A link — which any page can send — only toggles between stable and beta.
  // It never overrides an alpha or `disabled` choice made in Settings.
  const current = yield* selectUpdateChannel.effect();
  if (current !== 'stable' && current !== 'beta') {
    yield* call(notify.info, m.deeplink_links_channelUnchanged_message());
    return;
  }
  // The update-channel saga persists the preference and main checks the new
  // feed on switch (with its own "Checking…" feedback), so dispatching is all.
  if (current !== target) yield* put(setUpdateChannel(target));
  yield* call(
    notify.success,
    target === 'beta'
      ? m.deeplink_links_betaChannel_message()
      : m.deeplink_links_stableChannel_message(),
  );
}

export function* handleDeepLinkAction(action: DeepLinkActionPayload): SagaGenerator<void> {
  const params = action.params ?? {};
  switch (action.type) {
    case 'open':
      if (params.path) return yield* call(openFolder, params.path, params.alias);
      if (params.id) return yield* call(openWorkspaceById, params.id);
      break;
    case 'create':
      if (params.repo || params.githubUrl || params.prompt) {
        return yield* call(openCreateForm, params);
      }
      break;
    case 'clone':
      if (params.repo)
        return yield* call(openCreateForm, { ...params, githubUrl: params.repo, repo: '' });
      yield* call(notify.error, m.deeplink_links_cloneMissingRepo_error());
      return;
    case 'settings':
      if (params.beta !== undefined) return yield* call(switchUpdateChannel, params.beta);
      return yield* call(navigateToRoute, '/settings');
  }
  logger.warn('Unsupported deep link', { type: action.type, keys: Object.keys(params) });
  yield* call(notify.error, m.deeplink_links_unsupported_error());
}

function isActionPayload(value: unknown): value is DeepLinkActionPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DeepLinkActionPayload).type === 'string' &&
    typeof (value as DeepLinkActionPayload).params === 'object'
  );
}

/**
 * Wait until this window's principal is admitted on its current connection.
 * Until then workspace mutations are rejected (`captureMutation`), so a link
 * consumed during startup would be lost; leaving it in main's queue keeps it.
 * A confirmed denial still admits (the context exists) and surfaces as the
 * handler's error toast rather than a silent drop.
 */
function* waitForPrincipalAdmission(): SagaGenerator<void> {
  while (!(yield* selectPrincipalActionContext.effect())) {
    // Admission becomes ready through a principal read or context change; the
    // periodic re-check covers a connection-side change that lands without one.
    yield* race({
      changed: take([
        principalContextChanged,
        principalReceived,
        hostMembershipChanged,
        principalIdentityChanged,
      ]),
      recheck: delay(1000),
    });
  }
}

export function* drainPendingDeepLinks(): SagaGenerator<void> {
  yield* call(waitForPrincipalAdmission);
  let actions: unknown;
  try {
    const result = yield* call(
      invoke<{ actions?: unknown }>,
      DEEP_LINK_CHANNELS.CONSUME_PENDING,
      {},
    );
    actions = result?.actions;
  } catch (error) {
    logger.warn('Failed to consume pending deep links', { error });
    return;
  }
  if (!Array.isArray(actions)) return;
  for (const action of actions) {
    if (!isActionPayload(action)) continue;
    try {
      yield* call(handleDeepLinkAction, action);
    } catch (error) {
      logger.warn('Deep link handler failed', { type: action.type, error });
    }
  }
}

function* watchNudges(): SagaGenerator<void> {
  // Register the listener before the first drain: a nudge sent between the
  // drain and the subscription would otherwise be missed until the next one.
  const channel = createElectronChannel<{ pending: true }>('deep-link', {
    bufferPolicy: {
      kind: 'sliding',
      limit: 1,
      rationale: 'A nudge only says "drain the queue"; one pending nudge covers any number.',
    },
  });
  try {
    yield* call(drainPendingDeepLinks);
    while (true) {
      yield* take(channel);
      yield* call(drainPendingDeepLinks);
    }
  } finally {
    channel.close();
  }
}

export function* deepLinksSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
  try {
    yield* call(watchNudges);
  } finally {
    running = false;
  }
}
