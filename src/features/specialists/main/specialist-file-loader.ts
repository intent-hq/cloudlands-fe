/**
 * Specialist File Loader
 *
 * Backend service for discovering and loading specialist files from ~/.intent/specialists/
 * Specialists are markdown files with YAML frontmatter that define agent behavior.
 *
 * File format:
 * ```markdown
 * ---
 * name: "My Specialist"
 * description: "Does something specific"
 * model: "opus4.5"
 * roleReminder: "Never do X, always do Y"
 * ---
 *
 * ## Specialist Role
 * You are a specialist that...
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { app } from 'electron';
import { getSafeHomeDir } from '../../../shared/main/utils';
import { Logger } from '../../../shared/logger';
import { m } from '../../../shared/paraglide/messages.js';
import {
  type SpecialistFile,
  type SpecialistFileFrontmatter,
  type SpecialistFilesResult,
  type SpecialistFileScope,
  type SpecialistModelOption,
  type SpecialistRole,
  type SpecialistSource,
  SPECIALISTS_FOLDER,
  SPECIALIST_FILE_EXTENSIONS,
  filenameToSpecialistId,
  specialistIdToFilename,
} from '../../../shared/specialist-file-types';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('SpecialistFileLoader');

/**
 * Get the path to the user's specialists directory
 */
export function getSpecialistsDirectory(): string {
  return path.join(getSafeHomeDir(), '.intent', SPECIALISTS_FOLDER);
}

export function getProjectSpecialistsDirectory(workspacePath: string): string {
  return path.join(workspacePath, '.intent', SPECIALISTS_FOLDER);
}

/**
 * Get the path to the bundled specialists directory (shipped with app)
 * In development: ./resources/specialists
 * In production: app.getAppPath()/resources/specialists (unpacked)
 */
function getBundledSpecialistsDirectory(): string {
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, use the resources folder relative to the project root
    return path.join(__dirname, '..', '..', '..', '..', 'resources', 'specialists');
  } else {
    // In production, resources are unpacked alongside the app
    const appPath = app.getAppPath();
    const unpackedPath = appPath.replace('app.asar', 'app.asar.unpacked');
    return path.join(unpackedPath, 'resources', 'specialists');
  }
}

/**
 * Check if a file or directory exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the specialists directory exists
 */
export async function ensureSpecialistsDirectory(): Promise<string> {
  const dir = getSpecialistsDirectory();
  try {
    await fs.mkdir(dir, { recursive: true });
    return dir;
  } catch (error) {
    logger.error('Failed to create specialists directory', error as Error);
    throw error;
  }
}

async function ensureProjectSpecialistsDirectory(workspacePath: string): Promise<string> {
  const dir = getProjectSpecialistsDirectory(workspacePath);
  try {
    await fs.mkdir(dir, { recursive: true });
    return dir;
  } catch (error) {
    logger.error('Failed to create project specialists directory', error as Error, {
      workspacePath,
    });
    throw error;
  }
}

function getDirectoryForScope(scope: SpecialistFileScope, workspacePath?: string): string {
  if (scope === 'project') {
    if (!workspacePath) {
      throw new Error('workspacePath is required for project-level specialists');
    }
    return getProjectSpecialistsDirectory(workspacePath);
  }

  return getSpecialistsDirectory();
}

async function loadSpecialistFilesFromDirectory(
  dir: string,
  source: SpecialistSource,
  options?: {
    missingMessage?: string;
    missingLevel?: 'debug' | 'warn';
    missingContext?: Record<string, unknown>;
  },
): Promise<SpecialistFilesResult> {
  const result: SpecialistFilesResult = {
    specialists: [],
    errors: [],
  };

  if (!(await fileExists(dir))) {
    // i18n-ignore (developer log message)
    const message = options?.missingMessage ?? 'Specialists directory does not exist';
    const context = { dir, ...(options?.missingContext ?? {}) };
    if (options?.missingLevel === 'warn') {
      logger.warn(message, context);
    } else {
      logger.debug(message, context);
    }
    return result;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const mdFiles = entries.filter(
      (entry) =>
        entry.isFile() && SPECIALIST_FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
    );

    await Promise.all(
      mdFiles.map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = parseSpecialistFile(filePath, content, source);

          if ('error' in parsed) {
            result.errors.push({ filePath, error: parsed.error });
          } else {
            result.specialists.push(parsed);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : m.specialists_loader_unknown_error();
          result.errors.push({ filePath, error: errorMessage });
          logger.error(`Failed to load specialist file: ${filePath}`, error as Error);
        }
      }),
    );

    logger.info(`Loaded ${result.specialists.length} specialists from files`, {
      directory: dir,
      source,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to read specialists directory', error as Error, { dir, source });
    return result;
  }
}

