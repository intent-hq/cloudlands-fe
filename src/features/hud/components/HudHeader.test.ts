/**
 * HudHeader counter tests — the ATTN and FAILED counters blink (hud-stat-blink)
 * only when their count is > 0; zero counts render static/dimmed
 * (hud-stat-zero) like the other counters.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudHeader from './HudHeader.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

/** Workspace with an agentSummary carrying the given agent statuses (§5.1). */
function workspaceWithAgents(id: string, statuses: string[]): Workspace {
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
      count: statuses.length,
      agentIds: statuses.map((_, i) => `a-${i}`),
      agents: statuses.map((status, i) => ({ id: `a-${i}`, name: `Agent ${i}`, status })),
    } as Workspace['agentSummary'],
  } as Workspace;
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

  it('blinks only the non-zero counter (waiting raises ATTN, not FAILED)', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['waiting'])));
    flushSync();

    expect(attnCounter().textContent).toBe('1');
    expect(attnCounter().classList.contains('hud-stat-blink')).toBe(true);
    expect(attnCounter().classList.contains('hud-stat-zero')).toBe(false);
    expect(failCounter().textContent).toBe('0');
    expect(failCounter().classList.contains('hud-stat-blink')).toBe(false);
    expect(failCounter().classList.contains('hud-stat-zero')).toBe(true);
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

    appStore.dispatch(setWorkspaceEntity(workspaceWithAgents('ws-1', ['failed', 'waiting'])));
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
