/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  getBrowserHistoryDirection,
  keyboardInterceptorScript,
  parseForwardedPanelShortcut,
} from './browser-keyboard-interceptor';

describe('browser keyboard interceptor script', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeAll(() => {
    new Function(keyboardInterceptorScript)();
    // Re-injection on a later dom-ready is a no-op.
    new Function(keyboardInterceptorScript)();
  });

  function pressInPage(init: KeyboardEventInit) {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    const messages = log.mock.calls.map(([message]) => String(message));
    log.mockRestore();
    return { event, messages };
  }

  it.each([
    ['macOS next', 'MacIntel', { key: 'ArrowRight', metaKey: true, altKey: true }],
    ['macOS previous', 'MacIntel', { key: 'ArrowLeft', metaKey: true, altKey: true }],
    ['Windows/Linux next', 'Win32', { key: 'ArrowRight', ctrlKey: true, altKey: true }],
    ['Windows/Linux previous', 'Linux x86_64', { key: 'ArrowLeft', ctrlKey: true, altKey: true }],
  ] as const)('forwards %s column focus with its Alt flag', (_label, platform, init) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const { event, messages } = pressInPage(init);
    expect(event.defaultPrevented).toBe(true);
    expect(messages).toHaveLength(1);
    expect(parseForwardedPanelShortcut(messages[0])).toEqual({
      key: init.key,
      shiftKey: false,
      metaKey: 'metaKey' in init,
      ctrlKey: 'ctrlKey' in init,
      altKey: true,
    });
    // The forwarded chord never reads as browser back/forward in the host.
    expect(getBrowserHistoryDirection(parseForwardedPanelShortcut(messages[0])!)).toBeNull();
  });

  it('forwards Mod+Shift brackets for workspace tab switching', () => {
    const { messages } = pressInPage({ key: '}', metaKey: true, shiftKey: true });
    expect(parseForwardedPanelShortcut(messages[0])).toEqual({
      key: '}',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    });
  });

  it.each([
    ['macOS Ctrl+Opt+Arrow', 'MacIntel', { key: 'ArrowRight', ctrlKey: true, altKey: true }],
    ['Windows/Linux Meta+Alt+Arrow', 'Win32', { key: 'ArrowLeft', metaKey: true, altKey: true }],
  ] as const)('leaves %s (not the platform Mod) to the page', (_label, platform, init) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const { event, messages } = pressInPage(init);
    expect(event.defaultPrevented).toBe(false);
    expect(messages).toEqual([]);
  });

  it.each([
    ['MacIntel', { key: ']', ctrlKey: true }, '__INTENT_PANEL_BRACKET__:]:0:0:1:0'],
    ['Win32', { key: '}', metaKey: true, shiftKey: true }, '__INTENT_PANEL_BRACKET__:}:1:1:0:0'],
    ['MacIntel', { key: 'w', ctrlKey: true }, '__INTENT_CLOSE_TAB__'],
  ] as const)(
    'keeps existing either-modifier forwarding on %s for %o',
    (platform, init, message) => {
      vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
      expect(pressInPage(init).messages).toEqual([message]);
    },
  );

  it('leaves plain Alt+Arrow to the page', () => {
    const { event, messages } = pressInPage({ key: 'ArrowLeft', altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(messages).toEqual([]);
  });
});

describe('parseForwardedPanelShortcut', () => {
  it('accepts messages from an older script without the Alt flag', () => {
    expect(parseForwardedPanelShortcut('__INTENT_PANEL_BRACKET__:{:1:1:0')).toEqual({
      key: '{',
      shiftKey: true,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
    });
  });

  it('ignores unrelated or empty messages', () => {
    expect(parseForwardedPanelShortcut('__INTENT_REFRESH__')).toBeNull();
    expect(parseForwardedPanelShortcut('__INTENT_PANEL_BRACKET__:')).toBeNull();
  });
});

describe('getBrowserHistoryDirection', () => {
  const press = (
    key: string,
    mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>>,
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  it('navigates only on Alt+Left/Right without Cmd or Ctrl', () => {
    expect(getBrowserHistoryDirection(press('ArrowLeft', { altKey: true }))).toBe('back');
    expect(getBrowserHistoryDirection(press('ArrowRight', { altKey: true }))).toBe('forward');
    expect(
      getBrowserHistoryDirection(press('ArrowLeft', { altKey: true, metaKey: true })),
    ).toBeNull();
    expect(
      getBrowserHistoryDirection(press('ArrowRight', { altKey: true, ctrlKey: true })),
    ).toBeNull();
    expect(getBrowserHistoryDirection(press('ArrowRight', {}))).toBeNull();
  });
});
