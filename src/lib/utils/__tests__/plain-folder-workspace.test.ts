import { describe, expect, it } from 'vitest';
import { isPlainFolderWorkspace } from '../plain-folder-workspace';

describe('isPlainFolderWorkspace', () => {
  it('is true only for an explicit plainFolder flag', () => {
    expect(isPlainFolderWorkspace({ plainFolder: true })).toBe(true);
    expect(isPlainFolderWorkspace({ plainFolder: false })).toBe(false);
    expect(isPlainFolderWorkspace({})).toBe(false);
    expect(isPlainFolderWorkspace(null)).toBe(false);
    expect(isPlainFolderWorkspace(undefined)).toBe(false);
  });

  it('never infers plain-folder mode from an empty branch', () => {
    expect(isPlainFolderWorkspace({ branch: '' } as never)).toBe(false);
  });
});
