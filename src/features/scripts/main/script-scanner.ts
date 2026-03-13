/**
 * Script Auto-Detection Scanner
 *
 * Discovers scripts from common root manifests and classifies them using:
 * 1. package.json scripts with LLM classification (preferred)
 * 2. Heuristic/fixed classification for common non-Node manifests
 *
 * Also detects the package manager from lockfiles and caches results at the repo level.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { AugmentCLI } from '../../auggie/main/augment-cli';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import type { WorkspaceScript, ScriptCategory, ScriptMode } from '../types';
import { REPO_INTENT_DIR } from '../../../shared/types/repo-config.types';

const logger = new Logger('ScriptScanner');

const SCRIPTS_CACHE_FILENAME = 'detected-scripts.json';

// ============================================================================
// Package Manager Detection
// ============================================================================

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export async function detectPackageManager(repoPath: string): Promise<PackageManager> {
  try {
    const files = await fs.readdir(repoPath);
    if (files.includes('pnpm-lock.yaml')) return 'pnpm';
    if (files.includes('yarn.lock')) return 'yarn';
  } catch {
    // ignore
  }
  return 'npm';
}

function getRunPrefix(pm: PackageManager): string {
  if (pm === 'pnpm') return 'pnpm';
  if (pm === 'yarn') return 'yarn';
  return 'npm run';
}

// ============================================================================
// Heuristic Classification
// ============================================================================

interface ScriptClassification {
  category: ScriptCategory;
  mode: ScriptMode;
}

type ScriptSourceManifest = 'package.json' | 'Makefile' | 'Cargo.toml' | 'pyproject.toml';

interface DetectedScriptCandidate {
  name: string;
  command: string;
  classification: ScriptClassification;
  source: ScriptSourceManifest;
}

const EXACT_MATCHES: Record<string, ScriptClassification> = {
  dev: { category: 'dev', mode: 'service' },
  start: { category: 'dev', mode: 'service' },
  serve: { category: 'dev', mode: 'service' },
  develop: { category: 'dev', mode: 'service' },
  build: { category: 'build', mode: 'command' },
  test: { category: 'test', mode: 'command' },
  lint: { category: 'lint', mode: 'command' },
  typecheck: { category: 'typecheck', mode: 'command' },
  'type-check': { category: 'typecheck', mode: 'command' },
  format: { category: 'format', mode: 'command' },
  fmt: { category: 'format', mode: 'command' },
  storybook: { category: 'storybook', mode: 'service' },
  prettier: { category: 'format', mode: 'command' },
  eslint: { category: 'lint', mode: 'command' },
  check: { category: 'typecheck', mode: 'command' },
  watch: { category: 'dev', mode: 'service' },
  preview: { category: 'dev', mode: 'service' },
};

const PREFIX_MATCHES: Array<{ prefix: string; classification: ScriptClassification }> = [
  { prefix: 'dev:', classification: { category: 'dev', mode: 'service' } },
  { prefix: 'dev-', classification: { category: 'dev', mode: 'service' } },
  { prefix: 'start:', classification: { category: 'dev', mode: 'service' } },
  { prefix: 'start-', classification: { category: 'dev', mode: 'service' } },
  { prefix: 'build:', classification: { category: 'build', mode: 'command' } },
  { prefix: 'build-', classification: { category: 'build', mode: 'command' } },
  { prefix: 'test:', classification: { category: 'test', mode: 'command' } },
  { prefix: 'test-', classification: { category: 'test', mode: 'command' } },
  { prefix: 'lint:', classification: { category: 'lint', mode: 'command' } },
  { prefix: 'lint-', classification: { category: 'lint', mode: 'command' } },
  { prefix: 'format:', classification: { category: 'format', mode: 'command' } },
  { prefix: 'format-', classification: { category: 'format', mode: 'command' } },
  { prefix: 'typecheck:', classification: { category: 'typecheck', mode: 'command' } },
  { prefix: 'type-check:', classification: { category: 'typecheck', mode: 'command' } },
  { prefix: 'storybook:', classification: { category: 'storybook', mode: 'service' } },
  { prefix: 'watch:', classification: { category: 'dev', mode: 'service' } },
  { prefix: 'watch-', classification: { category: 'dev', mode: 'service' } },
];

const SUBSTRING_MATCHES: Array<{ substring: string; classification: ScriptClassification }> = [
  { substring: 'storybook', classification: { category: 'storybook', mode: 'service' } },
  { substring: 'lint', classification: { category: 'lint', mode: 'command' } },
  { substring: 'test', classification: { category: 'test', mode: 'command' } },
  { substring: 'build', classification: { category: 'build', mode: 'command' } },
  { substring: 'format', classification: { category: 'format', mode: 'command' } },
  { substring: 'typecheck', classification: { category: 'typecheck', mode: 'command' } },
];

export function classifyScriptHeuristic(name: string): ScriptClassification {
  const lower = name.toLowerCase();
  if (EXACT_MATCHES[lower]) return EXACT_MATCHES[lower];
  for (const { prefix, classification } of PREFIX_MATCHES) {
    if (lower.startsWith(prefix)) return classification;
  }
  for (const { substring, classification } of SUBSTRING_MATCHES) {
    if (lower.includes(substring)) return classification;
  }
  return { category: 'other', mode: 'command' };
}

// ============================================================================
// LLM Classification
// ============================================================================

interface LLMScriptEntry {
  name: string;
  category: ScriptCategory;
  mode: ScriptMode;
}

const LLM_SYSTEM_PROMPT = `You are a script classifier. Given a list of package.json script entries, classify each one.

For each script, output:
- name: the script name (unchanged)
- category: one of "dev", "build", "test", "lint", "typecheck", "format", "storybook", "other"
- mode: "service" if it runs continuously (dev servers, watchers, storybook), "command" if it runs once and exits (build, test, lint)

Respond ONLY with a JSON array. No explanation, no markdown fences. Example:
[{"name":"dev","category":"dev","mode":"service"},{"name":"build","category":"build","mode":"command"}]`;

async function classifyScriptsWithLLM(
  scripts: Record<string, string>,
): Promise<LLMScriptEntry[] | null> {
  try {
    const cli = new AugmentCLI();
    const entries = Object.entries(scripts).map(([name, cmd]) => `${name}: ${cmd}`);
    const message = `Classify these package.json scripts:\n${entries.join('\n')}`;

    const response = await cli.streamChat(
      message,
      {
        model: MODEL_DEFAULTS.BACKGROUND_REQUEST_MODEL,
        agentId: 'script-scanner',
        systemPrompt: LLM_SYSTEM_PROMPT,
        skipMcp: true,
      },
      () => {},
      undefined,
      30000,
    );

    if (!response.content) return null;

    let jsonStr = response.content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;

    const validCategories = new Set<string>([
      'dev', 'build', 'test', 'lint', 'typecheck', 'format', 'storybook', 'other',
    ]);
    const validModes = new Set<string>(['service', 'command']);

    return parsed
      .filter(
        (entry: any) =>
          typeof entry.name === 'string' &&
          validCategories.has(entry.category) &&
          validModes.has(entry.mode),
      )
      .map((entry: any) => ({
        name: entry.name as string,
        category: entry.category as ScriptCategory,
        mode: entry.mode as ScriptMode,
      }));
  } catch (error) {
    logger.warn('LLM script classification failed, falling back to heuristics', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// Manifest Detection
// ============================================================================

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function detectPackageJsonScripts(
  repoPath: string,
  runPrefix: string,
  options?: { skipLLM?: boolean },
): Promise<DetectedScriptCandidate[]> {
  const content = await readFileIfExists(path.join(repoPath, 'package.json'));
  if (!content) return [];

  let pkgScripts: Record<string, string>;
  try {
    const pkg = JSON.parse(content);
    pkgScripts = pkg.scripts || {};
  } catch {
    logger.debug('No package.json or parse error', { repoPath });
    return [];
  }

  const scriptNames = Object.keys(pkgScripts);
  if (scriptNames.length === 0) return [];

  const classifications = new Map<string, ScriptClassification>();

  if (!options?.skipLLM) {
    const llmResult = await classifyScriptsWithLLM(pkgScripts);
    if (llmResult) {
      for (const entry of llmResult) {
        classifications.set(entry.name, { category: entry.category, mode: entry.mode });
      }
      logger.info('LLM classified scripts', { count: llmResult.length });
    }
  }

  return scriptNames.map((name) => ({
    name,
    command: `${runPrefix} ${name}`,
    classification: classifications.get(name) || classifyScriptHeuristic(name),
    source: 'package.json' as const,
  }));
}

async function detectMakefileScripts(repoPath: string): Promise<DetectedScriptCandidate[]> {
  const content = await readFileIfExists(path.join(repoPath, 'Makefile'));
  if (!content) return [];

  const targets = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9_.-]*)*)\s*::?(?:\s|$)/);
    if (!match) continue;

    for (const target of match[1].split(/\s+/)) {
      if (!target.includes('%')) targets.add(target);
    }
  }

  return [...targets].map((name) => ({
    name,
    command: `make ${name}`,
    classification: classifyScriptHeuristic(name),
    source: 'Makefile' as const,
  }));
}

async function detectCargoScripts(repoPath: string): Promise<DetectedScriptCandidate[]> {
  const content = await readFileIfExists(path.join(repoPath, 'Cargo.toml'));
  if (!content) return [];

  if (!/^\[(package|workspace)\]/m.test(content) && !/^\[\[bin\]\]/m.test(content)) {
    return [];
  }

  return ['build', 'test', 'check'].map((name) => ({
    name,
    command: `cargo ${name}`,
    classification: classifyScriptHeuristic(name),
    source: 'Cargo.toml' as const,
  }));
}

async function detectPyprojectScripts(repoPath: string): Promise<DetectedScriptCandidate[]> {
  const content = await readFileIfExists(path.join(repoPath, 'pyproject.toml'));
  if (!content) return [];

  const scripts: DetectedScriptCandidate[] = [];
  const hasPytest = /^\[tool\.pytest(?:\.ini_options)?\]/m.test(content);
  const hasRuff = /^\[tool\.ruff(?:\]|\.)/m.test(content);
  const hasBlack = /^\[tool\.black\]/m.test(content);
  const hasMypy = /^\[tool\.mypy\]/m.test(content);
  const hasPyright = /^\[tool\.pyright\]/m.test(content);

  if (hasPytest) {
    scripts.push({
      name: 'test',
      command: 'pytest',
      classification: { category: 'test', mode: 'command' },
      source: 'pyproject.toml',
    });
  }

  if (hasRuff) {
    scripts.push({
      name: 'lint',
      command: 'ruff check .',
      classification: { category: 'lint', mode: 'command' },
      source: 'pyproject.toml',
    });
  }

  if (hasBlack) {
    scripts.push({
      name: 'format',
      command: 'black .',
      classification: { category: 'format', mode: 'command' },
      source: 'pyproject.toml',
    });
  } else if (hasRuff) {
    scripts.push({
      name: 'format',
      command: 'ruff format .',
      classification: { category: 'format', mode: 'command' },
      source: 'pyproject.toml',
    });
  }

  if (hasMypy) {
    scripts.push({
      name: 'typecheck',
      command: 'mypy .',
      classification: { category: 'typecheck', mode: 'command' },
      source: 'pyproject.toml',
    });
  } else if (hasPyright) {
    scripts.push({
      name: 'typecheck',
      command: 'pyright',
      classification: { category: 'typecheck', mode: 'command' },
      source: 'pyproject.toml',
    });
  }

  return scripts;
}

function getManifestPrefix(source: ScriptSourceManifest): string {
  if (source === 'Makefile') return 'make';
  if (source === 'Cargo.toml') return 'cargo';
  if (source === 'pyproject.toml') return 'python';
  return 'script';
}

function uniquifyScriptCandidates(candidates: DetectedScriptCandidate[]): DetectedScriptCandidate[] {
  const usedNames = new Set<string>();

  return candidates.map((candidate) => {
    let uniqueName = candidate.name;

    if (usedNames.has(uniqueName)) {
      const prefixedName = `${getManifestPrefix(candidate.source)}:${candidate.name}`;
      uniqueName = prefixedName;

      let suffix = 2;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${prefixedName}-${suffix}`;
        suffix += 1;
      }
    }

    usedNames.add(uniqueName);
    return { ...candidate, name: uniqueName };
  });
}

// ============================================================================
// Repo-Level Cache
// ============================================================================

interface ScriptsCacheFormat {
  version: number;
  detectedAt: string;
  packageManager: PackageManager;
  /** Hash of manifest file contents so script-body changes invalidate the cache. */
  manifestHash?: string;
  scripts: Array<{
    name: string;
    command: string;
    category: ScriptCategory;
    mode: ScriptMode;
  }>;
}

