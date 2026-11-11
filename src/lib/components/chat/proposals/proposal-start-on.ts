/**
 * Start on for a workspace proposal card: where the new workspace's first
 * agent runs. The default is the proposer's location, which the backend stamps
 * as `proposal.placement`; an older backend stamps none, so the card reads the
 * proposing agent's own placement instead.
 */
import { m } from '$shared/paraglide/messages.js';
import type { AgentSession } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import {
  START_ON_BACKEND,
  START_ON_E2B,
  startOnCloudId,
  startOnCloudMachineId,
  type StartOnOption,
} from '$features/remote-machines/start-on';

type Proposer = Pick<AgentSession, 'placement' | 'nodeId'>;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The Start on id a placement names, or null when it is not a usable placement. */
function startOnIdForPlacement(placement: unknown, nodeId?: string): string | null {
  if (!placement || typeof placement !== 'object') return null;
  const value = placement as Record<string, unknown>;
  switch (value.target) {
    case 'local':
      return START_ON_BACKEND;
    case 'remote': {
      const id = nonEmpty(value.nodeId) ?? nonEmpty(nodeId);
      return id ?? null;
    }
    case 'e2b': {
      const entry = nonEmpty(value.cloudMachineId);
      return entry ? startOnCloudId(entry) : START_ON_E2B;
    }
    default:
      return null;
  }
}

export function proposalStartOnDefault(
  proposal: Proposal,
  proposer: Proposer | null | undefined,
): string {
  const stamped = startOnIdForPlacement(
    proposal.kind === 'workspace-create' ? proposal.placement : undefined,
  );
  if (stamped !== null) return stamped;
  return startOnIdForPlacement(proposer?.placement, proposer?.nodeId) ?? START_ON_BACKEND;
}

/**
 * An E2B stamp without `cloudMachineId` means the only saved entry, else the
 * legacy "e2b" entry (PROTOCOL workspace.md "Proposer placement").
 */
export function resolveImplicitE2b(value: string, options: readonly StartOnOption[]): string {
  if (value !== START_ON_E2B || options.some((option) => option.id === START_ON_E2B)) return value;
  const entries = options.filter((option) => option.kind === 'cloud');
  return entries.length === 1 ? entries[0].id : value;
}

/**
 * The rows to offer for `value`, and the chosen row when it can't start an
 * agent. A choice that is no longer listed is added as a disabled row so the
 * card still shows it.
 */
export function proposalStartOnChoices(
  options: StartOnOption[],
  value: string,
  missingLabel: string,
): { options: StartOnOption[]; unavailable: StartOnOption | null } {
  if (value === START_ON_BACKEND) return { options, unavailable: null };
  const listed = options.find((option) => option.id === value);
  if (listed) return { options, unavailable: listed.disabled ? listed : null };
  const missing: StartOnOption = {
    id: value,
    label: missingLabel,
    platform: null,
    disabled: true,
    reason: m.chat_proposalCard_startOnRemoved_label(),
    ...(startOnCloudMachineId(value) ? { kind: 'cloud' as const } : {}),
  };
  return { options: [...options, missing], unavailable: missing };
}
