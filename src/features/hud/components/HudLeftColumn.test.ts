/**
 * HudLeftColumn WORKSPACES-BY-STATE attention-row blink gating — the row
 * blinks yellow (hud-state-bar-blink) only when a workspace needs input,
 * gated on the SAME card-derived count as the header ATTN counter
 * (selectHudAttnCount: top-level, non-background). No blink at zero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { hudActivated } from '$store/renderer/slices/hud/hud-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudLeftColumn from './HudLeftColumn.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

interface SummaryAgent {
  id: string;
  status: string;
  parentAgentId?: string;
}

function workspaceWithAgents(id: string, agents: SummaryAgent[]): Workspace {
  const entries = agents.map((agent) => ({ name: agent.id, ...agent }));
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    displayStatus: 'in_progress',
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

describe('HudLeftColumn WORKSPACES-BY-STATE attention blink gating', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('does not blink the attention row at zero (no workspace needs input)', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }])),
    );
    flushSync();

    expect(attnRow().classList.contains('hud-state-bar-blink')).toBe(false);
  });

  it('blinks the attention row when a top-level agent needs input', () => {
    render(HudLeftColumn, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity(workspaceWithAgents('ws-1', [{ id: 'a-0', status: 'active' }])),
    );
    trackSession('a-0', { attentionRequestKind: 'discussion' });
    flushSync();

    expect(attnRow().classList.contains('hud-state-bar-blink')).toBe(true);
  });

  it('does not blink for delegated/background agents (same gating as the header)', () => {
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

    expect(attnRow().classList.contains('hud-state-bar-blink')).toBe(false);
  });
});