/**
 * Unescape a YAML string value.
 * Handles escaped quotes, backslashes, and common escape sequences.
 * Uses a single pass so already-unescaped output is never re-interpreted
 * (avoids double-unescaping, e.g. `\\n` must yield `\n` literally, not a newline).
 */
function unescapeYamlValue(value: string): string {
  return value.replace(/\\(.)/g, (match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case '"':
      case "'":
      case '\\':
        return char;
      default:
        return match;
    }
  });
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns null if no valid frontmatter is found
 *
 * Supports:
 * - Simple key: value pairs
 * - Quoted strings with escaped characters
 * - Multiline values using YAML block scalars (| and >)
 * - Windows line endings (\r\n)
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} | null {
  // Normalize line endings to \n
  const normalizedContent = content.replace(/\r\n/g, '\n');

  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = normalizedContent.match(frontmatterRegex);

  if (!match || !match[1]) {
    return null;
  }

  const frontmatterText = match[1];
  const body = normalizedContent.replace(frontmatterRegex, '').trim();
  const frontmatter: Record<string, string> = {};

  const lines = frontmatterText.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();

    // Skip lines with empty keys (malformed YAML)
    if (!key) {
      i++;
      continue;
    }

    let value = line.slice(colonIndex + 1).trim();

    // Check for YAML block scalar indicators (| or >)
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const isLiteral = value.startsWith('|'); // | preserves newlines, > folds them
      const stripFinal = value.endsWith('-'); // - strips trailing newline
      const blockLines: string[] = [];
      i++;

      // Collect indented lines
      while (i < lines.length) {
        const blockLine = lines[i];
        // Block continues while lines are indented (start with spaces)
        if (blockLine.startsWith('  ') || blockLine === '') {
          blockLines.push(blockLine.replace(/^  /, '')); // Remove 2-space indent
          i++;
        } else {
          break;
        }
      }

      // Join lines based on block style
      if (isLiteral) {
        value = blockLines.join('\n');
      } else {
        // Folded style: replace single newlines with spaces, preserve double newlines
        value = blockLines
          .join('\n')
          .replace(/\n\n/g, '\x00') // Preserve paragraph breaks
          .replace(/\n/g, ' ')
          .replace(/\x00/g, '\n\n');
      }

      if (stripFinal) {
        value = value.replace(/\n+$/, '');
      } else {
        value = value.replace(/\n*$/, '\n');
      }

      value = value.trim();
      frontmatter[key] = value;
      continue;
    }

    // Handle quoted strings
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      // Unescape if double-quoted
      if (quote === '"') {
        value = unescapeYamlValue(value);
      }
    }

    frontmatter[key] = value;
    i++;
  }

  return { frontmatter, body };
}

/**
 * Parse a frontmatter `modelOptions` scalar (single-line JSON array) with the
 * daemon's lenient read semantics (PROTOCOL §5.11): an unparseable scalar or
 * non-array is treated as an omitted key (undefined ⇒ inherits); unusable
 * entries — non-objects, or no non-empty (non-whitespace) string `model` —
 * are skipped individually; `provider` is carried when it is a non-empty
 * string; a non-string/empty `reasoningEffort` reads as omitted on the
 * entry; only a literal `[]` yields an explicit empty list, and a non-empty
 * array whose entries are ALL unusable is treated as omitted.
 *
 * Legacy compound `model` ids split on read: `provider:model` becomes the
 * explicit `provider` plus the bare `model` (both halves trimmed), the
 * prefix winning over an entry-level `provider` field (mirroring the spawn
 * precedence compound ids had). A compound id with an empty prefix or an
 * empty rest is unusable. Writes emit the triple shape only, and a bare
 * model id never contains a colon, so the re-split on every read is safe.
 * Exported for testing purposes.
 */
