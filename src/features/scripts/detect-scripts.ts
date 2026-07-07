/**
 * Renderer-side script detection.
 *
 * Runs a heuristic scan across common root manifests but reads them through
 * the daemon-owned filesystem seam (`appClient.files.read`) so it works in
 * daemon builds where the renderer has no direct disk access.
 *
 * The detector only produces candidates; upsert-into-daemon and the diff
 * against the live `script.list` live in `scripts.client.ts` so the wire
 * responsibility stays in one place.
 */
import type { FilesClient } from '$lib/client';
import type { ScriptCategory, ScriptMode } from './types';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

/** A script candidate extracted from a workspace manifest, pre-daemon upsert. */
export interface DetectedScriptCandidate {
  name: string;
  command: string;
  mode: ScriptMode;
  category: ScriptCategory;
  source: 'package.json' | 'Makefile' | 'Cargo.toml' | 'pyproject.toml';
}

/** Result of a workspace detection pass. */
export interface DetectResult {
  candidates: DetectedScriptCandidate[];
  packageManager: PackageManager;
}

// ── Classification ──────────────────────────────────────────────────────────

interface ScriptClassification {
  category: ScriptCategory;
  mode: ScriptMode;
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

// ── Manifest parsers (pure — take content strings) ──────────────────────────

function getRunPrefix(pm: PackageManager): string {
  if (pm === 'pnpm') return 'pnpm';
  if (pm === 'yarn') return 'yarn';
  return 'npm run';
}

export function parsePackageJsonScripts(
  content: string,
  runPrefix: string,
): DetectedScriptCandidate[] {
  let pkgScripts: Record<string, string>;
  try {
    const pkg = JSON.parse(content);
    pkgScripts = (pkg && typeof pkg === 'object' && pkg.scripts) || {};
  } catch {
    return [];
  }
  return Object.keys(pkgScripts).map((name) => ({
    name,
    command: `${runPrefix} ${name}`,
    ...classifyScriptHeuristic(name),
    source: 'package.json' as const,
  }));
}

export function parseMakefileScripts(content: string): DetectedScriptCandidate[] {
  const targets = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^([A-Za-z0-9][A-Za-z0-9_.-]*(?:\s+[A-Za-z0-9][A-Za-z0-9_.-]*)*)\s*::?(?:\s|$)/,
    );
    if (!match) continue;
    for (const target of match[1].split(/\s+/)) {
      if (!target.includes('%')) targets.add(target);
    }
  }
  return [...targets].map((name) => ({
    name,
    command: `make ${name}`,
    ...classifyScriptHeuristic(name),
    source: 'Makefile' as const,
  }));
}

export function parseCargoTomlScripts(content: string): DetectedScriptCandidate[] {
  if (!/^\[(package|workspace)\]/m.test(content) && !/^\[\[bin\]\]/m.test(content)) {
    return [];
  }
  return ['build', 'test', 'check'].map((name) => ({
    name,
    command: `cargo ${name}`,
    ...classifyScriptHeuristic(name),
    source: 'Cargo.toml' as const,
  }));
}

export function parsePyprojectTomlScripts(content: string): DetectedScriptCandidate[] {
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
      category: 'test',
      mode: 'command',
      source: 'pyproject.toml',
    });
  }
  if (hasRuff) {
    scripts.push({
      name: 'lint',
      command: 'ruff check .',
      category: 'lint',
      mode: 'command',
      source: 'pyproject.toml',
    });
  }
  if (hasBlack) {
    scripts.push({
      name: 'format',
      command: 'black .',
      category: 'format',
      mode: 'command',
      source: 'pyproject.toml',
    });
  } else if (hasRuff) {
    scripts.push({
      name: 'format',
      command: 'ruff format .',
      category: 'format',
      mode: 'command',
      source: 'pyproject.toml',
    });
  }
  if (hasMypy) {
    scripts.push({
      name: 'typecheck',
      command: 'mypy .',
      category: 'typecheck',
      mode: 'command',
      source: 'pyproject.toml',
    });
  } else if (hasPyright) {
    scripts.push({
      name: 'typecheck',
      command: 'pyright',
      category: 'typecheck',
      mode: 'command',
      source: 'pyproject.toml',
    });
  }
  return scripts;
}

// ── Duplicate-name resolution (matches main scanner) ────────────────────────

function getManifestPrefix(source: DetectedScriptCandidate['source']): string {
  if (source === 'Makefile') return 'make';
  if (source === 'Cargo.toml') return 'cargo';
  if (source === 'pyproject.toml') return 'python';
  return 'script';
}

export function uniquifyScriptCandidates(
  candidates: DetectedScriptCandidate[],
): DetectedScriptCandidate[] {
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

// ── Orchestration ───────────────────────────────────────────────────────────

/** Read a workspace-relative manifest via the daemon; missing/unreadable → null. */
async function readManifest(
  files: FilesClient,
  workspaceId: string,
  path: string,
): Promise<string | null> {
  const entry = await files.read(workspaceId, path);
  return entry ? entry.originalContent : null;
}

/**
 * Detect the package manager by probing lockfiles at the workspace root via
 * the daemon `file.read` seam. Falls back to `npm` when no lockfile is present.
 */
export async function detectPackageManager(
  files: FilesClient,
  workspaceId: string,
): Promise<PackageManager> {
  const [pnpm, yarn] = await Promise.all([
    files.read(workspaceId, 'pnpm-lock.yaml'),
    files.read(workspaceId, 'yarn.lock'),
  ]);
  if (pnpm) return 'pnpm';
  if (yarn) return 'yarn';
  return 'npm';
}

/**
 * Scan a workspace for scripts across common root manifests.
 *
 * Reads every manifest through the daemon-owned `file.read` seam so it works
 * in daemon builds. Emits pure candidates — persistence + diff-against-
 * daemon-list happens in `scripts.client.ts`.
 */
export async function detectScriptCandidates(
  files: FilesClient,
  workspaceId: string,
): Promise<DetectResult> {
  const packageManager = await detectPackageManager(files, workspaceId);
  const runPrefix = getRunPrefix(packageManager);

  const [pkgJson, makefile, cargo, pyproject] = await Promise.all([
    readManifest(files, workspaceId, 'package.json'),
    readManifest(files, workspaceId, 'Makefile'),
    readManifest(files, workspaceId, 'Cargo.toml'),
    readManifest(files, workspaceId, 'pyproject.toml'),
  ]);

  const candidates: DetectedScriptCandidate[] = uniquifyScriptCandidates([
    ...(pkgJson ? parsePackageJsonScripts(pkgJson, runPrefix) : []),
    ...(makefile ? parseMakefileScripts(makefile) : []),
    ...(cargo ? parseCargoTomlScripts(cargo) : []),
    ...(pyproject ? parsePyprojectTomlScripts(pyproject) : []),
  ]);

  return { candidates, packageManager };
}
