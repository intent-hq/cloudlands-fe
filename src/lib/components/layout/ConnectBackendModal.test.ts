/**
 * ConnectBackendModal Component Tests
 *
 * Covers the two-step add flow: enter host/port/token → capture fingerprint →
 * confirm → store + switch. The saga-owned request actions are mocked so the
 * flow is observable without real IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  captureFingerprintRequested: vi.fn(),
  addConnectionRequested: vi.fn(),
  switchConnectionRequested: vi.fn(),
  openExternalUrl: vi.fn(),
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
  switchConnectionRequested: mocks.switchConnectionRequested,
}));

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
    mocks.captureFingerprintRequested.mockImplementation((params) => ({
      payload: [params],
      promise: Promise.resolve({ fingerprint: 'AA:BB:CC:DD', tokenValid: true }),
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
    mocks.switchConnectionRequested.mockImplementation((id) => ({
      payload: [id],
      promise: Promise.resolve(),
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

  it('stores and switches to the connection on confirm', async () => {
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
    await vi.waitFor(() => expect(mocks.switchConnectionRequested).toHaveBeenCalledWith('r1'));
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

  it('skips the redundant switch when main already re-paired the active backend', async () => {
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
    // The modal closes without dispatching a second teardown/reconnect cycle.
    await vi.waitFor(() => expect(screen.queryByLabelText('Host')).toBeNull());
    expect(mocks.switchConnectionRequested).not.toHaveBeenCalled();
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
});
