/**
 * WorkspaceActionsMenu daemon-locality gating (monorepo#883).
 *
 * "Choose app" shows a LOCAL app picker against a daemon-host path, so the
 * editors block (editor list + "Choose app") must disappear when the daemon
 * is remote, while locality-safe copy actions stay.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  render,
  waitFor,
} from '@testing-library/svelte';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import type { InstalledEditor } from '$store/renderer/slices/external-editors/external-editors-slice';
import type { BackendTransportInfo } from '$store/renderer/slices/daemon-health/daemon-health-types';

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

function makeState(
  transport: BackendTransportInfo | null,
  hostLocality: 'local' | 'remote' | null = null,
): Partial<StoreState> {
  return {
    externalEditors: {
      selectedAction: 'vscode',
      editors: createCollection<InstalledEditor, 'id'>('id', mockEditors),
      hiddenEditorIds: [],
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport, hostLocality },
  } as unknown as Partial<StoreState>;
}

async function renderMenu() {
  const WorkspaceActionsMenu = (await import('../WorkspaceActionsMenu.svelte')).default;
  const { container } = render(WorkspaceActionsMenu, {
    props: { filePath: '/tmp/project', showFileActions: true },
  });
  await waitFor(() => {
    expect(container.textContent).toContain('Copy Absolute Path');
  });
  return container;
}

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
});
