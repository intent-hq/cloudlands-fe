import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { invoke } from '$lib/electron-bridge';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import type { StoreState } from '$store/renderer/types';
import { warmImport } from '../../../test/warm-import';

let mockStoreState: Partial<StoreState> = {};
const mockDispatch = vi.fn();

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({ state: () => mockStoreState, dispatch: mockDispatch });
    },
  };
});
vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => true }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const editors: InstalledEditor[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
  },
  {
    id: 'finder',
    name: 'Finder',
    shortLabel: 'Finder',
    appName: 'Finder',
    category: 'finder',
    handlerType: 'finder',
    priority: 0,
    installed: true,
  },
];

function makeState(transportMode: 'sidecar-uds' | 'external-ws'): Partial<StoreState> {
  return {
    externalEditors: {
      selectedAction: 'vscode',
      editors: createCollection<InstalledEditor, 'id'>('id', editors),
      editorOrder: [],
      hiddenEditorIds: [],
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport: { mode: transportMode }, hostLocality: null },
    workspace: { workspaces: createCollection('id', []) },
  } as unknown as Partial<StoreState>;
}

const childrenLabel = createRawSnippet(() => ({ render: () => '<span>path/to/file</span>' }));

async function renderCombo(props: Record<string, unknown> = {}) {
  const OpenComboButton = (await import('./OpenComboButton.svelte')).default;
  const { container } = render(OpenComboButton, {
    props: { filePath: '/tmp/project', usePortal: false, ...props },
  });
  return container;
}

function primaryButton(container: HTMLElement): HTMLElement {
  return within(container)
    .getAllByRole('button')
    .find((button) => button.getAttribute('title') === 'Open in Visual Studio Code')!;
}

function menuTriggers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'));
}

warmImport(() => import('$lib/components/ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('./OpenComboButton.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreState = makeState('sidecar-uds');
});
afterEach(cleanup);

describe('OpenComboButton trigger ownership', () => {
  it('gives only the full-mode chevron the menu trigger', async () => {
    const container = await renderCombo();
    const chevron = within(container).getByRole('button', { name: 'Open in...' });
    const primary = primaryButton(container);

    expect(menuTriggers(container)).toEqual([chevron]);
    expect(primary).not.toBe(chevron);

    await fireEvent.click(chevron);
    expect(await within(container).findByRole('menu')).toBeTruthy();
  });

  it('forwards the menu trigger to the compact icon button', async () => {
    const container = await renderCombo({ compact: true });
    const [trigger] = menuTriggers(container);

    expect(trigger).toBe(within(container).getByRole('button'));
    await fireEvent.click(trigger);
    expect(await within(container).findByRole('menu')).toBeTruthy();
  });

  it.each([
    ['children', {}],
    ['inline children', { inline: true }],
  ])('opens the menu from a %s trigger when several actions exist', async (_label, props) => {
    const container = await renderCombo({ children: childrenLabel, ...props });
    const trigger = within(container).getByRole('button');

    expect(menuTriggers(container)).toEqual([trigger]);
    await fireEvent.click(trigger);
    expect(await within(container).findByRole('menu')).toBeTruthy();
  });

  it.each([
    ['children', {}],
    ['inline children', { inline: true }],
  ])(
    'runs the only action directly from a %s trigger instead of opening a menu',
    async (_label, props) => {
      const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
      try {
        mockStoreState = makeState('external-ws');
        const container = await renderCombo({ children: childrenLabel, ...props });
        const trigger = within(container).getByRole('button');

        expect(menuTriggers(container)).toEqual([]);
        await fireEvent.click(trigger);
        await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
        expect(within(container).queryByRole('menu')).toBeNull();
      } finally {
        delete (navigator as { clipboard?: unknown }).clipboard;
      }
    },
  );

  it('keeps the full-mode primary action outside dropdown activation', async () => {
    const container = await renderCombo();
    const chevron = within(container).getByRole('button', { name: 'Open in...' });
    const primary = primaryButton(container);
    const escaped = vi.fn();
    document.addEventListener('pointerdown', escaped);
    document.addEventListener('keydown', escaped);
    try {
      await fireEvent.pointerDown(primary);
      await fireEvent.keyDown(primary, { key: 'Enter' });
      await fireEvent.click(primary);

      expect(escaped).not.toHaveBeenCalled();
      expect(within(container).queryByRole('menu')).toBeNull();
      await waitFor(() => expect(invoke).toHaveBeenCalledWith('vscode:open', '/tmp/project'));

      await fireEvent.pointerDown(chevron);
      expect(escaped).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('pointerdown', escaped);
      document.removeEventListener('keydown', escaped);
    }
  });

  it('routes the guaranteed Finder action through the shell bridge', async () => {
    const container = await renderCombo();
    await fireEvent.click(within(container).getByRole('button', { name: 'Open in...' }));
    await within(container).findByRole('menu');

    const finder = within(container).getByRole('menuitemradio', { name: 'Finder' });
    expect(finder.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(finder);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledExactlyOnceWith('shell:showItemInFolder', {
        path: '/tmp/project',
      }),
    );
  });
});
