import type { Proposal } from '$shared/types/proposal';

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(',')}}`;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function getProposalId(proposal: Proposal): string {
  if (proposal.applyToolCallId) return proposal.applyToolCallId;
  const changes = proposal.kind === 'settings-change' ? proposal.payload.changes : proposal.payload;
  return `settings-${hashString(stableStringify(changes))}`;
}
