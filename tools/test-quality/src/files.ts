import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Config } from './types.ts';

export const hash = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');

export const slash = (value: string): string => value.split(path.sep).join('/');
export const isTestFile = (value: string): boolean =>
  /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/.test(value);
const sourceFile = /\.(?:[cm]?[jt]sx?|svelte|json)$/;
const ignored = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  'playwright-report',
  'test-results',
]);

export const defaults: Config = {
  include: ['**'],
  exclude: ['tools/test-quality/**'],
  aliases: {},
  maxContextChars: 20000,
  maxFragments: 24,
  maxDepth: 4,
};

export function readConfig(file?: string): Config {
  const input = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const config = { ...defaults, ...input } as Config;
  if (Object.keys(input).some((key) => !(key in defaults)))
    throw new Error('Unknown configuration field');
  for (const key of ['include', 'exclude'] as const) {
    if (!Array.isArray(config[key]) || !config[key].every((v) => typeof v === 'string'))
      throw new Error(`Invalid ${key}`);
  }
  if (
    !config.aliases ||
    Array.isArray(config.aliases) ||
    typeof config.aliases !== 'object' ||
    !Object.values(config.aliases).every((v) => typeof v === 'string')
  )
    throw new Error('Invalid aliases');
  for (const key of ['maxContextChars', 'maxFragments', 'maxDepth'] as const) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Invalid ${key}`);
  }
  if (config.maxContextChars < 4000 || config.maxContextChars > 24000)
    throw new Error('maxContextChars must be between 4000 and 24000');
  return config;
}

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function inventory(root: string, config: Config): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(root, absolute));
      if (
        relative === 'tools/test-quality' ||
        config.exclude.some((p) => path.matchesGlob(relative, p))
      )
        continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && sourceFile.test(relative)) files.push(relative);
    }
  };
  walk(root);
  return files.sort();
}

export function selectedFiles(files: string[], selectors: string[], config: Config): string[] {
  const candidates = files.filter(
    (file) => isTestFile(file) && config.include.some((p) => path.matchesGlob(file, p)),
  );
  if (!selectors.length) return candidates;
  const normalized = selectors.map((s) => slash(s).replace(/^\.\//, '').replace(/\/$/, ''));
  const matches = (file: string, selector: string): boolean =>
    file === selector || file.startsWith(`${selector}/`) || path.matchesGlob(file, selector);
  for (const selector of normalized)
    if (!candidates.some((f) => matches(f, selector)))
      throw new Error(`No test files match: ${selector}`);
  return candidates.filter((f) => normalized.some((s) => matches(f, s)));
}

export class Sources {
  root: string;
  texts = new Map<string, string>();
  hashes = new Map<string, string>();
  constructor(root: string) {
    this.root = realpathSync(root);
  }
  read(file: string): string {
    if (!this.texts.has(file)) {
      const absolute = realpathSync(path.resolve(this.root, file));
      if (!inside(this.root, absolute)) throw new Error(`Source escapes root: ${file}`);
      const text = readFileSync(absolute, 'utf8');
      this.texts.set(file, text);
      this.hashes.set(file, hash(text));
    }
    return this.texts.get(file)!;
  }
  digest(file: string): string {
    this.read(file);
    return this.hashes.get(file)!;
  }
}
