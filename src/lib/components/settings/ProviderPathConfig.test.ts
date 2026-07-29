/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ProviderPathConfig from './ProviderPathConfig.svelte';

const mocks = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
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
  default: (
    await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')
  ).default,
}));

const LONG_PATH =
  '/Users/clement/.local/share/some/deeply/nested/install/location/bin/claude-agent-acp';

async function openPopup(providerName: string) {
  await fireEvent.click(screen.getByTitle(`Configure ${providerName} path`));
}

describe('ProviderPathConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSettingsGet.mockResolvedValue({ value: {} });
    mocks.mockSettingsUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
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

  it('renders both labeled binaries for dual-binary providers (unsloth)', async () => {
    const unslothPath = '/Users/clement/.local/bin/unsloth';
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    render(ProviderPathConfig, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        resolvedPath: unslothPath,
        secondaryCliCommand: 'opencode',
        secondaryResolvedPath: opencodePath,
        isInstalled: true,
      },
    });
    await openPopup('Unsloth');

    expect(screen.getByText('Auto-detected unsloth at')).toBeTruthy();
    expect(screen.getByText(unslothPath)).toBeTruthy();
    expect(screen.getByText('Auto-detected opencode at')).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
    expect(screen.queryByText('Auto-detected at')).toBeNull();
  });

  it('shows only the labeled secondary row when the primary binary did not resolve', async () => {
    const opencodePath = '/Users/clement/.opencode/bin/opencode';
    render(ProviderPathConfig, {
      props: {
        providerId: 'unsloth',
        providerName: 'Unsloth',
        cliCommand: 'unsloth',
        secondaryCliCommand: 'opencode',
        secondaryResolvedPath: opencodePath,
        isInstalled: false,
      },
    });
    await openPopup('Unsloth');

    expect(screen.getByText('Auto-detected opencode at')).toBeTruthy();
    expect(screen.getByText(opencodePath)).toBeTruthy();
    expect(screen.queryByText('Auto-detected unsloth at')).toBeNull();
  });
});
