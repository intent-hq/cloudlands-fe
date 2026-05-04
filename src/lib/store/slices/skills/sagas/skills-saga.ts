import { call, put, takeLatest, type SagaGenerator } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import {
  loadSkillsRequested,
  setSkills,
  setSkillsError,
  setSkillsLoading,
} from "../skills-slice";
import { selectSkillsWorkspaceState } from "../skills-selectors";
import type { SkillInfo } from "../skills-types";

/**
 * Tracks the last workspace ID for which skills were successfully loaded.
 * Used to deduplicate repeated loadSkillsRequested dispatches for the same
 * workspace, avoiding unnecessary IPC calls and state churn.
 */
let lastLoadedWorkspaceId: string | null = null;

/**
 * Handle loading skills for a workspace via IPC.
 *
 * Uses takeLatest so that rapid workspace switches cancel stale requests
 * (mirrors the guard logic from the old Svelte store).
 *
 * Additionally deduplicates: if the same workspaceId is requested and skills
 * are already loaded (non-empty, not loading, no error), the IPC call is
 * skipped entirely to prevent state churn.
 */
function* handleLoadSkills(
  action: ReturnType<typeof loadSkillsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;

  // Deduplication guard: skip if skills are already loaded for this workspace
  if (workspaceId === lastLoadedWorkspaceId) {
    const wsState = yield* selectSkillsWorkspaceState.effect(workspaceId);
    if (!wsState.loading && wsState.error === null && wsState.skills.length > 0) {
      return;
    }
  }

  yield* put(setSkillsLoading(workspaceId, true));

  try {
    const result = yield* call(
      invoke<{ success?: boolean; data?: SkillInfo[] }>,
      "skills:list",
      { workspaceId },
    );

    if (result?.success && Array.isArray(result.data)) {
      yield* put(setSkills(workspaceId, result.data));
    } else {
      yield* put(setSkills(workspaceId, []));
    }
    // Mark this workspace as successfully loaded
    lastLoadedWorkspaceId = workspaceId;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load skills";
    yield* put(setSkillsError(workspaceId, message));
  }
}

export function* skillsSaga(): SagaGenerator<void> {
  yield* takeLatest(loadSkillsRequested, handleLoadSkills);
}