export function parseModelOptionsScalar(
  raw: string | undefined,
): SpecialistModelOption[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  if (parsed.length === 0) return [];
  const options: SpecialistModelOption[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const {
      provider: rawProvider,
      model: rawModel,
      hint,
      reasoningEffort,
    } = entry as {
      provider?: unknown;
      model?: unknown;
      hint?: unknown;
      reasoningEffort?: unknown;
    };
    if (typeof rawModel !== 'string' || rawModel.trim() === '') continue;
    let provider: string | undefined;
    let model: string;
    const colonIndex = rawModel.indexOf(':');
    if (colonIndex >= 0) {
      const prefix = rawModel.slice(0, colonIndex).trim();
      const rest = rawModel.slice(colonIndex + 1).trim();
      // A compound with an empty prefix or empty rest is unusable.
      if (prefix === '' || rest === '') continue;
      provider = prefix;
      model = rest;
    } else {
      provider =
        typeof rawProvider === 'string' && rawProvider.trim() !== '' ? rawProvider : undefined;
      model = rawModel;
    }
    options.push({
      ...(provider !== undefined ? { provider } : {}),
      model,
      hint: typeof hint === 'string' ? hint : '',
      // A non-string or empty level reads as an omitted key (inherits).
      ...(typeof reasoningEffort === 'string' && reasoningEffort.trim() !== ''
        ? { reasoningEffort }
        : {}),
    });
  }
  // All entries unusable ⇒ treated as omitted (inherits), never a clear.
  return options.length > 0 ? options : undefined;
}

/**
 * Parse a frontmatter `role` scalar with lenient read semantics (PROTOCOL
 * §5.11): only the known enum values are kept; unknown/empty values read as
 * an omitted key (standard specialist) — the parse never rejects.
 * Exported for testing purposes.
 */
export function parseRoleScalar(raw: string | undefined): SpecialistRole | undefined {
  return raw === 'orchestrator' || raw === 'internal' ? raw : undefined;
}

/**
 * Parse a frontmatter `teamAgents` scalar (single-line JSON array of
 * specialist ids) with the same lenient read semantics as `modelOptions`:
 * an unparseable scalar or non-array reads as omitted; unusable entries
 * (non-strings, blank/whitespace-only strings) are skipped individually; a
 * literal `[]` yields an explicit empty list, and a non-empty array whose
 * entries are ALL unusable reads as omitted.
 * Exported for testing purposes.
 */
export function parseTeamAgentsScalar(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  if (parsed.length === 0) return [];
  const ids = parsed.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  return ids.length > 0 ? ids : undefined;
}

/**
 * Lenient read normalization of a legacy compound frontmatter `model` scalar
 * (PROTOCOL §5.11): `model: "provider:model"` splits into the bare `model`
 * plus a `codingAgent` set to the prefix — the prefix WINS over any
 * `codingAgent` the same file declares, preserving the spawn precedence
 * compound ids had. A compound with an empty prefix or empty rest is
 * unusable and reads as an omitted key (which inherits). Writes emit bare
 * model ids only, and a bare id never contains a colon, so the re-split on
 * every read is safe. Exported for testing purposes.
 */
export function splitCompoundModelScalar(
  model: string | undefined,
  codingAgent: string | undefined,
): { model: string | undefined; codingAgent: string | undefined } {
  if (model === undefined) return { model, codingAgent };
  const colonIndex = model.indexOf(':');
  if (colonIndex < 0) return { model, codingAgent };
  const prefix = model.slice(0, colonIndex).trim();
  const rest = model.slice(colonIndex + 1).trim();
  if (prefix === '' || rest === '') return { model: undefined, codingAgent };
  return { model: rest, codingAgent: prefix };
}

/**
 * Parse a specialist file from its content.
 * Exported for testing purposes.
 */
