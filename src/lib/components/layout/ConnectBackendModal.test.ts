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

const mocks = vi.hoisted(() => {
  const subscribers = new Set<() => void>();
  const captureOperation = {
    value: { version: 0, status: 'idle', result: null, error: null } as any,
  };
  const connectOperation = {
    value: { version: 0, status: 'idle', result: null, error: null } as any,
  };
  const state = {
    captureFingerprintRequested: vi.fn((params: unknown) => ({
      type: 'connections/captureFingerprintRequested',
      payload: [params],
    })),
    connectBackendRequested: vi.fn((params: unknown) => ({
      type: 'connections/connectBackendRequested',
      payload: [params],
    })),
    nextCapture: {
      result: { fingerprint: 'AA:BB:CC:DD', tokenValid: true },
      error: null as string | null,
    },
    nextConnectError: null as string | null,
    nextConnectResult: { status: 'opened', id: 'r1' } as {
      status: 'opened' | 'secret-unavailable';
      id?: string;
    },
    captureOperation,
    connectOperation,
    subscribers,
    notify() {
      subscribers.forEach((subscriber) => subscriber());
    },
  };
  const dispatch = vi.fn((action: { type?: string }) => {
    if (action.type === 'connections/captureFingerprintRequested') {
      queueMicrotask(() => {
        captureOperation.value = {
          version: captureOperation.value.version + 1,
          status: state.nextCapture.error ? 'error' : 'success',
          result: state.nextCapture.error ? null : state.nextCapture.result,
          error: state.nextCapture.error,
        };
        state.notify();
      });
    } else if (action.type === 'connections/connectBackendRequested') {
      queueMicrotask(() => {
        connectOperation.value = {
          version: connectOperation.value.version + 1,
          status: state.nextConnectError ? 'error' : 'success',
          result: state.nextConnectError ? null : state.nextConnectResult,
          error: state.nextConnectError,
        };
        state.notify();
      });
    }
    return action;
  });
  return Object.assign(state, {
    dispatch,
    loadKeychainSyncStateRequested: vi.fn(() => ({
      type: 'connections/loadKeychainSyncStateRequested',
    })),
    openExternalUrl: vi.fn(),
    // The keychain sync state the mocked selector serves; tests set it before
    // render. Null = not loaded (checkbox hidden, adds proceed normally).
    syncState: {
      value: null as { supported: boolean; enabled: boolean; status: null } | null,
    },
  });
});

