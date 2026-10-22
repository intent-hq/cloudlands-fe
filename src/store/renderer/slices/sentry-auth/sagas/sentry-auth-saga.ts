import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
import type { SentryProject } from '$features/sentry-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  fork,
  put,
  race,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { selectSentryAuthOperation } from '../sentry-auth-selectors';

import {
  connectSentry,
  cancelSentryAuth,
  consumeSentryAuth,
  initializeSentryAuth,
  logoutSentry,
  setSentryAuthState,
  setSentryConnected,
  settleSentryAuth,
  setSentryError,
  setSentryLoadingProjects,
  setSentryLoggedOut,
  setSentryProjects,
} from '../sentry-auth-slice';

const logger = createLogger('SentryAuthSaga');

function mapProject(source: SentryProject): SentryProject {
  const project: SentryProject = { id: source.id, slug: source.slug, name: source.name };
  if (source.platform !== undefined) project.platform = source.platform;
  if (source.isMember !== undefined) project.isMember = source.isMember;
  return project;
}

function* initialize(): SagaGenerator<void> {
  try {
    const state: Awaited<ReturnType<typeof sentryAuthClient.getAuthState>> = yield* call([
      sentryAuthClient,
      sentryAuthClient.getAuthState,
    ]);
    yield* put(
      setSentryAuthState(state.isAuthenticated, state.organization ?? null, state.error ?? null),
    );
  } catch (error) {
    logger.error('Failed to initialize Sentry auth', error);
  }
}

function* isCurrent(requestId: string): SagaGenerator<boolean> {
  const operation = yield* selectSentryAuthOperation.effect();
  return operation?.requestId === requestId && operation.status === 'pending';
}

function* connect(
  organization: string,
  apiToken: string,
  requestId: string,
): SagaGenerator<boolean> {
  try {
    const result: Awaited<ReturnType<typeof sentryAuthClient.saveConfig>> = yield* call(
      [sentryAuthClient, sentryAuthClient.saveConfig],
      organization,
      apiToken,
    );
    if (!result.success) {
      if (yield* call(isCurrent, requestId))
        yield* put(setSentryError(result.error ?? m.sentryAuth_service_connectFailed_error()));
      return false;
    }
    // The serialized write committed even if its UI consumer has gone away.
    // Reconcile resource truth, but do not revive that consumer's follow-up work.
    yield* put(setSentryConnected(organization));
    if (!(yield* call(isCurrent, requestId))) return true;
    yield* put(setSentryLoadingProjects(true));
    try {
      const projects: Awaited<ReturnType<typeof sentryAuthClient.fetchProjects>> = yield* call([
        sentryAuthClient,
        sentryAuthClient.fetchProjects,
      ]);
      if (yield* call(isCurrent, requestId))
        yield* put(setSentryProjects(projects.map(mapProject)));
    } catch (error) {
      logger.error('Failed to fetch Sentry projects', error);
    }
    return true;
  } catch (error) {
    if (yield* call(isCurrent, requestId))
      yield* put(
        setSentryError(
          error instanceof Error ? error.message : m.sentryAuth_service_connectFailed_error(),
        ),
      );
    return false;
  }
}

function* logout(): SagaGenerator<boolean> {
  try {
    yield* call([sentryAuthClient, sentryAuthClient.logout]);
    yield* put(setSentryLoggedOut());
    return true;
  } catch (error) {
    logger.error('Failed to log out of Sentry', error);
    return false;
  }
}

function* initializeSentryWorker(): SagaGenerator<void> {
  const operation = yield* selectSentryAuthOperation.effect();
  if (operation?.status === 'pending') return;
  yield* race({
    probe: call(initialize),
    invalidated: take([
      connectSentry,
      logoutSentry,
      cancelSentryAuth,
      consumeSentryAuth,
      setSentryConnected,
      setSentryLoggedOut,
    ]),
  });
}

function* mutations(): SagaGenerator<void> {
  // Config writes and resets share one queue; cancelling a UI request cannot
  // abort an already-sent write or allow the next write to overtake it.
  const requests = yield* actionChannel([connectSentry, logoutSentry], buffers.expanding());
  try {
    while (true) {
      const action: ReturnType<typeof connectSentry> | ReturnType<typeof logoutSentry> =
        yield* take(requests);
      const { requestId } = action.payload.request;
      if (!(yield* call(isCurrent, requestId))) continue;
      try {
        const connectRequest =
          'apiToken' in action.payload
            ? (action as ReturnType<typeof connectSentry>).payload
            : null;
        const success = connectRequest
          ? yield* call(connect, connectRequest.organization, connectRequest.apiToken, requestId)
          : yield* call(logout);
        yield* put(settleSentryAuth(requestId, success ? 'succeeded' : 'failed'));
      } finally {
        if (yield* cancelled()) yield* put(settleSentryAuth(requestId, 'cancelled'));
      }
    }
  } finally {
    requests.close();
    const operation = yield* selectSentryAuthOperation.effect();
    if (operation?.status === 'pending')
      yield* put(settleSentryAuth(operation.requestId, 'cancelled'));
  }
}

export function* sentryAuthSaga(): SagaGenerator<void> {
  yield* fork(mutations);
  yield* takeLatest(initializeSentryAuth, initializeSentryWorker);
}
