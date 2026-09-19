import { sentryAuthClient } from '$features/sentry-auth/renderer/sentry-auth.client';
import type { SentryProject } from '$features/sentry-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  cancelled,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  connectSentry,
  initializeSentryAuth,
  loadSentryIssuesRequested,
  logoutSentry,
  setSentryAuthState,
  setSentryConnected,
  setSentryConnecting,
  setSentryError,
  setSentryLoadingProjects,
  setSentryLoggedOut,
  setSentryProjects,
  sentryIssuesLoaded,
  sentryIssuesLoadSettled,
  sentryIssuesLoadStarted,
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

function* connect(organization: string, apiToken: string): SagaGenerator<void> {
  yield* put(setSentryError(null));
  yield* put(setSentryConnecting(true));
  try {
    const result: Awaited<ReturnType<typeof sentryAuthClient.saveConfig>> = yield* call(
      [sentryAuthClient, sentryAuthClient.saveConfig],
      organization,
      apiToken,
    );
    if (!result.success) {
      yield* put(setSentryError(result.error ?? m.sentryAuth_service_connectFailed_error()));
      yield* put(setSentryConnecting(false));
      return;
    }
    yield* put(setSentryConnected(organization));
    yield* put(setSentryLoadingProjects(true));
    try {
      const projects: Awaited<ReturnType<typeof sentryAuthClient.fetchProjects>> = yield* call([
        sentryAuthClient,
        sentryAuthClient.fetchProjects,
      ]);
      yield* put(setSentryProjects(projects.map(mapProject)));
    } catch (error) {
      logger.error('Failed to fetch Sentry projects', error);
    } finally {
      yield* put(setSentryLoadingProjects(false));
    }
  } catch (error) {
    yield* put(
      setSentryError(
        error instanceof Error ? error.message : m.sentryAuth_service_connectFailed_error(),
      ),
    );
    yield* put(setSentryConnecting(false));
  } finally {
    if (yield* cancelled()) yield* put(setSentryConnecting(false));
  }
}

function* logout(): SagaGenerator<void> {
  try {
    yield* call([sentryAuthClient, sentryAuthClient.logout]);
    yield* put(setSentryLoggedOut());
  } catch (error) {
    logger.error('Failed to log out of Sentry', error);
  }
}

function* loadIssues(): SagaGenerator<void> {
  yield* put(sentryIssuesLoadStarted());
  try {
    const issues: Awaited<ReturnType<typeof sentryAuthClient.fetchIssues>> = yield* call([
      sentryAuthClient,
      sentryAuthClient.fetchIssues,
    ]);
    yield* put(sentryIssuesLoaded(issues));
  } catch (error) {
    logger.error('Failed to fetch Sentry issues', error);
  } finally {
    yield* put(sentryIssuesLoadSettled());
  }
}

function* initializeSentryWorker(
  _action: ReturnType<typeof initializeSentryAuth>,
): SagaGenerator<void> {
  yield* call(initialize);
}

function* connectSentryWorker(action: ReturnType<typeof connectSentry>): SagaGenerator<void> {
  yield* race({
    completed: call(connect, action.payload[0], action.payload[1]),
    superseded: take(logoutSentry),
  });
}

function* logoutSentryWorker(_action: ReturnType<typeof logoutSentry>): SagaGenerator<void> {
  yield* race({ completed: call(logout), superseded: take(connectSentry) });
}

export function* sentryAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeSentryAuth, initializeSentryWorker);
  yield* takeLatest(connectSentry, connectSentryWorker);
  yield* takeLatest(logoutSentry, logoutSentryWorker);
  yield* takeLeading(loadSentryIssuesRequested, loadIssues);
}
