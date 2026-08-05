/**
 * HudWorkspaceCard tests — the elapsed timer on an agent row renders only
 * for non-idle buckets: an idle (grey) row's `lastActivityTs` anchors to the
 * moment the agent STOPPED, so a ticking "elapsed" there is meaningless and
 * the row shows just dot + name (no placeholder). Running rows keep the
 * `HH:MM:SS` timer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

import type {
  HudCardAgent,
  HudWorkspaceCard as HudWorkspaceCardModel,
} from '$store/renderer/slices/hud/hud-selectors';

import HudWorkspaceCard from './HudWorkspaceCard.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

function makeAgent(overrides: Partial<HudCardAgent>): HudCardAgent {
  return {
    id: 'a-1',
    name: 'Coordinator',
    bucket: 'idle',
    lastActivityTs: '2026-07-30T11:58:35Z',
    line: null,
    parentAgentId: null,
    depth: 0,
    treePrefix: '',
    topLevel: true,
    isBackground: false,
    attentionKind: null,
    hasQuestion: false,
    isWaitingForAgents: false,
    waitingForAgentIds: [],
    ...overrides,
  };
}

function makeCard(
  agents: HudCardAgent[],
  overrides: Partial<HudWorkspaceCardModel> = {},
): HudWorkspaceCardModel {
  return {
    workspaceId: 'ws-1',
    title: 'Sidecar auto-update',
    repoRef: 'intent-hq/monorepo',
    stateKey: 'in_progress',
    attention: null,
    statusMessage: null,
    attentionSnippet: null,
    prNumber: null,
    tasks: { total: 4, completed: 1, inProgress: 1 },
    tokens: 1200,
    agents,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('HudWorkspaceCard agent-row elapsed timer', () => {
  it('renders no timer text on an idle (grey) agent row', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([makeAgent({ bucket: 'idle', isWaitingForAgents: true })]),
        nowMs: NOW_MS,
      },
    });

    expect(screen.getByText('Coordinator')).toBeTruthy();
    expect(container.querySelector('.hud-ws-card-agent-elapsed')).toBeNull();
    // No placeholder either — neither a ticking value nor the dash fallback.
    expect(container.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(container.textContent).not.toContain('--:--:--');
  });

  it('still shows the HH:MM:SS timer on a running agent row', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([
          makeAgent({ id: 'a-run', name: 'Implementor', bucket: 'running' }),
        ]),
        nowMs: NOW_MS,
      },
    });

    const elapsed = container.querySelector('.hud-ws-card-agent-elapsed');
    expect(elapsed).toBeTruthy();
    expect(elapsed?.textContent).toBe('00:01:25');
  });

  it('keeps the timer on done/needs-attention rows and drops it only for idle rows in a mixed list', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([
          makeAgent({ id: 'a-idle', name: 'Waiting Coordinator', bucket: 'idle' }),
          makeAgent({
            id: 'a-attn',
            name: 'Verifier',
            bucket: 'needs-attention',
            depth: 1,
            parentAgentId: 'a-idle',
            treePrefix: '└─',
          }),
        ]),
        nowMs: NOW_MS,
      },
    });

    const rows = container.querySelectorAll('.hud-ws-card-agent-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.hud-ws-card-agent-elapsed')).toBeNull();
    expect(rows[1].querySelector('.hud-ws-card-agent-elapsed')?.textContent).toBe('00:01:25');
  });
});

describe('HudWorkspaceCard failed attention strip', () => {
  it("renders the failing agent's error, not the workspace status message", () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([makeAgent({ bucket: 'failed' })], {
          stateKey: 'failed',
          statusMessage: 'Wiring the release-channel fetch',
          attentionSnippet: {
            kind: 'failed',
            text: 'Provider stream disconnected (upstream 529)',
          },
        }),
        nowMs: NOW_MS,
      },
    });

    const strip = container.querySelector('.hud-ws-card-question');
    expect(strip?.textContent?.trim()).toBe('ERR: Provider stream disconnected (upstream 529)');
    expect(container.textContent).not.toContain('Wiring the release-channel fetch');
  });

  it('renders the generic failed line when no stopReason is known', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([makeAgent({ bucket: 'failed' })], {
          stateKey: 'failed',
          statusMessage: 'Wiring the release-channel fetch',
          attentionSnippet: { kind: 'failed', text: '' },
        }),
        nowMs: NOW_MS,
      },
    });

    const strip = container.querySelector('.hud-ws-card-question');
    expect(strip?.textContent?.trim()).toBe('ERR: agent failed');
    expect(container.textContent).not.toContain('Wiring the release-channel fetch');
  });
});
