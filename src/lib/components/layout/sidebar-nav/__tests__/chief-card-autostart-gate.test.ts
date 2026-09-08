/**
 * Behavioral test for the Chief auto-start provider gate.
 *
 * On a provider-less backend (providers.active unset, no resolvable model)
 * the expanded ChiefCard must NOT dispatch an agent launch — no agent.create,
 * no toast. The skip must not latch, so once a provider becomes configured
 * the auto-start effect retries and fires exactly one launch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { setChiefCollapsed } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import type { AgentSession } from '$shared/types';
import ChiefCard from '../cards/ChiefCard.svelte';

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

const LAUNCH_TYPE = 'agentSessions/launchAgentRequested';

describe('ChiefCard auto-start provider gate', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let launchActions: unknown[];

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));

    launchActions = [];
    const originalDispatch = appStore.dispatch.bind(appStore);
    dispatchSpy = vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
      if (action?.type === LAUNCH_TYPE) {
        // Swallow the launch (no saga/wire round-trip) and settle its promise
        // so the component's await resolves like a successful agent.create.
        launchActions.push(action);
        action.success({ id: 'agent-chief-gate-test' } as unknown as AgentSession);
        return action;
      }
      return originalDispatch(action);
    });
  });

  afterEach(() => {
    cleanup();
    dispatchSpy.mockRestore();
    appStore.dispatch(setActiveProvider(''));
  });

  it('skips the launch while provider-less, then fires exactly once when configured', async () => {
    render(ChiefCard, { props: { expanded: true } });

    // Provider-less: the auto-start effect must skip without dispatching.
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchActions).toHaveLength(0);

    // Configure a provider: the ungated effect re-runs and launches once.
    appStore.dispatch(setActiveProvider('auggie'));
    await waitFor(() => expect(launchActions).toHaveLength(1));

    // The latch is set after the successful gate pass — no duplicate launch.
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchActions).toHaveLength(1);
  });

  it('preserves the collapsed preference when auto-start creates the first thread', async () => {
    appStore.dispatch(setChiefCollapsed(true));
    appStore.dispatch(setActiveProvider('auggie'));
    dispatchSpy.mockClear();

    render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: true, ontoggle: vi.fn() },
    });

    await waitFor(() => expect(launchActions).toHaveLength(1));
    expect(
      dispatchSpy.mock.calls.some(([action]) => action?.type === 'sidebarNav/setChiefCollapsed'),
    ).toBe(false);
    expect(appStore.state.sidebarNav.isChiefCollapsed).toBe(true);
  });

  it('expands the preference and creates a thread when the expanded + is clicked', async () => {
    appStore.dispatch(setChiefCollapsed(true));
    dispatchSpy.mockClear();
    render(ChiefCard, { props: { expanded: true, embedded: true, collapsed: false } });

    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
    );

    await waitFor(() => expect(launchActions).toHaveLength(1));
    expect(
      dispatchSpy.mock.calls.some(([action]) => action?.type === 'sidebarNav/setChiefCollapsed'),
    ).toBe(true);
    expect(appStore.state.sidebarNav.isChiefCollapsed).toBe(false);
  });
});
