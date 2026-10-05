import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildNativeEditMenu, buildNativeViewMenu } from '../native-menu-model';

function items(menu: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  if (!Array.isArray(menu.submenu)) throw new Error('Expected a native template');
  return menu.submenu;
}

function click(item: MenuItemConstructorOptions) {
  if (!item.click) throw new Error('Expected a native command');
  item.click({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
}

describe('native menu model', () => {
  it.each([true, false])('preserves platform editing roles (macOS=%s)', (isMacOS) => {
    const edit = items(buildNativeEditMenu(isMacOS));
    const roles = edit.flatMap((item) => (item.role ? [item.role] : []));
    expect(roles).toEqual(
      isMacOS
        ? ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']
        : ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll'],
    );
    const submenus = edit.filter((item) => item.submenu);
    expect(submenus.flatMap(items).flatMap((item) => (item.role ? [item.role] : []))).toEqual(
      isMacOS
        ? [
            'showSubstitutions',
            'toggleSmartQuotes',
            'toggleSmartDashes',
            'toggleTextReplacement',
            'startSpeaking',
            'stopSpeaking',
          ]
        : [],
    );
  });

  it.each([true, false])(
    'routes view commands without stealing renderer reload (macOS=%s)',
    (isMacOS) => {
      const actions = { reload: vi.fn(), toggleDevTools: vi.fn(), zoom: vi.fn() };
      const view = items(buildNativeViewMenu(isMacOS, actions));
      const byShortcut = (accelerator: string) =>
        view.find((item) => item.accelerator === accelerator)!;
      const reload = byShortcut('CmdOrCtrl+R');
      expect(reload.registerAccelerator).toBe(false);
      click(reload);
      expect(actions.reload).toHaveBeenCalledTimes(1);
      const devtools = byShortcut(isMacOS ? 'Alt+Command+I' : 'Ctrl+Shift+I');
      expect(devtools.role).toBeUndefined();
      click(devtools);
      expect(actions.toggleDevTools).toHaveBeenCalledTimes(1);
      for (const shortcut of ['CmdOrCtrl+0', 'CmdOrCtrl+=', 'CmdOrCtrl+-'])
        click(byShortcut(shortcut));
      expect(actions.zoom.mock.calls).toEqual([
        ['menu:reset-zoom'],
        ['menu:zoom-in'],
        ['menu:zoom-out'],
      ]);
      expect(view.filter((item) => item.role).map((item) => item.role)).toEqual([
        'forceReload',
        'togglefullscreen',
      ]);
    },
  );
});
