/**
 * HudLeftColumn WORKSPACES-BY-STATE blink gating — each row blinks
 * (hud-state-bar-blink) only when its OWN displayed count is non-zero,
 * matching the footer's hud-stat-blink gating: ATTENTION blinks yellow when
 * the ATTENTION bucket > 0, FAILED blinks red when the FAILED bucket > 0.
 * No blink at zero, and a failed fleet never pulses ATTENTION.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { hudActivated } from '$store/renderer/slices/hud/hud-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import type { AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudLeftColumn from './HudLeftColumn.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

beforeAll(() => appStore.init());
afterAll(() => appStore.dispose());

beforeEach(() => {
  appStore.dispatch(resetWorkspaceState());
  for (const [workspaceId, agentIds] of Object.entries(
    appStore.state.agentSessions.agentIdsByWorkspace,
  )) {
    appStore.dispatch(workspaceDeleted(workspaceId, agentIds));
  }
  appStore.dispatch(hudActivated());
});

afterEach(cleanup);

interface SummaryAgent {
  id: string;
  status: string;
  parentAgentId?: string;
}

function workspaceWithAgents(
  id: string,
  agents: SummaryAgent[],
  displayStatus = 'in_progress',
): Workspace {
  const entries = agents.map((agent) => ({ name: agent.id, ...agent }));
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    displayStatus,
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

function attnRow(): HTMLElement {
  return screen.getByTestId('hud-workspace-bar-attention');
}

function failedRow(): HTMLElement {
  return screen.getByTestId('hud-workspace-bar-failed');
}

function blinks(row: HTMLElement): boolean {
  return row.classList.contains('hud-state-bar-blink');
}

describe('HudLeftColumn WORKSPACES-BY-STATE blink gating', () => {
  it('blinks neither row at zero counts (no attention, no failures)', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }])),
    );
    flushSync();

    expect(blinks(attnRow())).toBe(false);
    expect(blinks(failedRow())).toBe(false);
  });

  it('blinks only ATTENTION for an attention-only fleet (FAILED stays static)', async () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(
        workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }], 'needs_attention'),
      ),
    );
    trackSession('a-0', { attentionRequestKind: 'discussion' });
    await waitFor(() => {
      flushSync();
      expect(blinks(attnRow())).toBe(true);
    });
    expect(blinks(failedRow())).toBe(false);
  });

  it('blinks only FAILED for a failed-only fleet (ATTENTION stays static)', async () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'error' }], 'failed')),
    );
    await waitFor(() => {
      flushSync();
      expect(blinks(failedRow())).toBe(true);
    });
    expect(blinks(attnRow())).toBe(false);
  });

  it('does not blink ATTENTION for delegated/background agents (same gating as the cards)', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(
        workspaceWithAgents('ws-1', [
          { id: 'a-0', status: 'active' },
          { id: 'a-1', status: 'active', parentAgentId: 'a-0' },
        ]),
      ),
    );
    trackSession('a-1', { attentionRequestKind: 'blocker' });
    flushSync();

    expect(blinks(attnRow())).toBe(false);
  });
});

describe('HudLeftColumn WORKSPACES-BY-STATE waiting row', () => {
  function waitingRow(): HTMLElement {
    return screen.getByTestId('hud-workspace-bar-waiting');
  }

  it('renders the orthogonal WAITING row and counts flagged workspaces (no blink)', async () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity({
        ...workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }]),
        waiting: true,
      }),
    );
    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-2', [{ id: 'b-0', status: 'active' }])),
    );
    await waitFor(() => {
      flushSync();
      expect(waitingRow().textContent).toContain('1');
    });

    const row = waitingRow();
    expect(row.textContent).toContain('WAITING');
    // Waiting is informational, never a call to action — no blink at any count.
    expect(blinks(row)).toBe(false);
  });

  it('shows zero when no workspace carries the flag', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }])),
    );
    flushSync();

    expect(waitingRow().textContent).toContain('0');
  });
});

describe('HudLeftColumn AGENTS-BY-STATE rows', () => {
  it('renders only the RUNNING / FAILED / IDLE bars (no NEEDS ATTENTION or DONE)', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(
        workspaceWithAgents('ws-1', [
          { id: 'a-0', status: 'active' },
          { id: 'a-1', status: 'completed' },
          { id: 'a-2', status: 'error' },
        ]),
      ),
    );
    flushSync();

    const agentPanel = screen.getByText('AGENTS BY STATE').closest('.hud-panel') as HTMLElement;
    const labels = Array.from(agentPanel.querySelectorAll('.hud-state-bar-label')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toEqual(['RUNNING', 'FAILED', 'IDLE']);
    expect(labels).not.toContain('NEEDS ATTENTION');
    expect(labels).not.toContain('DONE');
    expect(screen.queryByTestId('hud-agent-bar-needs-attention')).toBeNull();
  });
});
