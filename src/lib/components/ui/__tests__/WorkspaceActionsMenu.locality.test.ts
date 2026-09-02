/**
 * WorkspaceActionsMenu locality gating (monorepo#883, monorepo#2171).
 *
 * "Choose app" shows a LOCAL app picker against a workspace file path, so the
 * editors block (editor list + "Choose app") must disappear when the daemon
 * is remote (monorepo#883) — or when the workspace checkout itself is remote
 * even though the daemon is local (monorepo#2171) — while locality-safe copy
 * actions stay.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';
import { warmImport } from '../../../../test/warm-import';

let mockStoreState: Partial<StoreState> = {};
const mockDispatch = vi.fn();

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({
        state: () => mockStoreState,
        dispatch: mockDispatch,
      });
    },
  };
});

// Electron build: the capability alone must NOT keep "Choose app" visible.
vi.mock('$lib/utils/platform-capabilities', () => ({
  hasCapability: () => true,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/button.svelte')).default;
  return { default: MockButton };
});

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/client', () => ({
  appClient: { git: { status: vi.fn() } },
}));

const mockEditors: InstalledEditor[] = [
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
];

const manyMockEditors: InstalledEditor[] = [
  ...mockEditors,
  ...(['cursor', 'zed', 'windsurf'].map((id, index) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    shortLabel: id,
    appName: id,
    category: 'ide' as const,
    handlerType: 'generic' as const,
    priority: 90 - index * 10,
    installed: true,
  })) as InstalledEditor[]),
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
  {
    id: 'hidden-editor',
    name: 'Hidden Editor',
    shortLabel: 'Hidden',
    appName: 'Hidden Editor',
    category: 'ide',
    handlerType: 'generic',
    priority: 60,
    installed: true,
  },
];

const mockWorkspaces = [
  { id: 'ws-local' },
  { id: 'ws-remote', environmentConfig: { type: 'remote' } },
];

function makeState(
  transport: BackendTransportInfo | null,
  hostLocality: 'local' | 'remote' | null = null,
  editors: InstalledEditor[] = mockEditors,
  hiddenEditorIds: string[] = [],
  editorOrder: string[] = [],
): Partial<StoreState> {
  return {
    externalEditors: {
      selectedAction: 'vscode',
      editors: createCollection<InstalledEditor, 'id'>('id', editors),
      editorOrder,
      hiddenEditorIds,
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport, hostLocality },
    workspace: {
      workspaces: createCollection('id', mockWorkspaces),
    },
  } as unknown as Partial<StoreState>;
}

async function renderMenu(workspaceId = '') {
  const WorkspaceActionsMenu = (
    await import('$features/workspace/components/WorkspaceActionsMenu.svelte')
  ).default;
  const { container } = render(WorkspaceActionsMenu, {
    props: { filePath: '/tmp/project', workspaceId, showFileActions: true },
  });
  await waitFor(() => {
    expect(container.textContent).toContain('Copy Absolute Path');
  });
  return container;
}

function openInLabels(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLSpanElement>('button span[title^="Open in "]'),
  ).map((label) => label.textContent?.trim() ?? '');
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/Fa.svelte'));
warmImport(() => import('./mocks/button.svelte'));
warmImport(() => import('$features/workspace/components/WorkspaceActionsMenu.svelte'));

describe('WorkspaceActionsMenu locality gating (monorepo#883)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the editors block and "Choose app" on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('hides "Choose app" (and the editors block) on a remote daemon (external-ws)', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderMenu();

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).not.toContain('Open in');
    // Locality-safe copy actions stay available.
    expect(container.textContent).toContain('Copy Absolute Path');
    expect(container.textContent).toContain('Copy Relative Path');
  });

  it('honors BE-reported hostLocality=remote over a local transport', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' }, 'remote');
    const container = await renderMenu();

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).toContain('Copy Absolute Path');
  });

  it('honors BE-reported hostLocality=local over a remote transport', async () => {
    // Forced server.locality override (§5.12/§5.14): a WS connection to a
    // daemon that reports itself local restores the editors block.
    mockStoreState = makeState({ mode: 'external-ws' }, 'local');
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('shows every installed non-hidden editor on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' }, null, manyMockEditors, ['hidden-editor']);
    const container = await renderMenu();

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Open in Cursor');
    expect(container.textContent).toContain('Open in Zed');
    expect(container.textContent).toContain('Open in Windsurf');
    expect(container.textContent).not.toContain('Open in Hidden Editor');
  });

  it('preserves selector-provided order when Finder is moved away from the end', async () => {
    mockStoreState = makeState(
      { mode: 'sidecar-uds' },
      null,
      manyMockEditors,
      ['hidden-editor'],
      ['finder', 'zed', 'vscode', 'windsurf', 'cursor', 'hidden-editor'],
    );
    const container = await renderMenu();

    expect(openInLabels(container)).toEqual([
      'Open in Finder',
      'Open in Zed',
      'Open in Visual Studio Code',
      'Open in Windsurf',
      'Open in Cursor',
    ]);
  });
});

describe('WorkspaceActionsMenu workspace-locality gating (monorepo#2171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the editors block for a local workspace on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-local');

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });

  it('hides the editors block for a remote (SSH) workspace even on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-remote');

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).not.toContain('Open in');
    // Locality-safe copy actions stay available.
    expect(container.textContent).toContain('Copy Absolute Path');
    expect(container.textContent).toContain('Copy Relative Path');
  });

  it('hides the editors block for a remote workspace on a remote daemon too', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderMenu('ws-remote');

    expect(container.textContent).not.toContain('Choose app');
    expect(container.textContent).toContain('Copy Absolute Path');
  });

  it('treats an unknown workspace entity as local (optimistic default)', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderMenu('ws-unknown');

    expect(container.textContent).toContain('Open in Visual Studio Code');
    expect(container.textContent).toContain('Choose app');
  });
});
