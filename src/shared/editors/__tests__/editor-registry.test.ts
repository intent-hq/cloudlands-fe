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

  it('every non-macOSOnly editor should have platforms.linux.binaries defined', () => {
    const nonMacEditors = EDITOR_REGISTRY.filter((e) => !e.macOSOnly);
    for (const editor of nonMacEditors) {
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
});
