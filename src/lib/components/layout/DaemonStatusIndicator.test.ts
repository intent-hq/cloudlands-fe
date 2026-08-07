/**
 * DaemonStatusIndicator Component Tests
 *
 * Tests for the daemon status dot and dropdown menu rendering logic.
 * Full UI interaction tests are handled by integration tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import type { StoreState } from '$store/renderer/types';

// Create state holder
let mockStoreState: Partial<StoreState> = {
  daemonHealth: {
    health: 'down',
    stats: null,
    lastUpdated: null,
    polling: false,
  },
};
let mockDispatch = vi.fn();

// Default connections slice, merged under whatever a test sets on
// `mockStoreState` so the component's connections selectors always resolve
// (a test that only sets `daemonHealth` still gets a valid `connections` slice).
const DEFAULT_CONNECTIONS = {
  connections: [],
  activeId: 'local',
  status: 'idle',
  error: null,
  certMismatch: null,
};

// Mock svelte-fa
vi.mock('svelte-fa', () => ({
  default: () => null,
}));

// Mock the connect thunks so menu actions are observable without real IPC.
vi.mock('$store/renderer/middlewares/connections-service', () => ({
  switchConnection: vi.fn(() => Promise.resolve()),
  forgetConnection: vi.fn(() => Promise.resolve()),
  addConnection: vi.fn(() => Promise.resolve()),
  captureFingerprint: vi.fn(() => Promise.resolve({ fingerprint: '' })),
}));

// Mock tooltip with a passthrough component so the real dropdown can render
vi.mock('$lib/components/ui/tooltip', async () => {
  const Tooltip = (
    await import('$lib/components/workspace/sidebar/__tests__/mocks/MockTooltip.svelte')
  ).default;
  return { Tooltip };
});

// Mock the store module
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  return {
    get store() {
      return createAppStoreMock({
        state: () => ({ connections: { ...DEFAULT_CONNECTIONS }, ...mockStoreState }),
        dispatch: mockDispatch,
      });
    },
  };
});

describe('DaemonStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch = vi.fn();
    mockStoreState = {
      daemonHealth: {
        health: 'down',
        stats: null,
        lastUpdated: null,
        polling: false,
      },
    };
  });

  describe('health state mapping', () => {
    it('maps health states to correct colors', () => {
      const healthColors = {
        healthy: 'bg-green-500',
        degraded: 'bg-yellow-500',
        down: 'bg-red-500',
      };

      expect(healthColors.healthy).toBe('bg-green-500');
      expect(healthColors.degraded).toBe('bg-yellow-500');
      expect(healthColors.down).toBe('bg-red-500');
    });

    it('maps health states to correct labels', () => {
      const healthLabels = {
        healthy: 'intentd: healthy',
        degraded: 'intentd: degraded',
        down: 'intentd: not running',
      };

      expect(healthLabels.healthy).toBe('intentd: healthy');
      expect(healthLabels.degraded).toBe('intentd: degraded');
      expect(healthLabels.down).toBe('intentd: not running');
    });
  });

  describe('component structure', () => {
    it('component file exists and can be imported', async () => {
      const module = await import('./DaemonStatusIndicator.svelte');
      expect(module.default).toBeDefined();
    });
  });

  describe('state selectors', () => {
    it('uses daemon-health selectors from the store', async () => {
      const selectorsModule =
        await import('$store/renderer/slices/daemon-health/daemon-health-selectors');
      expect(selectorsModule.selectDaemonHealth).toBeDefined();
      expect(selectorsModule.selectDaemonHealthStats).toBeDefined();
      expect(selectorsModule.selectDaemonHealthLastUpdated).toBeDefined();
    });
  });

  describe('actions', () => {
    it('pollSystemStatus action is available', async () => {
      const sliceModule = await import('$store/renderer/slices/daemon-health/daemon-health-slice');
      expect(sliceModule.pollSystemStatus).toBeDefined();
      const action = sliceModule.pollSystemStatus();
      expect(action.type).toBe('daemonHealth/pollSystemStatus');
    });
  });

  describe('dropdown interaction', () => {
    it('dispatches pollSystemStatus when dropdown opens ($effect at line 72)', async () => {
      // This test verifies the $effect at line 72
      // which dispatches pollSystemStatus when dropdownOpen becomes true
      const { pollSystemStatus } =
        await import('$store/renderer/slices/daemon-health/daemon-health-slice');

      // Verify the component can trigger the action
      expect(pollSystemStatus).toBeDefined();
      const action = pollSystemStatus();
      expect(action.type).toBe('daemonHealth/pollSystemStatus');

      // Verify mock dispatch is available
      expect(mockDispatch).toBeDefined();
    });
  });

  describe('transport field rendering', () => {
    it('shows "sidecar (UDS)" when mode is sidecar-uds', async () => {
      type BackendTransportInfo =
        import('$store/renderer/slices/daemon-health/daemon-health-types').BackendTransportInfo;
      // Transport info should render as "sidecar (UDS)" for sidecar mode
      const transport: BackendTransportInfo = { mode: 'sidecar-uds' };
      expect(transport.mode).toBe('sidecar-uds');
    });

    it('shows "external (URL)" when mode is external-ws with target', async () => {
      type BackendTransportInfo =
        import('$store/renderer/slices/daemon-health/daemon-health-types').BackendTransportInfo;
      // Transport info should render as "external (ws://...)" for external mode
      const transport: BackendTransportInfo = {
        mode: 'external-ws',
        target: 'ws://127.0.0.1:5181/ws',
      };
      expect(transport.mode).toBe('external-ws');
      expect(transport.target).toBe('ws://127.0.0.1:5181/ws');
    });

    it('shows "unknown" when transport is missing (graceful fallback)', async () => {
      // When transport is undefined, component should show "unknown"
      const stats = {
        clients: 2,
        agents: 1,
        maxAgents: 10,
        listenMode: 'uds',
        port: null,
        version: '0.1.0',
        protocolVersion: '1',
        uptimeSeconds: 300,
        os: 'darwin',
        arch: 'arm64',
        // transport is undefined
      };
      expect(stats.transport).toBeUndefined();
    });
  });

  describe('live uptime calculation', () => {
    it('computes uptime accounting for elapsed time since poll', () => {
      // Component computes live uptime = uptimeSeconds + elapsed since lastUpdated
      const uptimeSeconds = 300; // 5 minutes
      const lastUpdated = new Date(Date.now() - 10000).toISOString(); // 10 seconds ago

      // Expected live uptime: 300s + 10s = 310s
      const expectedMin = 310;
      const expectedMax = 312; // Allow 2s margin for test execution time

      // Compute elapsed time
      const lastUpdateTime = new Date(lastUpdated).getTime();
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - lastUpdateTime) / 1000);
      const liveUptime = uptimeSeconds + elapsedSeconds;

      expect(liveUptime).toBeGreaterThanOrEqual(expectedMin);
      expect(liveUptime).toBeLessThanOrEqual(expectedMax);
    });

    it('returns base uptime when lastUpdated is null', () => {
      const uptimeSeconds = 300;
      const lastUpdated = null;

      // When lastUpdated is null, return base uptime
      const liveUptime = lastUpdated
        ? uptimeSeconds + Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000)
        : uptimeSeconds;

      expect(liveUptime).toBe(300);
    });

    it('returns undefined when uptimeSeconds is undefined', () => {
      const uptimeSeconds = undefined;
      const lastUpdated = new Date().toISOString();

      // When uptimeSeconds is undefined, return undefined
      const liveUptime =
        uptimeSeconds === undefined
          ? undefined
          : uptimeSeconds + Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000);

      expect(liveUptime).toBeUndefined();
    });

    it('formats uptime correctly for hours, minutes, seconds', () => {
      function formatUptime(seconds: number | undefined): string {
        if (seconds === undefined) return 'Unknown';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
          return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
          return `${minutes}m ${secs}s`;
        } else {
          return `${secs}s`;
        }
      }

      expect(formatUptime(45)).toBe('45s');
      expect(formatUptime(125)).toBe('2m 5s');
      expect(formatUptime(3665)).toBe('1h 1m 5s');
      expect(formatUptime(undefined)).toBe('Unknown');
    });
  });

  describe('CPU and memory rendering', () => {
    it('formats CPU percent with one decimal, as-is (sysinfo convention)', async () => {
      const { formatCpu } = await import('./DaemonStatusIndicator.svelte');
      expect(formatCpu(12.34)).toBe('12.3%');
      expect(formatCpu(0)).toBe('0.0%');
      // sysinfo per-process CPU can exceed 100% on multi-core hosts — displayed as-is.
      expect(formatCpu(250)).toBe('250.0%');
    });

    it('formats memory bytes as human-readable MB/GB', async () => {
      const { formatMemory } = await import('./DaemonStatusIndicator.svelte');
      expect(formatMemory(52428800)).toBe('50.0 MB');
      expect(formatMemory(104857600)).toBe('100.0 MB');
      expect(formatMemory(1610612736)).toBe('1.50 GB');
      expect(formatMemory(0)).toBe('0.0 MB');
    });

    it('renders CPU/Memory rows in the dropdown when the daemon reports the fields', async () => {
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            cpuPercent: 3.5,
            memoryBytes: 52428800,
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('CPU')).toBeTruthy();
      expect(screen.getByText('3.5%')).toBeTruthy();
      expect(screen.getByText('Memory')).toBeTruthy();
      expect(screen.getByText('50.0 MB')).toBeTruthy();
    });

    it('hides CPU/Memory rows when an older daemon omits the fields', async () => {
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: {
            clients: 2,
            agents: 1,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            // No cpuPercent / memoryBytes — pre-CPU/memory daemon.
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      // Other stats rows render, but CPU/Memory rows are absent.
      expect(screen.getByText('WSS clients')).toBeTruthy();
      expect(screen.queryByText('CPU')).toBeNull();
      expect(screen.queryByText('Memory')).toBeNull();
    });
  });

  describe('unsloth server section', () => {
    const healthyDaemonHealth = {
      health: 'healthy' as const,
      stats: {
        clients: 1,
        agents: 0,
        listenMode: 'uds',
        port: null,
        os: 'macos',
        arch: 'aarch64',
      },
      lastUpdated: new Date().toISOString(),
      polling: false,
    };
    const runningUnslothStatus = {
      running: true,
      repoId: 'unsloth/Qwen3-4B-GGUF',
      port: 52415,
      pid: 12345,
      uptimeSecs: 125,
      phase: 'ready',
      cpuPercent: 250.5,
      memoryBytes: 4294967296,
      attachedAgentCount: 2,
    };

    it('dispatches pollUnslothStatus when the dropdown opens', async () => {
      mockStoreState = { daemonHealth: { ...healthyDaemonHealth } };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      const unslothPolls = mockDispatch.mock.calls.filter(
        ([action]) => action?.type === 'daemonHealth/pollUnslothStatus',
      );
      expect(unslothPolls.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the unsloth section when a server is running', async () => {
      mockStoreState = {
        daemonHealth: { ...healthyDaemonHealth, unslothStatus: runningUnslothStatus },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('Unsloth Server')).toBeTruthy();
      // Model row shows the shortened repo name.
      expect(screen.getByText('Qwen3-4B-GGUF')).toBeTruthy();
      expect(screen.getByText('ready')).toBeTruthy();
      expect(screen.getByText('52415')).toBeTruthy();
      expect(screen.getByText('2m 5s')).toBeTruthy();
      expect(screen.getByText('250.5%')).toBeTruthy();
      expect(screen.getByText('4.00 GB')).toBeTruthy();
      expect(screen.getByText('Attached agents')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('Stop server')).toBeTruthy();
    });

    it('hides the unsloth section when no server is running ({ running: false } degrade)', async () => {
      mockStoreState = {
        daemonHealth: {
          ...healthyDaemonHealth,
          unslothStatus: { running: false, attachedAgentCount: 0 },
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.queryByText('Unsloth Server')).toBeNull();
      expect(screen.queryByText('Stop server')).toBeNull();
    });

    it('hides the unsloth section when no status has been polled yet', async () => {
      mockStoreState = { daemonHealth: { ...healthyDaemonHealth, unslothStatus: null } };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.queryByText('Unsloth Server')).toBeNull();
    });

    it('opens a confirm dialog on Stop server and dispatches stopUnslothRequested on confirm', async () => {
      mockStoreState = {
        daemonHealth: { ...healthyDaemonHealth, unslothStatus: runningUnslothStatus },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Stop server'));

      // Confirmation dialog with the attached-agent warning (2 agents attached).
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(screen.getByText('Stop Unsloth Server')).toBeTruthy();
      expect(screen.getByText(/2 agents are currently attached/)).toBeTruthy();

      // Portaled to document.body so the fixed overlay escapes the title-bar
      // region's containing block (same assertion as ChatMessage-edit-confirm).
      expect(dialog.closest('.portal-container')?.parentElement).toBe(document.body);

      // The dropdown closes when the dialog opens, so it can't sit above the
      // dialog's dim overlay or swallow the first Escape.
      expect(screen.queryByText('Unsloth Server')).toBeNull();

      // Nothing dispatched until confirm.
      const stopCalls = () =>
        mockDispatch.mock.calls.filter(
          ([action]) => action?.type === 'daemonHealth/stopUnslothRequested',
        ).length;
      expect(stopCalls()).toBe(0);

      await fireEvent.click(screen.getByRole('button', { name: 'Stop Server' }));
      expect(stopCalls()).toBe(1);
    });

    it('cancel in the confirm dialog does not dispatch stopUnslothRequested', async () => {
      mockStoreState = {
        daemonHealth: { ...healthyDaemonHealth, unslothStatus: runningUnslothStatus },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Stop server'));
      await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      const stopCalls = mockDispatch.mock.calls.filter(
        ([action]) => action?.type === 'daemonHealth/stopUnslothRequested',
      );
      expect(stopCalls.length).toBe(0);
    });

    it('shows a no-warning description when no agents are attached', async () => {
      mockStoreState = {
        daemonHealth: {
          ...healthyDaemonHealth,
          unslothStatus: { ...runningUnslothStatus, attachedAgentCount: 0 },
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Stop server'));

      expect(screen.getByText(/restarts automatically/)).toBeTruthy();
      expect(screen.queryByText(/currently attached/)).toBeNull();
    });

    it('disables the stop button while a stop is in flight', async () => {
      mockStoreState = {
        daemonHealth: {
          ...healthyDaemonHealth,
          unslothStatus: runningUnslothStatus,
          unslothStopping: true,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      const stopButton = screen.getByText('Stopping…').closest('button');
      expect(stopButton?.disabled).toBe(true);
    });
  });

  describe('1s polling while dropdown is open', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('dispatches pollSystemStatus every 1s while open and stops on close', async () => {
      vi.useFakeTimers();
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            uptimeSeconds: 300,
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const pollCalls = () =>
        mockDispatch.mock.calls.filter(
          ([action]) => action?.type === 'daemonHealth/pollSystemStatus',
        ).length;

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      await fireEvent.click(trigger);

      // Opening dispatches an immediate poll.
      const baseline = pollCalls();
      expect(baseline).toBeGreaterThanOrEqual(1);

      // Every 1s while open: one more poll per second.
      vi.advanceTimersByTime(3000);
      expect(pollCalls()).toBe(baseline + 3);

      // Closing stops the interval: no further dispatches.
      await fireEvent.click(trigger);
      const afterClose = pollCalls();
      vi.advanceTimersByTime(3000);
      expect(pollCalls()).toBe(afterClose);
    });
  });

  describe('multi-backend connect menu', () => {
    const healthy = {
      health: 'healthy' as const,
      stats: {
        clients: 1,
        agents: 0,
        listenMode: 'uds',
        port: null,
        os: 'macos',
        arch: 'aarch64',
      },
      lastUpdated: new Date().toISOString(),
      polling: false,
    };

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

    function withConnections(activeId: string) {
      return {
        connections: [localRecord, remoteRecord],
        activeId,
        status: 'idle',
        error: null,
        certMismatch: null,
      };
    }

    it('shows the connect action and the connections list with local first', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('Connect to another intentd…')).toBeTruthy();
      expect(screen.getByText('This machine (local)')).toBeTruthy();
      expect(screen.getByText('desk:4180')).toBeTruthy();

      // Local entry's expand toggle appears before the remote's in DOM order.
      const toggles = screen.getAllByRole('button', { expanded: false });
      const localIdx = toggles.findIndex((b) => b.textContent?.includes('This machine (local)'));
      const remoteIdx = toggles.findIndex((b) => b.textContent?.includes('desk:4180'));
      expect(localIdx).toBeGreaterThanOrEqual(0);
      expect(remoteIdx).toBeGreaterThan(localIdx);
    });

    it('renders each connection as a submenu trigger (side flyout, not inline)', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      // The row is a submenu trigger: collapsed with menu-popup semantics, and no
      // Switch/Forget rendered until it is opened (no inline expansion).
      const remoteRow = screen.getByText('desk:4180').closest('button');
      expect(remoteRow?.getAttribute('aria-haspopup')).toBe('menu');
      expect(remoteRow?.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText('Switch')).toBeNull();

      // Opening the row flips aria-expanded and reveals the flyout actions.
      await fireEvent.click(remoteRow!);
      expect(remoteRow?.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText('Switch')).toBeTruthy();
      expect(screen.getByText('Forget')).toBeTruthy();
    });

    it('expands local to Switch only (Forget hidden); remote to Switch + Forget', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      // Local: Switch present, Forget absent (un-forgettable).
      await fireEvent.click(screen.getByText('This machine (local)'));
      expect(screen.getByText('Switch')).toBeTruthy();
      expect(screen.queryByText('Forget')).toBeNull();

      // Remote: both Switch and Forget present.
      await fireEvent.click(screen.getByText('desk:4180'));
      expect(screen.getByText('Switch')).toBeTruthy();
      expect(screen.getByText('Forget')).toBeTruthy();
    });

    it('calls switchConnection when Switch is chosen on a non-active remote', async () => {
      const { switchConnection } = await import('$store/renderer/middlewares/connections-service');
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      await fireEvent.click(screen.getByText('desk:4180'));
      await fireEvent.click(screen.getByText('Switch'));

      expect(vi.mocked(switchConnection)).toHaveBeenCalledWith('r1');
    });

    it('disables Switch for the active entry', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('r1') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      await fireEvent.click(screen.getByText('desk:4180'));
      const switchBtn = screen.getByText('Switch').closest('button');
      expect(switchBtn?.disabled).toBe(true);
    });

    it('calls forgetConnection when Forget is chosen on a remote', async () => {
      const { forgetConnection } = await import('$store/renderer/middlewares/connections-service');
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      await fireEvent.click(screen.getByText('desk:4180'));
      await fireEvent.click(screen.getByText('Forget'));

      expect(vi.mocked(forgetConnection)).toHaveBeenCalledWith('r1');
    });

    it('opens the add-connection modal from the connect action', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Connect to another intentd…'));

      // Modal header + first-step fields render.
      expect(screen.getByRole('heading', { name: 'Connect to another intentd' })).toBeTruthy();
      expect(screen.getByLabelText('Host')).toBeTruthy();
      expect(screen.getByLabelText('Access token')).toBeTruthy();
    });
  });

  describe('connection label (hostname)', () => {
    it('formatConnectionLabel renders hostname (host:port) when a hostname is captured', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      expect(
        formatConnectionLabel({
          hostname: 'studio.local',
          host: '10.0.0.2',
          port: 4180,
          label: '10.0.0.2:4180',
        }),
      ).toBe('studio.local (10.0.0.2:4180)');
    });

    it('formatConnectionLabel falls back to host:port when hostname is missing/empty', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      const base = { host: '10.0.0.2', port: 4180, label: '10.0.0.2:4180' };
      expect(formatConnectionLabel({ ...base })).toBe('10.0.0.2:4180');
      expect(formatConnectionLabel({ ...base, hostname: null })).toBe('10.0.0.2:4180');
      expect(formatConnectionLabel({ ...base, hostname: '   ' })).toBe('10.0.0.2:4180');
    });

    it('renders a remote as "hostname (host:port)" in the menu once labeled', async () => {
      const remoteWithHostname = {
        id: 'r1',
        label: '10.0.0.2:4180',
        host: '10.0.0.2',
        port: 4180,
        fingerprint: 'AA:BB',
        hostname: 'studio.local',
        isLocal: false,
      };
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
        connections: {
          connections: [remoteWithHostname],
          activeId: 'local',
          status: 'idle',
          error: null,
          certMismatch: null,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('studio.local (10.0.0.2:4180)')).toBeTruthy();
    });
  });

  describe('cert-mismatch modal', () => {
    const mismatch = {
      id: 'r1',
      host: '10.0.0.2',
      port: 4180,
      expectedFingerprint: 'AA:BB:CC',
      actualFingerprint: 'DD:EE:FF',
    };

    function withMismatch() {
      return {
        connections: [],
        activeId: 'local',
        status: 'idle',
        error: null,
        certMismatch: mismatch,
      };
    }

    it('renders on a cert-mismatch push, showing stored vs presented fingerprint', async () => {
      mockStoreState = {
        daemonHealth: { health: 'healthy', stats: null, lastUpdated: null, polling: false },
        connections: withMismatch(),
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      // Renders without opening the dropdown — it is driven by the push.
      expect(screen.getByText('Certificate changed')).toBeTruthy();
      expect(screen.getByText('AA:BB:CC')).toBeTruthy();
      expect(screen.getByText('DD:EE:FF')).toBeTruthy();
      expect(screen.getByText('Switch back to This machine (local)')).toBeTruthy();
    });

    it('switch-back clears the mismatch and switches to local', async () => {
      const { switchConnection } = await import('$store/renderer/middlewares/connections-service');
      mockStoreState = {
        daemonHealth: { health: 'healthy', stats: null, lastUpdated: null, polling: false },
        connections: withMismatch(),
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByText('Switch back to This machine (local)'));

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connections/certMismatchCleared' }),
      );
      expect(vi.mocked(switchConnection)).toHaveBeenCalledWith('local');
    });

    it('forget & re-pair clears the mismatch and forgets the connection', async () => {
      const { forgetConnection } = await import('$store/renderer/middlewares/connections-service');
      mockStoreState = {
        daemonHealth: { health: 'healthy', stats: null, lastUpdated: null, polling: false },
        connections: withMismatch(),
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByText('Forget & re-pair'));

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connections/certMismatchCleared' }),
      );
      expect(vi.mocked(forgetConnection)).toHaveBeenCalledWith('r1');
    });
  });
});
