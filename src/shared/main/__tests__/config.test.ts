/**
 * Tests for WorkspaceConfig + regression guard against legacy root probing.
 *
 * Workspace directories are daemon-owned (PROTOCOL.md §5.1) and resolved via
 * WorkspacePathService. The FE must never guess workspace paths from assumed
 * filesystem roots (~/intent, ~/intent/workspaces, ~/.workspaces) — the guards
 * below fail if that pattern creeps back in.
 */

import { describe, it, expect } from 'vitest';
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

    // No fs imports in any form: 'fs', 'node:fs', 'fs/promises', 'node:fs/promises'.
    expect(source).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/);
    expect(source).not.toMatch(/require\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/);
    expect(source).not.toMatch(/import\(\s*['"](node:)?fs(\/promises)?['"]\s*\)/);
    // No filesystem probe calls, sync or async.
    expect(source).not.toMatch(/existsSync/);
    expect(source).not.toMatch(/readdir/);
    expect(source).not.toMatch(/\baccess(Sync)?\s*\(/);
    expect(source).not.toMatch(/\b(l)?stat(Sync)?\s*\(/);
  });

  it('config.ts derives no paths from assumed roots', () => {
    const source = readFileSync(CONFIG_SOURCE_PATH, 'utf-8');

    expect(source).not.toMatch(/resolveWorkspaceRoot/);
    expect(source).not.toMatch(/LEGACY_WORKSPACE_ROOT/);
    expect(source).not.toMatch(/['"]\.workspaces['"]/);
    expect(source).not.toMatch(/getSafeHomeDir/);
    // No home-directory-based root derivation (os.homedir + path.join guessing).
    expect(source).not.toMatch(/homedir/);
    expect(source).not.toMatch(/from\s+['"](node:)?os['"]/);
    expect(source).not.toMatch(/require\(\s*['"](node:)?os['"]\s*\)/);
    expect(source).not.toMatch(/process\.env\.HOME/);
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
        /WorkspaceConfig\.paths\./.test(source) ||
        // The browser-side WorkspaceConfig.WORKSPACE_ROOT getter (deleted
        // config-browser.ts, monorepo#1883) returned a hardcoded '~/intent'.
        /WorkspaceConfig\.WORKSPACE_ROOT/.test(source) ||
        /from\s+['"][^'"]*config-browser['"]/.test(source) ||
        // WORKSPACE_BASE-style hardcoded roots (deleted from constants.ts and
        // constants/agent-services.ts, monorepo#1906): no constant may carry
        // the workspace base, and the '~/intent' literal (quoted or template)
        // must not reappear.
        /\bWORKSPACE_BASE\b/.test(source) ||
        /['"`]~\/intent['"`]/.test(source)
      ) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no source module derives a workspace root from the home directory', () => {
    // The daemon owns the workspaces root; the FE must never fabricate it as
    // ~/intent (the deleted system:workspace-root handler did exactly that,
    // monorepo#1793). Subpaths like join(homedir(), 'intent', 'logs') are
    // app-storage locations, not workspace-root guesses, and stay allowed.
    const files = collectSourceFiles(SRC_ROOT);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      if (
        // Any two-arg join(<base>, 'intent') — regardless of how the base was
        // obtained (homedir(), a variable holding it, process.env.HOME, ...).
        /\bjoin\(\s*[^,;]{1,80},\s*['"]intent['"]\s*\)/.test(source) ||
        // Home-derived string building of an .../intent path on one line.
        /(homedir\(\)|process\.env\.(HOME|USERPROFILE))[^\n]{0,60}[/\\]+intent\b/.test(source) ||
        /['"]system:workspace-root['"]/.test(source)
      ) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
