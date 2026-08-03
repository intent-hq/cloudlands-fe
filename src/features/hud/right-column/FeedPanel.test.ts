/**
 * FeedPanel two-line row tests — line 1 carries the kind chip plus the source
 * name (resolved agent name for agent events, else the workspace title);
 * line 2, indented under the chip, carries the wire detail text color-coded
 * by the row's color class (failures red `err`, attention yellow `warn`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { hudActivated, hudFeedEntryReceived } from '$store/renderer/slices/hud/hud-slice';
import type { HudFeedEntry } from '$store/renderer/slices/hud/hud-slice';
import { HUD_FEED_COLORS } from './hud-right-column-labels';
import { cardStateColor } from '../grid/hud-card-meta';
import type { HudCardStateKey } from '$store/renderer/slices/hud/hud-types';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import FeedPanel from './FeedPanel.svelte';

function makeWorkspace(id: string, title: string, agents: Array<{ id: string; name: string }> = []): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    agentSummary: {
      count: agents.length,
      agentIds: agents.map((a) => a.id),
      agents: agents.map((a) => ({ ...a, status: 'active' })),
    } as Workspace['agentSummary'],
  } as Workspace;
}

function feedEntry(overrides: Partial<HudFeedEntry> = {}): HudFeedEntry {
  return {
    id: 'evt-1',
    ts: '2026-07-30T12:00:00Z',
    colorClass: 'info',
    source: 'ws-1',
    kind: 'agent:started',
    text: '',
    ...overrides,
  };
}

function row(): HTMLElement {
  return screen.getByTestId('hud-feed-panel').querySelector('.hud-feed-row') as HTMLElement;
}

describe('FeedPanel two-line rows', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('shows the resolved agent name on line 1 and the workspace-prefixed detail on line 2', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(feedEntry({ agentId: 'a1', kind: 'agent:completed', text: 'Done' })),
    );
    flushSync();

    expect(row().querySelector('.hud-feed-name')?.textContent).toBe('Implementor');
    expect(row().querySelector('.hud-feed-text')?.textContent).toBe('Sidecar update — Done');
  });

  it('falls back to the workspace title on line 1 when no agent resolves', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update')));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ kind: 'workspace:displayStatus-changed', displayStatus: 'in_progress' }),
      ),
    );
    flushSync();

    expect(row().querySelector('.hud-feed-name')?.textContent).toBe('Sidecar update');
    expect(row().querySelector('.hud-feed-text')?.textContent).toBe('IN PROGRESS');
  });

  it('omits line 2 when there is no detail beyond the name', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update')));
    // Workspace-sourced row (name line already shows the workspace title) with
    // no wire text → nothing left for line 2.
    appStore.dispatch(
      hudFeedEntryReceived(feedEntry({ kind: 'workspace:displayStatus-changed', text: '' })),
    );
    flushSync();

    expect(row().querySelector('.hud-feed-name')?.textContent).toBe('Sidecar update');
    expect(row().querySelector('.hud-feed-line2')).toBeNull();
  });

  it('color-codes the detail line red for failures and yellow for attention', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ id: 'evt-warn', agentId: 'a1', colorClass: 'warn', kind: 'workspace:attention-changed', text: 'needs input' }),
      ),
    );
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ id: 'evt-err', agentId: 'a1', colorClass: 'err', kind: 'agent:failed', text: 'crashed' }),
      ),
    );
    flushSync();

    const rows = screen.getByTestId('hud-feed-panel').querySelectorAll('.hud-feed-row');
    // Newest first: err row on top, warn row second.
    const errText = rows[0].querySelector('.hud-feed-text') as HTMLElement;
    const warnText = rows[1].querySelector('.hud-feed-text') as HTMLElement;
    expect(errText.style.color).toBe(HUD_FEED_COLORS.err);
    expect(warnText.style.color).toBe(HUD_FEED_COLORS.warn);
  });

  it('leaves the detail line uncolored for non-failure/attention rows', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(feedEntry({ agentId: 'a1', colorClass: 'info', kind: 'agent:completed', text: 'Done' })),
    );
    flushSync();

    const text = row().querySelector('.hud-feed-text') as HTMLElement;
    expect(text.style.color).toBe('');
  });
});

describe('FeedPanel agent-status chip wording', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  function chipFor(agentStatus: string): string {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ id: `evt-${agentStatus}`, agentId: 'a1', kind: 'agent:status-changed', agentStatus }),
      ),
    );
    flushSync();
    const chip = row().querySelector('.hud-feed-tag')?.textContent ?? '';
    cleanup();
    return chip;
  }

  it('names the specific transition instead of a generic AGENT STATUS chip', () => {
    expect(chipFor('active')).toBe('AGENT RUNNING');
    expect(chipFor('waiting')).toBe('AGENT WAITING');
    expect(chipFor('idle')).toBe('AGENT IDLE');
    expect(chipFor('completed')).toBe('AGENT DONE');
    expect(chipFor('error')).toBe('AGENT FAILED');
  });

  it('renders the synthetic first-start kind as an AGENT DELEGATED chip', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ agentId: 'a1', kind: 'agent:delegated', agentStatus: 'active' }),
      ),
    );
    flushSync();

    expect(row().querySelector('.hud-feed-tag')?.textContent).toBe('AGENT DELEGATED');
    expect(row().querySelector('.hud-feed-name')?.textContent).toBe('Implementor');
  });

  it('never leaks the raw wire status into the chip or the detail line', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update', [{ id: 'a1', name: 'Implementor' }])));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ agentId: 'a1', kind: 'agent:status-changed', agentStatus: 'some_new_status' }),
      ),
    );
    flushSync();

    expect(row().querySelector('.hud-feed-tag')?.textContent).toBe('AGENT IDLE');
    // Detail carries the workspace title only — no raw status word appended.
    expect(row().querySelector('.hud-feed-text')?.textContent).toBe('Sidecar update');
  });
});

describe('FeedPanel WORKSPACE STATUS rows', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(hudActivated());
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  function statusRow(displayStatus: string): HTMLElement {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update')));
    appStore.dispatch(
      hudFeedEntryReceived(
        feedEntry({ id: `evt-${displayStatus}`, kind: 'workspace:displayStatus-changed', displayStatus }),
      ),
    );
    flushSync();
    return row();
  }

  it('renders the WORKSPACE STATUS chip label (not WS STATUS)', () => {
    expect(statusRow('in_progress').querySelector('.hud-feed-tag')?.textContent).toBe(
      'WORKSPACE STATUS',
    );
  });

  it('renders the localized card-state label per status — never the raw wire value', () => {
    // Same labels the card banner renders (cardStateLabel); `needs_attention`
    // folds to NEEDS ATTENTION exactly like cardStateKey. No snake_case leaks.
    const expected: Array<[string, string]> = [
      ['in_progress', 'IN PROGRESS'],
      ['needs_attention', 'NEEDS ATTENTION'],
      ['idle', 'IDLE'],
      ['not_started', 'NOT STARTED'],
      ['complete', 'COMPLETE'],
      ['pr_ready', 'PR MERGEABLE'],
      ['pr_open', 'PR OPEN'],
      ['pr_merged', 'PR MERGED'],
    ];
    for (const [wire, label] of expected) {
      const text = statusRow(wire).querySelector('.hud-feed-text')?.textContent ?? '';
      expect(text, wire).toBe(label);
      expect(text, wire).not.toContain('_');
      cleanup();
    }
  });

  it('an unknown wire status renders no detail rather than leaking the raw value', () => {
    expect(statusRow('some_future_status').querySelector('.hud-feed-line2')).toBeNull();
  });

  it('colors the row dot with the reported status card color token', () => {
    const expected: Array<[string, HudCardStateKey]> = [
      ['in_progress', 'in_progress'],
      ['needs_attention', 'wait'],
      ['idle', 'idle'],
      ['pr_open', 'pr_open'],
    ];
    for (const [wire, stateKey] of expected) {
      const dot = statusRow(wire).querySelector('.hud-feed-dot') as HTMLElement;
      expect(dot.style.background, wire).toBe(cardStateColor(stateKey));
      cleanup();
    }
  });

  it('other kinds keep their feed color-class dot', () => {
    render(FeedPanel);
    appStore.dispatch(setWorkspaceEntity(makeWorkspace('ws-1', 'Sidecar update')));
    appStore.dispatch(
      hudFeedEntryReceived(feedEntry({ kind: 'git:commit', colorClass: 'info', text: 'msg' })),
    );
    flushSync();
    const dot = row().querySelector('.hud-feed-dot') as HTMLElement;
    expect(dot.style.background).toBe(HUD_FEED_COLORS.info);
  });
});
