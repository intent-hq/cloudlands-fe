/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord, KeychainSyncStateResult } from '$shared/types/connections';

const mocks = vi.hoisted(() => ({
  loaded: true,
  connections: [] as ConnectionRecord[],
  pinnedVersion: null as string | null,
  connectedIds: [] as string[],
  keychainSync: null as KeychainSyncStateResult | null,
  // Optional overrides for the shared eligibility predicates (null = real
  // implementation). Lets local-row tests exercise the eligible path without
  // depending on the predicate's local-entry handling.
  isDaemonBehindPin: null as
    (typeof import('$lib/utils/device-update-eligibility'))['isDaemonBehindPin'] | null,
  canRequestDeviceUpdate: null as
    (typeof import('$lib/utils/device-update-eligibility'))['canRequestDeviceUpdate'] | null,
  dispatch: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  rotate: vi.fn(),
  open: vi.fn(),
  forget: vi.fn(),
  updateBackend: vi.fn(),
  setSyncEnabled: vi.fn(),
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
  selectConnections: () => mocks.readable(() => mocks.connections),
  selectConnectionsLoaded: () => mocks.readable(() => mocks.loaded),
  selectRemoteConnections: () =>
    mocks.readable(() => mocks.connections.filter((connection) => !connection.isLocal)),
  selectKeychainSyncState: () => mocks.readable(() => mocks.keychainSync),
  selectPinnedDaemonVersion: () => mocks.readable(() => mocks.pinnedVersion),
  selectConnectedIds: () => mocks.readable(() => mocks.connectedIds),
}));

vi.mock('$lib/utils/device-update-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/device-update-eligibility')>();
  return {
    ...actual,
    isDaemonBehindPin: (...args: Parameters<typeof actual.isDaemonBehindPin>) =>
      mocks.isDaemonBehindPin
        ? mocks.isDaemonBehindPin(...args)
        : actual.isDaemonBehindPin(...args),
    canRequestDeviceUpdate: (...args: Parameters<typeof actual.canRequestDeviceUpdate>) =>
      mocks.canRequestDeviceUpdate
        ? mocks.canRequestDeviceUpdate(...args)
        : actual.canRequestDeviceUpdate(...args),
  };
});

