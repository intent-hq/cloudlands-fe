/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import ProviderPathConfigHost from './__tests__/ProviderPathConfigHost.svelte';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  pickDirectory: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
  pickFile: vi.fn(async ({ openModal }: { openModal: () => void }) => openModal()),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      get: mocks.mockSettingsGet,
      update: mocks.mockSettingsUpdate,
    },
  },
}));

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

vi.mock('$lib/directory-picker-service', () => ({
  pickDirectory: mocks.pickDirectory,
  pickFile: mocks.pickFile,
}));

// The real modal reads directory listings from the store; stub it with the
// existing mock that renders a "mock select" button reporting /Users/me/src.
vi.mock('$lib/components/workspace/creation/DirectoryPickerModal.svelte', async () => ({
  default: (
    await import('$lib/components/workspace/creation/__tests__/mocks/MockDirectoryPickerModal.svelte')
  ).default,
}));

const LONG_PATH =
  '/Users/clement/.local/share/some/deeply/nested/install/location/bin/claude-agent-acp';

const flush = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(
  () =>
    import('$lib/components/workspace/creation/__tests__/mocks/MockDirectoryPickerModal.svelte'),
);

describe('ProviderPathConfig', () => {
  it('saves the Antigravity ACP path without overwriting another provider', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ value: { codex: '/keep/codex' } });
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'antigravity',
        providerName: 'Antigravity',
        cliCommand: 'antigravity-acp',
        isInstalled: false,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    await flush();
    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await flush();
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledExactlyOnceWith([
      { path: 'providers.paths', value: { codex: '/keep/codex', antigravity: '/Users/me/src' } },
    ]);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSettingsGet.mockResolvedValue({ value: {} });
    mocks.mockSettingsUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('loads a configured override', () => {
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        configuredPath: '/custom/bin/claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    const input = screen.getByPlaceholderText(LONG_PATH) as HTMLInputElement;
    expect(input.value).toBe('/custom/bin/claude-agent-acp');
  });

  it('describes the pinned npx launch for npx-only providers instead of an auto-detected adapter', () => {
    const npxPath = '/usr/local/bin/npx';
    const npxPackage = '@agentclientprotocol/claude-agent-acp@1.2.3';
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: npxPath,
        npxPackage,
        isInstalled: true,
      },
    });
    // The daemon's resolvedPath for an npx-only provider is npx itself, so it
    // must not be offered as the adapter path placeholder.
    expect(screen.queryByPlaceholderText(npxPath)).toBeNull();
    expect(screen.getByPlaceholderText('Path to claude-agent-acp')).toBeTruthy();
    expect(screen.getByText(npxPath)).toBeTruthy();
    // The pinned package spec is named in both the hint and the status row.
    expect(screen.getAllByText(npxPackage, { exact: false }).length).toBeGreaterThan(0);
  });

  it('does not describe a pinned npx launch when npx itself is unresolved', () => {
    const npxPackage = '@agentclientprotocol/claude-agent-acp@1.2.3';
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: '',
        npxPackage,
        isInstalled: false,
      },
    });
    // Nothing can run via npx, so the popup must not claim an npx default.
    expect(screen.queryByText(npxPackage, { exact: false })).toBeNull();
    expect(screen.getByPlaceholderText('Path to claude-agent-acp')).toBeTruthy();
  });

  it('keeps the npx path row alongside the configured path once an npx-only provider is overridden', () => {
    const npxPath = '/usr/local/bin/npx';
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        configuredPath: '/opt/homebrew/bin/claude-agent-acp',
        resolvedPath: npxPath,
        npxPackage: '@agentclientprotocol/claude-agent-acp@1.2.3',
        isInstalled: true,
      },
    });
    const input = screen.getByPlaceholderText('Path to claude-agent-acp') as HTMLInputElement;
    expect(input.value).toBe('/opt/homebrew/bin/claude-agent-acp');
    expect(screen.getByText(npxPath)).toBeTruthy();
  });

  it('renders the overridable unsloth CLI row and the read-only opencode runtime row (unsloth)', () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    const unslothPath = '/Users/clement/.local/bin/unsloth';
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        resolvedPath: unslothPath,
        runtimeCliCommand: 'opencode',
        runtimeResolvedPath: opencodePath,
        isInstalled: true,
      },
    });
    expect(screen.getByText(unslothPath)).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
  });

  it('shows only the runtime row when the unsloth CLI did not resolve', () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        runtimeCliCommand: 'opencode',
        runtimeResolvedPath: opencodePath,
        isInstalled: false,
      },
    });
    expect(screen.getByPlaceholderText('Path to unsloth')).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
  });

  it('renders the path as a readonly field with a file picker, not a free-text input', () => {
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    const input = screen.getByPlaceholderText(LONG_PATH) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
  });

  it('picking a file read-merge-writes the override into providers.paths', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ value: { codex: '/old/codex' } });
    const onPathChange = vi.fn();
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
        onPathChange,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    await flush();

    expect(mocks.pickFile).toHaveBeenCalledOnce();
    expect(mocks.pickFile.mock.calls[0][0]).toMatchObject({
      title: 'Select the claude-agent-acp executable',
    });

    // The service mock invoked openModal (remote case) — selecting in the
    // modal saves the picked path.
    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await flush();

    expect(mocks.mockSettingsGet).toHaveBeenCalledExactlyOnceWith('providers.paths');
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledExactlyOnceWith([
      {
        path: 'providers.paths',
        value: { codex: '/old/codex', 'claude-code': '/Users/me/src' },
      },
    ]);
    expect(onPathChange).toHaveBeenCalledExactlyOnceWith('/Users/me/src');
  });

  it('keeps the menu and remote picker modal mounted while the picker is open', async () => {
    // jsdom's zero-size layout makes Floating UI's hide middleware mark the
    // portaled content visibility:hidden, so "mounted vs dismissed" must be
    // asserted with visibility-insensitive queries ({ hidden: true }): a
    // dismissed bits-ui menu is removed from the DOM entirely. The same
    // zero-size layout makes bits-ui's outside-pointer dismissal a no-op in
    // jsdom (isClickTrulyOutside needs real rects), so the restored-dismissal
    // step below uses Escape, which is layout-independent.
    const queryMenu = () => screen.queryByRole('menu', { hidden: true });

    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    expect(queryMenu()).toBeTruthy();

    // The service mock routes to openModal (remote case).
    await fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
    await flush();
    expect(screen.getByTestId('mock-picker-select')).toBeTruthy();
    expect(queryMenu(), 'menu should survive opening the picker').toBeTruthy();

    // The real modal portals a dialog outside the menu, so its interactions,
    // Escape keydowns, and focus land "outside" the menu content. The menu
    // must not dismiss — dismissing unmounts the modal with it.
    await fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    await fireEvent.click(document.body);
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await flush();

    expect(queryMenu(), 'menu should survive outside interactions').toBeTruthy();
    expect(screen.getByTestId('mock-picker-select')).toBeTruthy();

    // Selecting in the modal still commits the path through savePath.
    await fireEvent.click(screen.getByTestId('mock-picker-select'));
    await flush();

    expect(mocks.mockSettingsUpdate).toHaveBeenCalledExactlyOnceWith([
      { path: 'providers.paths', value: { 'claude-code': '/Users/me/src' } },
    ]);
    expect(screen.queryByTestId('mock-picker-select'), 'modal should close on select').toBeNull();

    // With the modal closed, normal menu dismissal is restored.
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(queryMenu()).toBeNull());
  });

  it('clear read-merge-writes an empty override, restoring auto-detection', async () => {
    mocks.mockSettingsGet.mockResolvedValue({
      value: { 'claude-code': '/custom/bin/claude-agent-acp', codex: '/old/codex' },
    });
    const onPathChange = vi.fn();
    render(ProviderPathConfigHost, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        configuredPath: '/custom/bin/claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
        onPathChange,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear path and restore default' }));
    await flush();

    expect(mocks.pickFile).not.toHaveBeenCalled();
    expect(mocks.mockSettingsGet).toHaveBeenCalledExactlyOnceWith('providers.paths');
    expect(mocks.mockSettingsUpdate).toHaveBeenCalledExactlyOnceWith([
      {
        path: 'providers.paths',
        value: { 'claude-code': '', codex: '/old/codex' },
      },
    ]);
    expect(onPathChange).toHaveBeenCalledExactlyOnceWith('');
  });
});
