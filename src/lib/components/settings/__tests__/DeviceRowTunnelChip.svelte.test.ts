/**
 * @vitest-environment jsdom
 *
 * DeviceRow tunnel chip — a device record carrying a `tcAddress` (tailcat
 * tunnel endpoint, PROTOCOL §12.3) shows a copyable tunnel chip; records
 * without one (older daemons / tunnel off) render no chip, so the page
 * degrades gracefully.
 */
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: {
      connections: { connectedIds: [], pinnedDaemonVersion: null },
    },
    dispatch: vi.fn(),
  });
});

const toastSuccess = vi.fn();
vi.mock('$lib/components/ui/toast', () => ({
  toast: {
    get success() {
      return toastSuccess;
    },
    error: vi.fn(),
  },
}));

import DeviceRow from '../DeviceRow.svelte';

function device(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: 'remote-1',
    label: 'Studio Mac',
    host: '10.0.0.2',
    port: 5181,
    fingerprint: 'AA:BB',
    isLocal: false,
    status: 'not-open',
    ...overrides,
  };
}

function renderRow(record: ConnectionRecord) {
  return render(DeviceRow, {
    props: {
      device: record,
      panelMode: null,
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onRequestRemove: () => {},
    },
  });
}

describe('DeviceRow tunnel chip', () => {
  it('shows the copyable tunnel chip when the record carries a tc address', () => {
    const { getByRole } = renderRow(device({ tcAddress: 'tc-key-abc123' }));
    expect(getByRole('button', { name: m.settings_devices_tcAddress_copy() })).toBeTruthy();
  });

  it('renders no chip when the record has no tc address (older daemon / tunnel off)', () => {
    const { queryByRole } = renderRow(device());
    expect(queryByRole('button', { name: m.settings_devices_tcAddress_copy() })).toBeNull();
  });

  it('clicking the chip copies the tc address to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { getByRole } = renderRow(device({ tcAddress: 'tc-key-abc123' }));
    await fireEvent.click(getByRole('button', { name: m.settings_devices_tcAddress_copy() }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tc-key-abc123'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
