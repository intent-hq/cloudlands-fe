/**
 * Workspace-initializer persistence service — restores the localStorage-backed
 * hydration + persistence that the removed `workspace-initializer-saga` performed,
 * now promoted to daemon-owned BE persistence (§5.12 `workspaceInitializer.state`).
 *
 * The home-screen repository selector defaults to the last selected repository again,
 * with all workspace-initializer state (compact form, onboarding form, last repo,
 * branch overrides, recent repos, remote setups, last agent) backed by a daemon
 * setting instead of localStorage alone.
 *
 * Boot-time hydration reads `workspaceInitializer.state` from the daemon via
 * `appClient.settings.get` on first action and dispatches `hydrateWorkspaceInitializer`
 * so `state.hydrated` becomes true. Write-after-action persistence writes the updated
 * bag via `settings.update` after each mutating reducer runs. Persists that fire while
 * hydration is still in flight are deferred and flushed once hydration settles, so
 * pre-hydration default state (empty recentRepos, null lastSelectedRepo, …) can never
 * overwrite the previously persisted daemon bag. Debounce logic for
 * `debounceWorkspaceInitializerOnboardingFormState` mimics the deleted saga's race-based
 * cancellation (resetOnboarding / cancelDebounce kill the pending write).
 *
 * One-time migration: if the daemon bag is empty/absent and legacy localStorage keys
 * exist, seed the daemon from localStorage so pre-saga-removal user data is honored.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/types, and safeLocalStorage — no selectors
 * (importing them would evaluate `store.createSelector` mid store-init).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { safeLocalStorage } from "$lib/utils/safe-storage";
import { createLogger } from "$lib/utils/client-logger";
import {
  hydrateWorkspaceInitializer,
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerOnboardingFormState,
  debounceWorkspaceInitializerOnboardingFormState,
  cancelWorkspaceInitializerOnboardingFormStateDebounce,
  setWorkspaceInitializerLastSelectedRepo,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerDefaultParentPath,
  setWorkspaceInitializerRecentRepos,
  setWorkspaceInitializerRemoteSetups,
  upsertWorkspaceInitializerRemoteSetup,
  removeWorkspaceInitializerRemoteSetup,
  setWorkspaceInitializerLastSubmittedAgent,
} from "../slices/workspace-initializer/workspace-initializer-slice";
import { resetOnboarding } from "../slices/onboarding/onboarding-slice";
import type {
  WorkspaceInitializerHydrationState,
  WorkspaceInitializerOnboardingFormState,
  WorkspaceInitializerRecentRepo,
  WorkspaceInitializerRemoteSetup,
  WorkspaceInitializerRepoSelection,
  CompactWorkspaceInitializerFormState,
  WorkspaceInitializerAgentSettings,
} from "../slices/workspace-initializer/workspace-initializer-types";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

const logger = createLogger("WorkspaceInitializerPersistenceService");

// Settings path per PROTOCOL §5.12 and spec "Design decision" section
const SETTINGS_PATH = "workspaceInitializer.state";

// Legacy localStorage keys for one-time migration (match deleted saga exactly)
const COMPACT_FORM_STATE_KEY = "compact-workspace-initializer-state";
const ONBOARDING_FORM_STATE_KEY = "onboarding-form-state";
const LAST_SELECTED_REPO_KEY = "workspace-initializer-last-repo";
const BRANCH_BY_REPO_KEY = "workspace-initializer-branch-by-repo";
const DEFAULT_PARENT_PATH_KEY = "workspace-initializer-default-parent";
const RECENT_REPOS_KEY = "workspace-initializer-recent-repos";
const REMOTE_SETUPS_KEY = "remote-setups";
const LAST_SUBMITTED_AGENT_KEY = "workspace-initializer-last-agent";
const ONBOARDING_PROMPT_SESSION_KEY = "onboarding-prompt";

const ONBOARDING_FORM_STATE_DEBOUNCE_MS = 300;

// Tolerant parsing guards from deleted saga
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function objectArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : undefined;
}

/** Persist the current state bag to the daemon (fire-and-forget; failures only log). */
function persistStateBag(): void {
  const state = appStore.state.workspaceInitializer;
  const bag: WorkspaceInitializerHydrationState = {
    compactFormState: state.compactFormState,
    onboardingFormState: state.onboardingFormState,
    lastSelectedRepo: state.lastSelectedRepo,
    branchByRepo: state.branchByRepo,
    defaultParentPath: state.defaultParentPath,
    recentRepos: getItems(state.recentRepos),
    remoteSetups: getItems(state.remoteSetups),
    lastSubmittedAgent: state.lastSubmittedAgent,
  };
  void appClient.settings
    .update([{ path: SETTINGS_PATH, value: bag }])
    .catch((error) => logger.error(`Failed to persist ${SETTINGS_PATH}`, { error }));
}

