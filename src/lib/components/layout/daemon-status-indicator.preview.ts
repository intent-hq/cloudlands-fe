import { definePreview } from '$lib/component-catalog/preview-definition';
import { PREVIEW_FIXTURE_TIMESTAMPS } from '$lib/component-catalog/preview-fixtures';
import { store } from '$store/renderer/store';
import {
  connectionStatusChanged,
  heartbeatFailed,
  systemStatusFailure,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import type {
  DaemonStatusCheckFailureKind,
  SystemStatusWirePayload,
} from '$store/renderer/slices/daemon-health/daemon-health-types';
import DaemonStatusIndicator from './DaemonStatusIndicator.svelte';

const transport = { mode: 'sidecar-uds' as const, pinnedVersion: '0.9.1' };

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

const generation = () => selectDaemonConnectionGeneration.select(store.state);

interface Scenario {
  stats?: boolean;
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

// The trigger is a dot; open it and the "Status - …" submenu to see the
// details panel this preview is about.
function setup({ stats = true, failures }: Scenario) {
  return () => {
    store.dispatch(connectionStatusChanged('connected', transport));
    if (stats) {
      store.dispatch(
        systemStatusSuccess(statusPayload, PREVIEW_FIXTURE_TIMESTAMPS.lastActivity, generation()),
      );
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
    return () => store.dispatch(connectionStatusChanged('disconnected'));
  };
}

export const preview = definePreview<Record<string, never>>({
  id: 'daemon-status-indicator',
  title: 'Daemon status indicator',
  defaultState: 'degraded-timeout',
  states: {
    healthy: { props: {}, setup: setup({}) },
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
