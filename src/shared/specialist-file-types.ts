/**
 * Specialist Types
 *
 * Shared type definitions for specialists. Definitions, including the built-in
 * ones, are resolved by intentd (PROTOCOL §5.11 `specialist.*`).
 */

/**
 * Source of a specialist definition
 * - 'project': Repo-local file in <repo>/.intent/specialists/
 * - 'user': User-defined file in ~/.intent/specialists/
 * - 'bundled': Ships with intentd (built-in)
 * - 'builtin': Legacy hardcoded specialists (fallback only)
 * - 'electron-store': Custom specialists stored in electron-store (legacy)
 */
export type SpecialistSource = 'project' | 'user' | 'bundled' | 'builtin' | 'electron-store';

export type SpecialistFileScope = Extract<SpecialistSource, 'project' | 'user'>;

/**
 * One entry of a specialist's ordered delegation model-option list
 * (PROTOCOL §5.11 `modelOptions`): `model` is a BARE model id (e.g.
 * "kimi-k3"); an omitted `provider` means the specialist's own provider
 * (`codingAgent`, else the settings-derived default). `hint` is the author's
 * free-text guidance for choosing that option (`""` when none was given).
 * `reasoningEffort` is the optional per-option effort level (one of the
 * model's catalog `effortLevels`); omitted when the option inherits the
 * model default. Legacy compound `model` ids ("provider:model") split on
 * read (the prefix wins over an entry-level `provider`); writes emit the
 * triple shape only.
 */
export interface SpecialistModelOption {
  provider?: string;
  model: string;
  hint: string;
  reasoningEffort?: string;
}

/**
 * Orchestration role of a specialist (PROTOCOL §5.11 `role`):
 * - 'orchestrator': power the New Workspace modal's team-mode card.
 * - 'internal': excluded from the modal's single-agent dropdown ONLY; still
 *   visible in-workspace (SpecialistDropdown) and in Settings, unlike
 *   `hidden` which hides from all pickers.
 * Absent (undefined) means a standard specialist. Unknown values read as
 * absent (lenient parse).
 */
export type SpecialistRole = 'orchestrator' | 'internal';

/**
 * Sanitize a string to be used as a specialist ID.
 * Normalizes diacritics, strips unsafe characters, and collapses separators.
 */
function sanitizeSpecialistId(
  name: string,
  options?: {
    fallback?: string;
  },
): string {
  const sanitized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return sanitized || options?.fallback || '';
}

export function generateUniqueSpecialistId(
  name: string,
  existingIds: Iterable<string>,
  options?: {
    fallback?: string;
  },
): string {
  const baseId = sanitizeSpecialistId(name, { fallback: options?.fallback ?? 'specialist' });
  const seenIds = existingIds instanceof Set ? existingIds : new Set(existingIds);

  if (!seenIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (seenIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}-${suffix}`;
}
