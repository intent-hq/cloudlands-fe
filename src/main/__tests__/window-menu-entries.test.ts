import { describe, expect, it } from 'vitest';

import {
  buildWindowMenuEntries,
  type WindowMenuConnectionRecord,
  type WindowMenuWindowDescriptor,
} from '../window-menu-entries';

const LABELS = { mainWindowLabel: 'Intent', hudLabel: 'HUD', localBackendLabel: 'local' };

function win(overrides: Partial<WindowMenuWindowDescriptor> = {}): WindowMenuWindowDescriptor {
  return { windowId: 1, isHud: false, backendId: 'local', isFocused: false, ...overrides };
}

const CONNECTIONS: WindowMenuConnectionRecord[] = [
  { id: 'local', label: 'This machine (local)' },
  { id: 'conn-1', label: 'Office Mac', hostname: 'office.local' },
  { id: 'conn-2', label: '', hostname: 'basement.local' },
];

describe('buildWindowMenuEntries', () => {
  it('labels an all-local main window without a backend suffix', () => {
    const entries = buildWindowMenuEntries([win({ windowId: 7 })], CONNECTIONS, LABELS);

    expect(entries).toEqual([{ windowId: 7, label: 'Intent', checked: false }]);
  });

  it('labels an all-local HUD window without a backend suffix', () => {
    const entries = buildWindowMenuEntries(
      [win({ windowId: 3, isHud: true })],
      CONNECTIONS,
      LABELS,
    );

    expect(entries).toEqual([{ windowId: 3, label: 'HUD', checked: false }]);
  });

  it('uses the connection label for a remote-stamped window', () => {
    const entries = buildWindowMenuEntries(
      [win({ windowId: 2, backendId: 'conn-1' })],
      CONNECTIONS,
      LABELS,
    );

    expect(entries).toEqual([{ windowId: 2, label: 'Intent [Office Mac]', checked: false }]);
  });

  it('falls back to hostname then backend id for unlabeled or unknown backends', () => {
    const entries = buildWindowMenuEntries(
      [win({ windowId: 1, backendId: 'conn-2' }), win({ windowId: 2, backendId: 'conn-gone' })],
      CONNECTIONS,
      LABELS,
    );

    expect(entries.map((e) => e.label)).toEqual(['Intent [basement.local]', 'Intent [conn-gone]']);
  });

  it('checks only the focused window', () => {
    const entries = buildWindowMenuEntries(
      [win({ windowId: 1 }), win({ windowId: 2, isFocused: true })],
      CONNECTIONS,
      LABELS,
    );

    expect(entries.map((e) => e.checked)).toEqual([false, true]);
  });

  it('orders main windows before HUD windows, keeping input order within groups', () => {
    const entries = buildWindowMenuEntries(
      [
        win({ windowId: 1, isHud: true }),
        win({ windowId: 2 }),
        win({ windowId: 3, isHud: true }),
        win({ windowId: 4 }),
      ],
      CONNECTIONS,
      LABELS,
    );

    expect(entries.map((e) => e.windowId)).toEqual([2, 4, 1, 3]);
  });

  it('adds the backend suffix to every entry (including local ones) once any window is remote', () => {
    const entries = buildWindowMenuEntries(
      [
        win({ windowId: 1 }),
        win({ windowId: 2, isHud: true }),
        win({ windowId: 3, backendId: 'conn-1' }),
      ],
      CONNECTIONS,
      LABELS,
    );

    expect(entries.map((e) => e.label)).toEqual([
      'Intent [local]',
      'Intent [Office Mac]',
      'HUD [local]',
    ]);
  });

  it('returns no entries for no windows', () => {
    expect(buildWindowMenuEntries([], CONNECTIONS, LABELS)).toEqual([]);
  });
});
