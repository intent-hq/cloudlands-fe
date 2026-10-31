/**
 * The add dialog's steps after Create for the Different login, API key and
 * Token kinds (PROTOCOL §5.54). The profile itself is saved through the
 * ordinary create mutation (provider-profiles-saga), with the setup id as its
 * request id; this saga drives what comes around it:
 *
 * - Different login: `host.listDirectory` on `~/intent/profiles/<provider>/`
 *   (a missing folder counts as empty) → an unused `<slug>-<suffix>` folder →
 *   `providers.profiles.create` with the folder variable and the kind's unsets
 *   → `host.createDirectory` → the bottom terminal on the daemon host running
 *   the plain login command with the folder variable in `env` (never in the
 *   command string) → `host.providerAuthStatus { force: true }` every 2.5 s
 *   until signed in (then the terminal panel hides if it still shows that
 *   terminal) or 10 minutes pass ("Still waiting?").
 * - API key / Token: create, then `host.providerTestPrompt` → "Key works" or
 *   "Key was rejected"; a rejected key can be replaced and checked again.
 *
 * Typed secrets are staged (provider-profiles-state) and never enter state,
 * actions or logs. Dismissing a setup stops its work; the profile stays saved.
 */
import { all, call, delay, put, race, take, takeEvery } from 'typed-redux-saga';
type Action = { type: string; payload?: unknown };
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  buildProviderAuthStatusParams,
  PROVIDER_AUTH_STATUS_METHOD,
  type ProviderAuthStatusResponse,
} from '$shared/provider-auth-status';
import type { EnvEntryWrite, ProviderProfile } from '$shared/provider-profiles';
import { invalidateProviderAuthStatus } from '$features/providers/provider-auth-status.client';
import { runProviderTestPrompt } from '$features/providers/provider-test-prompt.client';
import {
  buildCreatePayload,
  folderVariableFor,
  loginCommand,
  pickUnusedFolder,
  profileFoldersParent,
  slugifyProfileName,
  type ProfileProvider,
  type RandomSource,
} from '$lib/provider-profile-kinds';
import {
  providerProfileCheckRequested,
  providerProfileCreateRequested,
  providerProfileFolderSetupRequested,
  providerProfileMutationDismissed,
  providerProfileMutationFailed,
  providerProfileMutationSucceeded,
  providerProfileSecretRetryRequested,
  providerProfileSecretSetupRequested,
  providerProfileSetupChanged,
  providerProfileSetupDismissed,
  providerProfileSignInRetryRequested,
  providerProfileStatusChanged,
  providerProfileUpdateRequested,
} from '../provider-settings-slice';
import { selectProviderProfile, selectProviderProfileSetups } from '../provider-settings-selectors';
import { takeStagedProfileEnv } from '../provider-profiles-state';
import { selectIsDaemonAppOwned } from '../../daemon-health/daemon-health-selectors';
import { closeTerminalOverlay, openTerminalOverlay } from '../../terminals/terminals-slice';
import { selectWorkspaceTerminalState } from '../../terminals/terminals-selectors';

const logger = createLogger('ProviderProfileSetupSaga');

/** How often the sign-in wait re-checks the profile (brief: every 2–3 s). */
export const SIGN_IN_POLL_MS = 2_500;
/** When the dialog offers "Still waiting? Try again". */
export const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export interface ProviderProfileSetupDeps {
  /** Entry names in `path` on the daemon host; a missing folder is `[]`. */
  listDirectory(path: string): Promise<string[]>;
  /** Creates `path` (with parents, idempotent) and returns the expanded path. */
  createDirectory(path: string): Promise<string>;
  /** Opens the bottom terminal on the daemon host; returns its id. */
  openTerminal(command: string, env: Record<string, string>): Promise<string>;
  /** One forced `host.providerAuthStatus` for a profile reference. */
  authStatus(providerRef: string): Promise<{ authenticated?: boolean; email?: string }>;
  /** `host.providerTestPrompt` for a profile reference: true when it answered. */
  testPrompt(providerRef: string): Promise<boolean>;
  now(): number;
  random?: RandomSource;
}

/** `host.listDirectory` reports a missing folder as an IO error naming the OS error. */
function isMissingFolderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /os error (2|3)\b|no such file|cannot find the (path|file)/i.test(message);
}