vi.mock('svelte-fa', () => ({
  default: () => null,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));

vi.mock('$store/renderer/slices/connections/connections-slice', () => ({
  captureFingerprintRequested: mocks.captureFingerprintRequested,
  connectBackendRequested: mocks.connectBackendRequested,
  loadKeychainSyncStateRequested: mocks.loadKeychainSyncStateRequested,
}));

vi.mock('$store/renderer/slices/connections/connections-selectors', async () => {
  const { readable } = await import('svelte/store');
  const operationSelector = (operation: { value: unknown }) =>
    Object.assign(
      () => ({
        subscribe(run: (value: unknown) => void) {
          const notify = () => run(operation.value);
          notify();
          mocks.subscribers.add(notify);
          return () => mocks.subscribers.delete(notify);
        },
      }),
      { select: () => operation.value },
    );
  return {
    selectKeychainSyncState: () => readable(mocks.syncState.value),
    selectCaptureFingerprintOperation: operationSelector(mocks.captureOperation),
    selectConnectBackendOperation: operationSelector(mocks.connectOperation),
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
    mocks.captureOperation.value = { version: 0, status: 'idle', result: null, error: null };
    mocks.connectOperation.value = { version: 0, status: 'idle', result: null, error: null };
    mocks.nextCapture = {
      result: { fingerprint: 'AA:BB:CC:DD', tokenValid: true },
      error: null,
    };
    mocks.nextConnectError = null;
    mocks.nextConnectResult = { status: 'opened', id: 'r1' };
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

    expect(mocks.connectBackendRequested).toHaveBeenCalledWith({
      connection: {
        label: 'Studio Mac',
        accent: 'blue',
        deviceIcon: 'auto',
        host: '10.0.0.2',
        port: 4180,
        fingerprint: 'AA:BB:CC:DD',
        token: 'secret-token',
        detectHosts: true,
      },
      enableSyncAfterAdd: false,
    });
    await vi.waitFor(() => expect(screen.queryByLabelText('Host')).toBeNull());
  });

  it('passes detectHosts: false when the detect-all-IPs option is unticked', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('switch', { name: 'Detect all backend IPs' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ detectHosts: false }),
      }),
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

    expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ label: 'Render box', accent: 'emerald' }),
      }),
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

    expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
      expect.objectContaining({ connection: expect.objectContaining({ accent: null }) }),
    );
  });

  it('offers Automatic first and stores an explicit device icon override', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    const picker = screen.getByTestId('device-icon-picker-trigger');
    expect(picker.getAttribute('aria-label')).toContain('Automatic (Desktop)');
    picker.focus();
    await fireEvent.keyDown(picker, { key: 'Enter' });
    await fireEvent.keyDown(picker, { key: 'End' });
    await fireEvent.keyDown(picker, { key: 'Enter' });
    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ deviceIcon: 'pottedPlant' }),
      }),
    );
  });

  it('opens the backend after main re-pairs an active connection', async () => {
    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    await vi.waitFor(() => expect(mocks.connectBackendRequested).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.queryByLabelText('Host')).toBeNull());
  });

  it('surfaces a capture error inline and stays on the details step', async () => {
    mocks.nextCapture = { result: null, error: 'unreachable host' };

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('unreachable host')).toBeTruthy();
    expect(mocks.connectBackendRequested).not.toHaveBeenCalled();
    // Still on details: the Host field is present.
    expect(screen.getByLabelText('Host')).toBeTruthy();
  });

  it('surfaces a 401 token rejection inline and blocks the confirm step', async () => {
    mocks.nextCapture = {
      result: { fingerprint: 'AA:BB:CC:DD', tokenValid: false, statusCode: 401 },
      error: null,
    };

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/rejected this access token/i)).toBeTruthy();
    expect(mocks.connectBackendRequested).not.toHaveBeenCalled();
    // Still on details: the Host field is present, no confirm button.
    expect(screen.getByLabelText('Host')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm & connect' })).toBeNull();
  });

  it('stays open with an inline error when the post-add open resolves secret-unavailable (#3783)', async () => {
    mocks.nextConnectResult = { status: 'secret-unavailable' };

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    await vi.waitFor(() => expect(mocks.connectBackendRequested).toHaveBeenCalled());
    // A resolved secret-unavailable is a failure: the modal must not close as
    // if the open succeeded, and the confirm action is re-enabled.
    expect(await screen.findByText(/access token could not be read back/i)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm & connect' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('surfaces a 403 rejection (WS API disabled) with its dedicated message', async () => {
    mocks.nextCapture = {
      result: { fingerprint: 'AA:BB:CC:DD', tokenValid: false, statusCode: 403 },
      error: null,
    };

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/WebSocket API is disabled/i)).toBeTruthy();
    expect(mocks.connectBackendRequested).not.toHaveBeenCalled();
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

    it('hides the checkbox entirely when sync is unsupported (non-macOS)', async () => {
      mocks.syncState.value = { supported: false, enabled: false, status: null };
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      expect(screen.queryByRole('switch', { name: 'Save to iCloud' })).toBeNull();
    });

    it('shows the checkbox checked by default on macOS and adds without syncExcluded', async () => {
      mocks.syncState.value = macSync(true);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.not.objectContaining({ syncExcluded: true }),
          enableSyncAfterAdd: false,
        }),
      );
    });

    it('adds with syncExcluded: true when sync is on but the box is unchecked', async () => {
      mocks.syncState.value = macSync(true);
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      const checkbox = screen.getByRole('switch', { name: 'Save to iCloud' });
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
      await fireEvent.click(checkbox);

      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({ syncExcluded: true }),
          enableSyncAfterAdd: false,
        }),
      );
    });

    it('shows the enable-sync confirm when sync is off; confirming adds then enables sync', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      // The machine-global consequences are stated before anything happens.
      expect(await screen.findByText(/syncs all backends on this Mac/i)).toBeTruthy();
      expect(mocks.connectBackendRequested).not.toHaveBeenCalled();

      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.not.objectContaining({ syncExcluded: true }),
          enableSyncAfterAdd: true,
        }),
      );
    });

    it('declining the enable-sync confirm still adds the backend, excluded from sync', async () => {
      mocks.syncState.value = macSync(false);
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Add without iCloud' }));

      await vi.waitFor(() =>
        expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
          expect.objectContaining({
            connection: expect.objectContaining({ syncExcluded: true }),
            enableSyncAfterAdd: false,
          }),
        ),
      );
    });

    it('adds with syncExcluded and no confirm dialog when sync is off and the box is unchecked', async () => {
      mocks.syncState.value = macSync(false);
      const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
      render(ConnectBackendModal, { props: { open: true } });

      await fireEvent.click(screen.getByRole('switch', { name: 'Save to iCloud' }));
      await fillDetails();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText('AA:BB:CC:DD');
      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

      expect(screen.queryByText(/syncs all backends on this Mac/i)).toBeNull();
      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({ syncExcluded: true }),
          enableSyncAfterAdd: false,
        }),
      );
    });

    it('a failed add on the enable-sync path leaves machine-global sync untouched', async () => {
      mocks.syncState.value = macSync(false);
      mocks.nextConnectError = 'token rejected';
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(await screen.findByText('token rejected')).toBeTruthy();
      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({ enableSyncAfterAdd: true }),
      );
    });

    it('surfaces an aggregate connect failure inline', async () => {
      mocks.syncState.value = macSync(false);
      mocks.nextConnectError = 'keychain unavailable';
      await renderAndReachConfirm();

      await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));
      await screen.findByText(/syncs all backends on this Mac/i);
      await fireEvent.click(screen.getByRole('button', { name: 'Enable sync & add' }));

      expect(await screen.findByText('keychain unavailable')).toBeTruthy();
      expect(mocks.connectBackendRequested).toHaveBeenCalledWith(
        expect.objectContaining({ enableSyncAfterAdd: true }),
      );
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
      expect(mocks.connectBackendRequested).not.toHaveBeenCalled();
    });

    it('falls back to the preload platform gate while the sync state has not loaded', async () => {
      // Sync state never loads (null) but the preload bridge says darwin: the
      // consent checkbox must still render so a fast add cannot silently
      // default to synced without the user ever seeing the opt-out.
      mocks.syncState.value = null;
      (window as any).electronAPI = { ...(window as any).electronAPI, platform: 'darwin' };
      try {
        const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
        render(ConnectBackendModal, { props: { open: true } });

        expect(screen.getByRole('switch', { name: 'Save to iCloud' })).toBeTruthy();
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
