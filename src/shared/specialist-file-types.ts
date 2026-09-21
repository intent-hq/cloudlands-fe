/**
 * Specialist File Types
 *
 * Shared type definitions for the file-based specialist system.
 * Specialists can be defined as markdown files with YAML frontmatter
 * stored in ~/.intent/specialists/
 *
 * Example specialist file (my-specialist.md):
 * ```markdown
 * ---
 * name: "My Specialist"
 * description: "Does something specific"
 * model: "opus4.5"
 * roleReminder: "Never do X, always do Y"
 * ---
 *
 * ## Specialist Role
 *
 * You are a specialist that...
 * ```
 */

/**
 * Source of a specialist definition
 * - 'project': Repo-local file in <repo>/.intent/specialists/
 * - 'user': User-defined file in ~/.intent/specialists/
 * - 'bundled': Ships with the app (in resources/specialists/)
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
 * - 'orchestrator': powers the New Workspace modal's team-mode card.
 * - 'internal': excluded from the modal's single-agent dropdown ONLY; still
 *   visible in-workspace (SpecialistDropdown) and in Settings, unlike
 *   `hidden` which hides from all pickers.
 * Absent (undefined) means a standard specialist. Unknown values read as
 * absent (lenient parse).
 */
export type SpecialistRole = 'orchestrator' | 'internal';

/**
 * YAML frontmatter fields for specialist markdown files
 */
export interface SpecialistFileFrontmatter {
  /** Display name for the specialist (required) */
  name: string;
  /** Short description shown in UI (required) */
  description: string;
  /**
   * ACP provider / runtime backend for this specialist (optional).
   * If omitted, callers should fall back to the global default coding agent.
   */
  codingAgent?: string;
  /**
   * Default model ID, e.g., "opus4.5", "sonnet4.5" (optional).
   * When omitted, the specialist inherits the global default model.
   */
  model?: string;
  /**
   * Short reminder of critical constraints for this specialist.
   * Injected periodically during long conversations to prevent role drift.
   * Should be 1-2 sentences focusing on what the specialist MUST NOT do.
   */
  roleReminder?: string;
  /**
   * Default agent type for agents created with this specialist.
   * Controls which instruction set (agent loop) the agent uses.
   * If not set, defaults to 'task-loop'.
   */
  agentType?: string;
  /**
   * When true, this specialist is excluded from picker surfaces
   * (it remains visible on Settings → AI Behavior for editing).
   */
  hidden?: boolean;
  /**
   * Ordered delegation model options (PROTOCOL §5.11). Stored in frontmatter
   * as a single-line JSON-array scalar. Omitted (undefined) when the file has
   * no `modelOptions:` key — an explicit `[]` is the inherit-clearing form.
   */
  modelOptions?: SpecialistModelOption[];
  /**
   * Reasoning-effort level for the specialist's model (PROTOCOL §5.11).
   * Omitted (undefined) when the file has no `reasoningEffort:` key — the
   * specialist then inherits the model default.
   */
  reasoningEffort?: string;
  /**
   * Orchestration role (PROTOCOL §5.11). Omitted (undefined) means standard;
   * unknown values in files read as omitted.
   */
  role?: SpecialistRole;
  /**
   * Specialist ids the orchestrator delegates to (advisory/render-only, used
   * for the team-card avatar row). Stored in frontmatter as a single-line
   * JSON-array scalar like `modelOptions`. Omitted (undefined) when the file
   * has no `teamAgents:` key.
   */
  teamAgents?: string[];
  /**
   * Built-in avatar design id for this specialist (PROTOCOL §5.11). Carried
   * verbatim; unknown/absent values degrade to the id-map + seeded fallback
   * at render time.
   */
  icon?: string;
}

/**
 * A specialist loaded from a markdown file
 */
export interface SpecialistFile {
  /** Unique identifier derived from filename (e.g., "my-specialist" from "my-specialist.md") */
  id: string;
  /** Full filesystem path to the file */
  filePath: string;
  /** Parsed frontmatter metadata */
  frontmatter: SpecialistFileFrontmatter;
  /** The markdown body content (frontmatter removed) - this is the behavior prompt */
  behaviorPrompt: string;
  /** Raw file content including frontmatter */
  rawContent: string;
  /** Where this specialist was loaded from */
  source: SpecialistSource;
}

/**
 * Result of listing specialists from files
 */
export interface SpecialistFilesResult {
  /** Successfully loaded specialists */
  specialists: SpecialistFile[];
  /** Errors encountered during loading */
  errors: Array<{
    filePath: string;
    error: string;
  }>;
}

/**
 * The specialists folder name under ~/.intent/
 */
export const SPECIALISTS_FOLDER = 'specialists';

/**
 * Valid file extensions for specialist files
 */
export const SPECIALIST_FILE_EXTENSIONS = ['.md'];

/**
 * Sanitize a string to be used as a specialist ID.
 * Normalizes diacritics, strips unsafe characters, and collapses separators.
 */
export function sanitizeSpecialistId(
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

/**
 * Generate a filename from a specialist name
 */
export function specialistIdToFilename(id: string): string {
  return `${id}.md`;
}

/**
 * Extract specialist ID from a filename
 */
export function filenameToSpecialistId(filename: string): string {
  // Remove extension
  for (const ext of SPECIALIST_FILE_EXTENSIONS) {
    if (filename.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return filename;
}

/**
 * Merge multiple specialist lists by priority (last list wins for duplicate IDs).
 * Used to combine bundled, user, and project specialist lists where higher-priority
 * sources should override lower-priority ones for the same specialist ID.
 */
export function mergeSpecialistsByPriority<T extends { id: string }>(
  ...specialistLists: T[][]
): T[] {
  const specialistsById = new Map<string, T>();
  for (const specialists of specialistLists) {
    for (const specialist of specialists) {
      specialistsById.set(specialist.id, specialist);
    }
  }
  return Array.from(specialistsById.values());
}
