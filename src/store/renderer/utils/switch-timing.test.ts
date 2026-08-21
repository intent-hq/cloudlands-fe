/**
 * Unit tests for the dev-only workspace-switch timing module.
 * `import.meta.env.DEV` is true under vitest, so the module is active.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SEED_RELEVANCE_SLACK_MS,
  VIEW_MERGE_WINDOW_MS,
  beginAgentView,
  discardAgentView,
  finalizeAgentView,
  hasOpenAgentView,
  markAgentGate,
  markWorkspaceSeed,
  resetSwitchTiming,
} from './switch-timing';

const AGENT = 'agent-1';
const WS = 'ws-1';

describe('switch-timing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] });
    resetSwitchTiming();
  });
  afterEach(() => {
    resetSwitchTiming();
    vi.useRealTimers();
  });

  it('records gates and finalizes one summary with deltas from t=0', () => {
    beginAgentView(AGENT, WS, 'initialize');
    vi.advanceTimersByTime(50);
    markAgentGate(AGENT, 'hydrationStarted');
    vi.advanceTimersByTime(100);
    markAgentGate(AGENT, 'hydrationSettled');
    vi.advanceTimersByTime(25);

    const summary = finalizeAgentView(AGENT);
    expect(summary).toMatchObject({
      agentId: AGENT,
      workspaceId: WS,
      trigger: 'initialize',
      outcome: 'revealed',
      revealMs: 175,
      gates: { hydrationStarted: 50, hydrationSettled: 150 },
    });
    expect(hasOpenAgentView(AGENT)).toBe(false);
    // Finalize is one-shot.
    expect(finalizeAgentView(AGENT)).toBeNull();
  });

  it('merges a second begin inside the merge window, keeping t=0 and trigger', () => {
    beginAgentView(AGENT, undefined, 'initialize');
    vi.advanceTimersByTime(VIEW_MERGE_WINDOW_MS - 1);
    beginAgentView(AGENT, WS, 'viewed');
    const summary = finalizeAgentView(AGENT);
    expect(summary?.trigger).toBe('initialize');
    expect(summary?.workspaceId).toBe(WS);
    expect(summary?.revealMs).toBe(VIEW_MERGE_WINDOW_MS - 1);
  });

  it('restarts the record when begin arrives after the merge window', () => {
    beginAgentView(AGENT, WS, 'initialize');
    vi.advanceTimersByTime(VIEW_MERGE_WINDOW_MS + 1);
    beginAgentView(AGENT, WS, 'viewed');
    const summary = finalizeAgentView(AGENT);
    expect(summary?.trigger).toBe('viewed');
    expect(summary?.revealMs).toBe(0);
  });

  it('keeps the first occurrence of a gate', () => {
    beginAgentView(AGENT, WS, 'viewed');
    vi.advanceTimersByTime(10);
    markAgentGate(AGENT, 'snapshotApplied');
    vi.advanceTimersByTime(10);
    markAgentGate(AGENT, 'snapshotApplied');
    expect(finalizeAgentView(AGENT)?.gates.snapshotApplied).toBe(10);
  });

  it('derives hydration-failed and revealed-after-timeout outcomes', () => {
    beginAgentView(AGENT, WS, 'initialize');
    markAgentGate(AGENT, 'hydrationFailed');
    expect(finalizeAgentView(AGENT)?.outcome).toBe('hydration-failed');

    beginAgentView(AGENT, WS, 'initialize');
    markAgentGate(AGENT, 'revealTimedOut');
    expect(finalizeAgentView(AGENT)?.outcome).toBe('revealed-after-timeout');
  });

  it('includes relevant workspace seeds and omits stale ones', () => {
    markWorkspaceSeed(WS, 'hooksSeedStarted');
    vi.advanceTimersByTime(SEED_RELEVANCE_SLACK_MS + 1000);
    beginAgentView(AGENT, WS, 'viewed');
    vi.advanceTimersByTime(30);
    markWorkspaceSeed(WS, 'prSeedStarted');
    vi.advanceTimersByTime(20);
    markWorkspaceSeed(WS, 'prSeedDelivered');

    const summary = finalizeAgentView(AGENT);
    expect(summary?.seeds).toEqual({ prSeedStarted: 30, prSeedDelivered: 50 });
  });

  it('a fresh seed start drops the previous delivered timestamp', () => {
    beginAgentView(AGENT, WS, 'viewed');
    markWorkspaceSeed(WS, 'hooksSeedStarted');
    vi.advanceTimersByTime(10);
    markWorkspaceSeed(WS, 'hooksSeedDelivered');
    vi.advanceTimersByTime(10);
    markWorkspaceSeed(WS, 'hooksSeedStarted');
    const summary = finalizeAgentView(AGENT);
    expect(summary?.seeds.hooksSeedStarted).toBe(20);
    expect(summary?.seeds.hooksSeedDelivered).toBeUndefined();
  });

  it('discard drops the open view without a summary', () => {
    beginAgentView(AGENT, WS, 'viewed');
    discardAgentView(AGENT);
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(finalizeAgentView(AGENT)).toBeNull();
  });

  it('gate marks without an open view are no-ops', () => {
    markAgentGate(AGENT, 'hydrationSettled');
    expect(finalizeAgentView(AGENT)).toBeNull();
  });
});
