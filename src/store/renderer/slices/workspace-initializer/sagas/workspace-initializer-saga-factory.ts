import {
  takeLatestFromSelector,
  type SelectorChannelPayload,
  type SelectorChannelSelector,
} from '@themislib/themis/saga';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  takeLeading,
  takeLatest,
} from 'typed-redux-saga';

import type { SettingsClient } from '$lib/client/settings-types';
import type { SagaGenerator } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { resetOnboarding } from '../../onboarding/onboarding-slice';
import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
  hydrateWorkspaceInitializer,
  dismissWorkspaceInitializerRecentRepo,
  removeWorkspaceInitializerRemoteSetup,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
  setWorkspaceLocalCreation,
  workspaceLocalCreationReloadRequested,
} from '../workspace-initializer-slice';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
  WorkspaceLocalCreation,
} from '../workspace-initializer-types';

import { readWorkspaceLocalCreation } from '../utils/local-creation-intent';

const logger = createLogger('WorkspaceInitializerSaga');
const SETTINGS_PATH = 'workspaceInitializer.state';
const COMPACT_FORM_STATE_KEY = 'compact-workspace-initializer-state';
const ONBOARDING_FORM_STATE_KEY = 'onboarding-form-state';
const LAST_SELECTED_REPO_KEY = 'workspace-initializer-last-repo';
const BRANCH_BY_REPO_KEY = 'workspace-initializer-branch-by-repo';
const DEFAULT_PARENT_PATH_KEY = 'workspace-initializer-default-parent';
const RECENT_REPOS_KEY = 'workspace-initializer-recent-repos';
const REMOTE_SETUPS_KEY = 'remote-setups';
const LAST_SUBMITTED_AGENT_KEY = 'workspace-initializer-last-agent';
const ONBOARDING_FORM_STATE_DEBOUNCE_MS = 300;

type HydrationGate = { settled: boolean; queued: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function objectArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : undefined;
}

function nonEmptyRecord<T>(value: unknown): T | null {
  return isRecord(value) && Object.keys(value).length > 0 ? (value as T) : null;
}

/**
 * Strip legacy setup-script fields from a persisted form-state record. The
 * setup script is session-local now (last-used per repo lives in
 * localStorage, `$features/setup-scripts/last-used`), so previously persisted
 * script fields must not rehydrate into Redux.
 */
function stripLegacyScriptFields<T>(record: T | null): T | null {
  if (!isRecord(record)) return record;
  const {
    setupScript: _setupScript,
    setupScriptName: _setupScriptName,
    isCustomSetupScript: _isCustomSetupScript,
    showSetupScript: _showSetupScript,
    ...rest
  } = record;
  return rest as T;
}

