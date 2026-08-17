/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import ProviderPathConfig from './ProviderPathConfig.svelte';
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
vi.mock('$features/onboarding/messages/DirectoryPickerModal.svelte', async () => ({
  default: (
    await import('$features/onboarding/messages/__tests__/mocks/MockDirectoryPickerModal.svelte')
  ).default,
}));

const LONG_PATH =
  '/Users/clement/.local/share/some/deeply/nested/install/location/bin/claude-agent-acp';

const flush = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

async function openPopup(providerName: string) {
  await fireEvent.click(screen.getByTitle(`Configure ${providerName} path`));
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte'));
warmImport(
  () => import('$features/onboarding/messages/__tests__/mocks/MockDirectoryPickerModal.svelte'),
);

describe('ProviderPathConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSettingsGet.mockResolvedValue({ value: {} });
    mocks.mockSettingsUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('supports a controlled open state without rendering the folder trigger', () => {
    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        open: true,
        showTrigger: false,
      },
    });

    expect(screen.queryByTitle('Configure Claude Code path')).toBeNull();
    expect(screen.getByText('Claude Code CLI Path')).toBeTruthy();
  });

  it('renders the full auto-detected path wrapped, not truncated', async () => {
    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    await openPopup('Claude Code');

    const code = screen.getByText(LONG_PATH);
    expect(code.textContent).toBe(LONG_PATH);
    expect(code.className).toContain('break-all');
    expect(code.className).not.toContain('truncate');
    expect(screen.getByText('Auto-detected at')).toBeTruthy();
  });

  it('keeps the auto-detected row visible and marked when an override is configured', async () => {
    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        configuredPath: '/custom/bin/claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    await openPopup('Claude Code');

    const input = screen.getByPlaceholderText(LONG_PATH) as HTMLInputElement;
    expect(input.value).toBe('/custom/bin/claude-agent-acp');
    expect(screen.getByText(LONG_PATH)).toBeTruthy();
    expect(screen.getByText('(overridden by the path above)')).toBeTruthy();
  });

  it('renders the overridable unsloth CLI row and the read-only opencode runtime row (unsloth)', async () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    const unslothPath = '/Users/clement/.local/bin/unsloth';
    render(ProviderPathConfig, {
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
    await openPopup('Unsloth');

    expect(screen.getByText('Auto-detected unsloth at')).toBeTruthy();
    expect(screen.getByText(unslothPath)).toBeTruthy();
    expect(screen.getByText('opencode runtime at')).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
    expect(screen.getByText("(follows the opencode provider's configuration)")).toBeTruthy();
    expect(screen.queryByText('Auto-detected at')).toBeNull();
  });

  it('marks only the overridable unsloth CLI row as overridden for dual-binary providers', async () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    const unslothPath = '/Users/clement/.local/bin/unsloth';
    render(ProviderPathConfig, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        configuredPath: '/custom/bin/unsloth',
        resolvedPath: unslothPath,
        runtimeCliCommand: 'opencode',
        runtimeResolvedPath: opencodePath,
        isInstalled: true,
      },
    });
    await openPopup('Unsloth');

    const input = screen.getByPlaceholderText(unslothPath) as HTMLInputElement;
    expect(input.value).toBe('/custom/bin/unsloth');
    expect(screen.getByText(unslothPath)).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
    expect(screen.getAllByText('(overridden by the path above)')).toHaveLength(1);
  });

  it('shows only the runtime row when the unsloth CLI did not resolve', async () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    render(ProviderPathConfig, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        runtimeCliCommand: 'opencode',
        runtimeResolvedPath: opencodePath,
        isInstalled: false,
      },
    });
    await openPopup('Unsloth');

    expect(screen.getByPlaceholderText('Path to unsloth')).toBeTruthy();
    expect(screen.getByText('opencode runtime at')).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
    expect(screen.getByText("(follows the opencode provider's configuration)")).toBeTruthy();
    expect(screen.queryByText('Auto-detected unsloth at')).toBeNull();
  });

  it('shows the runtime row without a path when the runtime binary did not resolve', async () => {
    const unslothPath = '/Users/clement/.local/bin/unsloth';
    render(ProviderPathConfig, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        resolvedPath: unslothPath,
        runtimeCliCommand: 'opencode',
        isInstalled: true,
      },
    });
    await openPopup('Unsloth');

    expect(screen.getByText('Auto-detected unsloth at')).toBeTruthy();
    expect(screen.getByText('opencode runtime')).toBeTruthy();
    expect(screen.getByText("(follows the opencode provider's configuration)")).toBeTruthy();
    expect(screen.queryByText('opencode runtime at')).toBeNull();
  });

  it('renders the path as a readonly field with a file picker, not a free-text input', async () => {
    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    await openPopup('Claude Code');

    const input = screen.getByPlaceholderText(LONG_PATH) as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();
  });

  it('picking a file read-merge-writes the override into providers.paths', async () => {
    mocks.mockSettingsGet.mockResolvedValue({ value: { codex: '/old/codex' } });
    const onPathChange = vi.fn();
    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
        onPathChange,
      },
    });
    await openPopup('Claude Code');

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

    render(ProviderPathConfig, {
      props: {
        providerId: 'claude-code',
        providerName: 'Claude Code',
        cliCommand: 'claude-agent-acp',
        resolvedPath: LONG_PATH,
        isInstalled: true,
      },
    });
    await openPopup('Claude Code');
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
    render(ProviderPathConfig, {
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
    await openPopup('Claude Code');

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
