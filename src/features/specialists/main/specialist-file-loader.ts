/**
 * Specialist File Loader
 *
 * Backend service for discovering and loading specialist files from ~/.augment/specialists/
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
import {
  type SpecialistFile,
  type SpecialistFileFrontmatter,
  type SpecialistFilesResult,
  type SpecialistSource,
  type ModelTier,
  SPECIALISTS_FOLDER,
  SPECIALIST_FILE_EXTENSIONS,
  filenameToSpecialistId,
  specialistIdToFilename,
  sanitizeSpecialistId,
} from '../../../shared/specialist-file-types';

// ESM polyfill for __dirname (not available in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = new Logger('SpecialistFileLoader');

/**
 * Get the path to the user's specialists directory
 */
export function getSpecialistsDirectory(): string {
  return path.join(getSafeHomeDir(), '.augment', SPECIALISTS_FOLDER);
}

/**
 * Get the path to the bundled specialists directory (shipped with app)
 * In development: ./resources/specialists
 * In production: app.getAppPath()/resources/specialists (unpacked)
 */
export function getBundledSpecialistsDirectory(): string {
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

/**
 * Unescape a YAML string value.
 * Handles escaped quotes, backslashes, and common escape sequences.
 */
function unescapeYamlValue(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
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
 * Parse a specialist file from its content.
 * Exported for testing purposes.
 */
export function parseSpecialistFile(
  filePath: string,
  content: string,
  source: SpecialistSource = 'file',
): SpecialistFile | { error: string } {
  const id = filenameToSpecialistId(path.basename(filePath));

  const parsed = parseFrontmatter(content);
  if (!parsed) {
    return { error: 'No valid YAML frontmatter found' };
  }

  const { frontmatter, body } = parsed;

  // Validate required fields
  if (!frontmatter.name) {
    return { error: 'Missing required field: name' };
  }
  if (!frontmatter.description) {
    return { error: 'Missing required field: description' };
  }

  // Validate modelTier if present
  const validModelTiers = ['fast', 'balanced', 'smart'];
  const modelTier = frontmatter.modelTier;
  if (modelTier && !validModelTiers.includes(modelTier)) {
    return {
      error: `Invalid modelTier: "${modelTier}". Must be one of: ${validModelTiers.join(', ')}.`,
    };
  }

  const specialistFrontmatter: SpecialistFileFrontmatter = {
    name: frontmatter.name,
    description: frontmatter.description,
    model: frontmatter.model,
    modelTier: modelTier as ModelTier | undefined,
    roleReminder: frontmatter.roleReminder,
    agentType: frontmatter.agentType,
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
  const result: SpecialistFilesResult = {
    specialists: [],
    errors: [],
  };

  const dir = getSpecialistsDirectory();

  // Check if directory exists
  if (!(await fileExists(dir))) {
    logger.debug('Specialists directory does not exist', { dir });
    return result;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const mdFiles = entries.filter(
      (entry) =>
        entry.isFile() && SPECIALIST_FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
    );

    // Load all files in parallel
    const loadPromises = mdFiles.map(async (entry) => {
      const filePath = path.join(dir, entry.name);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSpecialistFile(filePath, content);

        if ('error' in parsed) {
          result.errors.push({ filePath, error: parsed.error });
        } else {
          result.specialists.push(parsed);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ filePath, error: errorMessage });
        logger.error(`Failed to load specialist file: ${filePath}`, error as Error);
      }
    });

    await Promise.all(loadPromises);

    logger.info(`Loaded ${result.specialists.length} specialists from files`, {
      directory: dir,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to read specialists directory', error as Error);
    return result;
  }
}

/**
 * Load bundled specialist files that ship with the app
 * These are read from the resources/specialists directory
 */
export async function loadBundledSpecialistFiles(): Promise<SpecialistFilesResult> {
  const result: SpecialistFilesResult = {
    specialists: [],
    errors: [],
  };

  const dir = getBundledSpecialistsDirectory();
  logger.debug('Loading bundled specialists', {
    directory: dir,
    __dirname,
    isDev: !app.isPackaged,
  });

  // Check if directory exists
  if (!(await fileExists(dir))) {
    // Use warn level since missing bundled specialists is unexpected and will cause
    // issues like specialists not being found (e.g., "spec-writer not found")
    logger.warn(
      'Bundled specialists directory does not exist - specialists will not be available',
      {
        dir,
        __dirname,
        hint: 'Ensure resources/specialists/ exists relative to the app root',
      },
    );
    return result;
  }

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const mdFiles = entries.filter(
      (entry) =>
        entry.isFile() && SPECIALIST_FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
    );

    // Load all files in parallel
    const loadPromises = mdFiles.map(async (entry) => {
      const filePath = path.join(dir, entry.name);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSpecialistFile(filePath, content, 'bundled');

        if ('error' in parsed) {
          result.errors.push({ filePath, error: parsed.error });
        } else {
          result.specialists.push(parsed);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push({ filePath, error: errorMessage });
        logger.error(`Failed to load bundled specialist file: ${filePath}`, error as Error);
      }
    });

    await Promise.all(loadPromises);

    logger.info(`Loaded ${result.specialists.length} bundled specialists`, {
      directory: dir,
      errors: result.errors.length,
    });

    return result;
  } catch (error) {
    logger.error('Failed to read bundled specialists directory', error as Error);
    return result;
  }
}

/**
 * Load a single specialist file by ID
 */
export async function loadSpecialistFile(id: string): Promise<SpecialistFile | null> {
  const dir = getSpecialistsDirectory();
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseSpecialistFile(filePath, content);

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
  model?: string;
  modelTier?: string;
  roleReminder?: string;
  behaviorPrompt: string;
}): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    await ensureSpecialistsDirectory();

    const dir = getSpecialistsDirectory();
    const filename = specialistIdToFilename(specialist.id);
    const filePath = path.join(dir, filename);

    // Build frontmatter with properly escaped values
    const frontmatterParts = [
      `name: "${escapeYamlValue(specialist.name)}"`,
      `description: "${escapeYamlValue(specialist.description)}"`,
    ];

    // modelTier takes precedence over model (provider-aware resolution)
    if (specialist.modelTier) {
      frontmatterParts.push(`modelTier: "${escapeYamlValue(specialist.modelTier)}"`);
    } else if (specialist.model) {
      frontmatterParts.push(`model: "${escapeYamlValue(specialist.model)}"`);
    }

    if (specialist.roleReminder) {
      frontmatterParts.push(`roleReminder: "${escapeYamlValue(specialist.roleReminder)}"`);
    }

    const content = `---\n${frontmatterParts.join('\n')}\n---\n\n${specialist.behaviorPrompt}`;

    await fs.writeFile(filePath, content, 'utf-8');

    logger.info(`Wrote specialist file: ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to write specialist file', error as Error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Delete a specialist file
 */
export async function deleteSpecialistFile(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const dir = getSpecialistsDirectory();
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);

  if (!(await fileExists(filePath))) {
    return { success: false, error: 'Specialist file not found' };
  }

  try {
    await fs.unlink(filePath);
    logger.info(`Deleted specialist file: ${filePath}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to delete specialist file: ${filePath}`, error as Error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check if a specialist file exists
 */
export async function specialistFileExists(id: string): Promise<boolean> {
  const dir = getSpecialistsDirectory();
  const filename = specialistIdToFilename(id);
  const filePath = path.join(dir, filename);
  return fileExists(filePath);
}

/**
 * Migrate custom specialists from electron-store to file-based system.
 * This is a one-time migration that runs on startup.
 *
 * - Reads custom specialists from electron-store
 * - Writes them as markdown files to ~/.augment/specialists/
 * - Clears the custom specialists from electron-store after successful migration
 *
 * @returns Number of specialists migrated
 */
export async function migrateCustomSpecialistsFromStore(): Promise<{
  migrated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };

  try {
    // Dynamically import electron-store
    const ElectronStore = (await import('electron-store')).default;
    const settingsStore = new ElectronStore({ name: 'settings' });

    const CUSTOM_SPECIALISTS_KEY = 'custom-specialists';
    const MIGRATION_COMPLETE_KEY = 'specialists-migration-complete';

    // Check if migration already completed
    if (settingsStore.get(MIGRATION_COMPLETE_KEY)) {
      logger.debug('Specialist migration already completed');
      return result;
    }

    // Get custom specialists from store
    const customSpecialists = settingsStore.get(CUSTOM_SPECIALISTS_KEY) as
      | Array<{
          id: string;
          name: string;
          description: string;
          model: string;
          behaviorPrompt: string;
          roleReminder?: string;
        }>
      | undefined;

    if (!customSpecialists || !Array.isArray(customSpecialists) || customSpecialists.length === 0) {
      logger.debug('No custom specialists to migrate');
      settingsStore.set(MIGRATION_COMPLETE_KEY, true);
      return result;
    }

    logger.info(`Migrating ${customSpecialists.length} custom specialists to file-based system`);

    // Ensure the specialists directory exists
    await ensureSpecialistsDirectory();

    for (const specialist of customSpecialists) {
      try {
        // Sanitize the ID to ensure valid filename (legacy IDs may have special characters)
        const safeId = sanitizeSpecialistId(specialist.id);
        if (!safeId) {
          result.errors.push(`Cannot migrate specialist with invalid ID: "${specialist.id}"`);
          continue;
        }

        // Check if a file already exists for this specialist
        if (await specialistFileExists(safeId)) {
          logger.debug(
            `Skipping migration for ${specialist.id} -> ${safeId} - file already exists`,
          );
          result.skipped++;
          continue;
        }

        // Write the specialist to a file with sanitized ID
        const writeResult = await writeSpecialistFile({
          id: safeId,
          name: specialist.name,
          description: specialist.description,
          model: specialist.model,
          roleReminder: specialist.roleReminder,
          behaviorPrompt: specialist.behaviorPrompt,
        });

        if (writeResult.success) {
          logger.info(`Migrated specialist: ${specialist.name} (${specialist.id} -> ${safeId})`);
          result.migrated++;
        } else {
          result.errors.push(`Failed to migrate ${specialist.id}: ${writeResult.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error migrating ${specialist.id}: ${errorMessage}`);
        logger.error(`Failed to migrate specialist ${specialist.id}`, error as Error);
      }
    }

    // Mark migration as complete and clear the old data
    if (result.errors.length === 0) {
      settingsStore.delete(CUSTOM_SPECIALISTS_KEY);
      settingsStore.set(MIGRATION_COMPLETE_KEY, true);
      logger.info(`Migration complete: ${result.migrated} migrated, ${result.skipped} skipped`);
    } else {
      logger.warn(
        `Migration completed with errors: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors.length} errors`,
      );
    }

    return result;
  } catch (error) {
    logger.error('Failed to run specialist migration', error as Error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Migrate user overrides from electron-store to file-based system.
 * This creates user specialist files for any bundled specialists that have overrides.
 *
 * - Reads overrides from electron-store (modelOverrides, behaviorPromptOverrides)
 * - For each overridden bundled specialist, creates a user file with the overrides applied
 * - Clears the overrides from electron-store after successful migration
 *
 * @returns Migration result
 */
export async function migrateOverridesFromStore(): Promise<{
  migrated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { migrated: 0, skipped: 0, errors: [] as string[] };

  try {
    // Dynamically import electron-store
    const ElectronStore = (await import('electron-store')).default;
    const settingsStore = new ElectronStore({ name: 'settings' });

    const OVERRIDES_KEY = 'specialists-overrides';
    const OVERRIDES_MIGRATION_KEY = 'specialists-overrides-migration-complete';

    // Check if migration already completed
    if (settingsStore.get(OVERRIDES_MIGRATION_KEY)) {
      logger.debug('Overrides migration already completed');
      return result;
    }

    // Get overrides from store
    const overrides = settingsStore.get(OVERRIDES_KEY) as
      | {
          modelOverrides?: Record<string, string>;
          behaviorPromptOverrides?: Record<string, string>;
        }
      | undefined;

    if (!overrides) {
      logger.debug('No overrides to migrate');
      settingsStore.set(OVERRIDES_MIGRATION_KEY, true);
      return result;
    }

    const { modelOverrides = {}, behaviorPromptOverrides = {} } = overrides;

    // Get all specialist IDs that have overrides
    const overriddenIds = new Set([
      ...Object.keys(modelOverrides),
      ...Object.keys(behaviorPromptOverrides),
    ]);

    if (overriddenIds.size === 0) {
      logger.debug('No overrides to migrate');
      settingsStore.set(OVERRIDES_MIGRATION_KEY, true);
      return result;
    }

    logger.info(`Migrating overrides for ${overriddenIds.size} specialists to file-based system`);

    // Load bundled specialists to get base content
    const bundledResult = await loadBundledSpecialistFiles();
    const bundledById = new Map(bundledResult.specialists.map((s) => [s.id, s]));

    // Ensure the specialists directory exists
    await ensureSpecialistsDirectory();

    for (const specialistId of overriddenIds) {
      try {
        // Check if a user file already exists for this specialist
        if (await specialistFileExists(specialistId)) {
          logger.debug(
            `Skipping override migration for ${specialistId} - user file already exists`,
          );
          result.skipped++;
          continue;
        }

        // Get the bundled specialist
        const bundled = bundledById.get(specialistId);
        if (!bundled) {
          logger.warn(
            `Cannot migrate overrides for ${specialistId} - bundled specialist not found`,
          );
          result.skipped++;
          continue;
        }

        // Apply overrides
        const model = modelOverrides[specialistId] || bundled.frontmatter.model || '';
        const behaviorPrompt = behaviorPromptOverrides[specialistId] || bundled.behaviorPrompt;

        // Write the specialist to a file with overrides applied
        // If there's a model override, use it directly (no modelTier).
        // Otherwise, preserve the bundled specialist's modelTier for provider-aware resolution.
        const writeResult = await writeSpecialistFile({
          id: specialistId,
          name: bundled.frontmatter.name,
          description: bundled.frontmatter.description,
          model: modelOverrides[specialistId] ? model : bundled.frontmatter.model,
          modelTier: modelOverrides[specialistId] ? undefined : bundled.frontmatter.modelTier,
          roleReminder: bundled.frontmatter.roleReminder,
          behaviorPrompt,
        });

        if (writeResult.success) {
          logger.info(`Migrated overrides for specialist: ${specialistId}`);
          result.migrated++;
        } else {
          result.errors.push(
            `Failed to migrate overrides for ${specialistId}: ${writeResult.error}`,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error migrating overrides for ${specialistId}: ${errorMessage}`);
        logger.error(`Failed to migrate overrides for ${specialistId}`, error as Error);
      }
    }

    // Mark migration as complete and clear the old data
    if (result.errors.length === 0) {
      settingsStore.delete(OVERRIDES_KEY);
      settingsStore.set(OVERRIDES_MIGRATION_KEY, true);
      logger.info(
        `Overrides migration complete: ${result.migrated} migrated, ${result.skipped} skipped`,
      );
    } else {
      logger.warn(
        `Overrides migration completed with errors: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors.length} errors`,
      );
    }

    return result;
  } catch (error) {
    logger.error('Failed to run overrides migration', error as Error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}