/**
 * Type-safe read with guard: returns typed T when value is a non-empty record, null otherwise.
 * Used for migration reads from localStorage where empty objects should be treated as missing.
 */
function parseNonEmptyRecordOrNull<T>(value: unknown): T | null {
  return isRecord(value) && Object.keys(value).length > 0 ? (value as T) : null;
}

/** Boot-time hydration: read daemon setting, try localStorage migration, dispatch hydration. */
async function hydrateOnce(): Promise<void> {
  try {
    const setting = await appClient.settings.get(SETTINGS_PATH);
    const daemonBag = isRecord(setting?.value) ? setting.value : {};

    // If daemon bag is empty and legacy localStorage keys exist, migrate
    if (Object.keys(daemonBag).length === 0) {
      const compactFormState = parseNonEmptyRecordOrNull<CompactWorkspaceInitializerFormState>(
        safeLocalStorage.getJSON<CompactWorkspaceInitializerFormState>(COMPACT_FORM_STATE_KEY),
      );
      const onboardingFormState = parseNonEmptyRecordOrNull<WorkspaceInitializerOnboardingFormState>(
        safeLocalStorage.getJSON<WorkspaceInitializerOnboardingFormState>(ONBOARDING_FORM_STATE_KEY),
      );
      const lastSelectedRepo = parseNonEmptyRecordOrNull<WorkspaceInitializerRepoSelection>(
        safeLocalStorage.getJSON<WorkspaceInitializerRepoSelection>(LAST_SELECTED_REPO_KEY),
      );
      const branchByRepo = stringRecord(safeLocalStorage.getJSON(BRANCH_BY_REPO_KEY));
      const defaultParentPath = safeLocalStorage.getItem(DEFAULT_PARENT_PATH_KEY);
      const recentRepos = objectArray<WorkspaceInitializerRecentRepo>(
        safeLocalStorage.getJSON(RECENT_REPOS_KEY),
      );
      const remoteSetups = objectArray<WorkspaceInitializerRemoteSetup>(
        safeLocalStorage.getJSON(REMOTE_SETUPS_KEY),
      );
      const lastSubmittedAgent = parseNonEmptyRecordOrNull<WorkspaceInitializerAgentSettings>(
        safeLocalStorage.getJSON<WorkspaceInitializerAgentSettings>(LAST_SUBMITTED_AGENT_KEY),
      );

      const migratedBag: WorkspaceInitializerHydrationState = {
        compactFormState,
        onboardingFormState,
        lastSelectedRepo,
        branchByRepo,
        defaultParentPath: defaultParentPath ?? undefined,
        recentRepos,
        remoteSetups,
        lastSubmittedAgent,
      };

      appStore.dispatch(hydrateWorkspaceInitializer(migratedBag));

      // Write merged bag to daemon so future boots read from BE
      void appClient.settings
        .update([{ path: SETTINGS_PATH, value: migratedBag }])
        .catch((error) => logger.error("Failed to write migrated bag to daemon", { error }));
      return;
    }

    // Parse daemon bag with tolerant guards (settings.get returns value: unknown).
    // Don't filter empty objects here - the daemon bag already has well-formed data.
    const hydrationState: WorkspaceInitializerHydrationState = {
      compactFormState: isRecord(daemonBag.compactFormState)
        ? (daemonBag.compactFormState as unknown as CompactWorkspaceInitializerFormState)
        : null,
      onboardingFormState: isRecord(daemonBag.onboardingFormState)
        ? (daemonBag.onboardingFormState as unknown as WorkspaceInitializerOnboardingFormState)
        : null,
      lastSelectedRepo: isRecord(daemonBag.lastSelectedRepo)
        ? (daemonBag.lastSelectedRepo as unknown as WorkspaceInitializerRepoSelection)
        : null,
      branchByRepo: stringRecord(daemonBag.branchByRepo),
      defaultParentPath:
        typeof daemonBag.defaultParentPath === "string" ? daemonBag.defaultParentPath : undefined,
      recentRepos: objectArray<WorkspaceInitializerRecentRepo>(daemonBag.recentRepos),
      remoteSetups: objectArray<WorkspaceInitializerRemoteSetup>(daemonBag.remoteSetups),
      lastSubmittedAgent: isRecord(daemonBag.lastSubmittedAgent)
        ? (daemonBag.lastSubmittedAgent as unknown as WorkspaceInitializerAgentSettings)
        : null,
    };

    appStore.dispatch(hydrateWorkspaceInitializer(hydrationState));
  } catch (error) {
    logger.error("Hydration failed; dispatching defaults so UI is not blocked", { error });
    // Daemon read failure still dispatches hydration with defaults so the UI is not blocked
    appStore.dispatch(
      hydrateWorkspaceInitializer({
        compactFormState: null,
        onboardingFormState: null,
        lastSelectedRepo: null,
      }),
    );
  }
}

