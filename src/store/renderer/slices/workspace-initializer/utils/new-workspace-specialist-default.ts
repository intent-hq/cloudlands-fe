import { DEFAULT_NEW_WORKSPACE_SPECIALIST_ID } from '$lib/constants/specialists';
import type { WorkspaceInitializerAgentSettings } from '../workspace-initializer-types';

export interface ResolveNewWorkspaceSpecialistDefaultInput {
  /** In-progress New Workspace modal form state (wins over `lastSubmittedAgent`). */
  compactFormState: WorkspaceInitializerAgentSettings | null | undefined;
  /** Agent settings of the last submitted New Workspace form. */
  lastSubmittedAgent: WorkspaceInitializerAgentSettings | null | undefined;
  /** Specialists currently resolvable; a remembered id outside this set is stale. */
  specialists: ReadonlyArray<{ id: string }>;
  /** The team-mode orchestrator specialist id, or null when none exists. */
  orchestratorId: string | null;
}

/**
 * The specialist the New Workspace modal would start with right now, mirroring
 * its own precedence: in-progress form state → last submitted agent → the
 * first-launch default (`DEFAULT_NEW_WORKSPACE_SPECIALIST_ID` when present in
 * `specialists`, else General). Team mode resolves to the orchestrator.
 *
 * `null` means General (no specialist). A remembered id that is no longer in
 * `specialists` also resolves to `null` rather than a stale selection.
 */
export function resolveNewWorkspaceSpecialistDefault({
  compactFormState,
  lastSubmittedAgent,
  specialists,
  orchestratorId,
}: ResolveNewWorkspaceSpecialistDefaultInput): string | null {
  const isTeamMode = compactFormState?.isTeamMode ?? lastSubmittedAgent?.isTeamMode ?? false;
  if (isTeamMode) return orchestratorId;

  const hasSpecialist = (id: string): boolean => specialists.some((s) => s.id === id);
  // `selectedSpecialist` can be null (General), so check `!== undefined`
  // instead of `??`, which would fall through to the first-launch default.
  const selectedSpecialist =
    compactFormState?.selectedSpecialist !== undefined
      ? compactFormState.selectedSpecialist
      : lastSubmittedAgent?.selectedSpecialist !== undefined
        ? lastSubmittedAgent.selectedSpecialist
        : hasSpecialist(DEFAULT_NEW_WORKSPACE_SPECIALIST_ID)
          ? DEFAULT_NEW_WORKSPACE_SPECIALIST_ID
          : null;

  if (selectedSpecialist === null || !hasSpecialist(selectedSpecialist)) return null;
  return selectedSpecialist;
}
