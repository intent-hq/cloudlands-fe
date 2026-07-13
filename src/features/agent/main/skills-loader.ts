import type { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import yaml from 'js-yaml';
import { getSafeHomeDir } from '../../../shared/main/utils';
import { Logger } from '../../../shared/logger';

const logger = new Logger('SkillsLoader');

const SKILL_FILENAME = 'SKILL.md';
const MAX_SCAN_DEPTH = 4;
const MAX_SCANNED_DIRECTORIES = 2000;
const NO_WORKSPACE_CACHE_KEY = '__no_workspace__';
const NOISE_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.hg',
  '.svn',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
]);

export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
  scope: 'project' | 'user';
  allowedTools?: string;
  compatibility?: string;
}

interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
  allowedTools?: string;
  compatibility?: string;
  license?: string;
  metadata?: Record<string, string>;
}

interface ParsedSkillFile {
  metadata: SkillMetadata;
  body: string;
}

interface DiscoveredSkill extends ParsedSkillFile {
  precedence: number;
}

interface ScanTarget {
  root: string;
  precedence: number;
  scope: 'project' | 'user';
}

interface PathFingerprint {
  path: string;
  exists: boolean;
  mtimeMs: number;
}

interface CachePayload {
  skills: SkillMetadata[];
  catalog: string;
  fingerprints: PathFingerprint[];
}

interface CacheEntry extends CachePayload {
  loadPromise?: Promise<CachePayload>;
}

const discoveryCache = new Map<string, CacheEntry>();

export async function discoverSkills(workspacePath: string): Promise<SkillMetadata[]> {
  const payload = await loadSkillsPayload(workspacePath);
  return payload.skills.map((skill) => ({ ...skill }));
}

export async function formatSkillsCatalogForPrompt(workspacePath: string): Promise<string> {
  const payload = await loadSkillsPayload(workspacePath);
  return payload.catalog;
}

async function loadSkillsPayload(workspacePath: string): Promise<CachePayload> {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  const cacheKey = normalizedWorkspacePath ?? NO_WORKSPACE_CACHE_KEY;

  for (;;) {
    const cached = discoveryCache.get(cacheKey);

    if (cached?.loadPromise) {
      return cached.loadPromise;
    }

    if (cached) {
      const fingerprintsCurrent = await areFingerprintsCurrent(cached.fingerprints);
      const latest = discoveryCache.get(cacheKey);

      if (latest?.loadPromise) {
        return latest.loadPromise;
      }

      if (latest !== cached) {
        continue;
      }

      if (fingerprintsCurrent) {
        logger.debug('Skills discovery cache hit', {
          workspacePath: normalizedWorkspacePath ?? '',
          count: cached.skills.length,
        });
        return cached;
      }
    }

    const latest = discoveryCache.get(cacheKey);
    if (latest?.loadPromise) {
      return latest.loadPromise;
    }

    const loadPromise = scanSkills(normalizedWorkspacePath)
      .then((payload) => {
        discoveryCache.set(cacheKey, payload);
        return payload;
      })
      .catch((error) => {
        discoveryCache.delete(cacheKey);
        throw error;
      });

    discoveryCache.set(cacheKey, {
      skills: latest?.skills ?? [],
      catalog: latest?.catalog ?? '',
      fingerprints: latest?.fingerprints ?? [],
      loadPromise,
    });

    return loadPromise;
  }
}

