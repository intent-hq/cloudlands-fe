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
    expect(longRow?.className).toContain('bg-muted/70');
    expect(longRow?.querySelector('[data-agent-row-name]')?.className).toContain('flex-1');
    expect(longRow?.querySelector('[data-panel-open-state="active"]')).toBeTruthy();
    expect(longRow?.querySelector('[data-agent-row-time]')).toBeTruthy();
    const backgroundRow = view.container.querySelector<HTMLElement>(
      `[data-agent-panel-row="${background.id}"]`,
    );
    expect(backgroundRow?.querySelector('[data-agent-background-badge]')).toBeTruthy();

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
    expect(onSelect).toHaveBeenCalledWith({ agentId: retired.id });

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
