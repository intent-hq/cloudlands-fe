/**
 * Tests for Editor Registry
 *
 * Validates that all editor definitions have required platform data.
 */

import { describe, it, expect } from 'vitest';
import { EDITOR_REGISTRY } from '../editor-registry';

describe('Editor Registry', () => {
  it('should have unique IDs for all editors', () => {
    const ids = EDITOR_REGISTRY.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('every cross-platform editor should have platforms.linux.binaries defined', () => {
    const crossPlatformEditors = EDITOR_REGISTRY.filter((e) => !e.macOSOnly && !e.win32Only);
    for (const editor of crossPlatformEditors) {
      expect(
        editor.platforms?.linux?.binaries,
        `Editor "${editor.id}" (${editor.name}) is missing platforms.linux.binaries`,
      ).toBeDefined();
      expect(
        editor.platforms!.linux!.binaries!.length,
        `Editor "${editor.id}" (${editor.name}) has empty platforms.linux.binaries`,
      ).toBeGreaterThan(0);
    }
  });

  it('macOSOnly editors should NOT have platforms.linux', () => {
    const macOnlyEditors = EDITOR_REGISTRY.filter((e) => e.macOSOnly);
    expect(macOnlyEditors.length).toBeGreaterThan(0); // Sanity check
    for (const editor of macOnlyEditors) {
      expect(
        editor.platforms?.linux,
        `macOSOnly editor "${editor.id}" should not have platforms.linux`,
      ).toBeUndefined();
    }
  });

  it('win32Only editors should NOT have platforms.linux', () => {
    const win32OnlyEditors = EDITOR_REGISTRY.filter((e) => e.win32Only);
    expect(win32OnlyEditors.length).toBeGreaterThan(0); // Sanity check
    for (const editor of win32OnlyEditors) {
      expect(
        editor.platforms?.linux,
        `win32Only editor "${editor.id}" should not have platforms.linux`,
      ).toBeUndefined();
    }
  });

  it('win32Only editors should have platforms.win32.binaries defined', () => {
    const win32OnlyEditors = EDITOR_REGISTRY.filter((e) => e.win32Only);
    for (const editor of win32OnlyEditors) {
      expect(
        editor.platforms?.win32?.binaries,
        `win32Only editor "${editor.id}" (${editor.name}) is missing platforms.win32.binaries`,
      ).toBeDefined();
      expect(
        editor.platforms!.win32!.binaries!.length,
        `win32Only editor "${editor.id}" (${editor.name}) has empty platforms.win32.binaries`,
      ).toBeGreaterThan(0);
    }
  });

  it('should have Windows terminal entries (powershell, windows-terminal, git-bash)', () => {
    const powershell = EDITOR_REGISTRY.find((e) => e.id === 'powershell');
    expect(powershell).toBeDefined();
    expect(powershell!.category).toBe('terminal');
    expect(powershell!.win32Only).toBe(true);
    expect(powershell!.platforms?.win32?.binaries).toContain('powershell');
    expect(powershell!.platforms?.win32?.binaries).toContain('pwsh');

    const windowsTerminal = EDITOR_REGISTRY.find((e) => e.id === 'windows-terminal');
    expect(windowsTerminal).toBeDefined();
    expect(windowsTerminal!.category).toBe('terminal');
    expect(windowsTerminal!.win32Only).toBe(true);
    expect(windowsTerminal!.platforms?.win32?.binaries).toContain('wt');

    const gitBash = EDITOR_REGISTRY.find((e) => e.id === 'git-bash');
    expect(gitBash).toBeDefined();
    expect(gitBash!.category).toBe('terminal');
    expect(gitBash!.win32Only).toBe(true);
    expect(gitBash!.platforms?.win32?.binaries).toContain('git-bash');
  });

  it('finder entry should have win32 display name overrides', () => {
    const finder = EDITOR_REGISTRY.find((e) => e.id === 'finder');
    expect(finder).toBeDefined();
    expect(finder!.platforms?.win32?.name).toBe('File Explorer');
    expect(finder!.platforms?.win32?.shortLabel).toBe('Explorer');
  });

  it('terminal entry should have win32 display name overrides and cmd binary', () => {
    const terminal = EDITOR_REGISTRY.find((e) => e.id === 'terminal');
    expect(terminal).toBeDefined();
    expect(terminal!.platforms?.win32?.name).toBe('Command Prompt');
    expect(terminal!.platforms?.win32?.shortLabel).toBe('CMD');
    expect(terminal!.platforms?.win32?.binaries).toEqual(['cmd']);
  });
});
