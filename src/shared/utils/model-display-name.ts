import { splitLegacyCompoundId } from './legacy-model-id';

/** Only unwrap a legacy prefix belonging to this provider; colons can be part of a bare ID. */
export function modelIdForDisplay(
  modelId: string,
  providerId: string,
  normalizeProvider: (id: string) => string,
): string {
  const split = splitLegacyCompoundId(modelId);
  return split.providerId && normalizeProvider(split.providerId) === providerId
    ? split.modelId
    : modelId;
}

/** Exact identities win. Only recognized legacy effort suffixes fall back to a base label. */
export function resolveModelDisplayName(
  modelId: string,
  lookup: (id: string) => string | undefined,
): string | undefined {
  const exact = lookup(modelId);
  if (exact) return exact;
  const match = /\/(minimal|low|medium|high|xhigh|max|ultra|none)$/i.exec(modelId);
  if (!match || match.index === 0) return undefined;
  const label = lookup(modelId.slice(0, match.index));
  const effort = match[1].toLowerCase();
  return label ? `${label} (${effort.charAt(0).toUpperCase()}${effort.slice(1)})` : undefined;
}

const CLAUDE_FAMILIES = new Set(['opus', 'sonnet', 'haiku']);

/**
 * Last-resort label for Claude Code model IDs when no catalog names them
 * (e.g. a remote machine reports `opus`, `claude-fable-5-1[1m]`). Returns
 * undefined for IDs it does not recognize.
 */
export function prettyClaudeModelName(modelId: string): string | undefined {
  const match = /^(?:claude-)?([a-z]+)((?:-\d+)*)(?:\[(\d+[km])\])?$/i.exec(modelId.trim());
  if (!match) return undefined;
  const family = match[1].toLowerCase();
  const isAlias = !modelId.toLowerCase().startsWith('claude-');
  if (isAlias && !CLAUDE_FAMILIES.has(family)) return undefined;
  const version = match[2].slice(1).replace(/-/g, '.');
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  const ctx = match[3] ? ` (${match[3].toUpperCase()} context)` : '';
  return `${name}${version ? ` ${version}` : ''}${ctx}`;
}
