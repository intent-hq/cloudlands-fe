import { describe, expect, it } from 'vitest';
import {
  canMoveTabToWindow,
  isTabWindowLayoutId,
  isTabWindowRoute,
  tabWindowDisplayMode,
  tabWindowIdFromRoute,
  tabWindowLayoutId,
  tabWindowRoute,
} from './tab-window';

describe('tab window routes and layout keys', () => {
  it('round-trips a tab window id through its route', () => {
    expect(tabWindowRoute('abc-123')).toBe('/tab-window/abc-123');
    expect(tabWindowIdFromRoute('/tab-window/abc-123')).toBe('abc-123');
    expect(tabWindowIdFromRoute('/tab-window/abc-123/')).toBe('abc-123');
    expect(isTabWindowRoute('/tab-window/abc-123')).toBe(true);
  });

  it('rejects other pages and malformed ids', () => {
    expect(tabWindowIdFromRoute('/workspace/abc')).toBeNull();
    expect(tabWindowIdFromRoute('/tab-window/')).toBeNull();
    expect(tabWindowIdFromRoute('/tab-window/a/b')).toBeNull();
    expect(tabWindowIdFromRoute(`/tab-window/${'x'.repeat(65)}`)).toBeNull();
  });

  it('marks a tab window layout key, never a workspace id', () => {
    expect(isTabWindowLayoutId(tabWindowLayoutId('abc'))).toBe(true);
    expect(isTabWindowLayoutId('ws-1')).toBe(false);
    expect(isTabWindowLayoutId(undefined)).toBe(false);
  });

  it('a tab with unsaved changes cannot move', () => {
    expect(canMoveTabToWindow({ type: 'file', hasUnsavedChanges: true })).toBe(false);
    expect(canMoveTabToWindow({ type: 'file' })).toBe(true);
    expect(canMoveTabToWindow({ type: 'browser' })).toBe(true);
  });
});

describe('tabWindowDisplayMode', () => {
  it('macOS and Intent OS (sway) use full screen; other desktops maximize', () => {
    expect(tabWindowDisplayMode('darwin', {})).toBe('full-screen');
    expect(tabWindowDisplayMode('linux', { SWAYSOCK: '/run/user/1000/sway.sock' })).toBe(
      'full-screen',
    );
    expect(tabWindowDisplayMode('linux', { XDG_CURRENT_DESKTOP: 'sway' })).toBe('full-screen');
    expect(tabWindowDisplayMode('linux', { INTENT_OS: '1' })).toBe('full-screen');
    expect(tabWindowDisplayMode('linux', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe(
      'maximized',
    );
    expect(tabWindowDisplayMode('win32', {})).toBe('maximized');
  });
});