const defaultProviderProfileSetupDeps: ProviderProfileSetupDeps = {
  async listDirectory(path) {
    try {
      const listing = await backendRequest<{ entries?: { name: string }[] }>('host.listDirectory', {
        path,
      });
      return (listing.entries ?? []).map((entry) => entry.name);
    } catch (error) {
      if (isMissingFolderError(error)) return [];
      throw error;
    }
  },
  async createDirectory(path) {
    const result = await backendRequest<{ path: string }>('host.createDirectory', { path });
    return result.path;
  },
  async openTerminal(command, env) {
    const result = await invoke<{ ok: boolean; terminalId?: string; error?: string }>(
      IPC_CHANNELS.TERMINAL.CREATE_WITH_COMMAND,
      { workspaceId: ROOT_WORKSPACE_ID, command, env, interactive: true },
    );
    if (!result.ok || !result.terminalId) throw new Error(result.error || 'Terminal not opened');
    return result.terminalId;
  },
  async authStatus(providerRef) {
    invalidateProviderAuthStatus(providerRef);
    const response = await backendRequest<ProviderAuthStatusResponse>(
      PROVIDER_AUTH_STATUS_METHOD,
      buildProviderAuthStatusParams({ providerId: providerRef, force: true }),
    );
    const entry = response.providers.find((item) => item.id === providerRef);
    return {
      authenticated: entry?.authenticated ?? undefined,
      email: entry?.identity?.email || undefined,
    };
  },
  async testPrompt(providerRef) {
    return (await runProviderTestPrompt({ providerId: providerRef })).ok;
  },
  now: () => Date.now(),
};

/**
 * The previewed `<slug>-<suffix>` folder when nothing by that name exists
 * (ignoring case), otherwise another unused suffix.
 */
export function chooseProfileFolder(
  provider: ProfileProvider,
  name: string,
  suffix: string,
  existingEntries: readonly string[],
  random?: RandomSource,
): string {
  const preferred = `${slugifyProfileName(name)}-${suffix}`;
  const taken = existingEntries.some((entry) => entry.toLowerCase() === preferred);
  if (!taken) return `${profileFoldersParent(provider)}/${preferred}`;
  return pickUnusedFolder(provider, name, existingEntries, random);
}

const changed = (setupId: string, patch: Parameters<typeof providerProfileSetupChanged>[1]) =>
  providerProfileSetupChanged(setupId, patch);

/**
 * Wait for the create/update mutation `requestId` to settle, then dismiss it
 * (the setup records the outcome). Returns the saved profile or the failure.
 */
function* awaitMutation(requestId: string) {
  while (true) {
    const settled = yield* take([providerProfileMutationSucceeded, providerProfileMutationFailed]);
    if (settled.payload[0] !== requestId) continue;
    yield* put(providerProfileMutationDismissed(requestId));
    if (settled.type === providerProfileMutationSucceeded.type) {
      const [, result] = (settled as ReturnType<typeof providerProfileMutationSucceeded>).payload;
      return { profile: result.profile as ProviderProfile | undefined };
    }
    return { failure: (settled as ReturnType<typeof providerProfileMutationFailed>).payload[1] };
  }
}

/** Poll the profile's sign-in until it reports signed in or the wait times out. */
function* waitForSignIn(
  deps: ProviderProfileSetupDeps,
  setupId: string,
  profile: ProviderProfile,
  terminalId: string,
) {
  const startedAt = deps.now();
  while (true) {
    yield* delay(SIGN_IN_POLL_MS);
    let verdict: { authenticated?: boolean; email?: string } = {};
    try {
      verdict = yield* call([deps, deps.authStatus], profile.providerRef);
    } catch (error) {
      logger.warn('Profile sign-in status check failed', { profileId: profile.id, error });
    }
    if (verdict.authenticated === true) {
      yield* put(
        changed(setupId, { phase: 'signedIn', ...(verdict.email ? { email: verdict.email } : {}) }),
      );
      if (yield* selectProviderProfile.effect(profile.id))
        yield* put(providerProfileStatusChanged(profile.id, 'ready'));
      const terminal = yield* selectWorkspaceTerminalState.effect(ROOT_WORKSPACE_ID);
      if (terminal.isOpen && terminal.activeTerminalId === terminalId && !terminal.selectedScriptId)
        yield* put(closeTerminalOverlay(ROOT_WORKSPACE_ID));
      return;
    }
    if (deps.now() - startedAt >= SIGN_IN_TIMEOUT_MS) {
      yield* put(changed(setupId, { phase: 'stillWaiting' }));
      return;
    }
  }
}

