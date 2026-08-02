/**
 * HudHeader counter tests — the ATTN and FAILED counters blink (hud-stat-blink)
 * only when their count is > 0; zero counts render static/dimmed
 * (hud-stat-zero) like the other counters. ATTN uses the card-gated
 * attention count (selectHudAttnCount): only top-level non-background
 * agents with a pending attention request (plus failed agents, ungated)
 * count — a delegated/background agent's request never blinks the header.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudHeader from './HudHeader.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

/** Summary agent entry: status plus optional parentage (§5.1 v2.9). */
interface SummaryAgent {
  status: string;
  parentAgentId?: string;
}

/** Workspace with an agentSummary carrying the given agents (§5.1). */
function workspaceWithAgents(id: string, agents: Array<string | SummaryAgent>): Workspace {
  const entries = agents.map((agent, i) => {
    const info = typeof agent === 'string' ? { status: agent } : agent;
    return { id: `a-${i}`, name: `Agent ${i}`, ...info };
  });
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
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
  return screen.getByTestId('hud-header-stat-attn');
}
function failCounter(): HTMLElement {
  return screen.getByTestId('hud-header-stat-fail');
}

describe('HudHeader ATTN/FAILED counter blink gating', () => {
  beforeEach(() => {
    appStore.init();
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('renders zero counts static/dimmed without the blink class', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    expect(attnCounter().textContent).toBe('0');
    expect(failCounter().textContent).toBe('0');
    for (const counter of [attnCounter(), failCounter()]) {
      expect(counter.classList.contains('hud-stat-blink')).toBe(false);
      expect(counter.classList.contains('hud-stat-zero')).toBe(true);
    }
  });

  it('blinks only the non-zero counter (top-level discussion raises ATTN, not FAILED)', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['active'])));
    trackSession('a-0', { attentionRequestKind: 'discussion' });
    flushSync();

    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(false);
    expect(failCounter().textContent).toBe('0');
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(failCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('ignores attention requests from delegated/background agents (regression: phantom ATTN blink)', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    // Root + delegated child + background helper, all active; the child and
    // the background agent raise attention requests. No card would show
    // NEEDS INPUT/BLOCKED, so ATTN must stay 0 and not blink.
    appStore.dispatch(
      setWorkspaceEntity(
        workspaceWithAgents('ws-1', [
          'active',
          { status: 'active', parentAgentId: 'a-0' },
          'active',
        ]),
      ),
    );
    trackSession('a-1', { attentionRequestKind: 'blocker' });
    trackSession('a-2', { isBackground: true, attentionRequestKind: 'discussion' });
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('drops the count and stops blinking when the attention request clears', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['active'])));
    trackSession('a-0', { attentionRequestKind: 'discussion' });
    flushSync();
    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);

    // User-origin delivery cleared the pending request (§5.5).
    appStore.dispatch(updateSession('a-0', { attentionRequestKind: undefined }));
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(true);
  });

  it('blinks both counters when a failed agent raises ATTN and FAILED', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['failed'])));
    flushSync();

    expect(attnCounter().textContent).toBe('1');
    expect(failCounter().textContent).toBe('1');
    for (const counter of [attnCounter(), failCounter()]) {
      expect(counter.classList.contains('hud-stat-blink')).toBe(true);
      expect(counter.classList.contains('hud-stat-zero')).toBe(false);
    }
  });

  it('stops blinking when the counts drop back to zero', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['failed'])));
    flushSync();
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(true);

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['active', 'completed'])));
    flushSync();

    expect(attnCounter().textContent).toBe('0');
    expect(failCounter().textContent).toBe('0');
    for (const counter of [attnCounter(), failCounter()]) {
      expect(counter.classList.contains('hud-stat-blink')).toBe(false);
      expect(counter.classList.contains('hud-stat-zero')).toBe(true);
    }
  });
});
