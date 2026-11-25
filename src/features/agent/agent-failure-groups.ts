/**
 * Grouping of failed top-level agents for the failure toast layer.
 *
 * Two failure kinds group: a usage or rate limit (daemon `errorCode:
 * "quota-exceeded"`) and a provider sign-in error (matched by the caller
 * against the provider catalog's auth patterns). Agents group by the failed
 * BASE provider and kind, so `claude-code` and `claude-code@work` share one
 * group; a group needs 2+ members. Everything else stays a single failure.
 *
 * Pure: the caller injects the auth matcher, so this module has no store
 * access and the registry stays dependency-light.
 */
import { providerRefBaseId } from '$shared/provider-profiles';
import type { AgentFailureEntry } from './agent-failure-registry';

export type GroupedFailureKind = 'quota' | 'auth';

export interface FailureClassification {
  kind: GroupedFailureKind;
  /** Failed provider reference (may name a profile, e.g. `claude-code@work`). */
  providerRef: string;
  baseProviderId: string;
}

export type FailureClassifier = (entry: AgentFailureEntry) => FailureClassification | null;

export type AuthErrorMatcher = (
  providerRef: string,
  model: string | null | undefined,
  error: string,
) => boolean;

export interface AgentFailureGroup {
  key: string;
  kind: GroupedFailureKind;
  baseProviderId: string;
  /** Oldest first. */
  members: AgentFailureEntry[];
}

export interface SwitchRow {
  key: string;
  providerRef: string;
  model: string | null;
  agentIds: string[];
}

export function classifyAgentFailure(
  entry: AgentFailureEntry,
  isAuthError: AuthErrorMatcher,
): FailureClassification | null {
  if (entry.errorCode === 'quota-exceeded') {
    const providerRef = entry.eventProviderId || entry.provider;
    return providerRef
      ? { kind: 'quota', providerRef, baseProviderId: providerRefBaseId(providerRef) }
      : null;
  }
  if (entry.provider && isAuthError(entry.provider, entry.model, entry.error)) {
    return {
      kind: 'auth',
      providerRef: entry.provider,
      baseProviderId: providerRefBaseId(entry.provider),
    };
  }
  return null;
}

export function failureGroupKey(kind: GroupedFailureKind, baseProviderId: string): string {
  return `${kind}:${baseProviderId}`;
}

export function groupAgentFailures(
  entries: AgentFailureEntry[],
  classify: FailureClassifier,
): { groups: AgentFailureGroup[]; singles: AgentFailureEntry[] } {
  const candidates = new Map<string, AgentFailureGroup>();
  const order: Array<{ entry: AgentFailureEntry; key?: string }> = [];
  for (const entry of entries) {
    const classification = classify(entry);
    if (!classification) {
      order.push({ entry });
      continue;
    }
    const key = failureGroupKey(classification.kind, classification.baseProviderId);
    let group = candidates.get(key);
    if (!group) {
      group = {
        key,
        kind: classification.kind,
        baseProviderId: classification.baseProviderId,
        members: [],
      };
      candidates.set(key, group);
    }
    group.members.push(entry);
    order.push({ entry, key });
  }
  const groups = [...candidates.values()].filter((group) => group.members.length >= 2);
  const grouped = new Set(groups.map((group) => group.key));
  const singles = order
    .filter(({ key }) => key === undefined || !grouped.has(key))
    .map(({ entry }) => entry);
  return { groups, singles };
}

/** One row per distinct failed (provider reference, model), in first-seen order. */
export function switchRowsForMembers(
  members: AgentFailureEntry[],
  classify: FailureClassifier,
): SwitchRow[] {
  const rows = new Map<string, SwitchRow>();
  for (const entry of members) {
    const classification = classify(entry);
    if (!classification) continue;
    const model = entry.model ?? null;
    const key = `${classification.providerRef}|${model ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, providerRef: classification.providerRef, model, agentIds: [] };
      rows.set(key, row);
    }
    row.agentIds.push(entry.agentId);
  }
  return [...rows.values()];
}