/** Create the saved folder, open the terminal sign-in on it, and wait. */
function* signIn(
  deps: ProviderProfileSetupDeps,
  setupId: string,
  provider: ProfileProvider,
  profile: ProviderProfile,
  folder: string,
) {
  const appOwned = yield* selectIsDaemonAppOwned.effect();
  const deviceAuth = provider === 'codex' && !appOwned;
  yield* put(changed(setupId, { phase: 'openingTerminal', deviceAuth, failure: undefined }));
  let expanded: string;
  try {
    expanded = yield* call([deps, deps.createDirectory], folder);
  } catch (error) {
    logger.warn('Profile folder creation failed', { profileId: profile.id, error });
    yield* put(
      changed(setupId, { phase: 'failed', failure: { kind: 'folderFailed', path: folder } }),
    );
    return;
  }
  let terminalId: string;
  try {
    terminalId = yield* call([deps, deps.openTerminal], loginCommand(provider, appOwned), {
      [folderVariableFor(provider)]: expanded,
    });
  } catch (error) {
    logger.warn('Profile sign-in terminal failed to open', { profileId: profile.id, error });
    yield* put(changed(setupId, { phase: 'failed', failure: { kind: 'terminalFailed' } }));
    return;
  }
  yield* put(openTerminalOverlay(ROOT_WORKSPACE_ID, terminalId));
  yield* put(changed(setupId, { phase: 'waiting' }));
  yield* call(waitForSignIn, deps, setupId, profile, terminalId);
}

function* runFolderSetup(
  deps: ProviderProfileSetupDeps,
  action: ReturnType<typeof providerProfileFolderSetupRequested>,
) {
  const [{ setupId, provider, name, backup, suffix }] = action.payload;
  yield* put(changed(setupId, { phase: 'saving' }));
  let folder: string;
  try {
    const parent = profileFoldersParent(provider);
    const entries = yield* call([deps, deps.listDirectory], parent);
    folder = chooseProfileFolder(provider, name, suffix, entries, deps.random);
  } catch (error) {
    logger.warn('Profile folder listing failed', { error });
    yield* put(
      changed(setupId, {
        phase: 'failed',
        failure: { kind: 'saveFailed', failure: { kind: 'other' } },
      }),
    );
    return;
  }
  const payload = buildCreatePayload('differentLogin', provider, { name, backup, folder });
  yield* put(
    providerProfileCreateRequested({
      requestId: setupId,
      baseProviderId: payload.baseProviderId,
      name: payload.name,
      env: payload.env,
      ...(backup ? { backup } : {}),
    }),
  );
  const saved = yield* call(awaitMutation, setupId);
  if (!saved.profile) {
    yield* put(
      changed(setupId, {
        phase: 'failed',
        failure: { kind: 'saveFailed', failure: saved.failure ?? { kind: 'other' } },
      }),
    );
    return;
  }
  yield* put(changed(setupId, { profileId: saved.profile.id, folder }));
  yield* call(signIn, deps, setupId, provider, saved.profile, folder);
}

/** Run the key check for a saved key/token profile. */
function* checkKey(deps: ProviderProfileSetupDeps, setupId: string, profile: ProviderProfile) {
  yield* put(changed(setupId, { phase: 'checkingKey', failure: undefined }));
  let works = false;
  try {
    works = yield* call([deps, deps.testPrompt], profile.providerRef);
  } catch (error) {
    logger.warn('Profile key check failed', { profileId: profile.id, error });
  }
  yield* put(changed(setupId, { phase: works ? 'keyWorks' : 'keyRejected' }));
  if (yield* selectProviderProfile.effect(profile.id))
    yield* put(providerProfileCheckRequested(profile.id));
}

function takeEnv(envRef: number | undefined): EnvEntryWrite[] | null {
  return envRef === undefined ? null : takeStagedProfileEnv(envRef);
}

