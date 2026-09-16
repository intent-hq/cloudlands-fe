import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  fork,
  join,
  put,
  race,
  select,
  take,
  takeEvery,
  takeLatest,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { invoke } from '$shared/generated/ipc-client';
import { SHELL_CHANNELS, SYSTEM_CHANNELS, WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { deserializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import { takeLatestInContext } from '$store/renderer/utils/context-saga-effects';
import {
  LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
  LEGACY_PROMPT_SESSION_KEY,
  NEW_WORKSPACE_DRAFT_AGENT_ID,
  NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
} from '$lib/components/workspace/initializer/new-workspace-draft';
import { createLogger } from '$lib/utils/client-logger';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';
import { getProviderAvailability } from '$features/providers/provider-availability.client';
import { runProviderTestPrompt } from '$features/providers/provider-test-prompt.client';
import { enhancePrompt } from '$lib/client/live/live-prompt-enhancement';
import { resolveOnboardingModel } from '$features/onboarding/utils/resolve-onboarding-model';
import { resetOnboarding } from '$store/renderer/slices/onboarding/onboarding-slice';
import {
  authCancelled,
  authCompleted,
  initializeGitHubAuth,
  setGitHubAuthError,
  startGitHubAuth,
} from '$store/renderer/slices/github-auth/github-auth-slice';
import {
  getLocalStorageItem,
  getLocalStorageJSON,
} from '$store/renderer/utils/safe-local-storage-saga';
import {
  selectCompactWorkspaceInitializerFormState,
  selectWorkspaceInitializerBranchByRepo,
  selectWorkspaceInitializerDefaultParentPath,
  selectWorkspaceInitializerLastSelectedRepo,
  selectWorkspaceInitializerLastSubmittedAgent,
  selectWorkspaceInitializerOnboardingFormState,
  selectWorkspaceInitializerRecentRepos,
  selectWorkspaceInitializerRemoteSetups,
} from '../workspace-initializer-selectors';
import {
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  debounceWorkspaceInitializerOnboardingFormState,
  clearNewWorkspaceDraftRequested,
  flushNewWorkspaceDraftRequested,
  generateWorkspaceSetupScriptRequested,
  hydrateWorkspaceInitializer,
  listGitHubBranchesCachedRequested,
  listGitHubBranchesRequested,
  loadWorkspaceInitializerGitHubBranches,
  searchWorkspaceInitializerGitHubBranches,
  setGitHubBranchListing,
  setGitHubBranchListingError,
  setGitHubBranchListingLoading,
  listInitializerSpecialistPreviewsRequested,
  readWorkspaceInitializerPrefillRequested,
  createWorkspaceFromInitializerRequested,
  setInitialAgentReasoningEffortRequested,
  connectGitHubForInitializerRequested,
  readWorkspaceInitializerDirectoryStatusRequested,
  readWorkspaceInitializerPullRequestRequested,
  readWorkspaceInitializerGitRemoteRequested,
  readWorkspaceInitializerGitAvailabilityRequested,
  addWorkspaceInitializerRecentRepositoryRequested,
  openWorkspaceInitializerExternalUrlRequested,
  readWorkspaceInitializerProviderAvailabilityRequested,
  runWorkspaceInitializerProviderTestRequested,
  enhanceWorkspaceInitializerPromptRequested,
  resolveWorkspaceInitializerModelRequested,
  pullWorkspaceInitializerRepositoryRequested,
  removeWorkspaceInitializerRemoteSetup,
  restoreNewWorkspaceDraftRequested,
  saveNewWorkspaceDraftRequested,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerLastSubmittedAgent,
  setWorkspaceInitializerOnboardingFormState,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
} from '../workspace-initializer-slice';
import type { WorkspaceInitializerPrefill } from '../workspace-initializer-types';
import type {
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
} from '../workspace-initializer-types';

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
const ONBOARDING_PROMPT_SESSION_KEY = 'onboarding-prompt';
const ONBOARDING_FORM_STATE_DEBOUNCE_MS = 300;
const NEW_WORKSPACE_DRAFT_DEBOUNCE_MS = 300;
const BRANCH_LOAD_DEBOUNCE_MS = 150;
const BRANCH_SEARCH_DEBOUNCE_MS = 100;
const BRANCH_CACHE_DURATION_MS = 5 * 60 * 1000;
const githubBranchLoadCache = new Map<
  string,
  { branches: string[]; defaultBranch: string; timestamp: number }
>();

type HydrationGate = { settled: boolean; queued: boolean };
type DraftPersistenceContext = {
  restoreFailed: boolean;
  pending: ReturnType<typeof saveNewWorkspaceDraftRequested> | null;
};

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

let warnedNonCloneableBag = false;

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

function* buildWorkspaceInitializerBag() {
  const compactFormState = yield* selectCompactWorkspaceInitializerFormState.effect();
  const onboardingFormState = yield* selectWorkspaceInitializerOnboardingFormState.effect();
  const lastSelectedRepo = yield* selectWorkspaceInitializerLastSelectedRepo.effect();
  const branchByRepo = yield* selectWorkspaceInitializerBranchByRepo.effect();
  const defaultParentPath = yield* selectWorkspaceInitializerDefaultParentPath.effect();
  const recentRepos = yield* selectWorkspaceInitializerRecentRepos.effect();
  const remoteSetups = yield* selectWorkspaceInitializerRemoteSetups.effect();
  const lastSubmittedAgent = yield* selectWorkspaceInitializerLastSubmittedAgent.effect();
  return {
    compactFormState,
    onboardingFormState,
    lastSelectedRepo,
    branchByRepo,
    defaultParentPath,
    recentRepos,
    remoteSetups,
    lastSubmittedAgent,
  } satisfies WorkspaceInitializerHydrationState;
}

export function* persistWorkspaceInitializerWorker() {
  const bag = cloneableBag(yield* call(buildWorkspaceInitializerBag));
  if (bag === null) return;
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: SETTINGS_PATH, value: bag }],
    );
  } catch (error) {
    logger.error(`Failed to persist ${SETTINGS_PATH}`, { error });
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

export function* hydrateWorkspaceInitializerWorker() {
  try {
    const setting = yield* call([appClient.settings, appClient.settings.get], SETTINGS_PATH);
    if (setting === null) throw new Error(`settings.get(${SETTINGS_PATH}) returned null`);
    const daemonBag = isRecord(setting.value) ? setting.value : {};
    if (Object.keys(daemonBag).length === 0) {
      const migratedBag = yield* call(readLegacyBag);
      yield* put(hydrateWorkspaceInitializer(migratedBag));
      try {
        yield* call(
          [appClient.settings, appClient.settings.update],
          [{ path: SETTINGS_PATH, value: migratedBag }],
        );
      } catch (error) {
        logger.error('Failed to write migrated bag to daemon', { error });
      }
      return true;
    }

    const hydrationState: WorkspaceInitializerHydrationState = {
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
      remoteSetups: objectArray<WorkspaceInitializerRemoteSetup>(daemonBag.remoteSetups),
      lastSubmittedAgent: isRecord(daemonBag.lastSubmittedAgent)
        ? (daemonBag.lastSubmittedAgent as WorkspaceInitializerAgentSettings)
        : null,
    };
    yield* put(hydrateWorkspaceInitializer(hydrationState));
    return true;
  } catch (error) {
    logger.error('Hydration failed; dispatching defaults so UI is not blocked', { error });
    yield* put(
      hydrateWorkspaceInitializer({
        compactFormState: null,
        onboardingFormState: null,
        lastSelectedRepo: null,
      }),
    );
    return false;
  }
}

function removeOnboardingPrompt(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(ONBOARDING_PROMPT_SESSION_KEY);
    }
  } catch {
    // Reset remains non-fatal when session storage is unavailable.
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

function removeSessionItem(key: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
  } catch {
    // Session storage is an optional migration source.
  }
}

