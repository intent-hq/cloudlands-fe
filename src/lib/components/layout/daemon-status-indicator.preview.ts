import { definePreview } from '$lib/component-catalog/preview-definition';
import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
import { store } from '$store/renderer/store';
import {
  agentMemoryBreakdownClosed,
  agentMemoryUsageRequested,
  agentMemoryUsageSucceeded,
  connectionStatusChanged,
  heartbeatFailed,
  systemStatusFailure,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import type {
  AgentMemoryUsageWirePayload,
  DaemonStatusCheckFailureKind,
  SystemStatusWirePayload,
} from '$store/renderer/slices/daemon-health/daemon-health-types';
import DaemonStatusIndicator from './DaemonStatusIndicator.svelte';

// Every scene connects to its own daemon: a distinct `target` makes the
// reducer treat the connect as a genuine daemon switch, which drops the
// previous scene's stats and freshness instead of keeping them as a
// same-daemon reconnect would. `sidecar-uds` never renders the target.
let daemonSerial = 0;
const nextTransport = () => ({
  mode: 'sidecar-uds' as const,
  target: `/tmp/preview-daemon-${(daemonSerial += 1)}.sock`,
  pinnedVersion: '0.9.1',
});

const statusPayload: SystemStatusWirePayload = {
  running: true,
  listenMode: 'uds',
  transports: ['uds'],
  port: null,
  clients: 2,
  agents: 1,
  maxAgents: 8,
  version: '0.9.1',
  uptimeSeconds: 5400,
  cpuPercent: 3.2,
  memoryBytes: 157286400,
  fingerprint: null,
  protocolVersion: '2.5',
  host: { os: 'macos', arch: 'aarch64', hasDisplay: true, locality: 'local' },
};

// A daemon that has sampled its process tree: the agent memory row appears
// and opens the per-agent breakdown.
const agentMemoryStatusPayload: SystemStatusWirePayload = {
  ...statusPayload,
  agents: 2,
  childProcesses: 9,
  childMemoryBytes: 3_650_000_000,
  childMemoryPeakBytes: 6_970_000_000,
  agentMemoryBytes: 3_221_225_472,
  agentProcessCount: 2,
};

// Wire order is memory-descending, as the daemon guarantees.
const agentMemoryUsage: AgentMemoryUsageWirePayload = {
  sampledAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt,
  totalBytes: 3_221_225_472,
  agents: [
    {
      agentId: 'agent-2f1c',
      agentName: 'Implement dark mode',
      workspaceId: 'ws-dark-mode',
      provider: 'claude',
      model: 'claude-sonnet-4',
      rootPid: 48213,
      processCount: 3,
      memoryBytes: 2_147_483_648,
      processes: [
        {
          pid: 48213,
          parentPid: 4120,
          name: 'claude-code-acp',
          cmdline:
            '/usr/local/lib/node_modules/@zed-industries/claude-code-acp/dist/index.js --stdio',
          memoryBytes: 1_288_490_189,
        },
        {
          pid: 48250,
          parentPid: 48213,
          name: 'node',
          cmdline:
            'node /home/dev/.cache/intent/mcp/workspace-mcp/server.js --workspace ws-dark-mode',
          memoryBytes: 536_870_912,
        },
        {
          pid: 48311,
          parentPid: 48250,
          name: 'esbuild',
          cmdline:
            '/home/dev/repo/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.25.0 --ping',
          memoryBytes: 322_122_547,
        },
      ],
    },
    {
      agentId: 'agent-9b07',
      agentName: 'Fix flaky CT spec',
      workspaceId: 'ws-flaky-ct',
      provider: 'codex',
      rootPid: 48902,
      processCount: 1,
      memoryBytes: 1_073_741_824,
      processes: [
        {
          pid: 48902,
          parentPid: 4120,
          name: 'codex',
          cmdline: '/usr/local/bin/codex --acp --model gpt-5-codex',
          memoryBytes: 1_073_741_824,
        },
      ],
    },
  ],
};

const generation = () => selectDaemonConnectionGeneration.select(store.state);

// Live uptime is base uptime plus time elapsed since the last successful
// check, so anchor that check near "now" rather than at a fixed past date.
const LAST_SUCCESS_AGE_MS = 90_000;
const lastSuccessAt = () => new Date(Date.now() - LAST_SUCCESS_AGE_MS).toISOString();

interface Scenario {
  stats?: boolean;
  /** Report agent-attributed memory and seed the breakdown the row opens. */
  agentMemory?: boolean;
  failures?:
    | { kind: DaemonStatusCheckFailureKind; count: number }
    | DaemonStatusCheckFailureKind[]
    | 'heartbeat';
}

function failureKinds(
  failures: Exclude<NonNullable<Scenario['failures']>, 'heartbeat'>,
): DaemonStatusCheckFailureKind[] {
  return Array.isArray(failures)
    ? failures
    : Array.from({ length: failures.count }, () => failures.kind);
}

// The store is shared, so two live scenes would render the same merged
// state. Refuse the overlap (`state=all`) rather than show a misleading grid.
let liveScenes = 0;

// The trigger is a dot; open it and the "Status - …" submenu to see the
// details panel this preview is about.
function setup({ stats = true, agentMemory = false, failures }: Scenario) {
  return () => {
    if (liveScenes > 0) {
      throw new Error(
        'The daemon status indicator preview drives the shared daemon-health store and can only show one state at a time; open a single state instead of "all".',
      );
    }
    liveScenes += 1;
    store.dispatch(connectionStatusChanged('connected', nextTransport()));
    if (stats) {
      store.dispatch(
        systemStatusSuccess(
          agentMemory ? agentMemoryStatusPayload : statusPayload,
          lastSuccessAt(),
          generation(),
        ),
      );
    }
    if (agentMemory) {
      // No saga runs in the preview, so the breakdown's first open shows this
      // seeded sample instead of waiting on agent.memoryUsage.
      store.dispatch(agentMemoryUsageRequested());
      store.dispatch(agentMemoryUsageSucceeded(agentMemoryUsage));
    }
    if (failures === 'heartbeat') {
      store.dispatch(heartbeatFailed());
    } else if (failures) {
      for (const kind of failureKinds(failures)) {
        store.dispatch(
          systemStatusFailure(
            { kind, failedAt: PREVIEW_FIXTURE_TIMESTAMPS.updatedAt },
            generation(),
          ),
        );
      }
    }
    return () => {
      liveScenes -= 1;
      if (agentMemory) store.dispatch(agentMemoryBreakdownClosed());
      store.dispatch(connectionStatusChanged('disconnected'));
    };
  };
}

export const preview = definePreview<Record<string, never>>({
  id: 'daemon-status-indicator',
  title: 'Daemon status indicator',
  defaultState: 'degraded-timeout',
  states: {
    healthy: { props: {}, setup: setup({}) },
    'agent-memory': { props: {}, setup: setup({ agentMemory: true }) },
    'degraded-timeout': {
      props: {},
      setup: setup({ failures: { kind: 'timeout', count: 1 } }),
    },
    'degraded-timeouts': {
      props: {},
      setup: setup({ failures: { kind: 'timeout', count: 3 } }),
    },
    'degraded-check-failed': {
      props: {},
      setup: setup({ failures: { kind: 'status-check-failed', count: 1 } }),
    },
    'degraded-mixed-failures': {
      props: {},
      setup: setup({ failures: ['status-check-failed', 'status-check-failed', 'timeout'] }),
    },
    'degraded-no-context': { props: {}, setup: setup({ failures: 'heartbeat' }) },
    'degraded-no-stats': {
      props: {},
      setup: setup({ stats: false, failures: { kind: 'timeout', count: 1 } }),
    },
  },
});

export default DaemonStatusIndicator;
