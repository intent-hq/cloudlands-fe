/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';

const mocks = vi.hoisted(() => ({
  loaded: true,
  connections: [] as ConnectionRecord[],
  dispatch: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  open: vi.fn(),
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
  testConnectionRequested: (params: unknown) => mocks.test(params),
  rotateConnectionSecretRequested: (params: unknown) => mocks.rotate(params),
  openConnectionRequested: (id: string) => mocks.open(id),
  forgetConnectionRequested: (id: string) => mocks.forget(id),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  loadKeychainSyncStateRequested: () => ({ promise: Promise.resolve() }),
  setKeychainSyncEnabledRequested: vi.fn(),
}));

import DevicesSettings from './DevicesSettings.svelte';

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

describe('DevicesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loaded = true;
    mocks.connections = [local, remote];
    mocks.update.mockImplementation((params) => ({
      type: 'connections/updateRequested',
      payload: [params],
      promise: Promise.resolve({ status: 'updated', connection: { ...remote, ...params } }),
    }));
    mocks.test.mockImplementation((params) => ({
      type: 'connections/testRequested',
      payload: [params],
      promise: Promise.resolve({ status: 'success', fingerprint: remote.fingerprint }),
    }));
    mocks.rotate.mockImplementation((params) => ({
      type: 'connections/rotateSecretRequested',
      payload: [params],
      promise: Promise.resolve({ status: 'updated', connection: remote }),
    }));
    mocks.open.mockImplementation((id) => ({
      type: 'connections/openRequested',
      payload: [id],
      promise: Promise.resolve({ status: 'opened', id }),
    }));
    mocks.forget.mockImplementation((id) => ({
      type: 'connections/forgetRequested',
      payload: [id],
      promise: Promise.resolve(),
    }));
  });

  afterEach(cleanup);

  it('shows named remotes without duplicating their address or visible status text', () => {
    render(DevicesSettings);

    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
    expect(screen.getByRole('status', { name: 'Status: Not open' }).textContent).toBe('');
    expect(screen.queryByText('This machine')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('shows only the raw version beside the name when connected', () => {
    mocks.connections = [
      local,
      { ...remote, hostname: 'studio-host', status: 'connected', intentdVersion: '6.8.0' },
    ];
    render(DevicesSettings);

    expect(screen.queryByText('studio-host')).toBeNull();
    expect(screen.getByText('6.8.0')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBeTruthy();
  });

  it('omits hostname and version when the connected version is unknown', () => {
    mocks.connections = [local, { ...remote, hostname: 'studio-host', status: 'connected' }];
    render(DevicesSettings);

    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.queryByText('studio-host')).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBeTruthy();
  });

  it('falls back to the address for a blank name', () => {
    mocks.connections = [local, { ...remote, label: '  ', hostname: null }];
    render(DevicesSettings);

    expect(screen.getByText('10.0.0.2:5181')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions for 10.0.0.2:5181' })).toBeTruthy();
  });

  it('dispatches Connect through the existing open/focus action', async () => {
    render(DevicesSettings);

    await openAction('Connect');

    expect(mocks.open).toHaveBeenCalledWith(remote.id);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'connections/openRequested', payload: [remote.id] }),
    );
    expect(mocks.test).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('surfaces Connect failure without testing or saving the device', async () => {
    mocks.open.mockImplementation((id) => ({
      type: 'connections/openRequested',
      payload: [id],
      promise: Promise.reject(new Error('open failed')),
    }));
    render(DevicesSettings);

    await openAction('Connect');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(mocks.test).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('opens the write-only replacement flow when Connect cannot decrypt the saved secret', async () => {
    mocks.open.mockImplementation((id) => ({
      type: 'connections/openRequested',
      payload: [id],
      promise: Promise.resolve({ status: 'secret-unavailable' }),
    }));
    render(DevicesSettings);

    await openAction('Connect');

    await waitFor(() => expect(screen.getByRole('form', { name: 'Edit Studio Mac' })).toBeTruthy());
    expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe('');
    expect(mocks.test).not.toHaveBeenCalled();
  });

  it('renders accessible loading and empty states', () => {
    mocks.loaded = false;
    const loading = render(DevicesSettings);
    expect(screen.getByRole('status').textContent).toContain('Loading devices');
    loading.unmount();

    mocks.loaded = true;
    mocks.connections = [local];
    render(DevicesSettings);
    expect(screen.getByText('No remote devices saved')).toBeTruthy();
  });

  async function openAction(name: 'Connect' | 'Edit' | 'Remove', deviceName = 'Studio Mac') {
    await fireEvent.click(screen.getByRole('button', { name: `Actions for ${deviceName}` }));
    await fireEvent.click(await screen.findByRole('menuitem', { name }));
  }

  it('edits metadata inline', async () => {
    render(DevicesSettings);

    await openAction('Edit');
    expect(screen.getByRole('form', { name: 'Edit Studio Mac' })).toBeTruthy();
    expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe('');
    const name = screen.getByRole('textbox', { name: 'Name' });
    await fireEvent.input(name, { target: { value: 'Render box' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Hostname or IP' }), {
      target: { value: 'render.local' },
    });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Port' }), {
      target: { value: '5190' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Use Rose accent' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'remote-1',
      label: 'Render box',
      accent: 'rose',
      host: 'render.local',
      port: 5190,
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/theme/i) }),
    );
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it('can clear a previously selected device accent', async () => {
    render(DevicesSettings);
    await openAction('Edit');
    const selected = screen.getByRole('button', {
      name: m.settings_devices_accentOption_ariaLabel({
        color: m.settings_devices_accentIndigo_label(),
      }),
    });
    const blank = screen.getByRole('button', {
      name: m.settings_devices_accentBlank_ariaLabel(),
    });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(blank.getAttribute('aria-pressed')).toBe('false');

    await fireEvent.click(blank);

    expect(selected.getAttribute('aria-pressed')).toBe('false');
    expect(blank.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ accent: null }));
  });

  it('replaces the first inline panel when a second device action opens', async () => {
    mocks.connections = [
      local,
      remote,
      { ...remote, id: 'remote-2', label: 'Travel Mac', host: '10.0.0.3' },
    ];
    render(DevicesSettings);

    await openAction('Edit');
    expect(screen.getByRole('form', { name: 'Edit Studio Mac' })).toBeTruthy();

    await openAction('Edit', 'Travel Mac');
    expect(screen.queryByRole('form', { name: 'Edit Studio Mac' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Edit Travel Mac' })).toBeTruthy();
  });

  it('tests current unsaved address values without updating or opening a connection', async () => {
    let resolveTest!: (result: { status: 'success'; fingerprint: string }) => void;
    mocks.test.mockImplementation((params) => ({
      type: 'connections/testRequested',
      payload: [params],
      promise: new Promise((resolve) => {
        resolveTest = resolve;
      }),
    }));
    render(DevicesSettings);
    await openAction('Edit');
    const form = screen.getByRole('form', { name: 'Edit Studio Mac' });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Hostname or IP' }), {
      target: { value: 'preview.local' },
    });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Port' }), {
      target: { value: '6200' },
    });
    const testButton = screen.getByRole('button', { name: 'Test connection' });
    await fireEvent.click(testButton);

    expect(mocks.test).toHaveBeenCalledWith({
      id: 'remote-1',
      host: 'preview.local',
      port: 6200,
    });
    expect(testButton.getAttribute('aria-busy')).toBe('true');
    expect(within(form).getByRole('status')).toBeTruthy();
    resolveTest({ status: 'success', fingerprint: remote.fingerprint! });
    await waitFor(() => expect(testButton.getAttribute('aria-busy')).toBeNull());
    expect(within(form).getByRole('status')).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/open/i) }),
    );
  });

  it('announces a failed connection test and leaves the action available to retry', async () => {
    mocks.test.mockImplementation((params) => ({
      type: 'connections/testRequested',
      payload: [params],
      promise: Promise.resolve({ status: 'failed', reason: 'connect-failed' }),
    }));
    render(DevicesSettings);
    await openAction('Edit');
    const form = screen.getByRole('form', { name: 'Edit Studio Mac' });
    const testButton = screen.getByRole('button', { name: 'Test connection' });

    await fireEvent.click(testButton);

    expect(await within(form).findByRole('alert')).toBeTruthy();
    expect(testButton.hasAttribute('disabled')).toBe(false);
  });

  it('tests a typed write-only secret without saving or rotating it', async () => {
    render(DevicesSettings);
    await openAction('Edit');
    await fireEvent.input(screen.getByLabelText('Access token'), {
      target: { value: 'preview-token' },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(mocks.test).toHaveBeenCalledWith({
      id: remote.id,
      host: remote.host,
      port: remote.port,
      token: 'preview-token',
    });
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('opens the write-only replacement flow when the saved secret is unavailable', async () => {
    mocks.test.mockImplementation((params) => ({
      type: 'connections/testRequested',
      payload: [params],
      promise: Promise.resolve({ status: 'secret-unavailable' }),
    }));
    render(DevicesSettings);
    await openAction('Edit');

    await fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    const edit = screen.getByRole('form', { name: 'Edit Studio Mac' });
    const token = screen.getByLabelText('Access token') as HTMLInputElement;
    expect(edit.contains(token)).toBe(true);
    expect(token.value).toBe('');
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it('validates required metadata before testing or updating', async () => {
    render(DevicesSettings);
    await openAction('Edit');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: ' ' },
    });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Hostname or IP' }), {
      target: { value: '' },
    });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Port' }), {
      target: { value: '70000' },
    });

    expect(screen.getByText('Enter a device name.')).toBeTruthy();
    expect(screen.getByText('Enter a hostname or IP address.')).toBeTruthy();
    expect(screen.getByText('Enter a port from 1 to 65535.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test connection' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Update' }).hasAttribute('disabled')).toBe(true);
  });

  it('requires explicit confirmation before trusting a changed certificate', async () => {
    mocks.update
      .mockImplementationOnce((params) => ({
        payload: [params],
        promise: Promise.resolve({
          status: 'fingerprint-confirmation-required',
          expectedFingerprint: 'AA:BB',
          actualFingerprint: 'CC:DD',
        }),
      }))
      .mockImplementationOnce((params) => ({
        payload: [params],
        promise: Promise.resolve({ status: 'updated', connection: remote }),
      }));
    render(DevicesSettings);
    await openAction('Edit');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Render box' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByText('CC:DD')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Trust fingerprint' }));
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ confirmedFingerprint: 'CC:DD' }),
    );
  });

  it('rotates a typed write-only secret before applying the edit', async () => {
    render(DevicesSettings);
    await openAction('Edit');
    const token = screen.getByLabelText('Access token') as HTMLInputElement;
    expect(token.value).toBe('');
    await fireEvent.input(token, { target: { value: 'replacement-token' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(mocks.rotate).toHaveBeenCalledWith({
      id: 'remote-1',
      token: 'replacement-token',
    });
    expect(mocks.update).toHaveBeenCalledWith({
      id: remote.id,
      label: remote.label,
      accent: remote.accent,
      host: remote.host,
      port: remote.port,
    });
  });

  it('returns focus to the overflow trigger after cancelling an inline form', async () => {
    render(DevicesSettings);
    const trigger = screen.getByRole('button', { name: 'Actions for Studio Mac' });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('requires confirmation before remove and keeps a retry action after failure', async () => {
    mocks.forget.mockImplementationOnce((id) => ({
      type: 'connections/forgetRequested',
      payload: [id],
      promise: Promise.reject(new Error('keychain unavailable')),
    }));
    render(DevicesSettings);

    await openAction('Remove');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Remove device?')).toBeTruthy();
    expect(mocks.forget).not.toHaveBeenCalled();

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(mocks.forget).toHaveBeenCalledWith('remote-1');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not remove the device.',
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
