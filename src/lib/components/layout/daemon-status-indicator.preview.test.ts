import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store } from '$store/renderer/store';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import {
  selectAgentMemoryUsage,
  selectDaemonHealth,
  selectDaemonHealthLastUpdated,
  selectDaemonHealthStats,
  selectDaemonStatusCheckFailure,
} from '$store/renderer/slices/daemon-health/daemon-health-selectors';
import { preview } from './daemon-status-indicator.preview';

vi.mock('./DaemonStatusIndicator.svelte', () => ({ default: vi.fn() }));

let storeContext: ReduxStoreContext | undefined;
let cleanup: (() => void) | undefined;

function enter(state: string) {
  cleanup?.();
  cleanup = preview.states[state].setup?.() || undefined;
}

function health() {
  return {
    health: selectDaemonHealth.select(store.state),
    stats: selectDaemonHealthStats.select(store.state),
    lastUpdated: selectDaemonHealthLastUpdated.select(store.state),
    failure: selectDaemonStatusCheckFailure.select(store.state),
  };
}

beforeEach(() => {
  storeContext = initAppStore(store);
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  store.dispatch(connectionStatusChanged('disconnected'));
  storeContext?.dispose();
  storeContext = undefined;
});

describe('daemon status indicator preview fixture', () => {
  it('does not carry stats or freshness from a populated scene into the no-stats scene', () => {
    enter('degraded-timeout');
    expect(health().stats).not.toBeNull();
    expect(health().lastUpdated).not.toBeNull();

    enter('degraded-no-stats');
    expect(health()).toMatchObject({
      health: 'degraded',
      stats: null,
      lastUpdated: null,
      failure: { kind: 'timeout', consecutiveFailures: 1 },
    });
  });

  it('does not carry failure context from a degraded scene into the healthy scene', () => {
    enter('degraded-mixed-failures');
    expect(health().failure?.consecutiveFailures).toBe(3);

    enter('healthy');
    expect(health()).toMatchObject({ health: 'healthy', failure: null });
    expect(health().stats).not.toBeNull();
  });

  it('gives every scene its own failure count regardless of the scene rendered before it', () => {
    const expectedFailures: Record<string, number | null> = {
      healthy: null,
      'agent-memory': null,
      'degraded-timeout': 1,
      'degraded-timeouts': 3,
      'degraded-check-failed': 1,
      'degraded-mixed-failures': 3,
      'degraded-no-context': null,
      'degraded-no-stats': 1,
    };
    expect(Object.keys(expectedFailures).sort()).toEqual(Object.keys(preview.states).sort());

    const order = [...Object.keys(preview.states), ...Object.keys(preview.states).reverse()];
    for (const state of order) {
      enter(state);
      expect(health().failure?.consecutiveFailures ?? null, state).toBe(expectedFailures[state]);
      expect(health().health, state).toBe(
        state === 'healthy' || state === 'agent-memory' ? 'healthy' : 'degraded',
      );
    }
  });

  it('seeds the agent memory scene with a sampled breakdown and drops it on cleanup', () => {
    enter('agent-memory');
    expect(health().stats?.agentMemoryBytes).toBeGreaterThan(0);
    const usage = selectAgentMemoryUsage.select(store.state);
    expect(usage?.agents.length).toBeGreaterThan(0);
    expect(usage?.agents.map((agent) => agent.memoryBytes)).toEqual(
      [...usage!.agents.map((agent) => agent.memoryBytes)].sort((a, b) => b - a),
    );

    enter('healthy');
    expect(health().stats?.agentMemoryBytes).toBeUndefined();
    expect(selectAgentMemoryUsage.select(store.state)).toBeNull();
  });

  it('returns the connection to down after cleanup', () => {
    enter('degraded-timeout');
    cleanup?.();
    cleanup = undefined;
    expect(health().health).toBe('down');
  });

  it('refuses to set up a second scene while one is still live', () => {
    enter('healthy');
    expect(() => preview.states['degraded-timeout'].setup?.()).toThrow(/one state at a time/i);
    expect(health()).toMatchObject({ health: 'healthy', failure: null });

    enter('degraded-timeout');
    expect(health().failure?.kind).toBe('timeout');
  });
});