/** Remove onboarding prompt from sessionStorage (mimics deleted saga helper). */
function removeOnboardingPromptSessionStorage(): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(ONBOARDING_PROMPT_SESSION_KEY);
    }
  } catch {
    // Ignore session storage failures; reset should still clear Redux-backed state.
  }
}

export function createWorkspaceInitializerPersistenceMiddleware(): StoreMiddleware {
  let hydrationStarted = false;
  let hydrationSettled = false;
  let persistQueued = false;
  // Per-instance debounce state (was module-scope, now closure-scoped to avoid cross-store leakage)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingOnboardingFormState: WorkspaceInitializerOnboardingFormState | null = null;

  // Defer persists until hydration settles: a persist that runs before hydrateOnce()
  // resolves would serialize default Redux state (lastSelectedRepo: null, recentRepos: [])
  // over the previously saved daemon bag. Queued persists flush once, after hydration,
  // when the state reflects the merged daemon values.
  const schedulePersist = (): void => {
    if (!hydrationSettled) {
      persistQueued = true;
      return;
    }
    persistStateBag();
  };

  return () => (next) => (action) => {
    // Boot-time hydration on first action
    if (!hydrationStarted) {
      hydrationStarted = true;
      void hydrateOnce().finally(() => {
        hydrationSettled = true;
        if (persistQueued) {
          persistQueued = false;
          persistStateBag();
        }
      });
    }

    const result = next(action);

    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      switch (action.type) {
        // Immediate persistence (write after reducer runs)
        case setCompactWorkspaceInitializerFormState.type:
        case setWorkspaceInitializerLastSelectedRepo.type:
        case setWorkspaceInitializerBranchForRepo.type:
        case setWorkspaceInitializerDefaultParentPath.type:
        case setWorkspaceInitializerRecentRepos.type:
        case setWorkspaceInitializerRemoteSetups.type:
        case upsertWorkspaceInitializerRemoteSetup.type:
        case removeWorkspaceInitializerRemoteSetup.type:
        case setWorkspaceInitializerLastSubmittedAgent.type:
          schedulePersist();
          break;

        // Debounced onboarding form state persistence
        case debounceWorkspaceInitializerOnboardingFormState.type: {
          const formState = payload[0] as WorkspaceInitializerOnboardingFormState;
          pendingOnboardingFormState = formState;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (pendingOnboardingFormState) {
              appStore.dispatch(setWorkspaceInitializerOnboardingFormState(pendingOnboardingFormState));
              pendingOnboardingFormState = null;
            }
            debounceTimer = null;
          }, ONBOARDING_FORM_STATE_DEBOUNCE_MS);
          break;
        }

        case cancelWorkspaceInitializerOnboardingFormStateDebounce.type:
        case resetOnboarding.type:
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
            pendingOnboardingFormState = null;
          }
          if (action.type === resetOnboarding.type) {
            // Clear onboarding form state (persisted) and session key
            appStore.dispatch(setWorkspaceInitializerOnboardingFormState(null));
            removeOnboardingPromptSessionStorage();
          }
          break;

        // Immediate persistence triggered by the debounced action applying the state
        case setWorkspaceInitializerOnboardingFormState.type:
          schedulePersist();
          break;
      }
    }

    return result;
  };
}