/** Shared draft owner; each app binds its own selectors and runtime dependencies. */
export function createWorkspaceInitializerSaga<State>({
  settingsClient,
  selectCanAdministerHost,
  selectHostAdministrationContext,
  selectWorkspaceInitializerPersistedState,
  workspaceInitializerGitSaga,
  getLocalStorageJSON,
  getLocalStorageItem,
  removeOnboardingPrompt,
  localCreation,
}: {
  settingsClient: Pick<SettingsClient, 'get' | 'update'>;
  selectCanAdministerHost: SelectorChannelSelector<boolean, [], State>;
  selectHostAdministrationContext: SelectorChannelSelector<string | null, [], State>;
  selectWorkspaceInitializerPersistedState: SelectorChannelSelector<
    WorkspaceInitializerHydrationState,
    [],
    State
  >;
  workspaceInitializerGitSaga: () => SagaGenerator<void>;
  getLocalStorageJSON: <T>(key: string) => SagaGenerator<T | undefined>;
  getLocalStorageItem: (key: string) => SagaGenerator<string | null>;
  removeOnboardingPrompt: () => void;
  /** Opt in to retaining the request receipt alongside the canonical draft. */
  localCreation?: {
    select: SelectorChannelSelector<WorkspaceLocalCreation | null, [], State>;
    selectReceiptContext: SelectorChannelSelector<string | null, [], State>;
  };
}) {
  let warnedNonCloneableBag = false;
  type WriteLock = { channel: Channel<boolean>; users: number };
  let activeWriteLock: WriteLock | null = null;

  function retainWriteLock(): WriteLock {
    if (!activeWriteLock) {
      activeWriteLock = { channel: channel<boolean>(buffers.fixed(1)), users: 0 };
      activeWriteLock.channel.put(true);
    }
    activeWriteLock.users++;
    return activeWriteLock;
  }

  // A stopped waiter releases its reference immediately. An accepted write
  // retains the channel until transport settlement, then the last user closes it.
  function releaseWriteLock(
    lock: WriteLock,
    acquired: boolean,
    pendingWrite: Promise<unknown> | undefined,
  ) {
    const release = () => {
      lock.users--;
      if (lock.users === 0) {
        if (activeWriteLock === lock) activeWriteLock = null;
        lock.channel.close();
      } else if (acquired) {
        lock.channel.put(true);
      }
    };
    if (pendingWrite) {
      void pendingWrite.then(release, release);
    } else {
      release();
    }
  }

  function cloneableBag(
    bag: WorkspaceInitializerHydrationState,
  ): WorkspaceInitializerHydrationState | null {
    try {
      structuredClone(bag);
      return bag;
    } catch (cloneError) {
      if (!warnedNonCloneableBag) {
        warnedNonCloneableBag = true;
        logger.warn(
          `Sanitized non-structured-cloneable ${SETTINGS_PATH} bag before persisting; ` +
            'a non-serializable value (e.g. a $state proxy) reached the store',
          { error: cloneError },
        );
      }
      try {
        return JSON.parse(JSON.stringify(bag)) as WorkspaceInitializerHydrationState;
      } catch (error) {
        logger.error(`Cannot sanitize ${SETTINGS_PATH} bag; skipping persist`, { error });
        return null;
      }
    }
  }

  function* persistWorkspaceInitializerWorker(): SagaGenerator<boolean> {
    const context = yield* selectHostAdministrationContext.effect();
    if (!context || !(yield* selectCanAdministerHost.effect())) return false;
    const lock = retainWriteLock();
    let acquired = false;
    let pendingWrite: Promise<unknown> | undefined;
    try {
      yield* take(lock.channel);
      acquired = true;
      if (
        context !== (yield* selectHostAdministrationContext.effect()) ||
        !(yield* selectCanAdministerHost.effect())
      )
        return false;
      // A failed settings read must never let draft edits overwrite an unread
      // idempotency receipt. Check after the lock, including direct callers.
      if (localCreation && context !== (yield* localCreation.selectReceiptContext.effect()))
        return false;
      const draft = yield* selectWorkspaceInitializerPersistedState.effect();
      const bag = cloneableBag(
        localCreation ? { ...draft, localCreation: yield* localCreation.select.effect() } : draft,
      );
      if (bag === null) return false;
      yield* call(() => {
        pendingWrite = settingsClient.update([{ path: SETTINGS_PATH, value: bag }]);
        return pendingWrite;
      });
      return (
        context === (yield* selectHostAdministrationContext.effect()) &&
        (yield* selectCanAdministerHost.effect())
      );
    } catch (error) {
      logger.error(`Failed to persist ${SETTINGS_PATH}`, { error });
      return false;
    } finally {
      releaseWriteLock(lock, acquired, pendingWrite);
    }
  }

  function* readLegacyBag() {
    const compactFormState = stripLegacyScriptFields(
      nonEmptyRecord<CompactWorkspaceInitializerFormState>(
        yield* getLocalStorageJSON<unknown>(COMPACT_FORM_STATE_KEY),
      ),
    );
    const onboardingFormState = stripLegacyScriptFields(
      nonEmptyRecord<WorkspaceInitializerOnboardingFormState>(
        yield* getLocalStorageJSON<unknown>(ONBOARDING_FORM_STATE_KEY),
      ),
    );
    const lastSelectedRepo = nonEmptyRecord<WorkspaceInitializerRepoSelection>(
      yield* getLocalStorageJSON<unknown>(LAST_SELECTED_REPO_KEY),
    );
    const branchByRepo = stringRecord(yield* getLocalStorageJSON<unknown>(BRANCH_BY_REPO_KEY));
    const defaultParentPath = yield* getLocalStorageItem(DEFAULT_PARENT_PATH_KEY);
    const recentRepos = objectArray<WorkspaceInitializerRecentRepo>(
      yield* getLocalStorageJSON<unknown>(RECENT_REPOS_KEY),
    );
    const remoteSetups = objectArray<WorkspaceInitializerRemoteSetup>(
      yield* getLocalStorageJSON<unknown>(REMOTE_SETUPS_KEY),
    );
    const lastSubmittedAgent = nonEmptyRecord<WorkspaceInitializerAgentSettings>(
      yield* getLocalStorageJSON<unknown>(LAST_SUBMITTED_AGENT_KEY),
    );
    return {
      ...(localCreation ? { localCreation: null } : {}),
      compactFormState,
      onboardingFormState,
      lastSelectedRepo,
      branchByRepo,
      defaultParentPath: defaultParentPath ?? undefined,
      recentRepos,
      remoteSetups,
      lastSubmittedAgent,
    } satisfies WorkspaceInitializerHydrationState;
  }

  function* hydrateWorkspaceInitializerWorker() {
    const context = yield* selectHostAdministrationContext.effect();
    if (!context || !(yield* selectCanAdministerHost.effect())) return false;
    const lock = retainWriteLock();
    let acquired = false;
    let pendingWrite: Promise<unknown> | undefined;
    try {
      yield* take(lock.channel);
      acquired = true;
      if (
        context !== (yield* selectHostAdministrationContext.effect()) ||
        !(yield* selectCanAdministerHost.effect())
      )
        return false;
      const setting = yield* call([settingsClient, settingsClient.get], SETTINGS_PATH);
      if (
        context !== (yield* selectHostAdministrationContext.effect()) ||
        !(yield* selectCanAdministerHost.effect())
      )
        return false;
      if (setting === null) throw new Error(`settings.get(${SETTINGS_PATH}) returned null`);
      const daemonBag = isRecord(setting.value) ? setting.value : {};
      if (Object.keys(daemonBag).length === 0) {
        const migratedBag = yield* call(readLegacyBag);
        yield* put(
          hydrateWorkspaceInitializer({
            ...migratedBag,
            ...(localCreation ? { localReceiptContext: context } : {}),
          }),
        );
        try {
          yield* call(() => {
            pendingWrite = settingsClient.update([{ path: SETTINGS_PATH, value: migratedBag }]);
            return pendingWrite;
          });
        } catch (error) {
          logger.error('Failed to write migrated bag to daemon', { error });
        }
        return true;
      }

      const hydrationState: WorkspaceInitializerHydrationState = {
        ...(localCreation ? { localReceiptContext: context } : {}),
        ...(localCreation
          ? { localCreation: readWorkspaceLocalCreation(daemonBag.localCreation) }
          : {}),
        compactFormState: isRecord(daemonBag.compactFormState)
          ? stripLegacyScriptFields(
              daemonBag.compactFormState as CompactWorkspaceInitializerFormState,
            )
          : null,
        onboardingFormState: isRecord(daemonBag.onboardingFormState)
          ? stripLegacyScriptFields(
              daemonBag.onboardingFormState as unknown as WorkspaceInitializerOnboardingFormState,
            )
          : null,
        lastSelectedRepo: isRecord(daemonBag.lastSelectedRepo)
          ? (daemonBag.lastSelectedRepo as unknown as WorkspaceInitializerRepoSelection)
          : null,
        branchByRepo: stringRecord(daemonBag.branchByRepo),
        defaultParentPath:
          typeof daemonBag.defaultParentPath === 'string' ? daemonBag.defaultParentPath : undefined,
        recentRepos: objectArray<WorkspaceInitializerRecentRepo>(daemonBag.recentRepos),
        dismissedRecentRepoKeys: isRecord(daemonBag.dismissedRecentRepoKeys)
          ? Object.fromEntries(
              Object.entries(daemonBag.dismissedRecentRepoKeys).filter(
                (entry): entry is [string, true] => entry[1] === true,
              ),
            )
          : undefined,
        remoteSetups: objectArray<WorkspaceInitializerRemoteSetup>(daemonBag.remoteSetups),
        lastSubmittedAgent: isRecord(daemonBag.lastSubmittedAgent)
          ? (daemonBag.lastSubmittedAgent as WorkspaceInitializerAgentSettings)
          : null,
      };
      yield* put(hydrateWorkspaceInitializer(hydrationState));
      return true;
    } catch (error) {
      if (
        context !== (yield* selectHostAdministrationContext.effect()) ||
        !(yield* selectCanAdministerHost.effect())
      )
        return false;
      logger.error('Hydration failed; dispatching defaults so UI is not blocked', { error });
      yield* put(
        hydrateWorkspaceInitializer({
          ...(localCreation ? { localReceiptContext: null } : {}),
          compactFormState: null,
          onboardingFormState: null,
          lastSelectedRepo: null,
        }),
      );
      return false;
    } finally {
      releaseWriteLock(lock, acquired, pendingWrite);
    }
  }

  function* applyDebouncedOnboardingFormWorker(
    action: ReturnType<typeof debounceWorkspaceInitializerOnboardingFormState>,
  ) {
    const result = yield* race({
      elapsed: delay(ONBOARDING_FORM_STATE_DEBOUNCE_MS),
      cancelled: take(cancelWorkspaceInitializerOnboardingFormStateDebounce),
      reset: take(resetOnboarding),
    });
    if (result.cancelled || result.reset) return;
    yield* put(setWorkspaceInitializerOnboardingFormState(action.payload[0]));
  }

  function* resetWorkspaceInitializerWorker() {
    yield* put(setWorkspaceInitializerOnboardingFormState(null));
    yield* call(removeOnboardingPrompt);
  }

  function* watchDebouncedOnboardingForm() {
    yield* takeLatest(
      debounceWorkspaceInitializerOnboardingFormState,
      applyDebouncedOnboardingFormWorker,
    );
  }

  function* watchOnboardingReset() {
    yield* takeEvery(resetOnboarding, resetWorkspaceInitializerWorker);
  }

  function* watchWorkspaceInitializerPersistence(gate: HydrationGate) {
    const channel = yield* actionChannel(
      [
        ...(localCreation ? [setWorkspaceLocalCreation] : []),
        setCompactWorkspaceInitializerFormState,
        setWorkspaceInitializerOnboardingFormState,
        setWorkspaceInitializerLastSelectedRepo,
        setWorkspaceInitializerBranchForRepo,
        setWorkspaceInitializerDefaultParentPath,
        setWorkspaceInitializerRecentRepos,
        dismissWorkspaceInitializerRecentRepo,
        setWorkspaceInitializerRemoteSetups,
        upsertWorkspaceInitializerRemoteSetup,
        removeWorkspaceInitializerRemoteSetup,
        setWorkspaceInitializerLastSubmittedAgent,
      ],
      buffers.sliding(1),
    );
    try {
      while (true) {
        yield* take(channel);
        if (!gate.settled) {
          gate.queued = true;
          continue;
        }
        yield* call(persistWorkspaceInitializerWorker);
      }
    } finally {
      channel.close();
    }
  }

  function* hydrateOwnerInitializer({ payload: context }: SelectorChannelPayload<string | null>) {
    if (!context) return;
    const gate: HydrationGate = { settled: false, queued: false };
    const persistenceTask = yield* fork(watchWorkspaceInitializerPersistence, gate);

    const hydrated = yield* call(hydrateWorkspaceInitializerWorker);
    // Keep the watcher gated until startup writes finish. Mutations during a save
    // request another latest-state snapshot, never a concurrent whole-bag update.
    while (gate.queued && hydrated) {
      gate.queued = false;
      yield* call(persistWorkspaceInitializerWorker);
    }
    gate.queued = false;
    gate.settled = true;

    yield* join(persistenceTask);
  }

  function* workspaceInitializerSaga() {
    yield* fork(workspaceInitializerGitSaga);
    if (localCreation)
      yield* takeLeading(workspaceLocalCreationReloadRequested, hydrateWorkspaceInitializerWorker);
    yield* fork(watchDebouncedOnboardingForm);
    yield* fork(watchOnboardingReset);
    yield* takeLatestFromSelector(selectHostAdministrationContext, hydrateOwnerInitializer);
  }

  return {
    workspaceInitializerSaga,
    hydrateWorkspaceInitializerWorker,
    persistWorkspaceInitializerWorker,
  };
}
