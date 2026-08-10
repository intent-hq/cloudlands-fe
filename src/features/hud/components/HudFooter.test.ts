/**
 * HudFooter tests — the footer shows three zones: the daemon connection
 * status (LEFT, from `selectHudSystem` — a live view over the daemon-health
 * slice the 10s middleware poll maintains), WORKSPACE counts by state
 * (MIDDLE, from `selectHudWorkspaceStateBars` — the SAME rollup the left
 * rail and grid use), and version info (RIGHT: `__APP_VERSION__` + the
 * daemon version from the same daemon-health stats). The ATTENTION and
 * FAILED counters blink (hud-stat-blink) only when their count is > 0; zero
 * counts render static/dimmed (hud-stat-zero) like the other counters.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  connectionStatusChanged,
  heartbeatFailed,
  systemStatusSuccess,
} from '$store/renderer/slices/daemon-health/daemon-health-slice';
import type { SystemStatusWirePayload } from '$store/renderer/slices/daemon-health/daemon-health-types';
import type { AgentSession, Workspace, WorkspaceDisplayStatus, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudFooter from './HudFooter.svelte';

/** PROTOCOL §5.7-shaped system.status payload the health poll folds. */
function systemStatusPayload(overrides: Partial<SystemStatusWirePayload> = {}): SystemStatusWirePayload {
  return {
    running: true,
    listenMode: 'uds',
    transports: ['uds'],
    clients: 1,
    agents: 2,
    version: '0.9.1',
    uptimeSeconds: 12,
    protocolVersion: '3',
    host: { os: 'macos', arch: 'arm64', hasDisplay: true, locality: 'local' },
    ...overrides,
  };
}

/** Summary agent entry: status plus optional parentage (§5.1 v2.9). */
interface SummaryAgent {
  status: string;
  parentAgentId?: string;
}

/** Workspace with a displayStatus and an agentSummary (§5.1). */
function makeWorkspace(
  id: string,
  displayStatus: WorkspaceDisplayStatus | undefined,
  agents: Array<string | SummaryAgent> = [],
): Workspace {
  const entries = agents.map((agent, i) => {
    const info = typeof agent === 'string' ? { status: agent } : agent;
    return { id: `${id}-a-${i}`, name: `Agent ${i}`, ...info };
  });
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    ...(displayStatus ? { displayStatus } : {}),
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    agentSummary: {
      count: entries.length,
      agentIds: entries.map((entry) => entry.id),
      agents: entries,
    } as Workspace['agentSummary'],
  } as Workspace;
}

/** Track a session overlay (attention request / background flag, §5.5). */
function trackSession(agentId: string, fields: Partial<AgentSession>) {
  const session = {
    id: agentId,
    workspaceId: 'ws-1',
    name: agentId,
    status: 'active',
    messages: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...fields,
  } as AgentSession;
  appStore.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
}

function attnCounter(): HTMLElement {
  return screen.getByTestId('hud-footer-stat-attn');
}
function failCounter(): HTMLElement {
  return screen.getByTestId('hud-footer-stat-fail');
}

beforeEach(() => {
  appStore.init();
});
afterEach(() => {
  cleanup();
  appStore.dispose();
});

