/**
 * OpenComboButton daemon-locality gating (monorepo#883).
 *
 * "Other…" shows a LOCAL app picker against a daemon-host path, so it must
 * disappear when the daemon is remote — and the `actions[0]` primary-action
 * fallback must land on "Copy path" instead of "Other".
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
  fireEvent,
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

// Electron build: the capability alone must NOT keep "Other…" visible.
vi.mock('$lib/utils/platform-capabilities', () => ({
  hasCapability: () => true,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => {
  const MockDropdown = (await import('./mocks/dropdown-menu.svelte')).default;
  return { default: MockDropdown };
});

vi.mock('$lib/components/ui/button', async () => {
  const MockButton = (await import('./mocks/button.svelte')).default;
  return { Button: MockButton };
});

vi.mock('$lib/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
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
  selectedAction = 'vscode',
): Partial<StoreState> {
  return {
    externalEditors: {
      selectedAction,
      editors: createCollection<InstalledEditor, 'id'>('id', mockEditors),
      hiddenEditorIds: [],
      loading: false,
      error: null,
      lastFetched: 0,
    },
    daemonHealth: { transport, hostLocality },
  } as unknown as Partial<StoreState>;
}

async function renderCombo(props: Record<string, unknown> = {}) {
  const OpenComboButton = (await import('../OpenComboButton.svelte')).default;
  const { container } = render(OpenComboButton, {
    props: { filePath: '/tmp/project', branchName: 'main', ...props },
  });
  return container;
}

async function renderAndOpenDropdown() {
  const container = await renderCombo();

  // Full mode renders [primary, dropdown-toggle] buttons; open the dropdown.
  const buttons = container.querySelectorAll('button');
  await fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => {
    expect(container.querySelector('.dropdown-content')).toBeTruthy();
  });
  return container;
}

function actionLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.dropdown-content button span.flex-1')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

describe('OpenComboButton locality gating (monorepo#883)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers editors and "Other" on a local daemon', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderAndOpenDropdown();

    expect(actionLabels(container)).toEqual([
      'Visual Studio Code',
      'Other',
      'Copy path',
      'Copy branch name',
    ]);
  });

  it('omits "Other" (and editors) on a remote daemon (external-ws)', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderAndOpenDropdown();

    expect(actionLabels(container)).toEqual(['Copy path', 'Copy branch name']);
  });

  it('falls back the primary action to "Copy path" on a remote daemon', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderAndOpenDropdown();

    // Remembered action ('vscode') is gone remotely; the primary must be the
    // locality-safe "Copy path" — with no "Open in" prefix (monorepo#890).
    const primary = container.querySelector('button[title]');
    expect(primary?.getAttribute('title')).toBe('Copy path');
  });

  it('honors BE-reported hostLocality=remote over a local transport', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' }, 'remote');
    const container = await renderAndOpenDropdown();

    expect(actionLabels(container)).toEqual(['Copy path', 'Copy branch name']);
  });

  it('honors BE-reported hostLocality=local over a remote transport', async () => {
    // Forced server.locality override (§5.12/§5.14): a WS connection to a
    // daemon that reports itself local restores the full action set.
    mockStoreState = makeState({ mode: 'external-ws' }, 'local');
    const container = await renderAndOpenDropdown();

    expect(actionLabels(container)).toEqual([
      'Visual Studio Code',
      'Other',
      'Copy path',
      'Copy branch name',
    ]);
  });
});

describe('OpenComboButton copy-only presentation (monorepo#890)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the "Open in …" combo + chevron when open-capable actions exist', async () => {
    mockStoreState = makeState({ mode: 'sidecar-uds' });
    const container = await renderCombo();

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2); // primary + dropdown chevron
    expect(buttons[0].getAttribute('title')).toBe('Open in Visual Studio Code');
    expect(buttons[0].textContent).toContain('Open');
  });

  it('labels the primary "Copy path" but keeps the dropdown when "Copy branch name" remains', async () => {
    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderCombo();

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2); // chevron stays to reach "Copy branch name"
    expect(buttons[0].getAttribute('title')).toBe('Copy path');
    expect(buttons[0].textContent).toContain('Copy path');
    expect(buttons[0].textContent).not.toContain('Open');
  });

  it('never says "Open in …" even when "copy-branch" is the remembered action', async () => {
    mockStoreState = makeState({ mode: 'external-ws' }, null, 'copy-branch');
    const container = await renderCombo();

    const primary = container.querySelector('button[title]');
    expect(primary?.getAttribute('title')).toBe('Copy path');
  });

  it('renders a plain chevron-less button that copies the path when "Copy path" is the only action', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

    mockStoreState = makeState({ mode: 'external-ws' });
    const container = await renderCombo({ branchName: undefined });

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1); // no dropdown chevron at all
    expect(buttons[0].getAttribute('title')).toBe('Copy path');
    expect(buttons[0].textContent).toContain('Copy path');

    await fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith('/tmp/project');
    });
  });
});
