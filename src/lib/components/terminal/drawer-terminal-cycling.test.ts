/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawerTerminalCycleDirection } from './drawer-terminal-cycling';

function drawerTerminal() {
  const drawer = document.createElement('div');
  const textarea = document.createElement('textarea');
  textarea.className = 'xterm-helper-textarea';
  drawer.appendChild(textarea);
  document.body.appendChild(drawer);
  return { drawer, textarea };
}

function press(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { shiftKey: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('drawerTerminalCycleDirection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('cycles with Cmd+Shift brackets on macOS but ignores Ctrl+Shift', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { drawer, textarea } = drawerTerminal();
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '}', metaKey: true }), drawer, 2),
    ).toBe(1);
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '{', metaKey: true }), drawer, 2),
    ).toBe(-1);
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '}', ctrlKey: true }), drawer, 2),
    ).toBeNull();
  });

  it('cycles with Ctrl+Shift brackets on Windows/Linux', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    const { drawer, textarea } = drawerTerminal();
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: ']', ctrlKey: true }), drawer, 2),
    ).toBe(1);
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '[', metaKey: true }), drawer, 2),
    ).toBeNull();
  });

  it('leaves the chord to workspace switching outside the drawer or with one terminal', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { drawer, textarea } = drawerTerminal();
    const column = document.createElement('textarea');
    column.className = 'xterm-helper-textarea';
    document.body.appendChild(column);
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '}', metaKey: true }), drawer, 1),
    ).toBeNull();
    expect(
      drawerTerminalCycleDirection(press(column, { key: '}', metaKey: true }), drawer, 2),
    ).toBeNull();
    expect(
      drawerTerminalCycleDirection(press(textarea, { key: '}', metaKey: true }), undefined, 2),
    ).toBeNull();
  });
});