vi.mock('$store/renderer/slices/connections/connections-slice', () => ({
  updateConnectionRequested: (params: unknown) => mocks.update(params),
  testConnectionRequested: (params: unknown) => mocks.test(params),
  rotateConnectionSecretRequested: (params: unknown) => mocks.rotate(params),
  openConnectionRequested: (id: string) => mocks.open(id),
  forgetConnectionRequested: (id: string) => mocks.forget(id),
  updateBackendRequested: (id: string) => mocks.updateBackend(id),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  loadKeychainSyncStateRequested: () => ({ promise: Promise.resolve() }),
  setKeychainSyncEnabledRequested: (enabled: boolean) => mocks.setSyncEnabled(enabled),
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
    mocks.pinnedVersion = null;
    mocks.connectedIds = [];
    mocks.keychainSync = null;
    mocks.isDaemonBehindPin = null;
    mocks.canRequestDeviceUpdate = null;
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
    mocks.updateBackend.mockImplementation((id) => ({
      type: 'connections/updateBackendRequested',
      payload: [id],
      promise: Promise.resolve({ ok: true, version: '0.9.1' }),
    }));
    mocks.setSyncEnabled.mockImplementation((enabled) => ({
      type: 'connections/setKeychainSyncEnabledRequested',
      payload: [enabled],
      promise: Promise.resolve({ supported: true, enabled, status: null }),
    }));
  });

  afterEach(cleanup);

  it('shows named remotes without duplicating their address or visible status text', () => {
    render(DevicesSettings);

    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
    expect(screen.getByRole('status', { name: 'Status: Not open' }).textContent).toBe('');
    expect(screen.getByText('This machine (local)')).toBeTruthy();
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
    for (const status of screen.getAllByRole('status')) {
      expect(status.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('omits hostname and version when the connected version is unknown', () => {
    mocks.connections = [local, { ...remote, hostname: 'studio-host', status: 'connected' }];
    render(DevicesSettings);

    expect(screen.getByText('Studio Mac')).toBeTruthy();
    expect(screen.queryByText('studio-host')).toBeNull();
    for (const status of screen.getAllByRole('status')) {
      expect(status.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('falls back to the address for a blank name', () => {
    mocks.connections = [local, { ...remote, label: '  ', hostname: null }];
    render(DevicesSettings);

    expect(screen.getByText('10.0.0.2:5181')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions for 10.0.0.2:5181' })).toBeTruthy();
  });

  it('shows the backend pretty hostname when the label is just the saved address', () => {
    mocks.connections = [
      local,
      { ...remote, label: '10.0.0.2:5181', hostname: 'Clement’s Mac Studio' },
    ];
    render(DevicesSettings);

    expect(screen.getByText('Clement’s Mac Studio')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Clement’s Mac Studio' })).toBeTruthy();
  });

  it('prefers the backend hostname over the address for a blank name', () => {
    mocks.connections = [local, { ...remote, label: '  ', hostname: 'studio-pretty' }];
    render(DevicesSettings);

    expect(screen.getByText('studio-pretty')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
  });

  it('still edits the stored label when the hostname is displayed', async () => {
    mocks.connections = [
      local,
      { ...remote, label: '10.0.0.2:5181', hostname: 'Clement’s Mac Studio' },
    ];
    render(DevicesSettings);

    await openAction('Edit', 'Clement’s Mac Studio');

    // The Name field always edits the raw stored label. For an unmigrated
    // record (never reconnected since pretty-name defaulting landed) that is
    // still the address — the store migrates it on the next hostname capture.
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      '10.0.0.2:5181',
    );
  });

  it('shows the migrated pretty name in the row and the edit form', async () => {
    mocks.connections = [
      local,
      { ...remote, label: 'Clement’s Mac Studio', hostname: 'Clement’s Mac Studio' },
    ];
    render(DevicesSettings);

    expect(screen.getByText('Clement’s Mac Studio')).toBeTruthy();
    expect(screen.queryByText('10.0.0.2:5181')).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Clement’s Mac Studio' })).toBeTruthy();

    await openAction('Edit', 'Clement’s Mac Studio');

    // Post-migration the stored label IS the pretty name, so the Name field
    // shows it directly.
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Clement’s Mac Studio',
    );
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

    // The local row alone suppresses the empty-state box — the two must not
    // render together (the box only appears when there are no rows at all).
    mocks.loaded = true;
    mocks.connections = [local];
    const withLocal = render(DevicesSettings);
    expect(screen.queryByText('No remote devices saved')).toBeNull();
    withLocal.unmount();

    mocks.connections = [];
    render(DevicesSettings);
    expect(screen.getByText('No remote devices saved')).toBeTruthy();
  });

  it('cycles automatic accents through only the selectable palette', async () => {
    mocks.connections = [
      local,
      remote,
      { ...remote, id: 'remote-2' },
      { ...remote, id: 'remote-3' },
    ];
    render(DevicesSettings);

    await fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    expect(
      screen.getByRole('button', { name: 'Use Teal accent' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Use Rose accent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use Orange accent' })).toBeNull();
  });

  async function openAction(
    name: 'Connect' | 'Edit' | 'Remove' | 'Update',
    deviceName = 'Studio Mac',
  ) {
    await fireEvent.click(screen.getByRole('button', { name: `Actions for ${deviceName}` }));
    await fireEvent.click(await screen.findByRole('menuitem', { name }));
  }

  describe('behind-pin indicator and Update action', () => {
    const behindLabel = m.settings_devices_daemonBehind_tooltip({
      daemonVersion: '0.9.0',
      pinnedVersion: '0.9.1',
    });

    it('marks a device whose captured daemon version is behind the pin, even while disconnected', () => {
      mocks.pinnedVersion = '0.9.1';
      mocks.connections = [local, { ...remote, daemonVersion: 'v0.9.0' }];
      render(DevicesSettings);

      expect(screen.getByRole('img', { name: behindLabel })).toBeTruthy();
    });

    it('shows no indicator for up-to-date or unknown versions', () => {
      mocks.pinnedVersion = '0.9.1';
      mocks.connections = [
        local,
        { ...remote, daemonVersion: '0.9.1' },
        { ...remote, id: 'remote-2', label: 'Other Mac' },
      ];
      render(DevicesSettings);

      expect(screen.queryByRole('img')).toBeNull();
    });

    it('shows no indicator when the pinned version is unknown', () => {
      mocks.connections = [local, { ...remote, daemonVersion: '0.9.0' }];
      render(DevicesSettings);

      expect(screen.queryByRole('img')).toBeNull();
    });

    it('offers Update only for connected behind devices and dispatches the backend update', async () => {
      mocks.pinnedVersion = '0.9.1';
      mocks.connectedIds = ['remote-1'];
      mocks.connections = [
        local,
        {
          ...remote,
          daemonVersion: '0.9.0',
          updateSupported: true,
          exactVersionUpdateSupported: true,
          status: 'connected',
        },
      ];
      render(DevicesSettings);

      await openAction('Update');

      expect(mocks.updateBackend).toHaveBeenCalledWith('remote-1');
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connections/updateBackendRequested',
          payload: ['remote-1'],
        }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('hides Update for a behind device without a live connection', async () => {
      mocks.pinnedVersion = '0.9.1';
      mocks.connections = [
        local,
        {
          ...remote,
          daemonVersion: '0.9.0',
          updateSupported: true,
          exactVersionUpdateSupported: true,
        },
      ];
      render(DevicesSettings);

      await fireEvent.click(screen.getByRole('button', { name: 'Actions for Studio Mac' }));
      await screen.findByRole('menuitem', { name: 'Connect' });

      expect(screen.queryByRole('menuitem', { name: 'Update' })).toBeNull();
      expect(mocks.updateBackend).not.toHaveBeenCalled();
    });

    it.each([undefined, false])(
      'hides Update for a legacy sitter without exact support: %s',
      async (exactVersionUpdateSupported) => {
        mocks.pinnedVersion = '0.9.1';
        mocks.connectedIds = ['remote-1'];
        mocks.connections = [
          local,
          {
            ...remote,
            daemonVersion: '0.9.0',
            updateSupported: true,
            exactVersionUpdateSupported,
            status: 'connected',
          },
        ];
        render(DevicesSettings);
        await fireEvent.click(screen.getByRole('button', { name: 'Actions for Studio Mac' }));
        await screen.findByRole('menuitem', { name: 'Edit' });
        expect(screen.queryByRole('menuitem', { name: 'Update' })).toBeNull();
        expect(mocks.updateBackend).not.toHaveBeenCalled();
      },
    );

    it('hides Update when the daemon does not support self-update or the flag is unknown', async () => {
      mocks.pinnedVersion = '0.9.1';
      mocks.connectedIds = ['remote-1', 'remote-2'];
      mocks.connections = [
        local,
        { ...remote, daemonVersion: '0.9.0', updateSupported: false, status: 'connected' },
        {
          ...remote,
          id: 'remote-2',
          label: 'Other Mac',
          daemonVersion: '0.9.0',
          status: 'connected',
        },
      ];
      render(DevicesSettings);

      // The behind-pin badge stays informational even without update support.
      expect(screen.getAllByRole('img', { name: behindLabel })).toHaveLength(2);

      await fireEvent.click(screen.getByRole('button', { name: 'Actions for Studio Mac' }));
      await screen.findByRole('menuitem', { name: 'Edit' });
      expect(screen.queryByRole('menuitem', { name: 'Update' })).toBeNull();
      // Close before opening the second device's menu.
      await fireEvent.keyDown(document.body, { key: 'Escape' });

      await fireEvent.click(screen.getByRole('button', { name: 'Actions for Other Mac' }));
      await screen.findByRole('menuitem', { name: 'Edit' });
      expect(screen.queryByRole('menuitem', { name: 'Update' })).toBeNull();
      expect(mocks.updateBackend).not.toHaveBeenCalled();
    });
  });

  describe('local device row', () => {
    const localLabel = m.layout_daemonStatus_localConnection_label();
    const behindLabel = m.settings_devices_daemonBehind_tooltip({
      daemonVersion: '0.9.0',
      pinnedVersion: '0.9.1',
    });

    it('lists the local machine first with its connection status and no remote-only actions', () => {
      render(DevicesSettings);

      const [firstRow] = screen.getAllByRole('article');
      expect(within(firstRow).getByText(localLabel)).toBeTruthy();
      expect(within(firstRow).getByRole('status', { name: 'Status: Connected' })).toBeTruthy();
      // Ineligible local rows expose no actions at all — Connect, Edit, and
      // Remove are remote-only.
      expect(screen.queryByRole('button', { name: `Actions for ${localLabel}` })).toBeNull();
    });

    it('shows no badge or Update affordance for the sidecar local row', () => {
      // Sidecar mode: the local record is never enriched with daemonVersion /
      // updateSupported, so the real predicates keep both affordances hidden.
      mocks.pinnedVersion = '0.9.1';
      mocks.connectedIds = ['local'];
      mocks.connections = [local];
      render(DevicesSettings);

      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.queryByRole('button', { name: `Actions for ${localLabel}` })).toBeNull();
    });

    it('offers the badge and Update when the shared predicates deem the local row eligible', async () => {
      const actual = await vi.importActual<typeof import('$lib/utils/device-update-eligibility')>(
        '$lib/utils/device-update-eligibility',
      );
      // The eligibility predicates' local-entry exclusion is being lifted for
      // the behind-pin external local daemon (owned by the behind-pin toast
      // change). Model that here: the row stays entirely predicate-driven.
      mocks.isDaemonBehindPin = (conn, pinned) =>
        actual.isDaemonBehindPin({ ...conn, isLocal: false }, pinned);
      mocks.canRequestDeviceUpdate = (conn, ids, pinned) =>
        actual.canRequestDeviceUpdate({ ...conn, isLocal: false }, ids, pinned);
      mocks.pinnedVersion = '0.9.1';
      mocks.connectedIds = ['local'];
      mocks.connections = [
        {
          ...local,
          daemonVersion: '0.9.0',
          updateSupported: true,
          exactVersionUpdateSupported: true,
        },
        remote,
      ];
      render(DevicesSettings);

      expect(screen.getByRole('img', { name: behindLabel })).toBeTruthy();

      await fireEvent.click(screen.getByRole('button', { name: `Actions for ${localLabel}` }));
      expect(await screen.findByRole('menuitem', { name: 'Update' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Connect' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull();

      await fireEvent.click(screen.getByRole('menuitem', { name: 'Update' }));
      expect(mocks.updateBackend).toHaveBeenCalledWith('local');
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connections/updateBackendRequested',
          payload: ['local'],
        }),
      );
    });
  });

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
    expect(screen.queryByRole('button', { name: 'Use Orange accent' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Use Emerald accent' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'remote-1',
      label: 'Render box',
      accent: 'emerald',
      host: 'render.local',
      port: 5190,
    });
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/theme/i) }),
    );
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it.each(['rose', 'orange'] as const)(
    'preserves a legacy %s accent until the user explicitly changes it',
    async (legacyAccent) => {
      mocks.connections = [local, { ...remote, accent: legacyAccent }];
      render(DevicesSettings);

      await openAction('Edit');
      const legacyOption = screen.getByRole('button', {
        name: `Use ${legacyAccent[0].toUpperCase()}${legacyAccent.slice(1)} accent`,
      });
      expect(legacyOption.getAttribute('aria-pressed')).toBe('true');
      const unavailableWarmAccent = legacyAccent === 'rose' ? 'Orange' : 'Rose';
      expect(
        screen.queryByRole('button', { name: `Use ${unavailableWarmAccent} accent` }),
      ).toBeNull();

      await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Renamed device' },
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Renamed device', accent: legacyAccent }),
      );
    },
  );

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

  describe('detect-IPs and push-to-cloud toggles', () => {
    const detectSwitch = () =>
      screen.getByRole('switch', { name: m.modals_connect_detectHosts_label() });
    const cloudSwitch = () =>
      screen.getByRole('switch', { name: m.settings_devices_pushToCloud_label() });

    beforeEach(() => {
      mocks.keychainSync = { supported: true, enabled: true, status: null };
    });

    it('reflects the saved flags and sends nothing for untouched toggles', async () => {
      mocks.connections = [local, { ...remote, detectHosts: false, syncExcluded: true }];
      render(DevicesSettings);
      await openAction('Edit');

      expect(detectSwitch().getAttribute('aria-checked')).toBe('false');
      expect(cloudSwitch().getAttribute('aria-checked')).toBe('false');
      expect((screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), {
        target: { value: 'Renamed' },
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      expect(mocks.update).toHaveBeenCalledWith({
        id: 'remote-1',
        label: 'Renamed',
        accent: 'indigo',
        host: '10.0.0.2',
        port: 5181,
      });
    });

    it('flips detect-IPs through the update call', async () => {
      render(DevicesSettings);
      await openAction('Edit');

      expect(detectSwitch().getAttribute('aria-checked')).toBe('true');
      await fireEvent.click(detectSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ detectHosts: false }));
      expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('syncExcluded');
      expect(mocks.setSyncEnabled).not.toHaveBeenCalled();
    });

    it('asks for confirmation before excluding a synced device from the cloud', async () => {
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      expect(mocks.update).not.toHaveBeenCalled();
      const warning = screen.getByRole('alert');
      expect(within(warning).getByText(m.settings_devices_removeFromCloud_title())).toBeTruthy();

      await fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(cloudSwitch().getAttribute('aria-checked')).toBe('true');
      expect(mocks.update).not.toHaveBeenCalled();

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      await fireEvent.click(
        within(screen.getByRole('alert')).getByRole('button', {
          name: m.settings_devices_removeFromCloud_confirm(),
        }),
      );
      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ syncExcluded: true })),
      );
      expect(mocks.setSyncEnabled).not.toHaveBeenCalled();
    });

    it('re-includes an excluded device and turns on machine-wide sync when it is off', async () => {
      mocks.keychainSync = { supported: true, enabled: false, status: null };
      mocks.connections = [local, { ...remote, syncExcluded: true }];
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ syncExcluded: false })),
      );
      await waitFor(() => expect(mocks.setSyncEnabled).toHaveBeenCalledWith(true));
      expect(screen.queryByRole('alert')).toBeNull();
      await waitFor(() =>
        expect(screen.queryByRole('form', { name: 'Edit Studio Mac' })).toBeNull(),
      );
    });

    it('leaves the machine-wide sync pref alone when the re-inclusion update is rejected', async () => {
      mocks.keychainSync = { supported: true, enabled: false, status: null };
      mocks.connections = [local, { ...remote, syncExcluded: true }];
      mocks.update.mockImplementation((params) => ({
        type: 'connections/updateRequested',
        payload: [params],
        promise: Promise.resolve({ status: 'failed', reason: 'connect-failed' }),
      }));
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ syncExcluded: false })),
      );
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('form', { name: 'Edit Studio Mac' })).toBeTruthy();
      expect(mocks.setSyncEnabled).not.toHaveBeenCalled();
    });

    it('asks for cloud-removal confirmation again after a confirmed submit fails', async () => {
      mocks.update.mockImplementation((params) => ({
        type: 'connections/updateRequested',
        payload: [params],
        promise: Promise.resolve({ status: 'failed', reason: 'connect-failed' }),
      }));
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      await fireEvent.click(
        within(screen.getByRole('alert')).getByRole('button', {
          name: m.settings_devices_removeFromCloud_confirm(),
        }),
      );
      await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(
          within(screen.getByRole('alert')).queryByText(m.settings_devices_removeFromCloud_title()),
        ).toBeNull(),
      );

      // Toggle back on, then off again: the earlier consent must not carry over.
      await fireEvent.click(cloudSwitch());
      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      expect(mocks.update).toHaveBeenCalledTimes(1);
      expect(
        within(screen.getByRole('alert')).getByText(m.settings_devices_removeFromCloud_title()),
      ).toBeTruthy();
    });

    it('dismisses the cloud-removal prompt when the toggle is flipped back on', async () => {
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      expect(screen.getByRole('alert')).toBeTruthy();

      await fireEvent.click(cloudSwitch());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(cloudSwitch().getAttribute('aria-checked')).toBe('true');
      expect((screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it('re-includes without touching the sync pref when it is already on', async () => {
      mocks.connections = [local, { ...remote, syncExcluded: true }];
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ syncExcluded: false })),
      );
      expect(mocks.setSyncEnabled).not.toHaveBeenCalled();
    });

    it('keeps the panel open with an error when enabling sync after re-inclusion fails', async () => {
      mocks.keychainSync = { supported: true, enabled: false, status: null };
      mocks.connections = [local, { ...remote, syncExcluded: true }];
      mocks.setSyncEnabled.mockImplementation((enabled) => ({
        type: 'connections/setKeychainSyncEnabledRequested',
        payload: [enabled],
        promise: Promise.reject(new Error('keychain locked')),
      }));
      render(DevicesSettings);
      await openAction('Edit');

      await fireEvent.click(cloudSwitch());
      await fireEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(mocks.setSyncEnabled).toHaveBeenCalledWith(true));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('form', { name: 'Edit Studio Mac' })).toBeTruthy();
    });

    it('disables the cloud toggle with an explanation where keychain sync is unsupported', async () => {
      mocks.keychainSync = { supported: false, enabled: false, status: null };
      render(DevicesSettings);
      await openAction('Edit');

      expect((cloudSwitch() as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(m.settings_backendSync_unsupported_description())).toBeTruthy();
      expect((detectSwitch() as HTMLButtonElement).disabled).toBe(false);
    });
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