function* runSecretSetup(
  deps: ProviderProfileSetupDeps,
  action: ReturnType<typeof providerProfileSecretSetupRequested>,
) {
  const { setupId, baseProviderId, name, backup, envRef } = action.payload;
  const env = takeEnv(envRef);
  if (!env) {
    yield* put(
      changed(setupId, {
        phase: 'failed',
        failure: { kind: 'saveFailed', failure: { kind: 'other' } },
      }),
    );
    return;
  }
  yield* put(changed(setupId, { phase: 'saving' }));
  yield* put(
    providerProfileCreateRequested({
      requestId: setupId,
      baseProviderId,
      name,
      env,
      ...(backup ? { backup } : {}),
    }),
  );
  const saved = yield* call(awaitMutation, setupId);
  if (!saved.profile) {
    yield* put(
      changed(setupId, {
        phase: 'failed',
        failure: { kind: 'saveFailed', failure: saved.failure ?? { kind: 'other' } },
      }),
    );
    return;
  }
  yield* put(changed(setupId, { profileId: saved.profile.id }));
  yield* call(checkKey, deps, setupId, saved.profile);
}

function* runSecretRetry(
  deps: ProviderProfileSetupDeps,
  action: ReturnType<typeof providerProfileSecretRetryRequested>,
) {
  const { setupId, envRef } = action.payload;
  const env = takeEnv(envRef);
  const setup = (yield* selectProviderProfileSetups.effect())[setupId];
  if (!env || !setup?.profileId) return;
  yield* put(changed(setupId, { phase: 'checkingKey', failure: undefined }));
  const requestId = `${setupId}:retry:${deps.now()}`;
  yield* put(providerProfileUpdateRequested({ requestId, profileId: setup.profileId, env }));
  const saved = yield* call(awaitMutation, requestId);
  if (!saved.profile) {
    yield* put(changed(setupId, { phase: 'keyRejected' }));
    return;
  }
  yield* call(checkKey, deps, setupId, saved.profile);
}

function* runSignInRetry(
  deps: ProviderProfileSetupDeps,
  action: ReturnType<typeof providerProfileSignInRetryRequested>,
) {
  const [setupId] = action.payload;
  const setup = (yield* selectProviderProfileSetups.effect())[setupId];
  if (!setup?.profileId || !setup.folder) return;
  const profile = yield* selectProviderProfile.effect(setup.profileId);
  const provider: ProfileProvider | undefined =
    profile?.baseProviderId === 'claude-code'
      ? 'claude'
      : profile?.baseProviderId === 'codex'
        ? 'codex'
        : undefined;
  if (!profile || !provider) return;
  yield* call(signIn, deps, setupId, provider, profile, setup.folder);
}

const setupIdOf = (action: Action): string | undefined => {
  if (action.type === providerProfileFolderSetupRequested.type)
    return (action as ReturnType<typeof providerProfileFolderSetupRequested>).payload[0].setupId;
  if (action.type === providerProfileSignInRetryRequested.type)
    return (action as ReturnType<typeof providerProfileSignInRetryRequested>).payload[0];
  return (
    action as
      | ReturnType<typeof providerProfileSecretSetupRequested>
      | ReturnType<typeof providerProfileSecretRetryRequested>
  ).payload.setupId;
};

function* awaitDismissal(setupId: string | undefined) {
  while (true) {
    const dismissed = yield* take(providerProfileSetupDismissed);
    if (dismissed.payload[0] === setupId) return;
  }
}

/** Run one setup step until it ends or the dialog dismisses the setup. */
function cancellable<A extends Action>(
  worker: (deps: ProviderProfileSetupDeps, action: A) => Generator,
  deps: ProviderProfileSetupDeps,
) {
  return function* (action: A) {
    const setupId = setupIdOf(action);
    yield* race({
      done: call(worker, deps, action),
      dismissed: call(awaitDismissal, setupId),
    });
  };
}

export function* providerProfileSetupSaga(
  deps: ProviderProfileSetupDeps = defaultProviderProfileSetupDeps,
) {
  yield* all([
    takeEvery(providerProfileFolderSetupRequested, cancellable(runFolderSetup, deps)),
    takeEvery(providerProfileSecretSetupRequested, cancellable(runSecretSetup, deps)),
    takeEvery(providerProfileSecretRetryRequested, cancellable(runSecretRetry, deps)),
    takeEvery(providerProfileSignInRetryRequested, cancellable(runSignInRetry, deps)),
  ]);
}
