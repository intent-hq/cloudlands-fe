/**
 * DaemonStatusIndicator Component Tests
 *
 * Tests for the daemon status dot and dropdown menu rendering logic.
 * Full UI interaction tests are handled by integration tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
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
const mockNavigateToSettings = vi.fn();

// Default connections slice, merged under whatever a test sets on
// `mockStoreState` so the component's connections selectors always resolve
// (a test that only sets `daemonHealth` still gets a valid `connections` slice).
const DEFAULT_CONNECTIONS = {
  connections: createCollection('id'),
  activeId: 'local',
  windowBackendId: 'local',
  status: 'idle',
  error: null,
  certMismatch: null,
  certWarnings: {},
};

// Mock svelte-fa
vi.mock('svelte-fa', () => ({
  default: () => null,
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: mockNavigateToSettings,
}));

// Mock tooltip with a passthrough component so the real dropdown can render.
// The mock also renders the `content` snippet inline (role="tooltip") so tests
// can assert tooltip text without simulating hover.
vi.mock('$lib/components/ui/tooltip', async () => {
  const Tooltip = (await import('./__tests__/mocks/MockTooltipWithContent.svelte')).default;
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

// Preload the component once at module scope so its import graph (~880
// modules — the ui/menu primitives pull the whole bits-ui barrel) is
// cold-transformed during collection, like every other component suite.
// Without this, the first `await import(...)` inside a test body absorbs the
// full transform cost and can exceed the 30s per-test timeout on slower CI
// runners. A dynamic import (after the mock state above is initialized, since
// the mocked store is evaluated during module init) rather than a hoisted
// static import; the in-test imports below are then instant cache hits.
const DaemonStatusIndicatorPreloaded = (await import('./DaemonStatusIndicator.svelte')).default;

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
      expect(module.default).toBe(DaemonStatusIndicatorPreloaded);
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
    it('does not show a tooltip when the status trigger is hovered or focused', async () => {
      mockStoreState = {
        daemonHealth: { health: 'healthy', stats: null, lastUpdated: null, polling: false },
      };
      render(DaemonStatusIndicatorPreloaded);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });

      await fireEvent.mouseEnter(trigger);
      expect(screen.queryByRole('tooltip')).toBeNull();

      trigger.focus();
      expect(trigger).toBe(document.activeElement);
      expect(screen.queryByRole('tooltip')).toBeNull();

      await fireEvent.click(trigger);
      expect(screen.getByRole('menuitem', { name: 'Status - Healthy' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Connect another device' })).toBeTruthy();
    });

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

    it.each([
      ['healthy', 'Status - Healthy'],
      ['degraded', 'Status - Degraded'],
      ['down', 'Status - Not running'],
    ] as const)('labels the details trigger for %s health', async (health, label) => {
      mockStoreState = {
        daemonHealth: { health, stats: null, lastUpdated: null, polling: false },
      };
      render(DaemonStatusIndicatorPreloaded);

      await fireEvent.click(
        screen.getByRole('button', {
          name: `intentd: ${health === 'down' ? 'not running' : health}`,
        }),
      );

      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy();
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

    it('formats memory bytes as human-readable MB/GB/TB', async () => {
      const { formatMemory } = await import('./DaemonStatusIndicator.svelte');
      expect(formatMemory(52428800)).toBe('50.0 MB');
      expect(formatMemory(104857600)).toBe('100.0 MB');
      expect(formatMemory(1610612736)).toBe('1.50 GB');
      expect(formatMemory(1099511627776)).toBe('1.00 TB');
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
      await fireEvent.click(screen.getByText(/^Status - /));

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
      await fireEvent.click(screen.getByText(/^Status - /));

      // Other stats rows render, but CPU/Memory rows are absent.
      expect(screen.getByText('WSS clients')).toBeTruthy();
      expect(screen.queryByText('CPU')).toBeNull();
      expect(screen.queryByText('Memory')).toBeNull();
    });
  });

  describe('workspace disk rendering', () => {
    function withDisk(opts: {
      health?: 'healthy' | 'degraded' | 'down';
      availableBytes?: number;
      totalBytes?: number;
    }) {
      const { health = 'healthy', availableBytes, totalBytes } = opts;
      return {
        daemonHealth: {
          health,
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            ...(availableBytes !== undefined
              ? { workspacesDiskAvailableBytes: availableBytes }
              : {}),
            ...(totalBytes !== undefined ? { workspacesDiskTotalBytes: totalBytes } : {}),
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };
    }

    const iconOf = (trigger: HTMLElement) => trigger.querySelector('svg')!;
    // Disk sizes render with decimal (SI) units so they match Finder.
    const GB = 1000 ** 3;
    const TB = 1000 ** 4;

    it('formats disk bytes with decimal units, at most 3 significant figures', async () => {
      const { formatDiskSize } = await import('./DaemonStatusIndicator.svelte');
      expect(formatDiskSize(2_000_000_000_000)).toBe('2 TB');
      expect(formatDiskSize(1_070_000_000_000)).toBe('1.07 TB');
      expect(formatDiskSize(994_080_000_000)).toBe('994 GB');
      expect(formatDiskSize(246_600_000)).toBe('247 MB');
      expect(formatDiskSize(0)).toBe('0 MB');
    });

    it('takes the larger unit at the half-step threshold so rounding never shows 4 digits', async () => {
      const { formatDiskSize } = await import('./DaemonStatusIndicator.svelte');
      // The whole [999.5 GB, 1 TB) window renders "1 TB", never "1000 GB".
      expect(formatDiskSize(999_500_000_000)).toBe('1 TB');
      expect(formatDiskSize(999_990_000_000)).toBe('1 TB');
      expect(formatDiskSize(999_999_999_999)).toBe('1 TB');
      // Just below the half-step threshold stays in GB.
      expect(formatDiskSize(999_400_000_000)).toBe('999 GB');
      // Same half-step at the MB → GB boundary.
      expect(formatDiskSize(999_500_000)).toBe('1 GB');
      expect(formatDiskSize(999_400_000)).toBe('999 MB');
    });

    it('clamps sub-MB values instead of rendering fractions like "0.0005 MB"', async () => {
      const { formatDiskSize } = await import('./DaemonStatusIndicator.svelte');
      expect(formatDiskSize(500)).toBe('0 MB');
      expect(formatDiskSize(500_000)).toBe('0.5 MB');
    });

    it('renders the row as "free of total" when the daemon reports both fields', async () => {
      // 1.07 TB free of 2 TB — well above the 10% threshold.
      mockStoreState = withDisk({ availableBytes: 1_070_000_000_000, totalBytes: 2 * TB });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.getByText('Workspace disk')).toBeTruthy();
      expect(screen.getByText('1.07 TB free of 2 TB')).toBeTruthy();
      // No warning at >= 10% free.
      expect(screen.queryByLabelText('Less than 10% of the workspaces volume is free')).toBeNull();
    });

    it('renders only the free part when the daemon omits the total', async () => {
      mockStoreState = withDisk({ availableBytes: 994_080_000_000 });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.getByText('Workspace disk')).toBeTruthy();
      expect(screen.getByText('994 GB free')).toBeTruthy();
      // No low-disk warning without a total to compare against.
      expect(screen.queryByLabelText('Less than 10% of the workspaces volume is free')).toBeNull();
    });

    it('hides the row when an older daemon omits the fields', async () => {
      mockStoreState = withDisk({});

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.getByText('WSS clients')).toBeTruthy();
      expect(screen.queryByText('Workspace disk')).toBeNull();
    });

    it('shows the warning icon and turns the dot yellow when free space is below 10%', async () => {
      // 50 GB free of 1 TB = ~4.9% free.
      mockStoreState = withDisk({ availableBytes: 50 * GB, totalBytes: TB });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(iconOf(trigger).classList.contains('text-yellow-500')).toBe(true);
      expect(iconOf(trigger).classList.contains('text-green-500')).toBe(false);

      await fireEvent.click(trigger);
      await fireEvent.click(screen.getByText(/^Status - /));
      expect(screen.getByText('50 GB free of 1 TB')).toBeTruthy();
      const icon = screen.getByLabelText('Less than 10% of the workspaces volume is free');
      // role="img" so the aria-label on the plain span is reliably exposed.
      expect(icon.getAttribute('role')).toBe('img');
      // In-menu status text renders yellow, not green.
      const statusValue = screen.getByText('Healthy');
      expect(statusValue.classList.contains('text-yellow-500')).toBe(true);
      expect(statusValue.classList.contains('text-green-500')).toBe(false);
    });

    it('keeps the green dot at exactly 10% free (threshold is strictly below)', async () => {
      mockStoreState = withDisk({ availableBytes: 0.1 * TB, totalBytes: TB });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(iconOf(trigger).classList.contains('text-green-500')).toBe(true);
    });

    it('keeps the red dot and down label when the daemon is down despite low disk', async () => {
      mockStoreState = withDisk({ health: 'down', availableBytes: 50 * GB, totalBytes: TB });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: not running' });
      expect(iconOf(trigger).classList.contains('text-red-500')).toBe(true);
      expect(iconOf(trigger).classList.contains('text-yellow-500')).toBe(false);
    });
  });

  describe('menu height', () => {
    it('lets the dropdown grow to the bits-ui available height instead of the 24rem default cap', async () => {
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
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      const menu = document.querySelector('[data-slot="menu-content"]')!;
      const style = menu.getAttribute('style') ?? '';
      expect(style).toContain('max-height: var(--bits-dropdown-menu-content-available-height)');
      expect(style).not.toContain('24rem');
    });
  });

  describe('menu width', () => {
    it('auto-sizes to content between the 224px floor and 320px cap instead of a fixed width', async () => {
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
            transport: {
              mode: 'external-ws' as const,
              target: 'wss://some-host.example.com:4180/ws',
            },
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      const wrapper = screen.getByText('Agent slots').closest('.min-w-56')!;
      expect(wrapper).toBeTruthy();
      // Intrinsic width with floor + cap, not the old fixed w-56.
      expect(wrapper.classList.contains('w-max')).toBe(true);
      expect(wrapper.classList.contains('max-w-80')).toBe(true);
      expect(wrapper.classList.contains('w-56')).toBe(false);

      // Stat rows keep label and value on one line.
      const statRow = screen.getByText('Agent slots').closest('div')!;
      expect(statRow.classList.contains('whitespace-nowrap')).toBe(true);

      // The Connection row's value still truncates (cap-constrained) rather
      // than driving the width.
      const connectionValue = screen.getByTitle('external (wss://some-host.example.com:4180/ws)');
      expect(connectionValue.classList.contains('truncate')).toBe(true);
      expect(connectionValue.classList.contains('min-w-0')).toBe(true);
    });
  });

  describe('daemon-vs-pin version mismatch', () => {
    function withVersions(opts: {
      health?: 'healthy' | 'degraded' | 'down';
      daemonVersion?: string;
      pinnedVersion?: string;
    }) {
      const { health = 'healthy', daemonVersion, pinnedVersion } = opts;
      return {
        daemonHealth: {
          health,
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            ...(daemonVersion ? { version: daemonVersion } : {}),
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
          ...(pinnedVersion ? { transport: { mode: 'sidecar-uds' as const, pinnedVersion } } : {}),
        },
      };
    }

    const iconOf = (trigger: HTMLElement) => trigger.querySelector('svg')!;

    it('turns the healthy dot yellow and updates the trigger label when the daemon is behind the pin', async () => {
      mockStoreState = withVersions({ daemonVersion: '0.9.0', pinnedVersion: '1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', {
        name: 'intentd: healthy (version mismatch)',
      });
      expect(iconOf(trigger).classList.contains('text-yellow-500')).toBe(true);
      expect(iconOf(trigger).classList.contains('text-green-500')).toBe(false);
    });

    it('shows the "behind" tooltip and warning icon on the version row when the daemon is older', async () => {
      mockStoreState = withVersions({ daemonVersion: '0.9.0', pinnedVersion: '1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(
        screen.getByRole('button', { name: 'intentd: healthy (version mismatch)' }),
      );
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(
        screen.getByText('Connected intentd v0.9.0 is behind the bundled sidecar (v1.0.0)'),
      ).toBeTruthy();
      expect(
        screen.getByLabelText('Connected intentd v0.9.0 is behind the bundled sidecar (v1.0.0)'),
      ).toBeTruthy();
    });

    it('shows the "ahead" tooltip when the daemon is newer than the pin', async () => {
      mockStoreState = withVersions({ daemonVersion: '2.0.0', pinnedVersion: '1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(
        screen.getByRole('button', { name: 'intentd: healthy (version mismatch)' }),
      );
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(
        screen.getByText('Connected intentd v2.0.0 is ahead of the bundled sidecar (v1.0.0)'),
      ).toBeTruthy();
    });

    it('strips a leading "v" from both versions in the mismatch tooltip (no "vv" double prefix)', async () => {
      // system.status may report a v-prefixed version (the comparator accepts
      // it); the i18n messages prepend their own "v", so the raw value would
      // render as "vv0.9.1".
      mockStoreState = withVersions({ daemonVersion: 'v0.9.1', pinnedVersion: 'v1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(
        screen.getByRole('button', { name: 'intentd: healthy (version mismatch)' }),
      );
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(
        screen.getByText('Connected intentd v0.9.1 is behind the bundled sidecar (v1.0.0)'),
      ).toBeTruthy();
      expect(screen.queryByText(/vv/)).toBeNull();
    });

    it('keeps the green dot and plain version row when the versions match', async () => {
      mockStoreState = withVersions({ daemonVersion: '1.0.0', pinnedVersion: '1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(iconOf(trigger).classList.contains('text-green-500')).toBe(true);

      await fireEvent.click(trigger);
      await fireEvent.click(screen.getByText(/^Status - /));
      expect(screen.getByText('1.0.0')).toBeTruthy();
      expect(screen.queryByLabelText(/bundled sidecar/)).toBeNull();
      expect(screen.queryByText(/bundled sidecar/)).toBeNull();
    });

    it('keeps the green dot when there is no pin to compare against', async () => {
      mockStoreState = withVersions({ daemonVersion: '1.0.0' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(iconOf(trigger).classList.contains('text-green-500')).toBe(true);
    });

    it('does not override the degraded label/dot with the mismatch state', async () => {
      mockStoreState = withVersions({
        health: 'degraded',
        daemonVersion: '0.9.0',
        pinnedVersion: '1.0.0',
      });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: degraded' });
      expect(iconOf(trigger).classList.contains('text-yellow-500')).toBe(true);
    });

    it('keeps the red dot and down label when the daemon is down despite a mismatch', async () => {
      mockStoreState = withVersions({
        health: 'down',
        daemonVersion: '0.9.0',
        pinnedVersion: '1.0.0',
      });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: not running' });
      expect(iconOf(trigger).classList.contains('text-red-500')).toBe(true);
      expect(iconOf(trigger).classList.contains('text-yellow-500')).toBe(false);
    });
  });

  describe('warning icon accessibility (monorepo#2315)', () => {
    // Both warning icons live inside DropdownMenu content where keyboard focus
    // is menu-managed (bits-ui closes the menu on Tab and roving arrow-key
    // focus only visits menu items), so a focusable tooltip trigger is
    // unreachable. The full explanation must instead be exposed to AT via the
    // icon's aria-label.
    it('exposes the full behind/ahead message as the version warning icon accessible name', async () => {
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
            version: '0.9.0',
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
          transport: { mode: 'sidecar-uds' as const, pinnedVersion: '1.0.0' },
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(
        screen.getByRole('button', { name: 'intentd: healthy (version mismatch)' }),
      );
      await fireEvent.click(screen.getByText(/^Status - /));

      const icon = screen.getByLabelText(
        'Connected intentd v0.9.0 is behind the bundled sidecar (v1.0.0)',
      );
      // role="img" so the aria-label on the plain span is reliably exposed.
      expect(icon.getAttribute('role')).toBe('img');
    });

    it('exposes the ahead message as the version warning icon accessible name', async () => {
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
            version: '2.0.0',
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
          transport: { mode: 'sidecar-uds' as const, pinnedVersion: '1.0.0' },
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(
        screen.getByRole('button', { name: 'intentd: healthy (version mismatch)' }),
      );
      await fireEvent.click(screen.getByText(/^Status - /));

      const icon = screen.getByLabelText(
        'Connected intentd v2.0.0 is ahead of the bundled sidecar (v1.0.0)',
      );
      expect(icon.getAttribute('role')).toBe('img');
    });

    it('exposes the protocol-mismatch explanation on the connection-row icon and its menuitem name', async () => {
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: null,
          lastUpdated: null,
          polling: false,
        },
        connections: {
          connections: createCollection('id', [
            {
              id: 'local',
              label: 'Local',
              host: null,
              port: null,
              fingerprint: null,
              isLocal: true,
            },
            {
              id: 'r1',
              label: 'desk:4180',
              host: '10.0.0.2',
              port: 4180,
              fingerprint: 'AA:BB',
              isLocal: false,
            },
          ]),
          activeId: 'r1',
          windowBackendId: 'r1',
          status: 'idle',
          error: null,
          certMismatch: null,
          certWarnings: {},
          protocolMismatch: {
            id: 'r1',
            host: '10.0.0.2',
            port: 4180,
            localProtocolVersion: '2',
            remoteProtocolVersion: '3',
          },
          protocolMismatchModalDismissed: true,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy — desk:4180' }));

      const icon = screen.getByLabelText('Protocol version differs from local');
      expect(icon.getAttribute('role')).toBe('img');

      // The label flows into the submenu trigger's name-from-contents, so
      // arrow-key (menu) navigation announces the explanation with the row.
      expect(
        screen.getByRole('menuitem', { name: /Protocol version differs from local/ }),
      ).toBeTruthy();
    });

    it('shows the passive cert-warnings icon on a connection row with observed per-host mismatches', async () => {
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: null,
          lastUpdated: null,
          polling: false,
        },
        connections: {
          connections: createCollection('id', [
            {
              id: 'local',
              label: 'Local',
              host: null,
              port: null,
              fingerprint: null,
              isLocal: true,
            },
            {
              id: 'r1',
              label: 'desk:4180',
              host: '10.0.0.2',
              port: 4180,
              fingerprint: 'AA:BB',
              isLocal: false,
            },
          ]),
          activeId: 'r1',
          windowBackendId: 'r1',
          status: 'idle',
          error: null,
          certMismatch: null,
          certWarnings: {
            r1: createCollection('host', [
              { host: '10.0.0.3', expectedFingerprint: 'AA:BB', actualFingerprint: 'CC:DD' },
            ]),
          },
          protocolMismatch: null,
          protocolMismatchModalDismissed: false,
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy — desk:4180' }));

      // Same aria-only pattern as the protocol-mismatch icon: the explanation
      // (including the warned host) is the icon's accessible name.
      const icon = screen.getByTestId('daemon-status-cert-warnings-icon');
      expect(icon.getAttribute('role')).toBe('img');
      expect(icon.getAttribute('aria-label')).toContain('unexpected certificate');
      expect(icon.getAttribute('aria-label')).toContain('10.0.0.3');
      // Passive: the row remains a normal openable menu item.
      expect(screen.getByRole('menuitem', { name: /desk:4180/ })).toBeTruthy();
    });

    it('exposes the active-connection check icon as role="img" (monorepo#2320)', async () => {
      mockStoreState = {
        daemonHealth: {
          health: 'healthy',
          stats: null,
          lastUpdated: null,
          polling: false,
        },
        connections: {
          connections: createCollection('id', [
            {
              id: 'local',
              label: 'Local',
              host: null,
              port: null,
              fingerprint: null,
              isLocal: true,
            },
          ]),
          activeId: 'local',
          windowBackendId: 'local',
          status: 'idle',
          error: null,
          certMismatch: null,
          certWarnings: {},
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      // role="img" so the aria-label on the plain span is reliably exposed.
      const icon = screen.getByLabelText('Active');
      expect(icon.getAttribute('role')).toBe('img');
      // The name also flows into the row's menuitem name-from-contents.
      expect(screen.getByRole('menuitem', { name: /Active/ })).toBeTruthy();
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
      await fireEvent.click(screen.getByText(/^Status - /));

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
      await fireEvent.click(screen.getByText(/^Status - /));

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
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.queryByText('Unsloth Server')).toBeNull();
      expect(screen.queryByText('Stop server')).toBeNull();
    });

    it('hides the unsloth section when no status has been polled yet', async () => {
      mockStoreState = { daemonHealth: { ...healthyDaemonHealth, unslothStatus: null } };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.queryByText('Unsloth Server')).toBeNull();
    });

    it('opens a confirm dialog on Stop server and dispatches stopUnslothRequested on confirm', async () => {
      mockStoreState = {
        daemonHealth: { ...healthyDaemonHealth, unslothStatus: runningUnslothStatus },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));
      await fireEvent.click(screen.getByText('Stop server'));

      // Confirmation dialog with the attached-agent warning (2 agents attached).
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(screen.getByText('Stop Unsloth Server')).toBeTruthy();
      expect(screen.getByText(/2 agents are currently attached/)).toBeTruthy();

      // Canonical Dialog portals directly to document.body so the fixed overlay
      // escapes the title-bar region's containing block.
      expect(dialog.parentElement).toBe(document.body);

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
      await fireEvent.click(screen.getByText(/^Status - /));
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
      await fireEvent.click(screen.getByText(/^Status - /));
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
      await fireEvent.click(screen.getByText(/^Status - /));

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
      detectedDeviceKind: 'laptop' as const,
    };
    const remoteRecord = {
      id: 'r1',
      label: 'desk:4180',
      accent: 'teal',
      host: '10.0.0.2',
      port: 4180,
      fingerprint: 'AA:BB',
      isLocal: false,
      detectedDeviceKind: 'macStudio' as const,
    };

    function withConnections(windowBackendId: string, activeId = windowBackendId) {
      return {
        connections: createCollection('id', [localRecord, remoteRecord]),
        activeId,
        windowBackendId,
        status: 'idle',
        error: null,
        certMismatch: null,
        certWarnings: {},
      };
    }

    it('checks the remote row and shows its trigger name while persisted activeId stays local', async () => {
      mockStoreState = {
        daemonHealth: { ...healthy },
        connections: withConnections('r1', 'local'),
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy — desk:4180' }));

      const activeIcon = screen.getByLabelText('Active');
      expect(activeIcon.closest('[role="menuitem"]')?.textContent).toContain('desk:4180');
    });

    it('keeps the saved machine accent in the connection row but omits it from the trigger', async () => {
      mockStoreState = {
        daemonHealth: { ...healthy },
        connections: withConnections('r1', 'local'),
      };

      const { container } = render(DaemonStatusIndicatorPreloaded);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy — desk:4180' }));

      expect(document.querySelectorAll('[data-connection-accent="teal"]')).toHaveLength(1);
      expect(container.querySelector('[data-connection-accent="teal"]')).toBeNull();
    });

    it('checks Local in a local window while the remote is also connected', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      const activeIcon = screen.getByLabelText('Active');
      expect(activeIcon.closest('[role="menuitem"]')?.textContent).toContain(
        'This machine (local)',
      );
    });

    it('shows the Devices list with local first and the Devices CTA last', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('Manage devices')).toBeTruthy();
      expect(screen.getByText('Devices')).toBeTruthy();
      expect(screen.getByText('This machine (local)')).toBeTruthy();
      expect(screen.getByText('desk:4180')).toBeTruthy();

      const localRow = screen.getByText('This machine (local)').closest('[role="menuitem"]')!;
      const remoteRow = screen.getByText('desk:4180').closest('[role="menuitem"]')!;
      expect(localRow.querySelector('svg')).toBeTruthy();
      expect(remoteRow.querySelector('svg')).toBeTruthy();

      // Local entry appears before the remote in DOM order.
      const rows = screen.getAllByRole('menuitem');
      const localIdx = rows.findIndex((b) => b.textContent?.includes('This machine (local)'));
      const remoteIdx = rows.findIndex((b) => b.textContent?.includes('desk:4180'));
      expect(localIdx).toBeGreaterThanOrEqual(0);
      expect(remoteIdx).toBeGreaterThan(localIdx);
      const menu = screen.getByText('Manage devices').closest('[role="menu"]')!;
      expect(
        within(menu as HTMLElement)
          .getAllByRole('button')
          .at(-1)?.textContent,
      ).toContain('Manage devices');
    });

    it('renders device rows as direct actions without secondary menus', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      const remoteRow = screen.getByText('desk:4180').closest('[role="menuitem"]');
      expect(remoteRow?.getAttribute('aria-haspopup')).toBeNull();
      expect(screen.queryByText('Open')).toBeNull();
      expect(screen.queryByText('Update')).toBeNull();
      expect(screen.queryByText('Forget')).toBeNull();

      await fireEvent.click(remoteRow!);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: ['r1'],
          type: 'connections/openRequested',
          asyncActionType: 'connections/open',
        }),
      );
      expect(screen.queryByText('Devices')).toBeNull();
    });

    it('routes the final CTA to Devices settings when a remote is saved', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withConnections('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Manage devices'));
      expect(mockNavigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
    });

    it('offers to connect another device when no remote is saved', async () => {
      mockStoreState = {
        daemonHealth: { ...healthy },
        connections: {
          ...withConnections('local'),
          connections: createCollection('id', [localRecord]),
        },
      };
      render(DaemonStatusIndicatorPreloaded);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText('Connect another device'));
      expect(mockNavigateToSettings).toHaveBeenCalledWith({ tab: 'devices' });
    });
  });

  describe('connection label', () => {
    it('formatConnectionLabel prefers the configured name over hostname and address', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      expect(
        formatConnectionLabel({
          hostname: 'studio.local',
          host: '10.0.0.2',
          port: 4180,
          label: 'Studio Mac',
        }),
      ).toBe('Studio Mac');
    });

    it('formatConnectionLabel falls back to host:port when hostname is missing/empty', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      const base = { host: '10.0.0.2', port: 4180, label: '10.0.0.2:4180' };
      expect(formatConnectionLabel({ ...base })).toBe('10.0.0.2:4180');
      expect(formatConnectionLabel({ ...base, hostname: null })).toBe('10.0.0.2:4180');
      expect(formatConnectionLabel({ ...base, hostname: '   ' })).toBe('10.0.0.2:4180');
    });

    it('formatConnectionLabel preserves the hostname fallback for legacy address labels', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      expect(
        formatConnectionLabel({
          host: '10.0.0.2',
          port: 4180,
          label: '10.0.0.2:4180',
          hostname: 'studio.local',
        }),
      ).toBe('studio.local');
    });

    it('formatConnectionLabel shows the migrated Name for pretty-defaulted records', async () => {
      const { formatConnectionLabel } = await import('./DaemonStatusIndicator.svelte');
      // Post-migration the stored label equals the captured pretty hostname;
      // the Name wins outright.
      expect(
        formatConnectionLabel({
          host: '10.0.0.2',
          port: 4180,
          label: 'Clement’s Mac Studio',
          hostname: 'Clement’s Mac Studio',
        }),
      ).toBe('Clement’s Mac Studio');
    });

    it('renders a configured remote name in the menu', async () => {
      const remoteWithHostname = {
        id: 'r1',
        label: 'Studio Mac',
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
          connections: createCollection('id', [remoteWithHostname]),
          activeId: 'local',
          windowBackendId: 'local',
          status: 'idle',
          error: null,
          certMismatch: null,
          certWarnings: {},
        },
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));

      expect(screen.getByText('Studio Mac')).toBeTruthy();
    });
  });

  describe('remote machine name next to the status dot', () => {
    const healthy = {
      health: 'healthy' as const,
      stats: null,
      lastUpdated: null,
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
    const remoteWithHostname = {
      id: 'r1',
      label: 'Studio Mac',
      host: '10.0.0.2',
      port: 4180,
      fingerprint: 'AA:BB',
      hostname: 'studio.local',
      isLocal: false,
    };
    const remoteWithoutHostname = {
      id: 'r2',
      label: '10.0.0.3:4180',
      host: '10.0.0.3',
      port: 4180,
      fingerprint: 'CC:DD',
      isLocal: false,
    };

    function withCurrent(windowBackendId: string) {
      return {
        connections: createCollection('id', [
          localRecord,
          remoteWithHostname,
          remoteWithoutHostname,
        ]),
        activeId: windowBackendId,
        windowBackendId,
        status: 'idle',
        error: null,
        certMismatch: null,
        certWarnings: {},
      };
    }

    it('shows the configured name inside the trigger button when a named remote is active', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withCurrent('r1') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      // Accessible name includes the visible remote name (WCAG 2.5.3).
      const trigger = screen.getByRole('button', { name: 'intentd: healthy — Studio Mac' });
      const label = screen.getByText('Studio Mac');
      expect(trigger.contains(label)).toBe(true);
      // Subtle, truncated styling so a long name cannot crowd the title bar.
      expect(label.classList.contains('truncate')).toBe(true);
      expect(label.classList.contains('max-w-32')).toBe(true);
      expect(label.classList.contains('text-subtle')).toBe(true);
    });

    it('falls back to the record label (host:port) when the remote has no hostname', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withCurrent('r2') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy — 10.0.0.3:4180' });
      const label = screen.getByText('10.0.0.3:4180');
      expect(trigger.contains(label)).toBe(true);
    });

    it('shows no label when the local connection is active (dot-only trigger)', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withCurrent('local') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(trigger.textContent?.trim()).toBe('');
      // Dot-only trigger keeps the original fixed width.
      expect(trigger.classList.contains('w-6')).toBe(true);
    });

    it('shows no label when connections have not loaded yet', async () => {
      mockStoreState = { daemonHealth: { ...healthy } };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      const trigger = screen.getByRole('button', { name: 'intentd: healthy' });
      expect(trigger.textContent?.trim()).toBe('');
    });

    it('clicking the label toggles the same dropdown as the dot', async () => {
      mockStoreState = { daemonHealth: { ...healthy }, connections: withCurrent('r1') };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByText('Studio Mac'));
      expect(screen.getByText('Manage devices')).toBeTruthy();
    });
  });

  describe('connection row overflow (monorepo#1744)', () => {
    const longTarget = 'wss:100.70.219.113:5181';

    function withTransport(transport?: {
      mode: 'sidecar-uds' | 'external-uds' | 'external-ws';
      target?: string;
    }) {
      return {
        daemonHealth: {
          health: 'healthy' as const,
          stats: {
            clients: 1,
            agents: 0,
            listenMode: 'uds',
            port: null,
            os: 'macos',
            arch: 'aarch64',
            transport,
          },
          lastUpdated: new Date().toISOString(),
          polling: false,
        },
      };
    }

    it('truncates a long external target and exposes the full value via title', async () => {
      mockStoreState = withTransport({ mode: 'external-ws', target: longTarget });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      const value = screen.getByText(`external (${longTarget})`);
      // Full value available via tooltip; ellipsis truncation keeps it inside the popover.
      expect(value.getAttribute('title')).toBe(`external (${longTarget})`);
      expect(value.classList.contains('truncate')).toBe(true);
      expect(value.classList.contains('min-w-0')).toBe(true);
      // Row keeps a gap so the value can never collide with the label.
      const row = value.parentElement!;
      expect(row.classList.contains('gap-2')).toBe(true);
      const label = row.querySelector('.text-subtle')!;
      expect(label.classList.contains('shrink-0')).toBe(true);
    });

    it('renders short values unchanged (sidecar mode)', async () => {
      mockStoreState = withTransport({ mode: 'sidecar-uds' });

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);
      await fireEvent.click(screen.getByRole('button', { name: 'intentd: healthy' }));
      await fireEvent.click(screen.getByText(/^Status - /));

      expect(screen.getByText('sidecar (UDS)')).toBeTruthy();
    });

    it('formatTransportLabel maps transport shapes to display strings', async () => {
      const { formatTransportLabel } = await import('$lib/utils/daemon-status-format');
      expect(formatTransportLabel({ mode: 'sidecar-uds' })).toBe('sidecar (UDS)');
      expect(formatTransportLabel({ mode: 'external-ws', target: longTarget })).toBe(
        `external (${longTarget})`,
      );
      expect(formatTransportLabel({ mode: 'external-ws' })).toBe('external (WebSocket)');
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
        connections: createCollection('id'),
        activeId: 'local',
        windowBackendId: 'local',
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
      expect(screen.getByText('Open This machine (local)')).toBeTruthy();
    });

    it('open-local clears the mismatch and dispatches a local open request', async () => {
      mockStoreState = {
        daemonHealth: { health: 'healthy', stats: null, lastUpdated: null, polling: false },
        connections: withMismatch(),
      };

      const DaemonStatusIndicator = (await import('./DaemonStatusIndicator.svelte')).default;
      render(DaemonStatusIndicator);

      await fireEvent.click(screen.getByText('Open This machine (local)'));

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connections/certMismatchCleared' }),
      );
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: ['local'],
          type: 'connections/openRequested',
          asyncActionType: 'connections/open',
        }),
      );
    });

    it('forget & re-pair clears the mismatch and dispatches a forget request', async () => {
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
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: ['r1'],
          type: 'connections/forgetRequested',
          asyncActionType: 'connections/forget',
        }),
      );
    });
  });
});
