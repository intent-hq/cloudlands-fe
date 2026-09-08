import {
  DEFAULT_NEW_WORKSPACE_SPECIALIST_ID,
  getSpecialistById,
  type Specialist,
} from '$lib/constants/specialists';
import { m } from '$shared/paraglide/messages.js';

type SpecialistSummary = Pick<Specialist, 'id' | 'name'>;

export function resolveNewWorkspaceSpecialistId(
  specialists: readonly SpecialistSummary[],
  selected: string | null | undefined,
): string | undefined {
  if (selected === null) return undefined;
  if (typeof selected === 'string') return selected;
  if (
    specialists.length === 0 ||
    specialists.some(({ id }) => id === DEFAULT_NEW_WORKSPACE_SPECIALIST_ID)
  ) {
    return DEFAULT_NEW_WORKSPACE_SPECIALIST_ID;
  }
  return undefined;
}

export function resolveNewWorkspaceAgentName(
  specialists: readonly SpecialistSummary[],
  specialistId: string | undefined,
): string {
  return (
    specialists.find(({ id }) => id === specialistId)?.name ??
    (specialistId ? getSpecialistById(specialistId)?.name : undefined) ??
    m.workspace_fileChanges_agent_label()
  );
}