function getCachePath(repoPath: string): string {
  return path.join(repoPath, REPO_INTENT_DIR, SCRIPTS_CACHE_FILENAME);
}

/**
 * Compute a hash of the manifest files that drive script detection.
 * This ensures the cache is invalidated when the underlying script bodies
 * change (e.g. package.json "dev": "vite" → "dev": "next dev").
 */
async function computeManifestHash(repoPath: string): Promise<string> {
  const manifests = ['package.json', 'Makefile', 'Cargo.toml', 'pyproject.toml'];
  const hash = createHash('sha256');
  for (const name of manifests) {
    const content = await readFileIfExists(path.join(repoPath, name));
    if (content) {
      hash.update(`${name}:${content}`);
    }
  }
  return hash.digest('hex');
}

async function readCache(repoPath: string): Promise<ScriptsCacheFormat | null> {
  try {
    const content = await fs.readFile(getCachePath(repoPath), 'utf-8');
    const data = JSON.parse(content);
    if (data.version === 1 && Array.isArray(data.scripts)) {
      return data as ScriptsCacheFormat;
    }
  } catch {
    // No cache or invalid
  }
  return null;
}

async function writeCache(repoPath: string, cache: ScriptsCacheFormat): Promise<void> {
  const cachePath = getCachePath(repoPath);
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  logger.debug('Script cache written', { repoPath, count: cache.scripts.length });
}

