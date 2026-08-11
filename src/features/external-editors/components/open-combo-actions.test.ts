import { describe, expect, it } from 'vitest';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import {
  FILE_MANAGER_EDITOR_ID,
  getVisibleOpenInEditors,
  MAX_OPEN_IN_APPS,
} from './open-combo-actions';

function editor(id: string): InstalledEditor {
  return {
    id,
    name: id,
    shortLabel: id,
    appName: id,
    category: 'ide',
    handlerType: 'generic',
    installed: true,
    priority: 0,
  };
}

describe('getVisibleOpenInEditors', () => {
  it('keeps at most the first three configured apps in the action menu', () => {
    const editors = ['one', 'two', 'three', 'four'].map(editor);

    expect(MAX_OPEN_IN_APPS).toBe(3);
    expect(getVisibleOpenInEditors(editors).map(({ id }) => id)).toEqual([
      'one',
      'two',
      'three',
      FILE_MANAGER_EDITOR_ID,
    ]);
  });

  it('keeps a detected platform file manager after the configured app cap', () => {
    const finder = {
      ...editor(FILE_MANAGER_EDITOR_ID),
      name: 'File Explorer',
      shortLabel: 'Explorer',
      category: 'finder' as const,
      handlerType: 'finder' as const,
    };
    const visible = getVisibleOpenInEditors([
      editor('one'),
      finder,
      editor('two'),
      editor('three'),
      editor('four'),
    ]);

    expect(visible.map(({ id }) => id)).toEqual(['one', 'two', 'three', FILE_MANAGER_EDITOR_ID]);
    expect(visible.at(-1)?.name).toBe('File Explorer');
  });
});
