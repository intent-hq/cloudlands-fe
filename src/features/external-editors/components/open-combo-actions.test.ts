import { describe, expect, it } from 'vitest';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import { getVisibleOpenInEditors } from './open-combo-actions';

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
  it('offers every installed editor in the supplied order', () => {
    const editors = ['one', 'two', 'three', 'four'].map(editor);
    editors.push({ ...editor('finder'), category: 'finder', handlerType: 'finder' });

    expect(getVisibleOpenInEditors(editors).map(({ id }) => id)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'finder',
    ]);
  });

  it('preserves a detected platform file manager in the supplied order', () => {
    const finder = {
      ...editor('finder'),
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

    expect(visible.map(({ id }) => id)).toEqual(['one', 'finder', 'two', 'three', 'four']);
    expect(visible[1]?.name).toBe('File Explorer');
  });

  it('omits hidden and not-installed editors without restoring a fallback', () => {
    const hidden = editor('hidden');
    const finder = {
      ...editor('finder'),
      category: 'finder' as const,
      handlerType: 'finder' as const,
    };
    expect(
      getVisibleOpenInEditors(
        [editor('one'), hidden, { ...editor('missing'), installed: false }, finder],
        ['hidden', 'finder'],
      ).map(({ id }) => id),
    ).toEqual(['one']);
  });
});
