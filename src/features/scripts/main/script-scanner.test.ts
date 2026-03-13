import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockStreamChat = vi.fn().mockResolvedValue({ content: null });

vi.mock('../../auggie/main/augment-cli', () => ({
  AugmentCLI: class {
    streamChat = mockStreamChat;
  },
}));

import { scanScripts } from './script-scanner';

let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'script-scanner-test-'));
  mockStreamChat.mockClear();
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repoPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

function summarize(result: Awaited<ReturnType<typeof scanScripts>>) {
  return result.scripts
    .map(({ name, command, category, mode }) => ({ name, command, category, mode }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('scanScripts', () => {
  it('detects package.json scripts with the inferred package manager prefix', async () => {
    await writeRepoFile(
      'package.json',
      JSON.stringify({ scripts: { dev: 'vite', test: 'vitest run' } }, null, 2),
    );
    await writeRepoFile('yarn.lock', '');

    const result = await scanScripts('workspace-1', repoPath, { skipLLM: true, skipCache: true });

    expect(summarize(result)).toEqual([
      { name: 'dev', command: 'yarn dev', category: 'dev', mode: 'service' },
      { name: 'test', command: 'yarn test', category: 'test', mode: 'command' },
    ]);
  });

  it('detects runnable Makefile targets without package.json', async () => {
    await writeRepoFile(
      'Makefile',
      ['.PHONY: dev build test lint', 'dev:', '\tpython -m http.server', 'build test:', '\t@echo done', 'lint::', '\t@echo lint'].join('\n'),
    );

    const result = await scanScripts('workspace-1', repoPath, { skipLLM: true, skipCache: true });

    expect(summarize(result)).toEqual([
      { name: 'build', command: 'make build', category: 'build', mode: 'command' },
      { name: 'dev', command: 'make dev', category: 'dev', mode: 'service' },
      { name: 'lint', command: 'make lint', category: 'lint', mode: 'command' },
      { name: 'test', command: 'make test', category: 'test', mode: 'command' },
    ]);
  });

  it('detects common Cargo.toml commands', async () => {
    await writeRepoFile('Cargo.toml', ['[package]', 'name = "demo"', 'version = "0.1.0"'].join('\n'));

    const result = await scanScripts('workspace-1', repoPath, { skipLLM: true, skipCache: true });

    expect(summarize(result)).toEqual([
      { name: 'build', command: 'cargo build', category: 'build', mode: 'command' },
      { name: 'check', command: 'cargo check', category: 'typecheck', mode: 'command' },
      { name: 'test', command: 'cargo test', category: 'test', mode: 'command' },
    ]);
  });

  it('detects common pyproject.toml tool commands', async () => {
    await writeRepoFile(
      'pyproject.toml',
      [
        '[tool.pytest.ini_options]',
        'addopts = "-q"',
        '',
        '[tool.ruff]',
        'line-length = 100',
        '',
        '[tool.black]',
        'line-length = 100',
        '',
        '[tool.mypy]',
        'python_version = "3.12"',
      ].join('\n'),
    );

    const result = await scanScripts('workspace-1', repoPath, { skipLLM: true, skipCache: true });

    expect(summarize(result)).toEqual([
      { name: 'format', command: 'black .', category: 'format', mode: 'command' },
      { name: 'lint', command: 'ruff check .', category: 'lint', mode: 'command' },
      { name: 'test', command: 'pytest', category: 'test', mode: 'command' },
      { name: 'typecheck', command: 'mypy .', category: 'typecheck', mode: 'command' },
    ]);
  });

  it('does not call LLM when skipLLM is true', async () => {
    await writeRepoFile(
      'package.json',
      JSON.stringify({ scripts: { dev: 'vite', build: 'tsc && vite build' } }, null, 2),
    );

    await scanScripts('workspace-1', repoPath, { skipLLM: true, skipCache: true });

    expect(mockStreamChat).not.toHaveBeenCalled();
  });

  it('calls LLM when skipLLM is explicitly false', async () => {
    await writeRepoFile(
      'package.json',
      JSON.stringify({ scripts: { dev: 'vite' } }, null, 2),
    );

    await scanScripts('workspace-1', repoPath, { skipLLM: false, skipCache: true });

    expect(mockStreamChat).toHaveBeenCalledTimes(1);
  });

  it('reuses and invalidates cache based on the detected command set', async () => {
    await writeRepoFile('Makefile', ['build:', '\t@echo build'].join('\n'));

    const first = await scanScripts('workspace-1', repoPath, { skipLLM: true });
    const second = await scanScripts('workspace-1', repoPath, { skipLLM: true });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);

    await writeRepoFile('Makefile', ['build:', '\t@echo build', 'test:', '\t@echo test'].join('\n'));

    const third = await scanScripts('workspace-1', repoPath, { skipLLM: true });

    expect(third.fromCache).toBe(false);
    expect(summarize(third)).toEqual([
      { name: 'build', command: 'make build', category: 'build', mode: 'command' },
      { name: 'test', command: 'make test', category: 'test', mode: 'command' },
    ]);
  });

  it('default scanScripts path does not invoke LLM (regression guard)', async () => {
    // scanScripts defaults to skipLLM: true so the interactive detect path
    // completes without any network/LLM round-trip. If this test fails, it
    // means the default has regressed, adding 15-30s of latency.
    await writeRepoFile(
      'package.json',
      JSON.stringify({
        scripts: { dev: 'vite', build: 'tsc && vite build', test: 'vitest run', lint: 'eslint .' },
      }, null, 2),
    );

    const result = await scanScripts('workspace-1', repoPath, { skipCache: true });

    // The LLM must never have been called
    expect(mockStreamChat).not.toHaveBeenCalled();

    // Heuristic classification must still produce correct results
    expect(summarize(result)).toEqual([
      { name: 'build', command: 'npm run build', category: 'build', mode: 'command' },
      { name: 'dev', command: 'npm run dev', category: 'dev', mode: 'service' },
      { name: 'lint', command: 'npm run lint', category: 'lint', mode: 'command' },
      { name: 'test', command: 'npm run test', category: 'test', mode: 'command' },
    ]);
  });
});