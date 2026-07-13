import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FilesClient } from '$lib/client';
import type { FileContentEntry } from '$store/renderer/slices/files/files-types';
import {
  classifyScriptHeuristic,
  detectPackageManager,
  detectScriptCandidates,
  parseCargoTomlScripts,
  parseMakefileScripts,
  parsePackageJsonScripts,
  parsePyprojectTomlScripts,
  uniquifyScriptCandidates,
} from './detect-scripts';

function fileEntry(path: string, content: string): FileContentEntry {
  return {
    path,
    absolutePath: null,
    originalContent: content,
    localContent: content,
    lastUpdated: Date.now(),
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
  };
}

function makeFakeFilesClient(byPath: Record<string, string>): FilesClient {
  return {
    async list() {
      return [];
    },
    async read(_workspaceId, path) {
      const content = byPath[path];
      return content !== undefined ? fileEntry(path, content) : null;
    },
    async explorerTree() {
      return null;
    },
    async listDirectory() {
      return [];
    },
    async gitStatusMap() {
      return {};
    },
    subscribe() {
      return () => {};
    },
    async write() {
      return { success: true };
    },
    async delete() {
      return { success: true };
    },
    async mkdir() {
      return { success: true };
    },
    async rename() {
      return { success: true };
    },
  };
}

describe('classifyScriptHeuristic', () => {
  it('matches common package-manager script names by exact spelling', () => {
    expect(classifyScriptHeuristic('dev')).toEqual({ category: 'dev', mode: 'service' });
    expect(classifyScriptHeuristic('build')).toEqual({ category: 'build', mode: 'command' });
    expect(classifyScriptHeuristic('test')).toEqual({ category: 'test', mode: 'command' });
  });

  it('matches prefixed and substring script names', () => {
    expect(classifyScriptHeuristic('dev:web')).toEqual({ category: 'dev', mode: 'service' });
    expect(classifyScriptHeuristic('test:unit')).toEqual({ category: 'test', mode: 'command' });
    expect(classifyScriptHeuristic('some-storybook-thing')).toEqual({
      category: 'storybook',
      mode: 'service',
    });
  });

  it('falls back to "other" / "command" for unknown names', () => {
    expect(classifyScriptHeuristic('publish')).toEqual({ category: 'other', mode: 'command' });
  });
});

describe('parsePackageJsonScripts', () => {
  it('emits one candidate per scripts entry with the given run prefix', () => {
    const content = JSON.stringify({ scripts: { dev: 'vite', test: 'vitest run' } });
    const candidates = parsePackageJsonScripts(content, 'pnpm');
    expect(candidates).toEqual([
      { name: 'dev', command: 'pnpm dev', category: 'dev', mode: 'service', source: 'package.json' },
      {
        name: 'test',
        command: 'pnpm test',
        category: 'test',
        mode: 'command',
        source: 'package.json',
      },
    ]);
  });

  it('returns an empty list when JSON is malformed or scripts is missing', () => {
    expect(parsePackageJsonScripts('not json', 'npm run')).toEqual([]);
    expect(parsePackageJsonScripts(JSON.stringify({ name: 'x' }), 'npm run')).toEqual([]);
  });
});

describe('parseMakefileScripts', () => {
  it('detects targets and skips pattern rules and leading-dot directives', () => {
    const content = [
      '.PHONY: dev build',
      'dev:',
      '\techo dev',
      'build test:',
      '\techo done',
      '%.o: %.c',
      '\tcc -c $<',
    ].join('\n');
    const names = parseMakefileScripts(content).map((c) => c.name).sort();
    expect(names).toEqual(['build', 'dev', 'test']);
  });
});

describe('parseCargoTomlScripts', () => {
  it('emits build/test/check when Cargo.toml has a [package]', () => {
    const names = parseCargoTomlScripts('[package]\nname = "x"').map((c) => c.name).sort();
    expect(names).toEqual(['build', 'check', 'test']);
  });

  it('returns nothing when the manifest is not a package / workspace / bin manifest', () => {
    expect(parseCargoTomlScripts('# empty')).toEqual([]);
  });
});

describe('parsePyprojectTomlScripts', () => {
  it('emits tool-driven candidates and prefers black over ruff format when both are present', () => {
    const content = ['[tool.pytest.ini_options]', '[tool.ruff]', '[tool.black]', '[tool.mypy]'].join(
      '\n',
    );
    const names = parsePyprojectTomlScripts(content).map((c) => c.name).sort();
    expect(names).toEqual(['format', 'lint', 'test', 'typecheck']);
    const format = parsePyprojectTomlScripts(content).find((c) => c.name === 'format');
    expect(format?.command).toBe('black .');
  });
});

describe('uniquifyScriptCandidates', () => {
  it('prefixes duplicates with the manifest and suffixes further collisions', () => {
    const result = uniquifyScriptCandidates([
      { name: 'test', command: 'pnpm test', category: 'test', mode: 'command', source: 'package.json' },
      { name: 'test', command: 'make test', category: 'test', mode: 'command', source: 'Makefile' },
      { name: 'test', command: 'cargo test', category: 'test', mode: 'command', source: 'Cargo.toml' },
    ]);
    expect(result.map((c) => c.name)).toEqual(['test', 'make:test', 'cargo:test']);
  });
});

describe('detectPackageManager', () => {
  afterEach(() => vi.clearAllMocks());

  it('picks pnpm when pnpm-lock.yaml is present', async () => {
    const files = makeFakeFilesClient({ 'pnpm-lock.yaml': '' });
    expect(await detectPackageManager(files, 'ws-1')).toBe('pnpm');
  });

  it('picks yarn when yarn.lock is present without pnpm-lock.yaml', async () => {
    const files = makeFakeFilesClient({ 'yarn.lock': '' });
    expect(await detectPackageManager(files, 'ws-1')).toBe('yarn');
  });

  it('defaults to npm when no lockfile is present', async () => {
    const files = makeFakeFilesClient({});
    expect(await detectPackageManager(files, 'ws-1')).toBe('npm');
  });
});

describe('detectScriptCandidates', () => {
  it('aggregates candidates across all root manifests through file.read', async () => {
    const files = makeFakeFilesClient({
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
      Makefile: 'lint:\n\techo hi',
      'Cargo.toml': '[package]\nname = "x"',
      'pyproject.toml': '[tool.pytest.ini_options]',
    });

    const result = await detectScriptCandidates(files, 'ws-1');

    expect(result.packageManager).toBe('pnpm');
    // Duplicate `test` from Cargo + pyproject collapses through uniquify — Cargo
    // wins the bare `test` (it's parsed first), pyproject becomes `python:test`.
    const names = result.candidates.map((c) => c.name).sort();
    expect(names).toEqual(['build', 'check', 'dev', 'lint', 'python:test', 'test']);
    const dev = result.candidates.find((c) => c.name === 'dev');
    expect(dev?.command).toBe('pnpm dev');
  });

  it('resolves an empty candidate list when no manifests are readable', async () => {
    const files = makeFakeFilesClient({});
    const result = await detectScriptCandidates(files, 'ws-1');
    expect(result.candidates).toEqual([]);
    expect(result.packageManager).toBe('npm');
  });
});
