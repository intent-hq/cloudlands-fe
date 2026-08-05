/**
 * AttentionPanel row structure tests — mock parity (Fleet HUD v3 lines
 * 131-140): kind chip names the raising signal (QUESTION / DISCUSSION
 * REQUIRED / BLOCKED / FAILED), the detail line carries the question or
 * reason with the card strip's Q:/Blocked: prefixes, row accents resolve
 * through HUD_STATE_COLORS, and the elapsed timer only renders when the
 * raise time is known.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { hudActivated, hudQuestionCaptured } from '$store/renderer/slices/hud/hud-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { HUD_STATE_COLORS } from '../grid/hud-card-meta';
import type { AgentSession, Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import AttentionPanel from './AttentionPanel.svelte';

function makeWorkspace(
  id: string,
  agents: Array<{ id: string; name: string; status: string; lastActivity?: string }>,
  displayStatus = 'in_progress',
): Workspace {
  return {
    id: id as WorkspaceId,
    title: `Workspace ${id}`,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    agentSummary: {
      count: agents.length,
      agentIds: agents.map((a) => a.id),
      agents,
    } as Workspace['agentSummary'],
  } as Workspace;
}

function rows(): HTMLElement[] {
  return Array.from(
    screen.getByTestId('hud-attention-panel').querySelectorAll('.hud-attention-row'),
  );
}

function chipTexts(row: HTMLElement): string[] {
  return Array.from(row.querySelectorAll('.hud-attention-row-top > span')).map(
    (el) => el.textContent ?? '',
  );
}

describe('AttentionPanel row structure (mock parity)', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('a captured question renders the QUESTION chip and the Q:-prefixed detail line', () => {
    render(AttentionPanel);
    appStore.dispatch(
      setWorkspaceEntity(
        makeWorkspace('ws-1', [
          { id: 'a1', name: 'Coordinator', status: 'idle', lastActivity: '2026-07-30T11:00:00Z' },
        ]),
      ),
    );
    appStore.dispatch(
      hudQuestionCaptured({
        workspaceId: 'ws-1',
        agentId: 'a1',
        header: 'Auth method',
        question: 'Which auth flow should the endpoint use?',
        ts: '2026-07-30T12:00:00Z',
      }),
    );
    flushSync();

    const [row] = rows();
    expect(chipTexts(row)[1]).toBe('QUESTION');
    expect(row.querySelector('.hud-attention-msg')?.textContent).toBe(
      'Q: Which auth flow should the endpoint use?',
    );
    expect(row.style.borderLeftColor).toBe(HUD_STATE_COLORS.attention);
    // Known raise time → the elapsed timer renders.
    expect(chipTexts(row).at(-1)).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('discussion/blocker attention requests render their signal chips and reasons', () => {
    render(AttentionPanel);
    appStore.dispatch(
      setWorkspaceEntity(
        makeWorkspace('ws-1', [
          { id: 'a1', name: 'Coordinator', status: 'active' },
          { id: 'a2', name: 'Implementor', status: 'active' },
        ]),
      ),
    );
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: 'a1',
          workspaceId: 'ws-1',
          status: 'active',
          attentionRequestKind: 'discussion',
          attentionRequestReason: 'Need a call on the rollout order',
          messages: [],
        } as unknown as AgentSession,
        {
          id: 'a2',
          workspaceId: 'ws-1',
          status: 'active',
          attentionRequestKind: 'blocker',
          attentionRequestReason: 'Sandbox network is down',
          messages: [],
        } as unknown as AgentSession,
      ]),
    );
    flushSync();

    const kinds = rows().map((row) => chipTexts(row)[1]);
    expect(kinds).toContain('DISCUSSION REQUIRED');
    expect(kinds).toContain('BLOCKED');
    const texts = rows().map((row) => row.querySelector('.hud-attention-msg')?.textContent);
    expect(texts).toContain('Need a call on the rollout order');
    expect(texts).toContain('Blocker: Sandbox network is down');
  });

  it('a failed agent row keeps the FAILED chip and the red accent', () => {
    render(AttentionPanel);
    appStore.dispatch(
      setWorkspaceEntity(
        makeWorkspace('ws-1', [
          { id: 'a1', name: 'Developer', status: 'error', lastActivity: '2026-07-30T11:00:00Z' },
        ]),
      ),
    );
    flushSync();

    const [row] = rows();
    expect(chipTexts(row)[1]).toBe('FAILED');
    expect(row.style.borderLeftColor).toBe(HUD_STATE_COLORS.failed);
    expect(row.querySelector('.hud-attention-msg')).toBeNull();
  });

  it('a generic needs_attention rollup row shows the fallback chip and no frozen timer', () => {
    render(AttentionPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', [], 'needs_attention')));
    flushSync();

    const [row] = rows();
    expect(chipTexts(row)[1]).toBe('ATTENTION');
    // Unknown raise time (sinceTs null) → no elapsed timer at all, instead
    // of a frozen 00:00:00 misreading as "just raised".
    expect(chipTexts(row).join(' ')).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