describe('HudFooter zones', () => {
  it('renders the system, stats, and versions zones', () => {
    render(HudFooter);
    expect(screen.getByTestId('hud-footer-system')).toBeTruthy();
    expect(screen.getByTestId('hud-footer-stats')).toBeTruthy();
    expect(screen.getByTestId('hud-footer-versions')).toBeTruthy();
  });

  it('shows OFFLINE until the daemon-health slice reports a live connection', () => {
    render(HudFooter);
    const system = screen.getByTestId('hud-footer-system');
    expect(system.textContent).toContain('OFFLINE');

    appStore.dispatch(connectionStatusChanged('connected'));
    flushSync();
    expect(system.textContent).toContain('ONLINE');
  });

  it('flips ONLINE→OFFLINE live when daemon health transitions to down', () => {
    render(HudFooter);
    const system = screen.getByTestId('hud-footer-system');

    appStore.dispatch(connectionStatusChanged('connected'));
    flushSync();
    expect(system.textContent).toContain('ONLINE');

    appStore.dispatch(connectionStatusChanged('disconnected'));
    flushSync();
    expect(system.textContent).toContain('OFFLINE');
  });

  it("keeps ONLINE while health is only 'degraded' (poll failed but still connected)", () => {
    render(HudFooter);
    const system = screen.getByTestId('hud-footer-system');

    appStore.dispatch(connectionStatusChanged('connected'));
    appStore.dispatch(heartbeatFailed());
    flushSync();
    expect(system.textContent).toContain('ONLINE');
  });

  it('renders the platform product label + app version and, once known, the daemon version', () => {
    (window as any).electronAPI.platform = 'darwin';
    render(HudFooter);
    const versions = screen.getByTestId('hud-footer-versions');
    expect(versions.textContent).toContain(`Intent for macOS v${__APP_VERSION__}`);
    expect(versions.textContent).not.toContain('cloudlands-fe');
    expect(versions.textContent).not.toContain('intentd');

    appStore.dispatch(
      systemStatusSuccess(systemStatusPayload({ version: 'v0.9.1' }), '2026-08-03T00:00:00.000Z'),
    );
    flushSync();
    expect(versions.textContent).toContain('intentd v0.9.1');
  });

  it.each([
    ['win32', 'Intent for Windows'],
    ['linux', 'Intent for Linux'],
  ])('maps platform %s to the "%s" product label', (platform, label) => {
    (window as any).electronAPI.platform = platform;
    render(HudFooter);
    expect(screen.getByTestId('hud-footer-versions').textContent).toContain(
      `${label} v${__APP_VERSION__}`,
    );
  });
});

describe('HudFooter ATTENTION/FAILED counter blink gating', () => {
  it('renders zero counts static/dimmed without the blink class', () => {
    render(HudFooter);

    expect(attnCounter().textContent).toBe('0');
    expect(failCounter().textContent).toBe('0');
    for (const counter of [attnCounter(), failCounter()]) {
      expect(counter.classList.contains('hud-stat-blink')).toBe(false);
      expect(counter.classList.contains('hud-stat-zero')).toBe(true);
    }
  });

  it('blinks only ATTENTION when a workspace shows the needs_attention banner', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'needs_attention')));
    flushSync();

    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(false);
    expect(failCounter().textContent).toBe('0');
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(failCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('drops the ATTENTION count and stops blinking when the banner clears', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'needs_attention')));
    flushSync();
    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'in_progress')));
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('blinks FAILED (not ATTENTION) on the wire failed rollup', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'failed', ['failed'])));
    flushSync();

    expect(failCounter().textContent).toBe('1');
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(failCounter().classList.contains('hud-stat-zero')).toBe(false);
    expect(attnCounter().textContent).toBe('0');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('blinks ATTENTION on the wire blocked rollup without counting FAILED', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'blocked', ['active'])));
    trackSession('ws-1-a-0', { attentionRequestKind: 'blocker' });
    flushSync();

    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(failCounter().textContent).toBe('0');
    expect(failCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('a failed live agent alone never moves the counters (the BE rollup owns them)', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'in_progress', ['failed'])));
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(failCounter().textContent).toBe('0');
  });

  it('stops blinking when the counts drop back to zero', () => {
    render(HudFooter);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'failed', ['failed'])));
    flushSync();
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(true);

    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'in_progress', ['active'])));
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(failCounter().textContent).toBe('0');
    for (const counter of [attnCounter(), failCounter()]) {
      expect(counter.classList.contains('hud-stat-blink')).toBe(false);
      expect(counter.classList.contains('hud-stat-zero')).toBe(true);
    }
  });
});