// ============================================================================
// Main Scanner
// ============================================================================

export interface ScanResult {
  scripts: WorkspaceScript[];
  packageManager: PackageManager;
  fromCache: boolean;
}

/**
 * Scan a repository for common root-manifest scripts and classify them.
 *
 * Flow:
 * 1. Detect package manager from lockfiles
 * 2. Read package.json, Makefile, Cargo.toml, and pyproject.toml from repo root
 * 3. Classify scripts using heuristics (LLM classification is opt-in via skipLLM: false)
 * 4. Cache results at repo level (.intent/detected-scripts.json)
 * 5. Return WorkspaceScript[] ready for merging
 *
 * By default the interactive detect path passes skipLLM: true so detection
 * completes without waiting on any remote call.
 */
export async function scanScripts(
  workspaceId: string,
  repoPath: string,
  options?: { skipLLM?: boolean; skipCache?: boolean },
): Promise<ScanResult> {
  const pm = await detectPackageManager(repoPath);
  const runPrefix = getRunPrefix(pm);
  // Default to skipping LLM so the interactive detect path stays fully local.
  // Callers that want LLM classification must explicitly pass { skipLLM: false }.
  const resolvedOptions = { skipLLM: true, ...options };

  const detectedCandidates = uniquifyScriptCandidates([
    ...(await detectPackageJsonScripts(repoPath, runPrefix, resolvedOptions)),
    ...(await detectMakefileScripts(repoPath)),
    ...(await detectCargoScripts(repoPath)),
    ...(await detectPyprojectScripts(repoPath)),
  ]);

  if (detectedCandidates.length === 0) {
    return { scripts: [], packageManager: pm, fromCache: false };
  }

  // Compute a hash of the raw manifest contents so that changes to script
  // bodies (e.g. package.json "dev": "vite" → "next dev") invalidate the cache
  // even when the generated command stays the same ("npm run dev").
  const manifestHash = await computeManifestHash(repoPath);

  // Check repo-level cache (unless forced re-scan)
  if (!options?.skipCache) {
    const cached = await readCache(repoPath);
    if (cached && cached.packageManager === pm && cached.manifestHash === manifestHash) {
      // Verify cache is still valid (same detected names AND commands)
      const cachedKeys = new Set(cached.scripts.map((s) => `${s.name}::${s.command}`));
      const currentKeys = new Set(detectedCandidates.map((s) => `${s.name}::${s.command}`));
      const sameScripts =
        cachedKeys.size === currentKeys.size &&
        [...cachedKeys].every((k) => currentKeys.has(k));

      if (sameScripts) {
        logger.debug('Using cached script classifications', { repoPath });
        const scripts = cached.scripts.map((s) => ({
          id: uuidv4(),
          workspaceId,
          name: s.name,
          command: s.command,
          mode: s.mode,
          category: s.category,
          source: 'auto-detected' as const,
          createdAt: new Date().toISOString(),
        }));
        return { scripts, packageManager: pm, fromCache: true };
      }
    }
  }

  // Build WorkspaceScript array
  const scripts: WorkspaceScript[] = detectedCandidates.map((candidate) => ({
      id: uuidv4(),
      workspaceId,
      name: candidate.name,
      command: candidate.command,
      mode: candidate.classification.mode,
      category: candidate.classification.category,
      source: 'auto-detected' as const,
      createdAt: new Date().toISOString(),
    }));

  // Write cache
  try {
    await writeCache(repoPath, {
      version: 1,
      detectedAt: new Date().toISOString(),
      packageManager: pm,
      manifestHash,
      scripts: scripts.map((s) => ({
        name: s.name,
        command: s.command,
        category: s.category!,
        mode: s.mode,
      })),
    });
  } catch (error) {
    logger.warn('Failed to write script cache', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { scripts, packageManager: pm, fromCache: false };
}

/**
 * Merge detected scripts with existing scripts.
 *
 * Rules:
 * - User-created scripts are NEVER modified or removed (sacred)
 * - Auto-detected scripts are updated if the command changed
 * - New auto-detected scripts are added
 * - Auto-detected scripts no longer in package.json are removed
 *
 * Returns the list of scripts to add/update (caller handles persistence).
 */
export function mergeDetectedScripts(
  existing: WorkspaceScript[],
  detected: WorkspaceScript[],
): { toAdd: WorkspaceScript[]; toRemove: string[] } {
  const toAdd: WorkspaceScript[] = [];
  const toRemove: string[] = [];

  // Index existing auto-detected scripts by name
  const existingAutoByName = new Map<string, WorkspaceScript>();
  const existingUserNames = new Set<string>();
  for (const s of existing) {
    if (s.source === 'auto-detected') {
      existingAutoByName.set(s.name, s);
    } else {
      existingUserNames.add(s.name);
    }
  }

  // Process detected scripts
  const detectedNames = new Set<string>();
  for (const d of detected) {
    detectedNames.add(d.name);

    // Skip if user has a script with the same name
    if (existingUserNames.has(d.name)) continue;

    const existingAuto = existingAutoByName.get(d.name);
    if (!existingAuto) {
      // New script
      toAdd.push(d);
    } else if (
      existingAuto.command !== d.command ||
      existingAuto.category !== d.category ||
      existingAuto.mode !== d.mode
    ) {
      // Updated script — keep the existing ID
      toAdd.push({
        ...d,
        id: existingAuto.id,
        updatedAt: new Date().toISOString(),
      });
    }
    // else: unchanged, skip
  }

  // Remove auto-detected scripts no longer in package.json
  for (const [name, s] of existingAutoByName) {
    if (!detectedNames.has(name)) {
      toRemove.push(s.id);
    }
  }

  return { toAdd, toRemove };
}

