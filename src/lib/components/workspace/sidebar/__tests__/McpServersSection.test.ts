import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const servers = [
    { name: 'enabled-server', type: 'stdio' as const, command: 'enabled' },
    { name: 'disabled-server', type: 'stdio' as const, command: 'disabled' },
  ];
  const selector =
    <T>(getter: () => T) =>
    () => ({
      subscribe(run: (value: T) => void) {
        run(getter());
        return () => {};
      },
    });
  return { dispatch, servers, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/mcp-settings/mcp-settings-selectors', () => ({
  selectMcpServers: mocks.selector(() => mocks.servers),
  selectMcpErrorMessages: mocks.selector(() => ({})),
  selectWorkspaceDisabledMcpServerNamesByWorkspaceId: mocks.selector(() => ['disabled-server']),
}));

vi.mock('$store/renderer/slices/mcp-settings/mcp-settings-slice', () => ({
  loadServers: vi.fn(() => ({ type: 'mcpSettings/loadServers' })),
  hydrateWorkspaceMcpDisabled: vi.fn((workspaceId: string) => ({
    type: 'mcpSettings/hydrateWorkspaceMcpDisabled',
    payload: [workspaceId],
  })),
  toggleWorkspaceMcpServer: vi.fn((workspaceId: string, serverName: string, enabled: boolean) => ({
    type: 'mcpSettings/toggleWorkspaceMcpServer',
    payload: [workspaceId, serverName, enabled],
  })),
}));

vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

describe('McpServersSection', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
  });

  it('maps the disabled-server list inversely to textless Toggle state and enablement actions', async () => {
    const McpServersSection = (await import('../McpServersSection.svelte')).default;
    const { getByRole, getByText } = render(McpServersSection, {
      props: { workspaceId: 'ws-1' },
    });
    await fireEvent.click(getByText('MCP Servers').closest('button')!);

    const enabledToggle = await waitFor(() => getByRole('button', { name: 'enabled-server' }));
    const disabledToggle = getByRole('button', { name: 'disabled-server' });
    expect(enabledToggle.textContent?.trim()).toBe('');
    expect(enabledToggle.getAttribute('aria-pressed')).toBe('true');
    expect(disabledToggle.textContent?.trim()).toBe('');
    expect(disabledToggle.getAttribute('aria-pressed')).toBe('false');

    mocks.dispatch.mockClear();
    await fireEvent.click(enabledToggle);
    await fireEvent.click(disabledToggle);

    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, {
      type: 'mcpSettings/toggleWorkspaceMcpServer',
      payload: ['ws-1', 'enabled-server', false],
    });
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'mcpSettings/toggleWorkspaceMcpServer',
      payload: ['ws-1', 'disabled-server', true],
    });
  });
});
