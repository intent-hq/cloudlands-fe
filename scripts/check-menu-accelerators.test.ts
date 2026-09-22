// @verify-changed-triggers: src/main/index.ts, scripts/check-menu-accelerators.mjs

import { describe, expect, it } from 'vitest';
import {
  RENDERER_OWNED_ACCELERATORS,
  checkMenuAccelerators,
  findMenuItems,
  readMenuSource,
} from './check-menu-accelerators.mjs';

function item(key: string, body: string[] = []) {
  return [
    '      {',
    `        label: m.${key}(),`,
    ...body.map((line) => `        ${line}`),
    '      },',
  ];
}

const rendererOwned = Object.entries(RENDERER_OWNED_ACCELERATORS).flatMap(([key, accelerator]) =>
  item(key, [
    `accelerator: '${accelerator}',`,
    'enabled: inWorkspace,',
    '// Let the renderer own the chord.',
    'registerAccelerator: false,',
    'click: () => { sendWorkspaceCommand(channel); },',
  ]),
);

const validMenu = [
  'const fileMenuItems = [',
  ...item('menu_new_window', ["accelerator: 'CmdOrCtrl+Shift+N',", 'click: () => open(),']),
  ...rendererOwned,
  ...item('menu_close_window', ['click: () => { focused.close(); },']),
  '];',
].join('\n');

describe('renderer-owned menu accelerators guard', () => {
  it('reads each labelled menu item with its accelerator and registration flag', () => {
    const items = findMenuItems(validMenu);
    expect(items.map((entry) => entry.key)).toEqual([
      'menu_new_window',
      ...Object.keys(RENDERER_OWNED_ACCELERATORS),
      'menu_close_window',
    ]);
    expect(items[0]).toMatchObject({
      accelerator: 'CmdOrCtrl+Shift+N',
      registersAccelerator: true,
    });
    expect(items[1]).toMatchObject({ accelerator: 'CmdOrCtrl+Alt+A', registersAccelerator: false });
    expect(items.at(-1)).toMatchObject({
      accelerator: null,
      line: validMenu.split('\n').length - 3,
    });
  });

  it('passes a menu that shows renderer-owned chords without registering them', () => {
    expect(checkMenuAccelerators(validMenu)).toEqual([]);
  });

  it('flags a renderer-owned chord that is registered natively', () => {
    const registered = validMenu.replace(
      "accelerator: 'CmdOrCtrl+[',\n        enabled: inWorkspace,\n        // Let the renderer own the chord.\n        registerAccelerator: false,",
      "accelerator: 'CmdOrCtrl+[',",
    );
    expect(checkMenuAccelerators(registered)).toEqual([
      expect.stringMatching(/menu_select_previous_tab\) must set `registerAccelerator: false`/),
    ]);
  });

  it('flags a renderer-owned item whose chord changed or disappeared', () => {
    const changed = validMenu.replace(
      "accelerator: 'CmdOrCtrl+Alt+N',",
      "accelerator: 'CmdOrCtrl+Alt+M',",
    );
    expect(checkMenuAccelerators(changed)).toEqual([
      expect.stringMatching(/menu_new_note\) shows CmdOrCtrl\+Alt\+M, expected CmdOrCtrl\+Alt\+N/),
    ]);
    const removed = validMenu.replace(
      /\s*\{\s*label: m\.menu_new_browser\(\),[\s\S]*?\n {6}\},/,
      '',
    );
    expect(checkMenuAccelerators(removed)).toEqual([
      'missing menu item `menu_new_browser` (expected accelerator CmdOrCtrl+Alt+B)',
    ]);
  });

  it('flags Close Window carrying an accelerator and any item claiming a renderer chord', () => {
    const closeWindow = validMenu.replace(
      'label: m.menu_close_window(),',
      "label: m.menu_close_window(),\n        accelerator: 'CmdOrCtrl+Shift+W',",
    );
    expect(checkMenuAccelerators(closeWindow)).toEqual([
      expect.stringMatching(
        /menu_close_window\) must not carry an accelerator \(has CmdOrCtrl\+Shift\+W\)/,
      ),
      expect.stringMatching(
        /menu_close_window\) claims CmdOrCtrl\+Shift\+W, which the renderer owns/,
      ),
    ]);
    const noCloseWindow = validMenu.replace(
      /\s*\{\s*label: m\.menu_close_window\(\),[\s\S]*?\n {6}\},/,
      '',
    );
    expect(checkMenuAccelerators(noCloseWindow)).toEqual([
      'missing menu item `menu_close_window` (expected without an accelerator)',
    ]);
    const pageUp = validMenu.replace(
      "accelerator: 'CmdOrCtrl+Shift+N',",
      "accelerator: 'CmdOrCtrl+PageUp',",
    );
    expect(checkMenuAccelerators(pageUp)).toEqual([
      expect.stringMatching(/menu_new_window\) claims CmdOrCtrl\+PageUp, which the renderer owns/),
    ]);
  });

  it('passes on the current main-process menu', () => {
    expect(checkMenuAccelerators(readMenuSource(process.cwd()))).toEqual([]);
  });
});
