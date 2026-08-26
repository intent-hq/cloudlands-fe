/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';

const mocks = vi.hoisted(() => ({
  loaded: true,
  connections: [] as ConnectionRecord[],
  dispatch: vi.fn(),
  update: vi.fn(),
  forget: vi.fn(),
  readable: <T>(get: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(get());
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('$store/renderer/slices/connections/connections-selectors', () => ({
  selectConnectionsLoaded: () => mocks.readable(() => mocks.loaded),
  selectRemoteConnections: () =>
    mocks.readable(() => mocks.connections.filter((connection) => !connection.isLocal)),
  selectKeychainSyncState: () => mocks.readable(() => null),
}));

vi.mock('$store/renderer/slices/connections/connections-slice', () => ({
  updateConnectionRequested: (params: unknown) => mocks.update(params),
  forgetConnectionRequested: (id: string) => mocks.forget(id),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  openConnectionRequested: vi.fn(),
  loadKeychainSyncStateRequested: () => ({ promise: Promise.resolve() }),
  setKeychainSyncEnabledRequested: vi.fn(),
}));

import MachinesSettings from './MachinesSettings.svelte';

const local: ConnectionRecord = {
  id: 'local',
  label: 'This machine',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
  status: 'connected',
};

const remote: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  accent: 'indigo',
  host: '10.0.0.2',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
  status: 'not-open',
};

describe('MachinesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loaded = true;
    mocks.connections = [local, remote];
    mocks.update.mockImplementation((params) => ({
      type: 'connections/updateRequested',
      payload: [params],
      promise: Promise.resolve({ connection: { ...remote, ...params } }),
    }));
    mocks.forget.mockImplementation((id) => ({
      type: 'connections/forgetRequested',
      payload: [id],
      promise: Promise.resolve(),
    }));
  });

  afterEach(cleanup);

  it('shows saved remotes only and reports unopened status without opening a connection', () => {
    render(MachinesSettings);

    expect(screen.getByDisplayValue('Studio Mac')).toBeTruthy();
    expect(screen.getByText('10.0.0.2:5181')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Status: Not open' })).toBeTruthy();
    expect(screen.queryByText('This machine')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('renders accessible loading and empty states', () => {
    mocks.loaded = false;
    const loading = render(MachinesSettings);
    expect(screen.getByRole('status').textContent).toContain('Loading machines');
    loading.unmount();

    mocks.loaded = true;
    mocks.connections = [local];
    render(MachinesSettings);
    expect(screen.getByText('No remote machines saved')).toBeTruthy();
  });

  it('renames a machine and updates its accent without changing theme state', async () => {
    render(MachinesSettings);

    const name = screen.getByRole('textbox', { name: 'Name' });
    await fireEvent.input(name, { target: { value: 'Render box' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'remote-1',
      label: 'Render box',
      accent: 'indigo',
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Use Rose accent' }));
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'remote-1',
      label: 'Studio Mac',
      accent: 'rose',
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/theme/i) }),
    );
  });

  it('requires confirmation before remove and keeps a retry action after failure', async () => {
    mocks.forget.mockImplementationOnce((id) => ({
      type: 'connections/forgetRequested',
      payload: [id],
      promise: Promise.reject(new Error('keychain unavailable')),
    }));
    render(MachinesSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Remove machine?')).toBeTruthy();
    expect(mocks.forget).not.toHaveBeenCalled();

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(mocks.forget).toHaveBeenCalledWith('remote-1');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not remove the machine.',
    );

    mocks.forget.mockImplementationOnce((id) => ({
      type: 'connections/forgetRequested',
      payload: [id],
      promise: Promise.resolve(),
    }));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.forget).toHaveBeenCalledTimes(2));
  });
});
