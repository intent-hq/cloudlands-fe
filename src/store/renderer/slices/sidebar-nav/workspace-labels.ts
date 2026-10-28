/**
 * Workspace label rules (PROTOCOL §5.1 "Workspace labels").
 *
 * A workspace holds at most one label. The reserved value `"pinned"` is the
 * built-in Pinned label; any other value is a custom label shown verbatim.
 * There is no label registry: the labels in use are exactly the distinct
 * values held by workspaces.
 */

/** Reserved wire value for the built-in Pinned label. */
// i18n-ignore (wire value; the UI renders a localized name)
export const PINNED_WORKSPACE_LABEL = 'pinned';

/** Maximum label length, counted in Unicode code points like the daemon. */
export const WORKSPACE_LABEL_MAX_LENGTH = 64;

type WorkspaceLabelNameError = 'empty' | 'tooLong' | 'reserved' | 'duplicate';

export type WorkspaceLabelNameResult =
  { ok: true; label: string } | { ok: false; error: WorkspaceLabelNameError };

/** Case-insensitive comparison key for label names. */
function workspaceLabelKey(label: string): string {
  return label.trim().toLocaleLowerCase();
}

export function isPinnedWorkspaceLabel(label: string | null | undefined): boolean {
  return label === PINNED_WORKSPACE_LABEL;
}

/**
 * Validate a new custom label name: trimmed, 1–64 characters, not "Pinned"
 * (ignoring case), and unique among `existingLabels` ignoring case.
 */
export function validateWorkspaceLabelName(
  name: string,
  existingLabels: readonly string[],
): WorkspaceLabelNameResult {
  const label = name.trim();
  if (label.length === 0) return { ok: false, error: 'empty' };
  if ([...label].length > WORKSPACE_LABEL_MAX_LENGTH) return { ok: false, error: 'tooLong' };
  const key = workspaceLabelKey(label);
  if (key === PINNED_WORKSPACE_LABEL) return { ok: false, error: 'reserved' };
  if (existingLabels.some((existing) => workspaceLabelKey(existing) === key)) {
    return { ok: false, error: 'duplicate' };
  }
  return { ok: true, label };
}

/**
 * Distinct custom labels held by `labels`, sorted A–Z (case-insensitive).
 * The Pinned label and blank values are excluded; the first spelling of a
 * case-insensitive duplicate wins.
 */
export function collectCustomWorkspaceLabels(
  labels: Iterable<string | null | undefined>,
): string[] {
  const byKey = new Map<string, string>();
  for (const label of labels) {
    if (typeof label !== 'string' || isPinnedWorkspaceLabel(label)) continue;
    const trimmed = label.trim();
    if (trimmed.length === 0) continue;
    const key = workspaceLabelKey(trimmed);
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