function readAndRemoveSessionItem(key: string): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const value = sessionStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function readSessionItem(key: string): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function readWorkspacePrefill(consume: boolean): WorkspaceInitializerPrefill | null {
  const raw = readSessionItem('workspace-prefill');
  if (!raw) return null;
  if (consume) removeSessionItem('workspace-prefill');
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? (value as WorkspaceInitializerPrefill) : null;
  } catch {
    if (!consume) removeSessionItem('workspace-prefill');
    return null;
  }
}

function* readWorkspacePrefillWorker(
  action: ReturnType<typeof readWorkspaceInitializerPrefillRequested>,
) {
  action.promise.catch(() => {});
  try {
    let prefill = yield* call(readWorkspacePrefill, action.payload[0]);
    if (prefill?.githubUrl && !prefill.repoPath) {
      const parsed = parseGitHubUrl(prefill.githubUrl);
      const recent = (yield* call(invoke, 'workspace:get-recent-repositories', {})) as {
        success: boolean;
        data?: Array<{ path: string; name: string; owner?: string }>;
      };
      if (parsed && recent.success && Array.isArray(recent.data)) {
        const match = recent.data.find(
          (repo) =>
            repo.owner?.toLowerCase() === parsed.owner.toLowerCase() &&
            repo.name.toLowerCase() === parsed.repo.toLowerCase(),
        );
        if (match?.path) prefill = { ...prefill, repoPath: match.path };
      }
    }
    yield* put(action.success(prefill));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* restoreNewWorkspaceDraftWorker(
  context: DraftPersistenceContext,
  action: ReturnType<typeof restoreNewWorkspaceDraftRequested>,
) {
  action.promise.catch(() => {});
  const legacyKey =
    action.payload[0] === 'onboarding'
      ? LEGACY_ONBOARDING_PROMPT_SESSION_KEY
      : LEGACY_PROMPT_SESSION_KEY;
  const legacyPrompt = yield* call(readSessionItem, legacyKey);
  try {
    const draft = yield* call(
      [appClient.drafts, appClient.drafts.get],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
    );
    context.restoreFailed = false;
    if (draft) {
      yield* call(removeSessionItem, legacyKey);
      yield* put(
        action.success({
          status: 'restored',
          text: draft.text ?? '',
          contextItems: draft.attachments?.length
            ? deserializeDraftAttachments(draft.attachments)
            : [],
        }),
      );
      return;
    }
    yield* call(readAndRemoveSessionItem, legacyKey);
    if (legacyPrompt) {
      try {
        yield* call(
          [appClient.drafts, appClient.drafts.set],
          NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
          NEW_WORKSPACE_DRAFT_AGENT_ID,
          legacyPrompt,
          undefined,
        );
      } catch (error) {
        logger.warn('New workspace legacy draft migration failed', { error });
      }
      yield* put(action.success({ status: 'restored', text: legacyPrompt, contextItems: [] }));
    } else {
      yield* put(action.success({ status: 'empty' }));
    }
  } catch (error) {
    context.restoreFailed = true;
    logger.warn('New workspace draft restore failed', { error });
    yield* put(action.success({ status: 'error' }));
  }
}

export function* persistNewWorkspaceDraftWorker(
  context: DraftPersistenceContext,
  action: ReturnType<typeof saveNewWorkspaceDraftRequested>,
) {
  const [text, attachments] = action.payload;
  if (context.restoreFailed && !text && attachments.length === 0) return;
  try {
    yield* call(
      [appClient.drafts, appClient.drafts.set],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
      text,
      attachments.length ? attachments : undefined,
    );
  } catch (error) {
    logger.warn('New workspace draft save failed', { error });
  }
}

export function* clearNewWorkspaceDraftWorker() {
  yield* call(removeSessionItem, LEGACY_PROMPT_SESSION_KEY);
  yield* call(removeSessionItem, LEGACY_ONBOARDING_PROMPT_SESSION_KEY);
  try {
    yield* call(
      [appClient.drafts, appClient.drafts.clear],
      NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
      NEW_WORKSPACE_DRAFT_AGENT_ID,
    );
  } catch (error) {
    logger.warn('New workspace draft clear failed', { error });
  }
}

function* saveNewWorkspaceDraftDebouncedWorker(
  context: DraftPersistenceContext,
  action: ReturnType<typeof saveNewWorkspaceDraftRequested>,
) {
  context.pending = action;
  yield* delay(NEW_WORKSPACE_DRAFT_DEBOUNCE_MS);
  if (context.pending !== action) return;
  context.pending = null;
  yield* call(persistNewWorkspaceDraftWorker, context, action);
}

function* flushNewWorkspaceDraftWorker(context: DraftPersistenceContext) {
  const pending = context.pending;
  context.pending = null;
  if (pending) yield* call(persistNewWorkspaceDraftWorker, context, pending);
}

function* clearNewWorkspaceDraftRequestWorker(context: DraftPersistenceContext) {
  context.pending = null;
  yield* call(clearNewWorkspaceDraftWorker);
}

export function* generateWorkspaceSetupScriptWorker(
  action: ReturnType<typeof generateWorkspaceSetupScriptRequested>,
) {
  action.promise.catch(() => {});
  try {
    const result = yield* call(
      [appClient.setupScripts, appClient.setupScripts.generate],
      action.payload[0],
    );
    yield* put(action.success(result));
  } catch (error) {
    action.promise.catch(() => {});
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* listInitializerSpecialistPreviewsWorker(
  action: ReturnType<typeof listInitializerSpecialistPreviewsRequested>,
) {
  action.promise.catch(() => {});
  try {
    yield* put(
      action.success(
        yield* call([appClient.specialists, appClient.specialists.list], action.payload[0]),
      ),
    );
  } catch (error) {
    action.promise.catch(() => {});
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* listGitHubBranchesCachedWorker(
  action: ReturnType<typeof listGitHubBranchesCachedRequested>,
) {
  try {
    const [owner, repo] = action.payload;
    yield* put(setGitHubBranchListingLoading(owner, repo, 'cached'));
    const result = yield* call(
      [appClient.integrations, appClient.integrations.githubBranchesCached],
      owner,
      repo,
    );
    yield* put(
      setGitHubBranchListing(
        owner,
        repo,
        'cached',
        result.branches,
        result.defaultBranch ?? '',
        result.source,
      ),
    );
    yield* put(action.success(result));
  } catch (error) {
    const [owner, repo] = action.payload;
    yield* put(setGitHubBranchListingError(owner, repo, 'cached', String(error)));
    action.promise.catch(() => {});
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* listGitHubBranchesWorker(action: ReturnType<typeof listGitHubBranchesRequested>) {
  try {
    const [owner, repo, prefix] = action.payload;
    const key = prefix ?? '';
    yield* put(setGitHubBranchListingLoading(owner, repo, key));
    const result = yield* prefix
      ? call([appClient.integrations, appClient.integrations.githubBranches], owner, repo, prefix)
      : call([appClient.integrations, appClient.integrations.githubBranches], owner, repo);
    yield* put(
      setGitHubBranchListing(owner, repo, key, result.branches, result.defaultBranch ?? ''),
    );
    yield* put(action.success(result));
  } catch (error) {
    const [owner, repo, prefix] = action.payload;
    yield* put(setGitHubBranchListingError(owner, repo, prefix ?? '', String(error)));
    action.promise.catch(() => {});
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* loadCachedGitHubBranchesWorker(owner: string, repo: string) {
  try {
    const result = yield* call(
      [appClient.integrations, appClient.integrations.githubBranchesCached],
      owner,
      repo,
    );
    yield* put(
      setGitHubBranchListing(
        owner,
        repo,
        'cached',
        result.branches,
        result.defaultBranch ?? '',
        result.source,
      ),
    );
  } catch (error) {
    yield* put(setGitHubBranchListingError(owner, repo, 'cached', String(error)));
  }
}

function* loadWorkspaceInitializerGitHubBranchesWorker(
  action: ReturnType<typeof loadWorkspaceInitializerGitHubBranches>,
) {
  const [owner, repo, forceRefresh, cacheEnabled, networkDelayMs] = action.payload;
  yield* delay(BRANCH_LOAD_DEBOUNCE_MS);
  if (networkDelayMs && networkDelayMs > 0) yield* delay(networkDelayMs);

  const cacheKey = JSON.stringify([owner, repo]);
  if (forceRefresh) githubBranchLoadCache.delete(cacheKey);
  const cached = githubBranchLoadCache.get(cacheKey);
  if (
    cacheEnabled &&
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < BRANCH_CACHE_DURATION_MS
  ) {
    yield* put(setGitHubBranchListing(owner, repo, 'cached', [], ''));
    yield* put(setGitHubBranchListing(owner, repo, '', cached.branches, cached.defaultBranch));
    return;
  }

  yield* fork(loadCachedGitHubBranchesWorker, owner, repo);
  try {
    const result = yield* call(
      [appClient.integrations, appClient.integrations.githubBranches],
      owner,
      repo,
    );
    const defaultBranch = result.defaultBranch ?? '';
    if (cacheEnabled) {
      githubBranchLoadCache.set(cacheKey, {
        branches: result.branches,
        defaultBranch,
        timestamp: Date.now(),
      });
    }
    yield* put(setGitHubBranchListing(owner, repo, '', result.branches, defaultBranch));
  } catch (error) {
    yield* put(setGitHubBranchListingError(owner, repo, '', String(error)));
  }
}

function* searchWorkspaceInitializerGitHubBranchesWorker(
  action: ReturnType<typeof searchWorkspaceInitializerGitHubBranches>,
) {
  const [owner, repo, prefix] = action.payload;
  if (!prefix) return;
  yield* delay(BRANCH_SEARCH_DEBOUNCE_MS);
  try {
    const result = yield* call(
      [appClient.integrations, appClient.integrations.githubBranches],
      owner,
      repo,
      prefix,
    );
    yield* put(
      setGitHubBranchListing(owner, repo, prefix, result.branches, result.defaultBranch ?? ''),
    );
  } catch (error) {
    yield* put(setGitHubBranchListingError(owner, repo, prefix, String(error)));
  }
}

function* createWorkspaceFromInitializerWorker(
  action: ReturnType<typeof createWorkspaceFromInitializerRequested>,
) {
  action.promise.catch(() => {});
  try {
    yield* put(
      action.success(yield* call([workspaceClient, workspaceClient.create], action.payload[0])),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* setInitialAgentReasoningEffortWorker(
  action: ReturnType<typeof setInitialAgentReasoningEffortRequested>,
) {
  action.promise.catch(() => {});
  try {
    const [agentId, workspaceId, reasoningEffort] = action.payload;
    const result = yield* call([appClient.agents, appClient.agents.setReasoningEffort], {
      agentId,
      workspaceId,
      reasoningEffort,
    });
    if (!result.success) throw new Error(result.error || 'Failed to set reasoning effort');
    yield* put(action.success(undefined));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* connectGitHubForInitializerWorker(
  action: ReturnType<typeof connectGitHubForInitializerRequested>,
) {
  try {
    yield* put(initializeGitHubAuth());
    yield* put(startGitHubAuth());
    const outcome = yield* race({
      completed: take(authCompleted),
      failed: take(setGitHubAuthError),
      cancelled: take(authCancelled),
      timeout: delay(5 * 60 * 1000),
    });
    if (outcome.completed) {
      yield* put(action.success(undefined));
    } else if (outcome.failed) {
      throw new Error(outcome.failed.payload[0] || 'GitHub authentication failed');
    } else if (outcome.cancelled) {
      throw new Error('GitHub authentication cancelled');
    } else {
      throw new Error('GitHub authentication timed out');
    }
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* readWorkspaceInitializerDirectoryStatusWorker(
  action: ReturnType<typeof readWorkspaceInitializerDirectoryStatusRequested>,
) {
  action.promise.catch(() => {});
  try {
    yield* delay(300);
    const result = (yield* call(invoke, 'file:getDirectoryStatus', {
      path: action.payload[0],
    })) as {
      success: boolean;
      data?: {
        exists: boolean;
        isDirectory: boolean;
        isEmpty: boolean;
        isGitRepo: boolean;
      };
    };
    yield* put(action.success(result.success && result.data ? result.data : null));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* readWorkspaceInitializerPullRequestWorker(
  action: ReturnType<typeof readWorkspaceInitializerPullRequestRequested>,
) {
  action.promise.catch(() => {});
  try {
    const [owner, repo, number] = action.payload;
    const result = (yield* call(invoke, 'git-tracking:get-pull-request', {
      owner,
      repo,
      number,
    })) as { success: boolean; data?: { sourceBranch?: string; targetBranch?: string } };
    yield* put(
      action.success(
        result.success && result.data?.sourceBranch
          ? { sourceBranch: result.data.sourceBranch, targetBranch: result.data.targetBranch }
          : null,
      ),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* readWorkspaceInitializerGitRemoteWorker(
  action: ReturnType<typeof readWorkspaceInitializerGitRemoteRequested>,
) {
  action.promise.catch(() => {});
  try {
    const result = (yield* call(invoke, 'git-tracking:get-remote-url', {
      repoPath: action.payload[0],
    })) as { success: boolean; data?: { owner?: string; repo?: string } };
    yield* put(
      action.success(
        result.success && result.data?.owner && result.data.repo
          ? { owner: result.data.owner, repo: result.data.repo }
          : null,
      ),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* readWorkspaceInitializerGitAvailabilityWorker(
  action: ReturnType<typeof readWorkspaceInitializerGitAvailabilityRequested>,
) {
  action.promise.catch(() => {});
  try {
    const result = (yield* call(invoke, SYSTEM_CHANNELS.CHECK_GIT)) as {
      success: boolean;
      data?: { available: boolean | 'unknown'; version?: string };
    };
    yield* put(action.success(result.success && result.data ? result.data : null));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* readWorkspaceInitializerProviderAvailabilityWorker(
  action: ReturnType<typeof readWorkspaceInitializerProviderAvailabilityRequested>,
) {
  action.promise.catch(() => {});
  try {
    yield* put(action.success(yield* call(getProviderAvailability)));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* runWorkspaceInitializerProviderTestWorker(
  action: ReturnType<typeof runWorkspaceInitializerProviderTestRequested>,
) {
  action.promise.catch(() => {});
  try {
    const [, providerId, model] = action.payload;
    yield* put(
      action.success(
        yield* call(runProviderTestPrompt, { providerId, ...(model ? { model } : {}) }),
      ),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* enhanceWorkspaceInitializerPromptWorker(
  action: ReturnType<typeof enhanceWorkspaceInitializerPromptRequested>,
) {
  action.promise.catch(() => {});
  try {
    yield* put(action.success(yield* call(enhancePrompt, action.payload[1])));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* resolveWorkspaceInitializerModelWorker(
  action: ReturnType<typeof resolveWorkspaceInitializerModelRequested>,
) {
  action.promise.catch(() => {});
  try {
    const state = yield* select();
    const [, model, provider] = action.payload;
    yield* put(
      action.success(
        yield* call(
          resolveOnboardingModel,
          state,
          model ? { model, ...(provider ? { provider } : {}) } : undefined,
        ),
      ),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* pullWorkspaceInitializerRepositoryWorker(
  action: ReturnType<typeof pullWorkspaceInitializerRepositoryRequested>,
) {
  action.promise.catch(() => {});
  try {
    const [, repoPath, branchName] = action.payload;
    yield* put(
      action.success(yield* call([appClient.git, appClient.git.pull], repoPath, branchName)),
    );
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* addWorkspaceInitializerRecentRepositoryWorker(
  action: ReturnType<typeof addWorkspaceInitializerRecentRepositoryRequested>,
) {
  try {
    yield* call(invoke, WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY, action.payload[0]);
    yield* put(action.success(undefined));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* openWorkspaceInitializerExternalUrlWorker(
  action: ReturnType<typeof openWorkspaceInitializerExternalUrlRequested>,
) {
  try {
    yield* call(invoke, SHELL_CHANNELS.OPEN_EXTERNAL, { url: action.payload[0] });
    yield* put(action.success(undefined));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* watchWorkspaceInitializerPersistence(gate: HydrationGate) {
  const channel = yield* actionChannel(
    [
      setCompactWorkspaceInitializerFormState,
      setWorkspaceInitializerOnboardingFormState,
      setWorkspaceInitializerLastSelectedRepo,
      setWorkspaceInitializerBranchForRepo,
      setWorkspaceInitializerDefaultParentPath,
      setWorkspaceInitializerRecentRepos,
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

/** Unregistered until the S20 middleware cutover. */
export function* workspaceInitializerSaga() {
  const gate: HydrationGate = { settled: false, queued: false };
  const draftContext: DraftPersistenceContext = { restoreFailed: true, pending: null };
  const persistenceTask = yield* fork(watchWorkspaceInitializerPersistence, gate);
  yield* fork(watchDebouncedOnboardingForm);
  yield* fork(watchOnboardingReset);
  yield* takeLatest(
    saveNewWorkspaceDraftRequested,
    saveNewWorkspaceDraftDebouncedWorker,
    draftContext,
  );
  yield* takeEvery(flushNewWorkspaceDraftRequested, flushNewWorkspaceDraftWorker, draftContext);
  yield* takeEvery(
    clearNewWorkspaceDraftRequested,
    clearNewWorkspaceDraftRequestWorker,
    draftContext,
  );
  yield* takeEvery(restoreNewWorkspaceDraftRequested, restoreNewWorkspaceDraftWorker, draftContext);
  yield* takeEvery(generateWorkspaceSetupScriptRequested, generateWorkspaceSetupScriptWorker);
  yield* takeEvery(
    listInitializerSpecialistPreviewsRequested,
    listInitializerSpecialistPreviewsWorker,
  );
  yield* takeEvery(listGitHubBranchesCachedRequested, listGitHubBranchesCachedWorker);
  yield* takeEvery(listGitHubBranchesRequested, listGitHubBranchesWorker);
  yield* takeLatestInContext(
    loadWorkspaceInitializerGitHubBranches,
    (action) => JSON.stringify(action.payload.slice(0, 2)),
    loadWorkspaceInitializerGitHubBranchesWorker,
  );
  yield* takeLatestInContext(
    searchWorkspaceInitializerGitHubBranches,
    (action) => JSON.stringify(action.payload.slice(0, 2)),
    searchWorkspaceInitializerGitHubBranchesWorker,
  );
  yield* takeEvery(readWorkspaceInitializerPrefillRequested, readWorkspacePrefillWorker);
  yield* takeEvery(createWorkspaceFromInitializerRequested, createWorkspaceFromInitializerWorker);
  yield* takeEvery(setInitialAgentReasoningEffortRequested, setInitialAgentReasoningEffortWorker);
  yield* takeEvery(connectGitHubForInitializerRequested, connectGitHubForInitializerWorker);
  yield* takeLatest(
    readWorkspaceInitializerDirectoryStatusRequested,
    readWorkspaceInitializerDirectoryStatusWorker,
  );
  yield* takeEvery(
    readWorkspaceInitializerPullRequestRequested,
    readWorkspaceInitializerPullRequestWorker,
  );
  yield* takeEvery(
    readWorkspaceInitializerGitRemoteRequested,
    readWorkspaceInitializerGitRemoteWorker,
  );
  yield* takeEvery(
    readWorkspaceInitializerGitAvailabilityRequested,
    readWorkspaceInitializerGitAvailabilityWorker,
  );
  yield* takeEvery(
    addWorkspaceInitializerRecentRepositoryRequested,
    addWorkspaceInitializerRecentRepositoryWorker,
  );
  yield* takeEvery(
    openWorkspaceInitializerExternalUrlRequested,
    openWorkspaceInitializerExternalUrlWorker,
  );
  yield* takeEvery(
    readWorkspaceInitializerProviderAvailabilityRequested,
    readWorkspaceInitializerProviderAvailabilityWorker,
  );
  yield* takeEvery(
    runWorkspaceInitializerProviderTestRequested,
    runWorkspaceInitializerProviderTestWorker,
  );
  yield* takeEvery(
    enhanceWorkspaceInitializerPromptRequested,
    enhanceWorkspaceInitializerPromptWorker,
  );
  yield* takeEvery(
    resolveWorkspaceInitializerModelRequested,
    resolveWorkspaceInitializerModelWorker,
  );
  yield* takeEvery(
    pullWorkspaceInitializerRepositoryRequested,
    pullWorkspaceInitializerRepositoryWorker,
  );

  const hydrated = yield* call(hydrateWorkspaceInitializerWorker);
  gate.settled = true;
  if (gate.queued && hydrated) yield* call(persistWorkspaceInitializerWorker);
  gate.queued = false;

  yield* join(persistenceTask);
}
