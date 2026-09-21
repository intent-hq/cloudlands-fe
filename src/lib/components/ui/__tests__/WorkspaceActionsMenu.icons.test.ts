import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import { faArrowRightArrowLeft } from '$lib/icons/phosphor-icons';
import { warmImport } from '../../../../test/warm-import';

let mockStoreState: Partial<StoreState>;
const mockDispatch = vi.fn();
const invoke = vi.fn().mockResolvedValue({ success: true });

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({ state: () => mockStoreState, dispatch: mockDispatch });
    },
  };
});
vi.mock('$lib/utils/platform-capabilities', () => ({ hasCapability: () => true }));
vi.mock('$lib/electron-bridge', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('$lib/client', () => ({ appClient: { git: { status: vi.fn() } } }));

warmImport(() => import('$features/workspace/components/WorkspaceActionsMenu.svelte'));
warmImport(() => import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte'));

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreState = {
    externalEditors: {
      selectedAction: 'finder',
      editors: createCollection('id', [
        {
          id: 'finder',
          name: 'Finder',
          shortLabel: 'Finder',
          appName: 'Finder',
          category: 'finder',
          handlerType: 'finder',
          installed: true,
          priority: 0,
        },
      ]),
      editorOrder: [],
      hiddenEditorIds: [],
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport: { mode: 'sidecar-uds' }, hostLocality: 'local' },
    workspace: { workspaces: createCollection('id', []) },
  } as unknown as Partial<StoreState>;
});

describe('Workspace action icon defaults with real controls', () => {
  it('uses regular mapped actions without changing editor, transfer, archive, or delete routing', async () => {
    const Component = (await import('$features/workspace/components/WorkspaceActionsMenu.svelte'))
      .default;
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const onClose = vi.fn();
    const onTransfer = vi.fn();
    const { container } = render(Component, {
      props: {
        filePath: '/tmp/project',
        showArchiveOption: true,
        onArchive,
        onDelete,
        onClose,
        additionalActions: [
          { label: 'Transfer', icon: faArrowRightArrowLeft, onClick: onTransfer },
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open in Finder' })).toBeTruthy(),
    );
    const glyphs = [...container.querySelectorAll('svg[data-icon]')];
    expect(glyphs).toHaveLength(5);
    for (const glyph of glyphs) expect(glyph.getAttribute('data-weight')).toBe('regular');

    await fireEvent.click(screen.getByRole('button', { name: 'Choose app' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('external-editors:open-with-other', {
        path: '/tmp/project',
      }),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(onTransfer).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Archive Workspace' }));
    expect(onArchive).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Workspace…' }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('uses the same default inside the keyboard-operated Open in submenu', async () => {
    const Harness = (await import('./mocks/WorkspaceActionsMenuSubmenuHarness.svelte')).default;
    render(Harness);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const trigger = await screen.findByRole('menuitem', { name: 'Open in...' });
    expect(trigger.querySelector('svg')?.getAttribute('data-weight')).toBe('regular');
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const chooseApp = await screen.findByRole('menuitem', { name: 'Choose app' });
    expect(chooseApp.querySelector('svg')?.getAttribute('data-weight')).toBe('regular');
    await fireEvent.click(chooseApp);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('external-editors:open-with-other', {
        path: '/tmp/project',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Choose app' })).toBeNull());
  });
});