export function parseSpecialistFile(
  filePath: string,
  content: string,
  source: SpecialistSource = 'user',
): SpecialistFile | { error: string } {
  const id = filenameToSpecialistId(path.basename(filePath));

  const parsed = parseFrontmatter(content);

  // Derive name from filename (e.g., "my-cool-specialist.md" -> "my-cool-specialist")
  const nameFromFilename = path.basename(filePath).replace(/\.[^.]+$/, '');

  // When no frontmatter is found, treat the entire content as the behavior prompt
  if (!parsed) {
    const specialistFrontmatter: SpecialistFileFrontmatter = {
      name: nameFromFilename,
      description: '',
    };

    return {
      id,
      filePath,
      frontmatter: specialistFrontmatter,
      behaviorPrompt: content.trim(),
      rawContent: content,
      source,
    };
  }

  const { frontmatter, body } = parsed;

  // Legacy compound `model` ids split into bare model + codingAgent on read.
  const { model, codingAgent } = splitCompoundModelScalar(
    frontmatter.model,
    frontmatter.codingAgent,
  );

  // Retired `modelTier:` keys in existing files are tolerated and ignored
  // (dropped on the next rewrite) — never rejected.
  const specialistFrontmatter: SpecialistFileFrontmatter = {
    name: frontmatter.name || nameFromFilename,
    description: frontmatter.description || '',
    codingAgent,
    model,
    roleReminder: frontmatter.roleReminder,
    agentType: frontmatter.agentType,
    hidden: frontmatter.hidden === 'true' ? true : undefined,
    modelOptions: parseModelOptionsScalar(frontmatter.modelOptions),
    reasoningEffort: frontmatter.reasoningEffort || undefined,
    role: parseRoleScalar(frontmatter.role),
    teamAgents: parseTeamAgentsScalar(frontmatter.teamAgents),
    icon: frontmatter.icon || undefined,
  };

  return {
    id,
    filePath,
    frontmatter: specialistFrontmatter,
    behaviorPrompt: body,
    rawContent: content,
    source,
  };
}

/**
 * Load all specialist files from the specialists directory
 */
export async function loadSpecialistFiles(): Promise<SpecialistFilesResult> {
  return loadSpecialistFilesFromDirectory(getSpecialistsDirectory(), 'user', {
    // i18n-ignore (developer log message)
    missingMessage: 'User specialists directory does not exist',
  });
}

export async function loadProjectSpecialistFiles(
  workspacePath?: string,
): Promise<SpecialistFilesResult> {
  if (!workspacePath) {
    return { specialists: [], errors: [] };
  }

  return loadSpecialistFilesFromDirectory(
    getProjectSpecialistsDirectory(workspacePath),
    'project',
    {
      // i18n-ignore (developer log message)
      missingMessage: 'Project specialists directory does not exist',
      missingContext: { workspacePath },
    },
  );
}

/**
 * Load bundled specialist files that ship with the app
 * These are read from the resources/specialists directory
 */
export async function loadBundledSpecialistFiles(): Promise<SpecialistFilesResult> {
  const dir = getBundledSpecialistsDirectory();
  logger.debug('Loading bundled specialists', {
    directory: dir,
    __dirname,
    isDev: !app.isPackaged,
  });

  return loadSpecialistFilesFromDirectory(dir, 'bundled', {
    missingLevel: 'warn',
    missingMessage:
      // i18n-ignore (developer log message)
      'Bundled specialists directory does not exist - specialists will not be available',
    missingContext: {
      __dirname,
      // i18n-ignore (developer log message)
      hint: 'Ensure resources/specialists/ exists relative to the app root',
    },
  });
}

/**
 * Load a single specialist file by ID
 */
export async function loadSpecialistFile(
  id: string,
  scope: SpecialistFileScope = 'user',
  workspacePath?: string,
): Promise<SpecialistFile | null> {
  const dir = getDirectoryForScope(scope, workspacePath);
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseSpecialistFile(filePath, content, scope);

    if ('error' in parsed) {
      logger.error(`Failed to parse specialist file: ${filePath}`, { error: parsed.error });
      return null;
    }

    return parsed;
  } catch (error) {
    logger.error(`Failed to load specialist file: ${filePath}`, error as Error);
    return null;
  }
}

/**
 * Escape a string value for use in YAML frontmatter.
 * Escapes internal double quotes, newlines, and handles special characters.
 */
