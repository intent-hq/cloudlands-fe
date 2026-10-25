/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  setMcpServers: vi.fn(),
  getMcpServerStatuses: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      getMcpServers: mocks.getMcpServers,
      setMcpServers: mocks.setMcpServers,
      getMcpServerStatuses: mocks.getMcpServerStatuses,
    },
  },
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
  withToastCountdown: (options: unknown) => options,
}));

import { store } from '$store/renderer/store';
import { mcpSettingsSaga } from '$store/renderer/slices/mcp-settings/sagas/mcp-settings-saga';
import {
  addServer,
  removeServer,
  setEnabled,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import McpServersSettings from './McpServersSettings.svelte';

const alpha = { id: 'srv-alpha', name: 'alpha', type: 'stdio' as const, command: 'run-alpha' };
const beta = { id: 'srv-beta', name: 'beta', type: 'stdio' as const, command: 'run-beta' };

async function renderLoaded() {
  store.dispatch(setEnabled(true));
  render(McpServersSettings);
  await screen.findByText('alpha');
  await screen.findByText('beta');
}

function expectNoLoadDiagnostic() {
  expect(screen.queryByText(m.settings_mcpServers_loadError())).toBeNull();
  expect(screen.queryByText(m.settings_mcpServers_retry())).toBeNull();
}

describe('McpServersSettings mutation errors (intent#5757)', () => {
  let stop: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    store.init();
    stop = store.runSaga(mcpSettingsSaga);
    mocks.getMcpServers.mockResolvedValue([alpha, beta]);
    mocks.getMcpServerStatuses.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    stop();
    store.dispose();
  });

  it.each([
    ['returns success: false', () => ({ success: false, error: 'write rejected' })],
    [
      'throws',
      () => {
        throw new Error('write rejected');
      },
    ],
  ])('keeps the list and restores the row when a remove save %s', async (_label, impl) => {
    mocks.setMcpServers.mockImplementation(async () => impl());
    await renderLoaded();

    store.dispatch(removeServer('srv-beta'));

    await screen.findByText('write rejected');
    expectNoLoadDiagnostic();
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getByTestId('mcp-mutation-error').textContent).toContain('write rejected');
  });

  it.each([
    ['returns success: false', () => ({ success: false, error: 'write rejected' })],
    [
      'throws',
      () => {
        throw new Error('write rejected');
      },
    ],
  ])('rolls back an added row and keeps the list when an add save %s', async (_label, impl) => {
    mocks.setMcpServers.mockImplementation(async () => impl());
    await renderLoaded();

    await fireEvent.click(screen.getByRole('button', { name: m.settings_mcpServers_addNew() }));
    const name = screen.getByPlaceholderText(m.settings_mcp_form_serverName_placeholder());
    await fireEvent.input(name, { target: { value: 'gamma' } });
    await fireEvent.input(screen.getByPlaceholderText('npx -y @some/mcp-server'), {
      target: { value: 'run-gamma' },
    });
    await fireEvent.click(screen.getByRole('button', { name: m.settings_mcp_form_addServer() }));

    await screen.findByText('write rejected');
    expectNoLoadDiagnostic();
    await waitFor(() => expect(screen.queryByText('gamma')).toBeNull());
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getByTestId('mcp-mutation-error').textContent).toContain('write rejected');
  });

  it('shows a duplicate-name add rejection in the open Add form, not as a load error', async () => {
    await renderLoaded();
    await fireEvent.click(screen.getByRole('button', { name: m.settings_mcpServers_addNew() }));

    store.dispatch(addServer({ name: 'alpha', type: 'stdio', command: 'other' }));

    await screen.findByText('Duplicate MCP server name requires distinct IDs: alpha');
    expectNoLoadDiagnostic();
    const alert = screen.getByTestId('mcp-add-error');
    expect(
      within(alert.parentElement!).getByPlaceholderText(
        m.settings_mcp_form_serverName_placeholder(),
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('mcp-mutation-error')).toBeNull();
    expect(mocks.setMcpServers).not.toHaveBeenCalled();
    expect(screen.getByText('beta')).toBeTruthy();
  });

  it('still shows the load diagnostic when reading the server list fails', async () => {
    mocks.getMcpServers.mockRejectedValue(new Error('daemon unreachable'));
    store.dispatch(setEnabled(true));
    render(McpServersSettings);

    expect(await screen.findByText(m.settings_mcpServers_loadError())).toBeTruthy();
    expect(screen.getByText('daemon unreachable')).toBeTruthy();
    expect(screen.queryByTestId('mcp-mutation-error')).toBeNull();
  });
});
