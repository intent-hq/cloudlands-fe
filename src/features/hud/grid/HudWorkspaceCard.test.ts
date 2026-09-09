/**
 * HudWorkspaceCard tests — the elapsed timer on an agent row renders only
 * for non-idle buckets: an idle (grey) row's `lastActivityTs` anchors to the
 * moment the agent STOPPED, so a ticking "elapsed" there is meaningless and
 * the row shows just dot + name (no placeholder). Running rows keep the
 * `HH:MM:SS` timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

import type {
  HudCardAgent,
  HudWorkspaceCard as HudWorkspaceCardModel,
} from '$store/renderer/slices/hud/hud-selectors';

// Controllable stand-in for `microConnectedReadable()` (a minimal Svelte
// readable; hoisted because `vi.mock` factories run before imports).
const micro = vi.hoisted(() => {
  let value = false;
  const subs = new Set<(v: boolean) => void>();
  return {
    set(v: boolean) {
      value = v;
      subs.forEach((run) => run(v));
    },
    subscribe(run: (v: boolean) => void) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    },
  };
});
vi.mock('$features/hardware-console/device/connection-status', () => ({
  microConnectedReadable: () => micro,
}));

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
    isUnread: false,
    isWaiting: false,
    statusMessage: null,
    attentionSnippet: null,
    prNumber: null,
    keySlot: null,
    tasks: { total: 4, completed: 1, inProgress: 1 },
    tokens: 1200,
    agents,
    ...overrides,
  };
}

afterEach(() => cleanup());
beforeEach(() => micro.set(false));

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
        card: makeCard([makeAgent({ id: 'a-run', name: 'Implementor', bucket: 'running' })]),
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

describe('HudWorkspaceCard hardware-key square', () => {
  const squareOf = (container: HTMLElement) =>
    container.querySelector('.hud-ws-card-title-row span[title]');

  it('renders the large square-cornered slot square while a micro is connected and the workspace holds a slot', () => {
    micro.set(true);
    const { container } = render(HudWorkspaceCard, {
      props: { card: makeCard([], { keySlot: 2 }), nowMs: NOW_MS },
    });

    const square = squareOf(container);
    expect(square).toBeTruthy();
    expect(square?.textContent?.trim()).toBe('3');
    // Clearly larger than the 16px sidebar badge, with square corners.
    expect(square?.classList.contains('h-6')).toBe(true);
    expect(square?.classList.contains('w-6')).toBe(true);
    expect(square?.classList.contains('rounded-none')).toBe(true);
  });

  it('renders nothing when the workspace holds no slot', () => {
    micro.set(true);
    const { container } = render(HudWorkspaceCard, {
      props: { card: makeCard([], { keySlot: null }), nowMs: NOW_MS },
    });

    expect(squareOf(container)).toBeNull();
  });

  it('renders nothing while no micro is connected, even with a slot', () => {
    const { container } = render(HudWorkspaceCard, {
      props: { card: makeCard([], { keySlot: 2 }), nowMs: NOW_MS },
    });

    expect(squareOf(container)).toBeNull();
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

describe('HudWorkspaceCard waiting status suffix', () => {
  const stateSpans = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.hud-ws-card-state'));

  it('renders the dimmed / WAITING suffix after IN PROGRESS while waiting', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([], { stateKey: 'in_progress', isWaiting: true }),
        nowMs: NOW_MS,
      },
    });

    const spans = stateSpans(container);
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('IN PROGRESS');
    // Base label keeps its state color; only the suffix carries the dimmed
    // muted-foreground class.
    expect(spans[0].classList.contains('hud-ws-card-state-waiting')).toBe(false);
    expect(spans[1].textContent).toBe('/ WAITING');
    expect(spans[1].classList.contains('hud-ws-card-state-waiting')).toBe(true);
  });

  it('renders the suffix on non-running states too (COMPLETE / WAITING)', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([], { stateKey: 'complete', isWaiting: true }),
        nowMs: NOW_MS,
      },
    });

    const spans = stateSpans(container);
    expect(spans[0].textContent).toBe('COMPLETE');
    expect(spans[1].textContent).toBe('/ WAITING');
  });

  it('renders no suffix when the flag is off', () => {
    const { container } = render(HudWorkspaceCard, {
      props: { card: makeCard([], { stateKey: 'in_progress' }), nowMs: NOW_MS },
    });

    expect(stateSpans(container)).toHaveLength(1);
    expect(container.textContent).not.toContain('/ WAITING');
  });
});

describe('HudWorkspaceCard unread overlay', () => {
  it('renders the corner-fold dog-ear from the flag, over the real state', () => {
    const { container } = render(HudWorkspaceCard, {
      props: {
        card: makeCard([], { stateKey: 'complete', isUnread: true }),
        nowMs: NOW_MS,
      },
    });

    const card = container.querySelector('.hud-ws-card');
    expect(card?.classList.contains('hud-ws-card-unread')).toBe(true);
    const dogear = container.querySelector('.hud-ws-card-dogear');
    expect(dogear).toBeTruthy();
    expect(dogear?.getAttribute('aria-hidden')).toBe('true');
    // The real state banner still renders — unread overlays, never masks.
    expect(container.textContent).toContain('COMPLETE');
  });

  it('omits the dog-ear when the flag is off', () => {
    const { container } = render(HudWorkspaceCard, {
      props: { card: makeCard([], { stateKey: 'complete' }), nowMs: NOW_MS },
    });

    expect(container.querySelector('.hud-ws-card-unread')).toBeNull();
    expect(container.querySelector('.hud-ws-card-dogear')).toBeNull();
  });
});