async function scanSkills(workspacePath?: string): Promise<CachePayload> {
  const observedPaths = new Set<string>();
  const discoveredByName = new Map<string, DiscoveredSkill>();
  const scanState = { scannedDirectories: 0 };

  for (const target of getScanTargets(workspacePath)) {
    observedPaths.add(target.root);
    const skillFiles = await findSkillFiles(target.root, observedPaths, scanState);

    for (const skillFile of skillFiles) {
      const parsed = await parseSkillFile(skillFile);
      if (!parsed) {
        continue;
      }

      const existing = discoveredByName.get(parsed.metadata.name);
      if (existing) {
        logger.warn('Skill name collision detected, keeping higher-precedence skill', {
          name: parsed.metadata.name,
          kept:
            target.precedence >= existing.precedence ? parsed.metadata.location : existing.metadata.location,
          shadowed:
            target.precedence >= existing.precedence ? existing.metadata.location : parsed.metadata.location,
          incomingScope: target.scope,
        });
      }

      if (!existing || target.precedence >= existing.precedence) {
        discoveredByName.set(parsed.metadata.name, {
          ...parsed,
          metadata: { ...parsed.metadata, scope: target.scope },
          precedence: target.precedence,
        });
      }
    }
  }

  const skills = [...discoveredByName.values()]
    .map((skill) => skill.metadata)
    .sort((left, right) => left.name.localeCompare(right.name));

  const fingerprints = await Promise.all(
    [...observedPaths].sort().map(async (observedPath) => getPathFingerprint(observedPath)),
  );

  logger.info('Skills discovery complete', {
    workspacePath,
    discoveredSkills: skills.length,
    observedPaths: fingerprints.length,
    scannedDirectories: scanState.scannedDirectories,
  });

  return {
    skills,
    catalog: buildSkillsCatalog(skills),
    fingerprints,
  };
}

function getScanTargets(workspacePath?: string): ScanTarget[] {
  const homeDir = getSafeHomeDir();
  const targets: ScanTarget[] = [
    { root: path.join(homeDir, '.agents', 'skills'), precedence: 1, scope: 'user' },
    { root: path.join(homeDir, '.claude', 'skills'), precedence: 2, scope: 'user' },
    { root: path.join(homeDir, '.augment', 'skills'), precedence: 3, scope: 'user' },
  ];

  if (workspacePath) {
    targets.push(
      {
        root: path.join(workspacePath, '.agents', 'skills'),
        precedence: 4,
        scope: 'project',
      },
      {
        root: path.join(workspacePath, '.augment', 'skills'),
        precedence: 5,
        scope: 'project',
      },
    );
  }

  return targets;
}

function normalizeWorkspacePath(workspacePath: string): string | undefined {
  const trimmedWorkspacePath = workspacePath.trim();
  if (trimmedWorkspacePath.length === 0) {
    return undefined;
  }

  return path.resolve(trimmedWorkspacePath);
}

