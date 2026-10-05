import type { MenuItemConstructorOptions } from 'electron';
import { m } from '../shared/paraglide/messages.js';

/** Native role expansion, kept independent of Electron window/service lifetime. */
export function buildNativeEditMenu(isMacOS: boolean): MenuItemConstructorOptions {
  return {
    label: m.menu_edit(),
    submenu: [
      { role: 'undo', label: m.menu_undo() },
      { role: 'redo', label: m.menu_redo() },
      { type: 'separator' },
      { role: 'cut', label: m.menu_cut() },
      { role: 'copy', label: m.menu_copy() },
      { role: 'paste', label: m.menu_paste() },
      ...(isMacOS
        ? ([
            { role: 'pasteAndMatchStyle', label: m.menu_paste_and_match_style() },
            { role: 'delete', label: m.menu_delete() },
            { role: 'selectAll', label: m.menu_select_all() },
            { type: 'separator' },
            {
              label: m.menu_substitutions(),
              submenu: [
                { role: 'showSubstitutions', label: m.menu_show_substitutions() },
                { type: 'separator' },
                { role: 'toggleSmartQuotes', label: m.menu_smart_quotes() },
                { role: 'toggleSmartDashes', label: m.menu_smart_dashes() },
                { role: 'toggleTextReplacement', label: m.menu_text_replacement() },
              ],
            },
            {
              label: m.menu_speech(),
              submenu: [
                { role: 'startSpeaking', label: m.menu_start_speaking() },
                { role: 'stopSpeaking', label: m.menu_stop_speaking() },
              ],
            },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { role: 'delete', label: m.menu_delete() },
            { type: 'separator' },
            { role: 'selectAll', label: m.menu_select_all() },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  };
}

interface ViewMenuActions {
  reload: () => void;
  toggleDevTools: () => void;
  zoom: (channel: 'menu:reset-zoom' | 'menu:zoom-in' | 'menu:zoom-out') => void;
}

export function buildNativeViewMenu(
  isMacOS: boolean,
  actions: ViewMenuActions,
): MenuItemConstructorOptions {
  return {
    label: m.menu_view(),
    submenu: [
      {
        label: m.menu_reload(),
        accelerator: 'CmdOrCtrl+R',
        // Renderer owns the chord so a browser panel reloads instead of the app.
        registerAccelerator: false,
        click: actions.reload,
      },
      { role: 'forceReload', label: m.menu_force_reload() },
      { type: 'separator' },
      {
        label: m.menu_toggle_devtools(),
        accelerator: isMacOS ? 'Alt+Command+I' : 'Ctrl+Shift+I',
        // A role would target a hidden webview guest, not the window renderer.
        click: actions.toggleDevTools,
      },
      { type: 'separator' },
      {
        label: m.menu_actual_size(),
        accelerator: 'CmdOrCtrl+0',
        click: () => actions.zoom('menu:reset-zoom'),
      },
      {
        label: m.menu_zoom_in(),
        accelerator: 'CmdOrCtrl+=',
        click: () => actions.zoom('menu:zoom-in'),
      },
      {
        label: m.menu_zoom_out(),
        accelerator: 'CmdOrCtrl+-',
        click: () => actions.zoom('menu:zoom-out'),
      },
      { type: 'separator' },
      { role: 'togglefullscreen', label: m.menu_toggle_fullscreen() },
    ],
  };
}
