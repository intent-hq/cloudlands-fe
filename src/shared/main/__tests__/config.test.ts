/**
 * Tests for WorkspaceConfig + regression guard against legacy root probing.
 *
 * Workspace directories are daemon-owned (PROTOCOL.md §5.1) and resolved via
 * WorkspacePathService. The FE must never guess workspace paths from assumed
 * filesystem roots (~/intent, ~/intent/workspaces, ~/.workspaces) — the guards
 * below fail if that pattern creeps back in.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

import { WorkspaceConfig } from '../config';
import { CHIEF_WORKSPACE_ID } from '../../types/branded-ids';

const SRC_ROOT = path.resolve(__dirname, '../../..');
const CONFIG_SOURCE_PATH = path.resolve(__dirname, '../config.ts');

/** Recursively collect non-test .ts/.svelte sources under a directory. */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
      !entry.name.includes('.test.') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('WorkspaceConfig', () => {
  describe('isVirtualWorkspace', () => {
    it('should treat the chief workspace as virtual', () => {
      expect(WorkspaceConfig.isVirtualWorkspace(CHIEF_WORKSPACE_ID)).toBe(true);
    });

    it('should treat background service workspaces as virtual', () => {
      expect(WorkspaceConfig.isVirtualWorkspace('background-request')).toBe(true);
      expect(WorkspaceConfig.isVirtualWorkspace('http-bridge-workspace')).toBe(true);
    });

    it('should treat regular workspace IDs as non-virtual', () => {
      expect(WorkspaceConfig.isVirtualWorkspace('amber-forest')).toBe(false);
      expect(WorkspaceConfig.isVirtualWorkspace('my-workspace')).toBe(false);
    });
  });
});

describe('regression guard: no legacy workspace-root probing', () => {
  it('config.ts performs no filesystem access', () => {
    const source = readFileSync(CONFIG_SOURCE_PATH, 'utf-8');

    expect(source).not.toMatch(/from\s+['"](node:)?fs['"]/);
    expect(source).not.toMatch(/require\(\s*['"](node:)?fs['"]\s*\)/);
    expect(source).not.toMatch(/existsSync/);
    expect(source).not.toMatch(/readdir/);
  });

  it('config.ts derives no paths from assumed roots', () => {
    const source = readFileSync(CONFIG_SOURCE_PATH, 'utf-8');

    expect(source).not.toMatch(/resolveWorkspaceRoot/);
    expect(source).not.toMatch(/LEGACY_WORKSPACE_ROOT/);
    expect(source).not.toMatch(/['"]\.workspaces['"]/);
    expect(source).not.toMatch(/getSafeHomeDir/);
  });

  it('no source module references the deleted root-probing API or legacy roots', () => {
    const files = collectSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(100); // sanity: the scan found the tree

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (
        /resolveWorkspaceRoot/.test(source) ||
        /LEGACY_WORKSPACE_ROOT/.test(source) ||
        /['"]\.workspaces['"]/.test(source) ||
        /WorkspaceConfig\.paths\./.test(source)
      ) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
