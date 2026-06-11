import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  readRepoConfig,
  writeRepoConfig,
} from '../../workspace/main/repo-config.service';
import { readRepoScripts } from './scripts-persistence';
import type { RepoScript, RepoConfig } from '../../../shared/types/repo-config.types';
import type { WorkspaceScript } from '../types';

let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-config-scripts-test-'));
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe('RepoConfig scripts', () => {
  it('round-trips scripts through config.json', async () => {
    const scripts: RepoScript[] = [
      { name: 'dev', command: 'npm run dev', mode: 'service' },
    ];

    await writeRepoConfig(repoPath, { scripts });
    const config = await readRepoConfig(repoPath);

    expect(config.scripts).toEqual(scripts);
  });

  it('migrates from legacy .intent/scripts.json', async () => {
    // Write old-format .intent/scripts.json (ScriptsFileFormat with version + scripts)
    const intentDir = path.join(repoPath, '.intent');
    await fs.mkdir(intentDir, { recursive: true });

    const legacyScripts: WorkspaceScript[] = [
      {
        id: 'script-1',
        workspaceId: 'ws-1',
        name: 'dev',
        command: 'npm run dev',
        mode: 'service',
        category: 'dev',
        source: 'user',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ];

    await fs.writeFile(
      path.join(intentDir, 'scripts.json'),
      JSON.stringify({ version: 1, scripts: legacyScripts }, null, 2),
      'utf-8',
    );

    // Read via legacy reader
    const read = await readRepoScripts(repoPath);
    expect(read).toHaveLength(1);
    expect(read[0].name).toBe('dev');

    // Simulate migration: write to config.json, delete old file
    const repoScripts: RepoScript[] = read.map((s) => ({
      name: s.name,
      command: s.command,
      mode: s.mode,
      category: s.category,
      cwd: s.cwd,
      env: s.env,
      autoStart: s.autoStart,
    }));

    await writeRepoConfig(repoPath, { scripts: repoScripts });
    await fs.unlink(path.join(intentDir, 'scripts.json'));

    const config = await readRepoConfig(repoPath);
    expect(config.scripts).toHaveLength(1);
    expect(config.scripts![0].name).toBe('dev');

    // Old file should be gone
    await expect(fs.access(path.join(intentDir, 'scripts.json'))).rejects.toThrow();
  });

  it('preserves explicit empty scripts array', async () => {
    await writeRepoConfig(repoPath, { scripts: [] });
    const config = await readRepoConfig(repoPath);

    // scripts: [] means "intentionally empty", not undefined
    expect(config.scripts).toEqual([]);
    expect(config.scripts).not.toBeUndefined();
  });

  it('preserves other config fields alongside scripts', async () => {
    const config: RepoConfig = {
      branchPrefix: 'feat/',
      scripts: [{ name: 'test', command: 'npm test', mode: 'command' }],
    };

    await writeRepoConfig(repoPath, config);
    const read = await readRepoConfig(repoPath);

    expect(read.branchPrefix).toBe('feat/');
    expect(read.scripts).toEqual([{ name: 'test', command: 'npm test', mode: 'command' }]);
  });

  it('maps WorkspaceScript to RepoScript stripping workspace-specific fields', () => {
    const wsScript: WorkspaceScript = {
      id: 'script-abc',
      workspaceId: 'ws-123',
      name: 'lint',
      command: 'eslint .',
      mode: 'command',
      category: 'lint',
      cwd: 'packages/app',
      env: { NODE_ENV: 'test' },
      autoStart: false,
      source: 'user',
      createdAt: '2025-06-01T00:00:00Z',
      updatedAt: '2025-06-02T00:00:00Z',
    };

    // Map to RepoScript — only keep repo-level fields
    const repoScript: RepoScript = {
      name: wsScript.name,
      command: wsScript.command,
      mode: wsScript.mode,
      category: wsScript.category,
      cwd: wsScript.cwd,
      env: wsScript.env,
      autoStart: wsScript.autoStart,
    };

    expect(repoScript).toEqual({
      name: 'lint',
      command: 'eslint .',
      mode: 'command',
      category: 'lint',
      cwd: 'packages/app',
      env: { NODE_ENV: 'test' },
      autoStart: false,
    });

    // Verify workspace-specific fields are NOT present
    expect(repoScript).not.toHaveProperty('id');
    expect(repoScript).not.toHaveProperty('workspaceId');
    expect(repoScript).not.toHaveProperty('createdAt');
    expect(repoScript).not.toHaveProperty('updatedAt');
    expect(repoScript).not.toHaveProperty('source');
  });
});