function escapeYamlValue(value: string): string {
  // Escape backslashes first, then double quotes, then newlines/tabs
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Write a specialist to a file
 */
export async function writeSpecialistFile(specialist: {
  id: string;
  name: string;
  description: string;
  codingAgent?: string;
  model?: string;
  roleReminder?: string;
  hidden?: boolean;
  modelOptions?: SpecialistModelOption[];
  reasoningEffort?: string;
  role?: SpecialistRole;
  teamAgents?: string[];
  icon?: string;
  behaviorPrompt: string;
  scope?: SpecialistFileScope;
  workspacePath?: string;
}): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const scope = specialist.scope ?? 'user';
    let dir: string;
    if (scope === 'project') {
      if (!specialist.workspacePath) {
        return {
          success: false,
          error: 'workspacePath is required for project-scoped specialists',
        };
      }
      dir = await ensureProjectSpecialistsDirectory(specialist.workspacePath);
    } else {
      dir = await ensureSpecialistsDirectory();
    }

    const filename = specialistIdToFilename(specialist.id);
    const filePath = path.join(dir, filename);

    // Writes emit the triple shape only (PROTOCOL §5.11): a legacy compound
    // `model` id from a stale caller is split into bare model + codingAgent
    // (the prefix winning) so a compound id never persists to disk.
    const { model, codingAgent } = splitCompoundModelScalar(
      specialist.model,
      specialist.codingAgent,
    );

    // Build frontmatter with properly escaped values
    const frontmatterParts = [
      `name: "${escapeYamlValue(specialist.name)}"`,
      `description: "${escapeYamlValue(specialist.description)}"`,
    ];

    if (codingAgent) {
      frontmatterParts.push(`codingAgent: "${escapeYamlValue(codingAgent)}"`);
    }

    if (model) {
      frontmatterParts.push(`model: "${escapeYamlValue(model)}"`);
    }

    if (specialist.roleReminder) {
      frontmatterParts.push(`roleReminder: "${escapeYamlValue(specialist.roleReminder)}"`);
    }

    if (specialist.hidden) {
      frontmatterParts.push('hidden: true');
    }

    // Single-line JSON-array scalar (PROTOCOL §5.11). An explicit [] is the
    // inherit-clearing form and is written verbatim; undefined writes no key.
    // Entries are normalized to the triple shape (compound ids split, the
    // prefix winning over the entry-level provider) so writes never persist a
    // compound `model`.
    if (specialist.modelOptions !== undefined) {
      const normalizedOptions = specialist.modelOptions.map((opt) => {
        const colonIndex = opt.model.indexOf(':');
        if (colonIndex < 0) return opt;
        const prefix = opt.model.slice(0, colonIndex).trim();
        const rest = opt.model.slice(colonIndex + 1).trim();
        if (prefix === '' || rest === '') return opt;
        const { provider: _provider, ...restFields } = opt;
        return { provider: prefix, ...restFields, model: rest };
      });
      frontmatterParts.push(`modelOptions: ${JSON.stringify(normalizedOptions)}`);
    }

    if (specialist.reasoningEffort) {
      frontmatterParts.push(`reasoningEffort: "${escapeYamlValue(specialist.reasoningEffort)}"`);
    }

    if (specialist.role) {
      frontmatterParts.push(`role: "${escapeYamlValue(specialist.role)}"`);
    }

    // Single-line JSON-array scalar like modelOptions: an explicit [] is
    // written verbatim; undefined writes no key.
    if (specialist.teamAgents !== undefined) {
      frontmatterParts.push(`teamAgents: ${JSON.stringify(specialist.teamAgents)}`);
    }

    if (specialist.icon) {
      frontmatterParts.push(`icon: "${escapeYamlValue(specialist.icon)}"`);
    }

    const content = `---\n${frontmatterParts.join('\n')}\n---\n\n${specialist.behaviorPrompt}`;

    await fs.writeFile(filePath, content, 'utf-8');

    logger.info(`Wrote specialist file: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : m.specialists_loader_unknown_error();
    logger.error('Failed to write specialist file', error as Error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Delete a specialist file
 */
export async function deleteSpecialistFile(
  id: string,
  scope: SpecialistFileScope = 'user',
  workspacePath?: string,
): Promise<{ success: boolean; error?: string }> {
  const dir = getDirectoryForScope(scope, workspacePath);
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);

  if (!(await fileExists(filePath))) {
    return { success: false, error: m.specialists_loader_fileNotFound_error() };
  }

  try {
    await fs.unlink(filePath);
    logger.info(`Deleted specialist file: ${filePath}`);
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : m.specialists_loader_unknown_error();
    logger.error(`Failed to delete specialist file: ${filePath}`, error as Error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check if a specialist file exists
 */
export async function specialistFileExists(
  id: string,
  scope: SpecialistFileScope = 'user',
  workspacePath?: string,
): Promise<boolean> {
  const dir = getDirectoryForScope(scope, workspacePath);
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);
  return fileExists(filePath);
}
