/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import WorkspaceAgentsList from '../WorkspaceAgentsList.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

const workspaceId = 'ws-agents-row-test';
const mountedIds: string[] = [];

function makeAgent(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  const agent = {
    id: AgentId(id),
    backendSessionId: `backend-${id}`,
    workspaceId: WorkspaceId(workspaceId),
    name: id,
    status: AgentStatus.Idle,
    messages: [],
    lastAgentResponse: `preview for ${id}`,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:01:00.000Z',
    ...overrides,
  } as AgentSession;
  mountedIds.push(id);
  return agent;
}

function agentTab(id: string): PanelTab {
  return {
    id: `tab-${id}`,
    type: 'agent',
    title: id,
    closable: true,
    workspaceId,
    agentId: id,
  };
}

describe('WorkspaceAgentsList single-line rows', () => {
  beforeEach(() => {
    appStore.init();
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
  });

  afterEach(() => {
    cleanup();
    for (const id of mountedIds.splice(0)) appStore.dispatch(removeSession(id));
    vi.unstubAllGlobals();
  });

  it('mounts coordinator, delegated, long-name, and background agents without preview rows', async () => {
    const coordinator = makeAgent('coordinator', {
      name: 'Coordinator',
      metadata: { specialist: 'spec-writer' } as AgentSession['metadata'],
    });
    const delegated = makeAgent('delegated-needle', {
      name: 'Delegated needle',
      status: AgentStatus.Active,
      metadata: { createdByAgentId: coordinator.id } as AgentSession['metadata'],
    });
    const longName = makeAgent('long-name', {
      name: 'An exceptionally long foreground agent name that must never reach the badges',
    });
    const background = makeAgent('background', {
      name: 'Background worker',
      isBackground: true,
      status: AgentStatus.Active,
    });
    const agents = [coordinator, delegated, longName, background];
    appStore.dispatch(bulkUpsertSessions(agents));
    const tabs = [agentTab(longName.id), agentTab(background.id)];
    const onSelect = vi.fn();
    const props = {
      agents,
      workspaceId,
      selectedAgentId: longName.id,
      runningAgentIds: [delegated.id, background.id],
      openPanelTabs: tabs,
      activePanelTab: tabs[0],
      searchQuery: '',
      onSelect,
    };
    const view = render(WorkspaceAgentsList, { props });

    await waitFor(() =>
      expect(view.container.querySelectorAll('[data-agent-panel-row]')).toHaveLength(3),
    );
    expect(view.container.querySelector('[data-testid="agent-card-preview"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="agent-card-preview-row"]')).toBeNull();
    expect(view.container.textContent).not.toContain('preview for');

    for (const row of view.container.querySelectorAll<HTMLElement>('[data-agent-panel-row]')) {
      expect(row.className).toContain('h-10');
      expect(row.querySelector('[data-avatar-variant="emphasized"]')).toBeTruthy();
      expect(row.querySelector('[data-agent-row-trailing]')).toBeTruthy();
    }
    const longRow = view.container.querySelector<HTMLElement>(
      `[data-agent-panel-row="${longName.id}"]`,
    );
    expect(longRow?.className).toContain('bg-transparent');
    expect(longRow?.className).not.toContain('hover:bg-muted');
    expect(longRow?.getAttribute('aria-current')).toBe('true');
    expect(longRow?.querySelector('[data-agent-row-name]')?.className).toContain('flex-1');
    expect(longRow?.querySelector('[data-panel-open-state]')).toBeNull();
    expect(longRow?.querySelector('[data-agent-row-time]')).toBeTruthy();
    const backgroundRow = view.container.querySelector<HTMLElement>(
      `[data-agent-panel-row="${background.id}"]`,
    );
    await fireEvent.click(backgroundRow!);
    expect(onSelect).toHaveBeenLastCalledWith({
      agentId: background.id,
      event: expect.any(MouseEvent),
    });

    await fireEvent.keyDown(longRow!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({
      agentId: longName.id,
      event: expect.any(KeyboardEvent),
    });
    longRow?.focus();
    expect(document.activeElement).toBe(longRow);

    const delegationToggle = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${coordinator.id}"]`,
    );
    expect(delegationToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector(`[data-agent-panel-row="${delegated.id}"]`)).toBeNull();
    expect(delegationToggle?.querySelector('[data-agent-avatar-with-state]')).toBeNull();
    await fireEvent.click(delegationToggle!);
    expect(delegationToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelector(`[data-agent-panel-row="${delegated.id}"]`)).toBeTruthy();
    await fireEvent.click(delegationToggle!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${delegated.id}"]`)).toBeNull(),
    );

    await view.rerender({ ...props, searchQuery: 'delegated needle' });
    expect(view.container.querySelector(`[data-agent-panel-row="${coordinator.id}"]`)).toBeTruthy();
    expect(view.container.querySelector(`[data-agent-panel-row="${delegated.id}"]`)).toBeTruthy();
    expect(view.container.querySelector(`[data-agent-panel-row="${longName.id}"]`)).toBeNull();

    await view.rerender(props);
    const backgroundToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-background-toggle]',
    );
    expect(backgroundToggle?.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(backgroundToggle!);
    expect(backgroundToggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows retired agents in a collapsed bin with a restore action', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const retired = makeAgent('retired-agent', {
      name: 'Retired agent',
      retiredAt: '2026-08-20T00:00:00.000Z',
    });
    const agents = [active, retired];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onRestoreRetired = vi.fn();
    const onSelect = vi.fn();
    const view = render(WorkspaceAgentsList, {
      props: { agents, workspaceId, onRestoreRetired, onSelect },
    });

    // Retired agent is excluded from the main list and hidden behind the toggle.
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${active.id}"]`)).toBeTruthy(),
    );
    expect(view.container.querySelector(`[data-agent-panel-row="${retired.id}"]`)).toBeNull();

    const retiredToggle = view.container.querySelector<HTMLElement>('[data-agent-retired-toggle]');
    expect(retiredToggle).toBeTruthy();
    expect(retiredToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(retiredToggle?.textContent).toContain('1 retired agents');

    await fireEvent.click(retiredToggle!);
    expect(retiredToggle?.getAttribute('aria-expanded')).toBe('true');
    const retiredRow = view.container.querySelector<HTMLElement>(
      `[data-agent-panel-row="${retired.id}"]`,
    );
    expect(retiredRow).toBeTruthy();

    // Clicking the row still opens the (read-only) conversation.
    await fireEvent.click(retiredRow!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ agentId: retired.id }));

    // The restore affordance dispatches the un-retire callback without selecting.
    const restoreButton = view.container.querySelector<HTMLElement>(
      '[data-testid="agent-restore-retired"]',
    );
    expect(restoreButton).toBeTruthy();
    onSelect.mockClear();
    await fireEvent.click(restoreButton!);
    expect(onRestoreRetired).toHaveBeenCalledWith({ agentId: retired.id });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the collapsed bin from retiredCount and lazy-loads rows on expand (§5.5 retiredOnly)', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    const view = render(WorkspaceAgentsList, {
      props: { agents, workspaceId, retiredCount: 3, onLoadRetired },
    });

    // Count-first: the collapsed toggle renders from the daemon-served count
    // even though no retired row is hydrated, and nothing loads eagerly.
    const retiredToggle = view.container.querySelector<HTMLElement>('[data-agent-retired-toggle]');
    expect(retiredToggle).toBeTruthy();
    expect(retiredToggle?.textContent).toContain('3 retired agents');
    expect(onLoadRetired).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-agent-retired-loading]')).toBeNull();

    // Expanding triggers the lazy load exactly once and shows skeleton rows.
    await fireEvent.click(retiredToggle!);
    await waitFor(() => expect(onLoadRetired).toHaveBeenCalledTimes(1));
    expect(view.container.querySelector('[data-agent-retired-loading]')).toBeTruthy();

    // Loaded: rows are authoritative for the label; the skeleton goes away.
    const retired = makeAgent('retired-agent', {
      name: 'Retired agent',
      retiredAt: '2026-08-20T00:00:00.000Z',
    });
    appStore.dispatch(bulkUpsertSessions([retired]));
    await view.rerender({
      agents: [active, retired],
      workspaceId,
      retiredCount: 1,
      retiredAgentsLoaded: true,
      onLoadRetired,
    });
    expect(view.container.querySelector('[data-agent-retired-loading]')).toBeNull();
    expect(retiredToggle?.textContent).toContain('1 retired agents');
    expect(view.container.querySelector(`[data-agent-panel-row="${retired.id}"]`)).toBeTruthy();
    expect(onLoadRetired).toHaveBeenCalledTimes(1);
  });

  it('lazy-loads retired rows when a search is active without expanding the bin', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    render(WorkspaceAgentsList, {
      props: { agents, workspaceId, retiredCount: 2, searchQuery: 'needle', onLoadRetired },
    });

    // An active search must cover retired agents, so the load fires eagerly.
    await waitFor(() => expect(onLoadRetired).toHaveBeenCalledTimes(1));
  });

  it('does not hot-retry a failed lazy load; collapse/re-expand retries (transition-triggered)', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    const props = { agents, workspaceId, retiredCount: 2, onLoadRetired };
    const view = render(WorkspaceAgentsList, { props });

    const retiredToggle = view.container.querySelector<HTMLElement>('[data-agent-retired-toggle]');
    await fireEvent.click(retiredToggle!);
    expect(onLoadRetired).toHaveBeenCalledTimes(1);

    // Saga side of a FAILED read: loading flips true → false while
    // retiredAgentsLoaded stays false. The trigger is the expand transition,
    // not tracked loading state, so no immediate re-dispatch may fire.
    await view.rerender({ ...props, loadingRetired: true });
    await view.rerender({ ...props, loadingRetired: false });
    expect(onLoadRetired).toHaveBeenCalledTimes(1);

    // Retry semantics: collapsing and re-expanding fires a fresh load.
    await fireEvent.click(retiredToggle!);
    await fireEvent.click(retiredToggle!);
    expect(onLoadRetired).toHaveBeenCalledTimes(2);
  });

  it('search activation triggers the load once per transition, not per loading-state change', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    const props = { agents, workspaceId, retiredCount: 2, searchQuery: '', onLoadRetired };
    const view = render(WorkspaceAgentsList, { props });
    expect(onLoadRetired).not.toHaveBeenCalled();

    await view.rerender({ ...props, searchQuery: 'needle' });
    await waitFor(() => expect(onLoadRetired).toHaveBeenCalledTimes(1));

    // Failed-load churn while the search stays active must not re-trigger.
    await view.rerender({ ...props, searchQuery: 'needle', loadingRetired: true });
    await view.rerender({ ...props, searchQuery: 'needle', loadingRetired: false });
    expect(onLoadRetired).toHaveBeenCalledTimes(1);

    // Clearing and re-typing the search is a new transition → one retry.
    await view.rerender({ ...props, searchQuery: '' });
    await view.rerender({ ...props, searchQuery: 'needle again' });
    await waitFor(() => expect(onLoadRetired).toHaveBeenCalledTimes(2));
  });

  it('re-fires the load when retiredCount lands after the search was already active (mount-before-hydrate edge)', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    // Mount with a persisted active query while hydration hasn't served the
    // count yet: the search transition consumes itself against the hidden bin.
    const props = { agents, workspaceId, retiredCount: 0, searchQuery: 'needle', onLoadRetired };
    const view = render(WorkspaceAgentsList, { props });
    // Bin hidden at count 0 → the search transition consumed itself, no load.
    expect(view.container.querySelector('[data-agent-retired-toggle]')).toBeNull();
    expect(onLoadRetired).not.toHaveBeenCalled();

    // Hydration lands the count → the bin's false→true edge re-fires the load
    // because the search is still active.
    await view.rerender({ ...props, retiredCount: 2 });
    await waitFor(() => expect(onLoadRetired).toHaveBeenCalledTimes(1));

    // Still edge-triggered: loading-state churn at a stable count is inert.
    await view.rerender({ ...props, retiredCount: 2, loadingRetired: true });
    await view.rerender({ ...props, retiredCount: 2, loadingRetired: false });
    expect(onLoadRetired).toHaveBeenCalledTimes(1);
  });

  it('hides the retired bin entirely at retiredCount 0 with no retired rows', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadRetired = vi.fn();
    const view = render(WorkspaceAgentsList, {
      props: { agents, workspaceId, retiredCount: 0, onLoadRetired },
    });

    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${active.id}"]`)).toBeTruthy(),
    );
    expect(view.container.querySelector('[data-agent-retired-toggle]')).toBeNull();
    expect(onLoadRetired).not.toHaveBeenCalled();
  });

  it('renders collapsed Delegated / Background bins from scopeCounts and lazy-loads each on expand (§5.5 row scope)', async () => {
    const coordinator = makeAgent('coordinator', { name: 'Coordinator' });
    const agents = [coordinator];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadDelegated = vi.fn();
    const onLoadBackground = vi.fn();
    const props = {
      agents,
      workspaceId,
      scopeCounts: { topLevel: 1, delegated: 4, background: 2 },
      onLoadDelegated,
      onLoadBackground,
    };
    const view = render(WorkspaceAgentsList, { props });

    // Count-first: both toggles render from the daemon-served counts with no
    // row hydrated, and nothing loads eagerly.
    const delegatedToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-delegated-toggle]',
    );
    const backgroundToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-background-toggle]',
    );
    expect(delegatedToggle?.textContent).toContain('4 delegated agents');
    expect(delegatedToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(backgroundToggle?.textContent).toContain('2 background agents');
    expect(backgroundToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(onLoadDelegated).not.toHaveBeenCalled();
    expect(onLoadBackground).not.toHaveBeenCalled();

    // Expanding the Delegated bin triggers its lazy load exactly once with skeleton rows.
    await fireEvent.click(delegatedToggle!);
    await waitFor(() => expect(onLoadDelegated).toHaveBeenCalledTimes(1));
    expect(onLoadBackground).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeTruthy();

    // Loaded: delegated rows nest under their parent and are revealed by the
    // expanded bin; the loaded rows are authoritative for the label.
    const child = makeAgent('child', {
      name: 'Delegated child',
      metadata: { createdByAgentId: coordinator.id } as AgentSession['metadata'],
    });
    appStore.dispatch(bulkUpsertSessions([child]));
    await view.rerender({
      ...props,
      agents: [coordinator, child],
      scopeCounts: { topLevel: 1, delegated: 1, background: 2 },
      delegatedAgentsLoaded: true,
    });
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeNull();
    expect(delegatedToggle?.textContent).toContain('1 delegated agents');
    expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeTruthy();
    const groupToggle = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${coordinator.id}"]`,
    );
    expect(groupToggle?.getAttribute('aria-expanded')).toBe('true');

    // The per-parent group still collapses independently while the bin is open.
    await fireEvent.click(groupToggle!);
    expect(groupToggle?.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeNull(),
    );

    // Collapsing the workspace-level bin hides the loaded delegated rows again.
    await fireEvent.click(groupToggle!);
    await fireEvent.click(delegatedToggle!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeNull(),
    );
    expect(
      view.container.querySelector(`[data-agent-delegation-toggle="${coordinator.id}"]`),
    ).toBeNull();
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);

    // Background bin: same expand-to-load contract.
    await fireEvent.click(backgroundToggle!);
    await waitFor(() => expect(onLoadBackground).toHaveBeenCalledTimes(1));
    expect(view.container.querySelector('[data-agent-background-loading]')).toBeTruthy();
    const background = makeAgent('background', { name: 'Background worker', isBackground: true });
    appStore.dispatch(bulkUpsertSessions([background]));
    await view.rerender({
      ...props,
      agents: [coordinator, child, background],
      scopeCounts: { topLevel: 1, delegated: 1, background: 1 },
      delegatedAgentsLoaded: true,
      backgroundAgentsLoaded: true,
    });
    expect(view.container.querySelector('[data-agent-background-loading]')).toBeNull();
    expect(backgroundToggle?.textContent).toContain('1 background agents');
    expect(view.container.querySelector(`[data-agent-panel-row="${background.id}"]`)).toBeTruthy();
    expect(onLoadBackground).toHaveBeenCalledTimes(1);
  });

  it('lazy-loads delegated and background rows when a search is active, once per transition', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const agents = [active];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadDelegated = vi.fn();
    const onLoadBackground = vi.fn();
    const props = {
      agents,
      workspaceId,
      scopeCounts: { topLevel: 1, delegated: 2, background: 1 },
      searchQuery: '',
      onLoadDelegated,
      onLoadBackground,
    };
    const view = render(WorkspaceAgentsList, { props });
    expect(onLoadDelegated).not.toHaveBeenCalled();
    expect(onLoadBackground).not.toHaveBeenCalled();

    await view.rerender({ ...props, searchQuery: 'needle' });
    await waitFor(() => expect(onLoadDelegated).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onLoadBackground).toHaveBeenCalledTimes(1));

    // Failed-load churn while the search stays active must not re-trigger.
    await view.rerender({ ...props, searchQuery: 'needle', loadingDelegated: true });
    await view.rerender({ ...props, searchQuery: 'needle', loadingDelegated: false });
    await view.rerender({ ...props, searchQuery: 'needle', loadingBackground: true });
    await view.rerender({ ...props, searchQuery: 'needle', loadingBackground: false });
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);
    expect(onLoadBackground).toHaveBeenCalledTimes(1);
  });

  it('hides the lazy bins at count 0 and keeps the all-rows behavior without scopeCounts (old daemon)', async () => {
    const parent = makeAgent('parent', { name: 'Parent' });
    const child = makeAgent('child', {
      name: 'Child',
      metadata: { createdByAgentId: parent.id } as AgentSession['metadata'],
    });
    const background = makeAgent('background', { name: 'Background', isBackground: true });
    const agents = [parent, child, background];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadDelegated = vi.fn();
    const onLoadBackground = vi.fn();

    // Old daemon (no scopeCounts): no workspace-level Delegated bin; the
    // per-parent group and the Background bin render from the rows themselves
    // and nothing lazy-loads.
    const legacy = render(WorkspaceAgentsList, {
      props: { agents, workspaceId, onLoadDelegated, onLoadBackground },
    });
    await waitFor(() =>
      expect(legacy.container.querySelector(`[data-agent-panel-row="${parent.id}"]`)).toBeTruthy(),
    );
    expect(legacy.container.querySelector('[data-agent-delegated-toggle]')).toBeNull();
    expect(
      legacy.container.querySelector(`[data-agent-delegation-toggle="${parent.id}"]`),
    ).toBeTruthy();
    const backgroundToggle = legacy.container.querySelector<HTMLElement>(
      '[data-agent-background-toggle]',
    );
    expect(backgroundToggle?.textContent).toContain('1 background agents');
    await fireEvent.click(backgroundToggle!);
    expect(onLoadBackground).not.toHaveBeenCalled();
    expect(onLoadDelegated).not.toHaveBeenCalled();
    cleanup();

    // New daemon with empty bins: both toggles stay hidden.
    const active = makeAgent('active-agent', { name: 'Active agent' });
    appStore.dispatch(bulkUpsertSessions([active]));
    const view = render(WorkspaceAgentsList, {
      props: {
        agents: [active],
        workspaceId,
        scopeCounts: { topLevel: 1, delegated: 0, background: 0 },
        onLoadDelegated,
        onLoadBackground,
      },
    });
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${active.id}"]`)).toBeTruthy(),
    );
    expect(view.container.querySelector('[data-agent-delegated-toggle]')).toBeNull();
    expect(view.container.querySelector('[data-agent-background-toggle]')).toBeNull();
  });

  it('keeps a delegated child whose parent is not loaded inside the Delegated bin (wire-parent membership)', async () => {
    const topLevel = makeAgent('top-level', { name: 'Top level' });
    appStore.dispatch(bulkUpsertSessions([topLevel]));
    const onLoadDelegated = vi.fn();
    const onLoadBackground = vi.fn();
    const props = {
      agents: [topLevel],
      workspaceId,
      scopeCounts: { topLevel: 1, delegated: 1, background: 1 },
      onLoadDelegated,
      onLoadBackground,
    };
    const view = render(WorkspaceAgentsList, { props });
    const delegatedToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-delegated-toggle]',
    );
    await fireEvent.click(delegatedToggle!);
    await waitFor(() => expect(onLoadDelegated).toHaveBeenCalledTimes(1));

    // The delegated read returns the child of a background parent the
    // collapsed Background bin has not loaded: the child stays a Delegated
    // row (the bin keeps its count and toggle) rather than becoming a
    // top-level foreground row.
    const child = makeAgent('child', {
      name: 'Child of background parent',
      metadata: { createdByAgentId: AgentId('background-parent') } as AgentSession['metadata'],
    });
    appStore.dispatch(bulkUpsertSessions([child]));
    await view.rerender({ ...props, agents: [topLevel, child], delegatedAgentsLoaded: true });
    expect(delegatedToggle?.textContent).toContain('1 delegated agents');
    expect(delegatedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${child.id}"]`,
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeNull();

    // Collapsing the bin hides it like any other delegated row.
    await fireEvent.click(delegatedToggle!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeNull(),
    );
    expect(delegatedToggle?.textContent).toContain('1 delegated agents');
    await fireEvent.click(delegatedToggle!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeTruthy(),
    );

    // A retired parent is excluded from the live tree too: its child is still
    // a Delegated row, and the parent lists in the Retired bin.
    const retiredParent = makeAgent('retired-parent', {
      name: 'Retired parent',
      retiredAt: '2026-08-16T00:02:00.000Z',
    });
    const orphan = makeAgent('orphan', {
      name: 'Child of retired parent',
      metadata: { createdByAgentId: retiredParent.id } as AgentSession['metadata'],
    });
    appStore.dispatch(bulkUpsertSessions([retiredParent, orphan]));
    await view.rerender({
      ...props,
      agents: [topLevel, child, retiredParent, orphan],
      scopeCounts: { topLevel: 1, delegated: 2, background: 1 },
      delegatedAgentsLoaded: true,
      retiredCount: 1,
    });
    expect(delegatedToggle?.textContent).toContain('2 delegated agents');
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${orphan.id}"]`,
      ),
    ).toBeTruthy();
    expect(view.container.querySelector('[data-agent-retired-toggle]')?.textContent).toContain(
      '1 retired agents',
    );

    // Once the Background bin loads the parent, the child nests under it
    // (per-parent group inside the Background section) and the Delegated
    // count is unchanged.
    const backgroundToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-background-toggle]',
    );
    await fireEvent.click(backgroundToggle!);
    await waitFor(() => expect(onLoadBackground).toHaveBeenCalledTimes(1));
    const backgroundParent = makeAgent('background-parent', {
      name: 'Background parent',
      isBackground: true,
    });
    appStore.dispatch(bulkUpsertSessions([backgroundParent]));
    await view.rerender({
      ...props,
      agents: [topLevel, child, retiredParent, orphan, backgroundParent],
      scopeCounts: { topLevel: 1, delegated: 2, background: 1 },
      delegatedAgentsLoaded: true,
      backgroundAgentsLoaded: true,
      retiredCount: 1,
    });
    expect(delegatedToggle?.textContent).toContain('2 delegated agents');
    expect(backgroundToggle?.textContent).toContain('1 background agents');
    const groupToggle = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${backgroundParent.id}"]`,
    );
    expect(groupToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeTruthy();
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${child.id}"]`,
      ),
    ).toBeNull();
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${orphan.id}"]`,
      ),
    ).toBeTruthy();

    // Collapsing only the Background bin hides the (idle) parent row; its
    // child is still a Delegated row, so the open Delegated bin lists it
    // directly and the visible rows keep matching the count.
    await fireEvent.click(backgroundToggle!);
    await waitFor(() =>
      expect(
        view.container.querySelector(`[data-agent-panel-row="${backgroundParent.id}"]`),
      ).toBeNull(),
    );
    expect(delegatedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(delegatedToggle?.textContent).toContain('2 delegated agents');
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${child.id}"]`,
      ),
    ).toBeTruthy();
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${orphan.id}"]`,
      ),
    ).toBeTruthy();

    // Re-expanding Background nests the child under its parent again.
    await fireEvent.click(backgroundToggle!);
    await waitFor(() =>
      expect(
        view.container.querySelector(`[data-agent-panel-row="${backgroundParent.id}"]`),
      ).toBeTruthy(),
    );
    expect(
      view.container.querySelector(
        `[data-agent-delegated-section] [data-agent-panel-row="${child.id}"]`,
      ),
    ).toBeNull();
    expect(view.container.querySelector(`[data-agent-panel-row="${child.id}"]`)).toBeTruthy();
  });

  it('renders collapsed per-parent bars from delegatedCounts and loads only that parent on expand (§5.5 delegatedCounts)', async () => {
    const coordinator = makeAgent('coordinator', { name: 'Coordinator' });
    const other = makeAgent('other', { name: 'Other parent' });
    const childless = makeAgent('childless', { name: 'Childless' });
    const agents = [coordinator, other, childless];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadDelegated = vi.fn();
    const props = {
      agents,
      workspaceId,
      scopeCounts: { topLevel: 3, delegated: 3, background: 0 },
      delegatedCounts: {
        running: 2,
        byParent: {
          [coordinator.id]: { total: 2, running: 1 },
          [other.id]: { total: 1, running: 1 },
          'agent-elsewhere': { total: 4, running: 4 },
        },
      },
      onLoadDelegated,
    };
    const view = render(WorkspaceAgentsList, { props });
    await waitFor(() =>
      expect(
        view.container.querySelector(`[data-agent-panel-row="${coordinator.id}"]`),
      ).toBeTruthy(),
    );

    // Count-first: every parent with a daemon-served count shows its collapsed
    // bar, labelled from `{ total, running }`, with no delegated row hydrated;
    // a parent without an entry (and an unknown key) renders nothing.
    const coordinatorBar = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${coordinator.id}"]`,
    );
    const otherBar = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${other.id}"]`,
    );
    expect(coordinatorBar?.textContent).toContain('1 / 2 delegated running');
    expect(coordinatorBar?.getAttribute('aria-expanded')).toBe('false');
    expect(otherBar?.textContent).toContain('1 / 1 delegated running');
    expect(
      view.container.querySelector(`[data-agent-delegation-toggle="${childless.id}"]`),
    ).toBeNull();
    expect(view.container.querySelectorAll('[data-agent-delegation-toggle]')).toHaveLength(2);
    expect(onLoadDelegated).not.toHaveBeenCalled();

    // The collapsed workspace bin reports the daemon's running count although
    // no delegated row is loaded locally.
    const delegatedToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-delegated-toggle]',
    );
    expect(delegatedToggle?.textContent).toContain('2 / 3 delegated agents running');
    expect(delegatedToggle?.getAttribute('aria-expanded')).toBe('false');

    // Expanding one bar requests that parent's children only, with skeleton
    // rows under the parent while the read is in flight.
    await fireEvent.click(coordinatorBar!);
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);
    expect(onLoadDelegated).toHaveBeenLastCalledWith(coordinator.id);
    expect(coordinatorBar?.getAttribute('aria-expanded')).toBe('true');
    expect(
      view.container.querySelector(`[data-agent-delegation-loading="${coordinator.id}"]`),
    ).toBeTruthy();
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeNull();
    expect(otherBar?.getAttribute('aria-expanded')).toBe('false');
    await view.rerender({ ...props, loadingDelegatedParentIds: { [coordinator.id]: true } });

    // Loaded: only that parent's children appear, and its label switches to the
    // loaded rows (the other parent keeps its daemon count).
    const childA = makeAgent('child-a', {
      name: 'Child A',
      metadata: { createdByAgentId: coordinator.id } as AgentSession['metadata'],
    });
    const childB = makeAgent('child-b', {
      name: 'Child B',
      metadata: { createdByAgentId: coordinator.id } as AgentSession['metadata'],
    });
    appStore.dispatch(bulkUpsertSessions([childA, childB]));
    await view.rerender({
      ...props,
      agents: [...agents, childA, childB],
      runningAgentIds: [childA.id],
      loadingDelegatedParentIds: {},
      loadedDelegatedParentIds: { [coordinator.id]: true },
    });
    expect(
      view.container.querySelector(`[data-agent-delegation-loading="${coordinator.id}"]`),
    ).toBeNull();
    expect(view.container.querySelector(`[data-agent-panel-row="${childA.id}"]`)).toBeTruthy();
    expect(view.container.querySelector(`[data-agent-panel-row="${childB.id}"]`)).toBeTruthy();
    expect(coordinatorBar?.textContent).toContain('2 delegated');
    expect(otherBar?.textContent).toContain('1 / 1 delegated running');
    expect(delegatedToggle?.textContent).toContain('2 / 3 delegated agents running');
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);

    // Collapsing a loaded parent hides its rows and shows the loaded running
    // count; re-expanding does not re-fetch.
    await fireEvent.click(coordinatorBar!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${childA.id}"]`)).toBeNull(),
    );
    expect(coordinatorBar?.textContent).toContain('1 / 2 delegated running');
    await fireEvent.click(coordinatorBar!);
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${childA.id}"]`)).toBeTruthy(),
    );
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);

    // Expanding the workspace bin still loads the whole bin (no parent id) and
    // opens every group: the still-unloaded parent shows its own skeleton
    // (rows are already loaded, so the bin-level skeleton stays off).
    await fireEvent.click(delegatedToggle!);
    await waitFor(() => expect(onLoadDelegated).toHaveBeenCalledTimes(2));
    expect(onLoadDelegated).toHaveBeenLastCalledWith();
    expect(otherBar?.getAttribute('aria-expanded')).toBe('true');
    expect(
      view.container.querySelector(`[data-agent-delegation-loading="${other.id}"]`),
    ).toBeTruthy();
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeNull();

    // Whole-bin loaded: every parent is loaded, labels come from the rows.
    const childC = makeAgent('child-c', {
      name: 'Child C',
      metadata: { createdByAgentId: other.id } as AgentSession['metadata'],
    });
    appStore.dispatch(bulkUpsertSessions([childC]));
    await view.rerender({
      ...props,
      agents: [...agents, childA, childB, childC],
      runningAgentIds: [childA.id],
      loadedDelegatedParentIds: { [coordinator.id]: true },
      delegatedAgentsLoaded: true,
    });
    expect(view.container.querySelector('[data-agent-delegated-loading]')).toBeNull();
    expect(view.container.querySelector(`[data-agent-panel-row="${childC.id}"]`)).toBeTruthy();
    expect(otherBar?.textContent).toContain('1 delegated');
    expect(delegatedToggle?.textContent).toContain('3 delegated agents');
    await fireEvent.click(delegatedToggle!);
    expect(delegatedToggle?.textContent).toContain('1 / 3 delegated agents running');
  });

  it('does not request a per-parent load while the whole-bin read is in flight or the parent is already loading', async () => {
    const parent = makeAgent('parent', { name: 'Parent' });
    appStore.dispatch(bulkUpsertSessions([parent]));
    const onLoadDelegated = vi.fn();
    const props = {
      agents: [parent],
      workspaceId,
      scopeCounts: { topLevel: 1, delegated: 1, background: 0 },
      delegatedCounts: { running: 0, byParent: { [parent.id]: { total: 1, running: 0 } } },
      onLoadDelegated,
    };
    const view = render(WorkspaceAgentsList, { props: { ...props, loadingDelegated: true } });
    const bar = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${parent.id}"]`,
    );
    expect(bar?.textContent).toContain('1 delegated');
    await fireEvent.click(bar!);
    expect(onLoadDelegated).not.toHaveBeenCalled();
    await fireEvent.click(bar!);

    await view.rerender({
      ...props,
      loadingDelegated: false,
      loadingDelegatedParentIds: { [parent.id]: true },
    });
    await fireEvent.click(bar!);
    expect(onLoadDelegated).not.toHaveBeenCalled();
    await fireEvent.click(bar!);

    // A failed read leaves the parent unloaded: the next expand retries.
    await view.rerender({ ...props, loadingDelegated: false, loadingDelegatedParentIds: {} });
    await fireEvent.click(bar!);
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);
    expect(onLoadDelegated).toHaveBeenLastCalledWith(parent.id);
  });

  it('keeps the whole-bin behavior without delegatedCounts (old daemon): no per-parent bar before the bin loads', async () => {
    const parent = makeAgent('parent', { name: 'Parent' });
    appStore.dispatch(bulkUpsertSessions([parent]));
    const onLoadDelegated = vi.fn();
    const props = {
      agents: [parent],
      workspaceId,
      scopeCounts: { topLevel: 1, delegated: 1, background: 0 },
      delegatedCounts: null,
      onLoadDelegated,
    };
    const view = render(WorkspaceAgentsList, { props });
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${parent.id}"]`)).toBeTruthy(),
    );
    expect(view.container.querySelector('[data-agent-delegation-toggle]')).toBeNull();
    const delegatedToggle = view.container.querySelector<HTMLElement>(
      '[data-agent-delegated-toggle]',
    );
    expect(delegatedToggle?.textContent).toContain('1 delegated agents');
    await fireEvent.click(delegatedToggle!);
    await waitFor(() => expect(onLoadDelegated).toHaveBeenCalledTimes(1));
    expect(onLoadDelegated).toHaveBeenLastCalledWith();
  });

  it('renders the per-parent bar above the virtualization threshold (counted group disables the flat virtual path)', async () => {
    const agents = Array.from({ length: 21 }, (_, index) =>
      makeAgent(`parent-${index}`, { name: `Parent ${index}` }),
    );
    const [first] = agents;
    appStore.dispatch(bulkUpsertSessions(agents));
    const onLoadDelegated = vi.fn();
    const props = {
      agents,
      workspaceId,
      scopeCounts: { topLevel: agents.length, delegated: 2, background: 0 },
      delegatedCounts: { running: 1, byParent: { [first.id]: { total: 2, running: 1 } } },
      onLoadDelegated,
    };
    const view = render(WorkspaceAgentsList, { props });
    await waitFor(() =>
      expect(view.container.querySelector(`[data-agent-panel-row="${first.id}"]`)).toBeTruthy(),
    );

    // Count-first, before any delegated row is loaded: the bar is present with
    // the daemon numbers, which the uniform-row virtual path cannot render.
    const bar = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${first.id}"]`,
    );
    expect(bar?.textContent).toContain('1 / 2 delegated running');
    expect(bar?.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelectorAll('[data-agent-delegation-toggle]')).toHaveLength(1);
    expect(view.container.querySelector('[data-index]')).toBeNull();
    expect(onLoadDelegated).not.toHaveBeenCalled();

    // Expanding the bar requests only that parent's children.
    await fireEvent.click(bar!);
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);
    expect(onLoadDelegated).toHaveBeenLastCalledWith(first.id);
    expect(
      view.container.querySelector(`[data-agent-delegation-loading="${first.id}"]`),
    ).toBeTruthy();

    // Whole-bin hydration: the bar stays in place and now reads from the rows.
    const children = ['child-a', 'child-b'].map((id) =>
      makeAgent(id, {
        name: id,
        metadata: { createdByAgentId: first.id } as AgentSession['metadata'],
      }),
    );
    appStore.dispatch(bulkUpsertSessions(children));
    await view.rerender({
      ...props,
      agents: [...agents, ...children],
      runningAgentIds: [children[0].id],
      delegatedAgentsLoaded: true,
    });
    const hydratedBar = view.container.querySelector<HTMLElement>(
      `[data-agent-delegation-toggle="${first.id}"]`,
    );
    expect(hydratedBar?.getAttribute('aria-expanded')).toBe('true');
    expect(hydratedBar?.textContent).toContain('2 delegated');
    expect(view.container.querySelector(`[data-agent-panel-row="${children[0].id}"]`)).toBeTruthy();
    expect(view.container.querySelector(`[data-agent-panel-row="${children[1].id}"]`)).toBeTruthy();
    expect(onLoadDelegated).toHaveBeenCalledTimes(1);

    // A childless list of the same size still virtualizes.
    await view.rerender({
      agents,
      workspaceId,
      scopeCounts: { topLevel: agents.length, delegated: 0, background: 0 },
      delegatedCounts: { running: 0, byParent: {} },
      onLoadDelegated,
    });
    await waitFor(() => expect(view.container.querySelector('[data-index]')).toBeTruthy());
    expect(view.container.querySelector('[data-agent-delegation-toggle]')).toBeNull();
  });

  it('virtualizes the retired bin above the threshold', async () => {
    const active = makeAgent('active-agent', { name: 'Active agent' });
    const retired = Array.from({ length: 40 }, (_, index) =>
      makeAgent(`retired-${index}`, {
        name: `Retired agent ${index}`,
        retiredAt: '2026-08-20T00:00:00.000Z',
      }),
    );
    const agents = [active, ...retired];
    appStore.dispatch(bulkUpsertSessions(agents));
    const onRestoreRetired = vi.fn();
    const view = render(WorkspaceAgentsList, {
      props: { agents, workspaceId, onRestoreRetired },
    });

    // Collapsed: no retired rows rendered at all.
    const retiredToggle = view.container.querySelector<HTMLElement>('[data-agent-retired-toggle]');
    expect(retiredToggle?.textContent).toContain('40 retired agents');
    expect(view.container.querySelector('[data-agent-retired-section]')).toBeNull();

    // Expanded: rows render through VirtualList slots, not all 21 eagerly.
    await fireEvent.click(retiredToggle!);
    const section = view.container.querySelector<HTMLElement>('[data-agent-retired-section]');
    expect(section).toBeTruthy();
    await waitFor(() => expect(section!.querySelector('[data-index]')).toBeTruthy());
    const slots = section!.querySelectorAll<HTMLElement>('[data-index]');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThan(retired.length);
    for (const slot of slots) expect(slot.style.height).toBe('40px');

    // Rows keep the restore affordance inside the virtual path.
    const restoreButton = section!.querySelector<HTMLElement>(
      '[data-testid="agent-restore-retired"]',
    );
    expect(restoreButton).toBeTruthy();
    await fireEvent.click(restoreButton!);
    expect(onRestoreRetired).toHaveBeenCalledWith({ agentId: retired[0].id });
  });

  it('keeps virtualized row slots at the shared 40px height', async () => {
    const agents = Array.from({ length: 21 }, (_, index) =>
      makeAgent(`virtual-${index}`, { name: `Virtual agent ${index}` }),
    );
    appStore.dispatch(bulkUpsertSessions(agents));
    const { container } = render(WorkspaceAgentsList, { props: { agents, workspaceId } });

    await waitFor(() => expect(container.querySelector('[data-index]')).toBeTruthy());
    for (const slot of container.querySelectorAll<HTMLElement>('[data-index]')) {
      expect(slot.style.height).toBe('40px');
    }
    expect(container.querySelector('[data-testid="agent-card-preview"]')).toBeNull();
    expect(container.querySelectorAll('[data-avatar-variant="emphasized"]').length).toBeGreaterThan(
      0,
    );
  });
});
