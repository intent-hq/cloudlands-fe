import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsMenuItem } from '../menu-settings';

const fixture = vi.hoisted(() => ({
  focused: null as BrowserWindow | null,
  dock: false,
  annotation: false,
}));
vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: () => fixture.focused } }));
vi.mock('../dock-window', () => ({ isDockWindow: () => fixture.dock }));
vi.mock('../../features/annotation/main/annotation-window', () => ({
  isAnnotationWindow: () => fixture.annotation,
}));

describe('Settings native menu accelerator', () => {
  const send = vi.fn();
  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send },
  } as unknown as BrowserWindow;
  beforeEach(() => {
    fixture.focused = window;
    fixture.dock = false;
    fixture.annotation = false;
    send.mockClear();
  });

  function click(item: ReturnType<typeof createSettingsMenuItem>) {
    item.click?.(
      {} as Electron.MenuItem,
      fixture.focused ?? undefined,
      {} as Electron.KeyboardEvent,
    );
  }

  it('keeps the settings shortcut working in a normal app window', () => {
    const item = createSettingsMenuItem('Settings');
    expect(item.accelerator).toBe('CmdOrCtrl+,');
    expect(item.enabled).toBe(true);
    click(item);
    expect(send).toHaveBeenCalledExactlyOnceWith('navigate', '/settings');
  });

  it.each(['dock', 'annotation'] as const)(
    'disables Settings while the %s is focused, even with no app windows',
    (kind) => {
      fixture[kind] = true;
      const item = createSettingsMenuItem('Settings');
      expect(item.enabled).toBe(false);
      click(item);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rechecks the focused window when an accelerator races the menu rebuild', () => {
    const item = createSettingsMenuItem('Settings');
    fixture.dock = true;
    click(item);
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when every window is closed', () => {
    const item = createSettingsMenuItem('Settings');
    fixture.focused = null;
    click(item);
    expect(send).not.toHaveBeenCalled();
  });
});
