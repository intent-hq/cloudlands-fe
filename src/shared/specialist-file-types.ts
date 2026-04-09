/**
 * Specialist File Types
 *
 * Shared type definitions for the file-based specialist system.
 * Specialists can be defined as markdown files with YAML frontmatter
 * stored in ~/.augment/specialists/
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
 * - 'project': Repo-local file in <repo>/.augment/specialists/
 * - 'user': User-defined file in ~/.augment/specialists/
 * - 'bundled': Ships with the app (in resources/specialists/)
 * - 'builtin': Legacy hardcoded specialists (fallback only)
 * - 'electron-store': Custom specialists stored in electron-store (legacy)
 */
export type SpecialistSource = 'project' | 'user' | 'bundled' | 'builtin' | 'electron-store';

export type SpecialistFileScope = Extract<SpecialistSource, 'project' | 'user'>;

/**
 * Model tier for provider-aware model resolution
 * - 'smart': Most capable model (e.g., opus4.5 for Anthropic)
 * - 'balanced': General purpose model (e.g., sonnet4.5 for Anthropic)
 * - 'fast': Faster, cheaper model (e.g., haiku4.5 for Anthropic)
 *
 * Must match the ModelTier type in provider-config.ts
 */
export type ModelTier = 'fast' | 'balanced' | 'smart';

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
   * Default model ID, e.g., "opus4.5", "sonnet4.5" (optional)
   * If modelTier is also specified, modelTier takes precedence for provider-aware resolution.
   */
  model?: string;
  /**
   * Model tier for provider-aware resolution (optional).
   * When specified, the actual model is resolved based on the active provider.
   * Takes precedence over the 'model' field.
   * - 'smart': Most capable model (e.g., opus4.5 for Anthropic)
   * - 'balanced': General purpose model (e.g., sonnet4.5 for Anthropic)
   * - 'fast': Faster, cheaper model (e.g., haiku4.5 for Anthropic)
   */
  modelTier?: ModelTier;
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
 * Unified specialist type that combines all sources
 * This is what the frontend and agent system work with
 */
export interface UnifiedSpecialist {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** ACP provider / runtime backend, if explicitly configured */
  codingAgent?: string;
  /** Default model ID */
  defaultModel: string;
  /** Behavior prompt / system instructions */
  defaultBehaviorPrompt: string;
  /** Optional role reminder for long conversations */
  roleReminder?: string;
  /** Source of this specialist definition */
  source: SpecialistSource;
  /** File path if source is 'file' */
  filePath?: string;
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
 * The specialists folder name under ~/.augment/
 */
export const SPECIALISTS_FOLDER = 'specialists';

/**
 * Valid file extensions for specialist files
 */
export const SPECIALIST_FILE_EXTENSIONS = ['.md'];

/**
 * Default model for specialists that don't specify one
 */
export const DEFAULT_SPECIALIST_MODEL = 'sonnet4.5';

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
export function mergeSpecialistsByPriority<T extends { id: string }>(...specialistLists: T[][]): T[] {
  const specialistsById = new Map<string, T>();
  for (const specialists of specialistLists) {
    for (const specialist of specialists) {
      specialistsById.set(specialist.id, specialist);
    }
  }
  return Array.from(specialistsById.values());
}
