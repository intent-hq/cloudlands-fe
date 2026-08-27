/**
 * ConnectBackendModal Component Tests
 *
 * Covers the two-step add flow: enter host/port/token → capture fingerprint →
 * confirm → store + open. The saga-owned request actions are mocked so the
 * flow is observable without real IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  openConnectionRequested: vi.fn(),
  loadKeychainSyncStateRequested: vi.fn(),
  setKeychainSyncEnabledRequested: vi.fn(),
  openExternalUrl: vi.fn(),
  // The keychain sync state the mocked selector serves; tests set it before
  // render. Null = not loaded (checkbox hidden, adds proceed normally).
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

async function fillDetails() {
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
      promise: Promise.resolve({ id }),
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
      label: '10.0.0.2:4180',
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
    await fireEvent.click(screen.getByLabelText('Detect all backend IPs'));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
      expect.objectContaining({ detectHosts: false }),
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

  it('keeps Continue disabled until host, a valid port, and token are provided', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    const continueBtn = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueBtn().disabled).toBe(true);

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

    it('hides the checkbox entirely when sync is unsupported (non-macOS)', async () => {
      mocks.syncState.value = { supported: false, enabled: false, status: null };
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      expect(screen.queryByRole('checkbox', { name: 'Save to iCloud' })).toBeNull();
    });

    it('shows the checkbox checked by default on macOS and adds without syncExcluded', async () => {
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

      const checkbox = screen.getByRole('checkbox', { name: 'Save to iCloud' });
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      await fireEvent.click(checkbox);

      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
        expect.objectContaining({ syncExcluded: true }),
      );
      expect(mocks.setKeychainSyncEnabledRequested).not.toHaveBeenCalled();
    });

    it('shows the enable-sync confirm when sync is off; confirming enables sync then adds normally', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      // The machine-global consequences are stated before anything happens.
      expect(await screen.findByText(/syncs all backends on this Mac/i)).toBeTruthy();
      expect(mocks.addConnectionRequested).not.toHaveBeenCalled();

      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(mocks.setKeychainSyncEnabledRequested).toHaveBeenCalledWith(true);
      await vi.waitFor(() =>
        expect(mocks.addConnectionRequested).toHaveBeenCalledWith(
          expect.not.objectContaining({ syncExcluded: true }),
        ),
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

      await fireEvent.click(screen.getByRole('checkbox', { name: 'Save to iCloud' }));
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

    it('surfaces an enable-sync failure inline and does not add', async () => {
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
      expect(mocks.addConnectionRequested).not.toHaveBeenCalled();
    });

    it('refreshes the keychain sync state when the modal opens', async () => {
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      await vi.waitFor(() => expect(mocks.loadKeychainSyncStateRequested).toHaveBeenCalled());
    });
  });
});
