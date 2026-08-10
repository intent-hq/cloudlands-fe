/**
 * CertMismatchModal Component Tests
 *
 * Verifies the blocking failure modal surfaces the stored vs presented
 * fingerprint and wires its three exits (switch back / forget & re-pair /
 * dismiss) to the provided callbacks.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-fa', () => ({
  default: () => null,
}));

const event = {
  id: 'r1',
  host: '10.0.0.2',
  port: 4180,
  expectedFingerprint: 'AA:BB:CC',
  actualFingerprint: 'DD:EE:FF',
};

describe('CertMismatchModal', () => {
  it('shows the connection, expected and presented fingerprints', async () => {
    const CertMismatchModal = (await import('./CertMismatchModal.svelte')).default;
    render(CertMismatchModal, { props: { event } });

    expect(screen.getByText('Certificate changed')).toBeTruthy();
    expect(screen.getByText('10.0.0.2:4180')).toBeTruthy();
    expect(screen.getByText('AA:BB:CC')).toBeTruthy();
    expect(screen.getByText('DD:EE:FF')).toBeTruthy();
  });

  it('invokes the callbacks for switch-back, forget, and dismiss', async () => {
    const onSwitchBack = vi.fn();
    const onForget = vi.fn();
    const onDismiss = vi.fn();

    const CertMismatchModal = (await import('./CertMismatchModal.svelte')).default;
    render(CertMismatchModal, { props: { event, onSwitchBack, onForget, onDismiss } });

    await fireEvent.click(screen.getByText('Switch back to This machine (local)'));
    expect(onSwitchBack).toHaveBeenCalledOnce();

    await fireEvent.click(screen.getByText('Forget & re-pair'));
    expect(onForget).toHaveBeenCalledWith('r1');

    await fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