async function findSkillFiles(
  rootPath: string,
  observedPaths: Set<string>,
  scanState: { scannedDirectories: number },
): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const skillFiles: string[] = [];

  const walk = async (currentPath: string, depth: number): Promise<void> => {
    if (scanState.scannedDirectories >= MAX_SCANNED_DIRECTORIES) {
      return;
    }

    scanState.scannedDirectories += 1;
    observedPaths.add(currentPath);

    let entries: Dirent[];
    try {
      entries = (await fs.readdir(currentPath, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    } catch (error) {
      logger.warn('Failed to read potential skills directory', {
        path: currentPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === SKILL_FILENAME);
    if (hasSkillFile) {
      const skillPath = path.join(currentPath, SKILL_FILENAME);
      observedPaths.add(skillPath);
      skillFiles.push(skillPath);
      return;
    }

    if (depth >= MAX_SCAN_DEPTH) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || NOISE_DIRECTORIES.has(entry.name)) {
        continue;
      }

      await walk(path.join(currentPath, entry.name), depth + 1);
      if (scanState.scannedDirectories >= MAX_SCANNED_DIRECTORIES) {
        logger.warn('Skills discovery stopped after reaching directory scan limit', {
          rootPath,
          limit: MAX_SCANNED_DIRECTORIES,
        });
        return;
      }
    }
  };

  await walk(rootPath, 0);
  return skillFiles;
}

async function parseSkillFile(skillPath: string): Promise<ParsedSkillFile | null> {
  let content: string;
  try {
    content = await fs.readFile(skillPath, 'utf-8');
  } catch (error) {
    logger.warn('Failed to read skill file', {
      skillPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = parseSkillContent(content);
  if (!parsed) {
    logger.warn('Skipping skill with unparseable YAML frontmatter', { skillPath });
    return null;
  }

  if (!parsed.name) {
    logger.warn('Skipping skill missing required name field', { skillPath });
    return null;
  }

  if (!parsed.description) {
    logger.warn('Skipping skill missing required description field', { skillPath });
    return null;
  }

  validateParsedSkill(skillPath, parsed);

  return {
    metadata: {
      name: parsed.name,
      description: parsed.description,
      location: skillPath,
      scope: 'user' as const,
      allowedTools: parsed.allowedTools,
      compatibility: parsed.compatibility,
    },
    body: parsed.body,
  };
}

function parseSkillContent(content: string): (ParsedSkillFrontmatter & { body: string }) | null {
  const extracted = extractFrontmatter(content);
  if (!extracted) {
    return null;
  }

  const parsedYaml =
    parseFrontmatterYaml(extracted.frontmatterText) ??
    parseFrontmatterYaml(quoteMalformedScalarValues(extracted.frontmatterText));

  if (!parsedYaml) {
    return null;
  }

  return {
    name: normalizeScalar(parsedYaml.name),
    description: normalizeScalar(parsedYaml.description),
    allowedTools: normalizeScalar(parsedYaml['allowed-tools']),
    compatibility: normalizeScalar(parsedYaml.compatibility),
    license: normalizeScalar(parsedYaml.license),
    metadata: normalizeStringMap(parsedYaml.metadata),
    body: extracted.body,
  };
}

function extractFrontmatter(content: string): { frontmatterText: string; body: string } | null {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalizedContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);

  if (!frontmatterMatch || !frontmatterMatch[1]) {
    return null;
  }

  return {
    frontmatterText: frontmatterMatch[1],
    body: normalizedContent.slice(frontmatterMatch[0].length).trim(),
  };
}

function parseFrontmatterYaml(frontmatterText: string): Record<string, unknown> | null {
  try {
    const parsed = yaml.load(frontmatterText);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function quoteMalformedScalarValues(frontmatterText: string): string {
  return frontmatterText
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*[A-Za-z0-9_-]+\s*:\s*)(.+)$/);
      if (!match) {
        return line;
      }

      const [, prefix, rawValue] = match;
      const value = rawValue.trim();
      if (
        value.length === 0 ||
        value.startsWith('"') ||
        value.startsWith("'") ||
        value.startsWith('[') ||
        value.startsWith('{') ||
        value === '|' ||
        value === '>' ||
        value === '|-' ||
        value === '>-' ||
        !value.includes(':')
      ) {
        return line;
      }

      return `${prefix}${JSON.stringify(value)}`;
    })
    .join('\n');
}

function validateParsedSkill(skillPath: string, parsed: ParsedSkillFrontmatter): void {
  const parentDirectoryName = path.basename(path.dirname(skillPath));

  if (parsed.name && parsed.name !== parentDirectoryName) {
    logger.warn('Skill name does not match parent directory name', {
      skillPath,
      name: parsed.name,
      parentDirectoryName,
    });
  }

  if (parsed.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.name)) {
    logger.warn('Skill name does not match the Agent Skills naming convention', {
      skillPath,
      name: parsed.name,
    });
  }
}

function normalizeScalar(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, normalizeScalar(entryValue)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildSkillsCatalog(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return '';
  }

  const skillXml = skills
    .map(
      (skill) => `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
    )
    .join('\n');

  return [
    'The following skills provide specialized instructions for specific tasks.',
    "When a task matches a skill's description, use your file-read tool to load",
    'the SKILL.md at the listed location before proceeding.',
    "When a skill references relative paths, resolve them against the skill's",
    'directory (the parent of SKILL.md) and use absolute paths in tool calls.',
    '',
    '<available_skills>',
    skillXml,
    '</available_skills>',
  ].join('\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function areFingerprintsCurrent(fingerprints: PathFingerprint[]): Promise<boolean> {
  const current = await Promise.all(fingerprints.map(async (fingerprint) => getPathFingerprint(fingerprint.path)));
  return current.every(
    (currentFingerprint, index) =>
      currentFingerprint.exists === fingerprints[index]?.exists &&
      currentFingerprint.mtimeMs === fingerprints[index]?.mtimeMs,
  );
}

async function getPathFingerprint(filePath: string): Promise<PathFingerprint> {
  try {
    const stats = await fs.stat(filePath);
    return {
      path: filePath,
      exists: true,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      mtimeMs: 0,
    };
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}