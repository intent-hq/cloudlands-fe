/**
 * HudBackendMenu tests — the HUD footer's INTENTD status zone as a drop-up
 * backend menu: trigger rendering (dot/label/state), the Open-only backend
 * list (open dispatch, current-backend check, no Switch/Forget), and the
 * add-backend entry.
 *
 * Uses the same mock-store pattern as DaemonStatusIndicator.test.ts so the
 * connections slice (including `windowBackendId`) can be seeded per test and
 * dispatches asserted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';

let mockStoreState: Partial<StoreState> = {};
let mockDispatch = vi.fn();

// Mock svelte-fa (icon rendering is irrelevant here).
vi.mock('svelte-fa', () => ({
  default: () => null,
}));

// Mock the store module
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({
        state: () => mockStoreState,
        dispatch: mockDispatch,
      });
    },
  };
});

// Preload once at module scope so the import graph (ui/menu pulls the bits-ui
// barrel) is cold-transformed during collection — same rationale as the
// DaemonStatusIndicator suite.
const HudBackendMenuPreloaded = (await import('./HudBackendMenu.svelte')).default;
void HudBackendMenuPreloaded;

const healthyDaemonHealth = {
  health: 'healthy',
  stats: null,
  lastUpdated: null,
  polling: false,
} as unknown as StoreState['daemonHealth'];

const localRecord = {
  id: 'local',
  label: 'Local',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};
const remoteRecord = {
  id: 'r1',
  label: 'desk:4180',
  host: '10.0.0.2',
  port: 4180,
  fingerprint: 'AA:BB',
  isLocal: false,
};

function withConnections(windowBackendId: string) {
  return {
    connections: createCollection('id', [localRecord, remoteRecord]),
    activeId: 'local',
    windowBackendId,
    status: 'idle',
    error: null,
    certMismatch: null,
  } as unknown as StoreState['connections'];
}

function seedState(windowBackendId = 'local') {
  mockStoreState = {
    daemonHealth: healthyDaemonHealth,
    connections: withConnections(windowBackendId),
  };
}

async function renderAndOpen() {
  const HudBackendMenu = (await import('./HudBackendMenu.svelte')).default;
  render(HudBackendMenu);
  await fireEvent.click(screen.getByTestId('hud-footer-system'));
}

describe('HudBackendMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch = vi.fn();
    seedState();
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the system-zone trigger with the online state', async () => {
    const HudBackendMenu = (await import('./HudBackendMenu.svelte')).default;
    render(HudBackendMenu);
    const trigger = screen.getByTestId('hud-footer-system');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('INTENTD');
    expect(trigger.textContent).toContain('ONLINE');
  });

  it('opens a menu listing all saved backends plus the add entry', async () => {
    await renderAndOpen();

    expect(screen.getByText('Connect to another intentd…')).toBeTruthy();
    expect(screen.getByText('Connections')).toBeTruthy();
    expect(screen.getByText('This machine (local)')).toBeTruthy();
    expect(screen.getByText('desk:4180')).toBeTruthy();
  });

  it('is Open-only: rows are plain items with no Switch/Forget flyout', async () => {
    await renderAndOpen();

    const remoteRow = screen.getByText('desk:4180').closest('[role="menuitem"]');
    expect(remoteRow?.getAttribute('aria-haspopup')).toBeNull();
    expect(screen.queryByText('Switch')).toBeNull();
    expect(screen.queryByText('Forget')).toBeNull();
  });

  it("marks the HUD's own backend as current (check on windowBackendId, not activeId)", async () => {
    seedState('r1');
    await renderAndOpen();

    const activeIcon = screen.getByLabelText('Active');
    expect(activeIcon.closest('[role="menuitem"]')?.textContent).toContain('desk:4180');
  });

  it('dispatches openConnectionRequested for the clicked backend and closes the menu', async () => {
    await renderAndOpen();

    await fireEvent.click(screen.getByText('desk:4180').closest('[role="menuitem"]')!);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: ['r1'],
        type: 'connections/openRequested',
        asyncActionType: 'connections/open',
      }),
    );
    expect(screen.queryByText('Connections')).toBeNull();
  });

  it('surfaces a secret-unavailable open inline instead of reading as success (#3783)', async () => {
    // Settle the open the way the saga would: a RESOLVED secret-unavailable
    // status (the stored token cannot be read), not a rejection.
    mockDispatch.mockImplementation((action: { type: string; success?: (r: unknown) => void }) => {
      if (action.type === 'connections/openRequested') {
        action.success?.({ status: 'secret-unavailable' });
      }
      return action;
    });
    await renderAndOpen();

    await fireEvent.click(screen.getByText('desk:4180').closest('[role="menuitem"]')!);

    // The HUD window has no toaster/settings route, so the menu carries the
    // failure line, naming the backend whose token is unavailable.
    const alert = await screen.findByTestId('hud-backend-menu-open-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('desk:4180');
  });

  it('shows no failure line when the open resolves opened', async () => {
    mockDispatch.mockImplementation((action: { type: string; success?: (r: unknown) => void }) => {
      if (action.type === 'connections/openRequested') {
        action.success?.({ status: 'opened', id: 'r1' });
      }
      return action;
    });
    await renderAndOpen();

    await fireEvent.click(screen.getByText('desk:4180').closest('[role="menuitem"]')!);

    await vi.waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connections/openRequested' }),
      ),
    );
    expect(screen.queryByTestId('hud-backend-menu-open-error')).toBeNull();
    expect(screen.queryByText('Connections')).toBeNull();
  });

  it('opens the add-backend modal from the add entry', async () => {
    await renderAndOpen();

    await fireEvent.click(
      screen.getByText('Connect to another intentd…').closest('[role="menuitem"]')!,
    );
    expect(screen.getByRole('heading', { name: 'Connect to another intentd' })).toBeTruthy();
    expect(screen.queryByText('Connections')).toBeNull();
  });

  it('closes on Escape', async () => {
    await renderAndOpen();
    expect(screen.getByText('Connections')).toBeTruthy();

    await fireEvent.keyDown(screen.getByText('Connections').closest('[role="menu"]')!, {
      key: 'Escape',
    });
    expect(screen.queryByText('Connections')).toBeNull();
  });
});
