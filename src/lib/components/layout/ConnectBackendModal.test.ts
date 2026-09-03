/**
 * ConnectBackendModal Component Tests
 *
 * Covers the two-step add flow: enter host/port/token → capture fingerprint →
 * confirm → store + open. The saga-owned request actions are mocked so the
 * flow is observable without real IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { warmImport } from '../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  openConnectionRequested: vi.fn(),
  loadKeychainSyncStateRequested: vi.fn(),
  setKeychainSyncEnabledRequested: vi.fn(),
  openExternalUrl: vi.fn(),
  // The keychain sync state the mocked selector serves; tests set it before
  // render. Null = not loaded (Toggle hidden, adds proceed normally).
  syncState: {
    value: null as { supported: boolean; enabled: boolean; status: null } | null,
  },
}));

vi.mock('svelte-fa', () => ({
  default: () => null,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('$store/renderer/slices/connections/connections-slice', () => ({
  captureFingerprintRequested: mocks.captureFingerprintRequested,
  addConnectionRequested: mocks.addConnectionRequested,
  openConnectionRequested: mocks.openConnectionRequested,
  loadKeychainSyncStateRequested: mocks.loadKeychainSyncStateRequested,
  setKeychainSyncEnabledRequested: mocks.setKeychainSyncEnabledRequested,
}));

vi.mock('$store/renderer/slices/connections/connections-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectKeychainSyncState: () => readable(mocks.syncState.value),
  };
});

vi.mock('$lib/utils/open-external', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

warmImport(() => import('./ConnectBackendModal.svelte'));

async function fillDetails() {
  await fireEvent.input(screen.getByLabelText('Device name'), {
    target: { value: 'Studio Mac' },
  });
  await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.0.0.2' } });
  await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '4180' } });
  await fireEvent.input(screen.getByLabelText('Access token'), {
    target: { value: 'secret-token' },
  });
}

describe('ConnectBackendModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncState.value = null;
    mocks.captureFingerprintRequested.mockImplementation((params) => ({
      payload: [params],
      promise: Promise.resolve({ fingerprint: 'AA:BB:CC:DD', tokenValid: true }),
    }));
    mocks.loadKeychainSyncStateRequested.mockImplementation(() => ({
      payload: [],
      promise: Promise.resolve(mocks.syncState.value),
    }));
    mocks.setKeychainSyncEnabledRequested.mockImplementation((enabled) => ({
      payload: [enabled],
      promise: Promise.resolve({ supported: true, enabled, status: null }),
    }));
    mocks.addConnectionRequested.mockImplementation((params) => ({
      payload: [params],
      promise: Promise.resolve({
        connection: {
          id: 'r1',
          label: '10.0.0.2:4180',
          host: '10.0.0.2',
          port: 4180,
          fingerprint: 'AA:BB:CC:DD',
          isLocal: false,
        },
        switched: false,
      }),
    }));
    mocks.openConnectionRequested.mockImplementation((id) => ({
      payload: [id],
      promise: Promise.resolve({ status: 'opened', id }),
    }));
  });

  it('captures the fingerprint on Continue and shows the confirm step', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(mocks.captureFingerprintRequested).toHaveBeenCalledWith({
      host: '10.0.0.2',
      port: 4180,
      token: 'secret-token',
    });

    // Confirm step: the captured fingerprint is shown for the user to verify.
    expect(await screen.findByText('AA:BB:CC:DD')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm & connect' })).toBeTruthy();
  });

  it('stores and opens the connection on confirm', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.addConnectionRequested).toHaveBeenCalledWith({
      label: 'Studio Mac',
      accent: 'blue',
      host: '10.0.0.2',
      port: 4180,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
      detectHosts: true,
    });
    await vi.waitFor(() => expect(mocks.openConnectionRequested).toHaveBeenCalledWith('r1'));
  });

  it('passes detectHosts: false when the detect-all-IPs option is unticked', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Detect all backend IPs' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
      expect.objectContaining({ detectHosts: false }),
    );
  });

  it('requires a name and assigns the selected accent', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true, defaultAccent: 'teal' } });

    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.0.0.2' } });
    await fireEvent.input(screen.getByLabelText('Access token'), { target: { value: 'token' } });
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await fireEvent.input(screen.getByLabelText('Device name'), {
      target: { value: 'Render box' },
    });
    expect(screen.queryByRole('button', { name: 'Use Rose accent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use Orange accent' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Use Emerald accent' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Render box', accent: 'emerald' }),
    );
  });

  it('can explicitly add a connection without an accent', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Use None accent' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
      expect.objectContaining({ accent: null }),
    );
  });

  it('opens the backend after main re-pairs an active connection', async () => {
    mocks.addConnectionRequested.mockImplementationOnce((params) => ({
      payload: [params],
      promise: Promise.resolve({
        connection: {
          id: 'r1',
          label: '10.0.0.2:4180',
          host: '10.0.0.2',
          port: 4180,
          fingerprint: 'AA:BB:CC:DD',
          isLocal: false,
        },
        switched: true,
      }),
    }));

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    await vi.waitFor(() => expect(mocks.addConnectionRequested).toHaveBeenCalled());
    // Opening is non-destructive even though main already refreshed the client.
    await vi.waitFor(() => expect(screen.queryByLabelText('Host')).toBeNull());
    expect(mocks.openConnectionRequested).toHaveBeenCalledWith('r1');
  });

  it('surfaces a capture error inline and stays on the details step', async () => {
    mocks.captureFingerprintRequested.mockImplementationOnce((params) => ({
      payload: [params],
      promise: Promise.reject(new Error('unreachable host')),
    }));

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('unreachable host')).toBeTruthy();
    expect(mocks.addConnectionRequested).not.toHaveBeenCalled();
    // Still on details: the Host field is present.
    expect(screen.getByLabelText('Host')).toBeTruthy();
  });

  it('surfaces a 401 token rejection inline and blocks the confirm step', async () => {
    mocks.captureFingerprintRequested.mockImplementationOnce((params) => ({
      payload: [params],
      promise: Promise.resolve({ fingerprint: 'AA:BB:CC:DD', tokenValid: false, statusCode: 401 }),
    }));

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/rejected this access token/i)).toBeTruthy();
    expect(mocks.addConnectionRequested).not.toHaveBeenCalled();
    // Still on details: the Host field is present, no confirm button.
    expect(screen.getByLabelText('Host')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm & connect' })).toBeNull();
  });

  it('surfaces a 403 rejection (WS API disabled) with its dedicated message', async () => {
    mocks.captureFingerprintRequested.mockImplementationOnce((params) => ({
      payload: [params],
      promise: Promise.resolve({ fingerprint: 'AA:BB:CC:DD', tokenValid: false, statusCode: 403 }),
    }));

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/WebSocket API is disabled/i)).toBeTruthy();
    expect(mocks.addConnectionRequested).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Host')).toBeTruthy();
  });

  it('applies the re-pair prefill on open but lets the user clear the field afterwards', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, {
      props: { open: true, prefillHost: '10.0.0.9', prefillPort: 4443 },
    });

    const hostInput = screen.getByLabelText('Host') as HTMLInputElement;
    const portInput = screen.getByLabelText('Port') as HTMLInputElement;
    expect(hostInput.value).toBe('10.0.0.9');
    expect(portInput.value).toBe('4443');

    // Clearing the field must stick — the prefill only applies on the
    // closed→open transition, not on every keystroke.
    await fireEvent.input(hostInput, { target: { value: '' } });
    expect(hostInput.value).toBe('');
  });

  it('shows the headless-install hint and opens the intentd repo via the external opener', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    // The hint renders on the details step, under the where-to-find help.
    expect(screen.getByText(/run a headless intentd/i)).toBeTruthy();

    const link = screen.getByRole('link', { name: 'github.com/intent-hq/intentd' });
    await fireEvent.click(link);

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/intent-hq/intentd');
  });

  it('keeps Continue disabled until name, host, a valid port, and token are provided', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    const continueBtn = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueBtn().disabled).toBe(true);

    await fireEvent.input(screen.getByLabelText('Device name'), {
      target: { value: 'Studio Mac' },
    });
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.0.0.2' } });
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: 'not-a-port' } });
    await fireEvent.input(screen.getByLabelText('Access token'), { target: { value: 't' } });
    expect(continueBtn().disabled).toBe(true);

    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '4180' } });
    expect(continueBtn().disabled).toBe(false);
  });

  describe('Save to iCloud', () => {
    const macSync = (enabled: boolean) => ({ supported: true, enabled, status: null });

    async function renderAndReachConfirm() {
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });
      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
    }

    it('uses the same textless Toggle treatment beside both connection option labels', async () => {
      mocks.syncState.value = macSync(true);
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      const detectHosts = screen.getByRole('button', { name: 'Detect all backend IPs' });
      const saveToICloud = screen.getByRole('button', { name: 'Save to iCloud' });

      expect(detectHosts.className).toBe(saveToICloud.className);
      expect(detectHosts.textContent?.trim()).toBe('');
      expect(saveToICloud.textContent?.trim()).toBe('');
      expect(detectHosts.getAttribute('aria-pressed')).toBe('true');
      expect(saveToICloud.getAttribute('aria-pressed')).toBe('true');
      expect(detectHosts.getAttribute('aria-describedby')).toBe('connect-detect-hosts-description');
    });

    it('hides the Toggle entirely when sync is unsupported (non-macOS)', async () => {
      mocks.syncState.value = { supported: false, enabled: false, status: null };
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      expect(screen.queryByRole('button', { name: 'Save to iCloud' })).toBeNull();
    });

    it('shows the Toggle pressed by default on macOS and adds without syncExcluded', async () => {
      mocks.syncState.value = macSync(true);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
        expect.not.objectContaining({ syncExcluded: true }),
      );
      await vi.waitFor(() => expect(mocks.openConnectionRequested).toHaveBeenCalledWith('r1'));
    });

    it('adds with syncExcluded: true when sync is on but the box is unchecked', async () => {
      mocks.syncState.value = macSync(true);
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      const toggle = screen.getByRole('button', { name: 'Save to iCloud' });
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      await fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-pressed')).toBe('false');

      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
        expect.objectContaining({ syncExcluded: true }),
      );
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
    });

    it('shows the enable-sync confirm when sync is off; confirming adds then enables sync', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      // The machine-global consequences are stated before anything happens.
      expect(await screen.findByText(/syncs all backends on this Mac/i)).toBeTruthy();
      expect(mocks.addConnectionRequested).not.toHaveBeenCalled();

      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
        expect.not.objectContaining({ syncExcluded: true }),
      );
      await vi.waitFor(() =>
        expect(mocks.setKeychainSyncEnabledRequested).toHaveBeenCalledWith(true),
      );
      await vi.waitFor(() => expect(mocks.openConnectionRequested).toHaveBeenCalledWith('r1'));
    });

    it('declining the enable-sync confirm still adds the backend, excluded from sync', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Add without iCloud' }));

      await vi.waitFor(() =>
        expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
          expect.objectContaining({ syncExcluded: true }),
        ),
      );
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(mocks.openConnectionRequested).toHaveBeenCalledWith('r1'));
    });

    it('adds with syncExcluded and no confirm dialog when sync is off and the box is unchecked', async () => {
      mocks.syncState.value = macSync(false);
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      await fireEvent.click(screen.getByRole('button', { name: 'Save to iCloud' }));
      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(screen.queryByText(/syncs all backends on this Mac/i)).toBeNull();
      expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
        expect.objectContaining({ syncExcluded: true }),
      );
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
    });

    it('a failed add on the enable-sync path leaves machine-global sync untouched', async () => {
      mocks.syncState.value = macSync(false);
      mocks.addConnectionRequested.mockImplementationOnce((params) => ({
        payload: [params],
        promise: Promise.reject(new Error('token rejected')),
      }));
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      // The bundled action did not complete: no machine-global side effect.
      expect(await screen.findByText('token rejected')).toBeTruthy();
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
      expect(mocks.openConnectionRequested).not.toHaveBeenCalled();
    });

    it('surfaces an enable-sync failure inline after a successful add (no open)', async () => {
      mocks.syncState.value = macSync(false);
      mocks.setKeychainSyncEnabledRequested.mockImplementationOnce((enabled) => ({
        payload: [enabled],
        promise: Promise.reject(new Error('keychain unavailable')),
      }));
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(await screen.findByText('keychain unavailable')).toBeTruthy();
      // The add ran first (sync enable only after a successful add).
      expect(mocks.addConnectionRequested).toHaveBeenCalled();
      expect(mocks.openConnectionRequested).not.toHaveBeenCalled();
    });

    it('the enable-sync step has a Back button returning to details with values kept', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      // Back on the details step, entered values intact, nothing dispatched.
      expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('10.0.0.2');
      expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe(
        'secret-token',
      );
      expect(mocks.addConnectionRequested).not.toHaveBeenCalled();
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
    });

    it('falls back to the preload platform gate while the sync state has not loaded', async () => {
      // Sync state never loads (null) but the preload bridge says darwin: the
      // consent Toggle must still render so a fast add cannot silently
      // default to synced without the user ever seeing the opt-out.
      mocks.syncState.value = null;
      (window as any).electronAPI = { ...(window as any).electronAPI, platform: 'darwin' };
      try {
        const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
        render(ConnectBackendModal, { props: { open: true } });

        expect(screen.getByRole('button', { name: 'Save to iCloud' })).toBeTruthy();
      } finally {
        delete (window as any).electronAPI.platform;
      }
    });

    it('refreshes the keychain sync state when the modal opens', async () => {
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      await vi.waitFor(() => expect(mocks.loadKeychainSyncStateRequested).toHaveBeenCalled());
    });
  });
});
