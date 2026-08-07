/**
 * ConnectBackendModal Component Tests
 *
 * Covers the two-step add flow: enter host/port/token → capture fingerprint →
 * confirm → store + switch. The connect thunks are mocked so the flow is
 * observable without real IPC.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-fa', () => ({
  default: () => null,
}));

vi.mock('$store/renderer/middlewares/connections-service', () => ({
  captureFingerprint: vi.fn(),
  addConnection: vi.fn(),
  switchConnection: vi.fn(() => Promise.resolve()),
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
  });

  it('captures the fingerprint on Continue and shows the confirm step', async () => {
    const { captureFingerprint } = await import('$store/renderer/middlewares/connections-service');
    vi.mocked(captureFingerprint).mockResolvedValue({ fingerprint: 'AA:BB:CC:DD' });

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(vi.mocked(captureFingerprint)).toHaveBeenCalledWith({
      host: '10.0.0.2',
      port: 4180,
      token: 'secret-token',
    });

    // Confirm step: the captured fingerprint is shown for the user to verify.
    expect(await screen.findByText('AA:BB:CC:DD')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm & connect' })).toBeTruthy();
  });

  it('stores and switches to the connection on confirm', async () => {
    const { captureFingerprint, addConnection, switchConnection } =
      await import('$store/renderer/middlewares/connections-service');
    vi.mocked(captureFingerprint).mockResolvedValue({ fingerprint: 'AA:BB:CC:DD' });
    vi.mocked(addConnection).mockResolvedValue({
      id: 'r1',
      label: '10.0.0.2:4180',
      host: '10.0.0.2',
      port: 4180,
      fingerprint: 'AA:BB:CC:DD',
      isLocal: false,
    });

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('AA:BB:CC:DD');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm & connect' }));

    expect(vi.mocked(addConnection)).toHaveBeenCalledWith({
      label: '10.0.0.2:4180',
      host: '10.0.0.2',
      port: 4180,
      fingerprint: 'AA:BB:CC:DD',
      token: 'secret-token',
    });
    await vi.waitFor(() => expect(vi.mocked(switchConnection)).toHaveBeenCalledWith('r1'));
  });

  it('surfaces a capture error inline and stays on the details step', async () => {
    const { captureFingerprint, addConnection } =
      await import('$store/renderer/middlewares/connections-service');
    vi.mocked(captureFingerprint).mockRejectedValue(new Error('unreachable host'));

    const ConnectBackendModal = (await import('./ConnectBackendModal.svelte')).default;
    render(ConnectBackendModal, { props: { open: true } });

    await fillDetails();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('unreachable host')).toBeTruthy();
    expect(vi.mocked(addConnection)).not.toHaveBeenCalled();
    // Still on details: the Host field is present.
    expect(screen.getByLabelText('Host')).toBeTruthy();
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
