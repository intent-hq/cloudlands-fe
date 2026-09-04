/**
 * @vitest-environment jsdom
 *
 * DeviceRow network details — the collapsed row carries no tunnel chip any
 * more; the edit panel shows the record's detected candidate hosts and, when
 * the daemon reports one, its tailcat tunnel address (PROTOCOL §12.3) as
 * read-only facts with a copy action. Records without a tunnel address
 * (older daemons / tunnel off) omit that entry, so the panel degrades
 * gracefully.
 */
import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { ConnectionRecord } from '$shared/types/connections';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: {
      connections: { connectedIds: [], pinnedDaemonVersion: null, keychainSync: null },
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

function renderRow(record: ConnectionRecord, panelMode: 'edit' | null = null) {
  return render(DeviceRow, {
    props: {
      device: record,
      panelMode,
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onRequestRemove: () => {},
    },
  });
}

describe('DeviceRow network details', () => {
  it('renders no tunnel chip or copy action on the collapsed row', () => {
    const { queryByRole } = renderRow(device({ tcAddress: 'tc-key-abc123' }));
    expect(queryByRole('button', { name: m.settings_devices_tcAddress_copy() })).toBeNull();
    expect(queryByRole('list', { name: m.settings_devices_detectedAddresses_label() })).toBeNull();
  });

  it('lists the detected candidate hosts read-only in the edit panel', () => {
    const { getByRole } = renderRow(
      device({ hosts: ['10.0.0.2', '192.168.1.20', 'studio.local'] }),
      'edit',
    );
    const list = getByRole('list', { name: m.settings_devices_detectedAddresses_label() });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.trim()),
    ).toEqual(['10.0.0.2', '192.168.1.20', 'studio.local']);
    expect(within(list).queryByRole('textbox')).toBeNull();
  });

  it('falls back to the primary host for records predating the hosts field', () => {
    const { getByRole } = renderRow(device(), 'edit');
    const list = getByRole('list', { name: m.settings_devices_detectedAddresses_label() });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.trim()),
    ).toEqual(['10.0.0.2']);
  });

  it('shows the tunnel address with a copy action only when the record carries one', () => {
    const withTunnel = renderRow(device({ tcAddress: 'tc-key-abc123' }), 'edit');
    expect(withTunnel.getByText('tc-key-abc123')).toBeTruthy();
    expect(
      withTunnel.getByRole('button', { name: m.settings_devices_tcAddress_copy() }),
    ).toBeTruthy();
    withTunnel.unmount();

    const withoutTunnel = renderRow(device(), 'edit');
    expect(
      withoutTunnel.queryByRole('button', { name: m.settings_devices_tcAddress_copy() }),
    ).toBeNull();
  });

  it('copies the tunnel address to the clipboard from the edit panel', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { getByRole } = renderRow(device({ tcAddress: 'tc-key-abc123' }), 'edit');
    await fireEvent.click(getByRole('button', { name: m.settings_devices_tcAddress_copy() }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tc-key-abc123'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
