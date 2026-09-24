/**
 * Behavioral contract for the Chief card's thread lifecycle and its embedded
 * chat layout, rendered against the real store with ChatPanel mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { m } from '$shared/paraglide/messages.js';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import ChiefCard from '../cards/ChiefCard.svelte';

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

const LAUNCH_TYPE = 'agentSessions/launchAgentRequested';
const CURRENT_THREAD_ID = 'agent-chief-current';
const STALE_THREAD_ID = 'agent-chief-stale';

function makeChiefSession(
  id: string,
  overrides: { createdAt: string; chiefPromptVersion?: number },
): AgentSession {
  return {
    id: AgentId(id),
    backendSessionId: null,
    workspaceId: CHIEF_WORKSPACE_ID,
    name: `Thread ${id}`,
    status: AgentStatus.Active,
    messages: [],
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
    lastActivity: overrides.createdAt,
    metadata: {
      specialist: CHIEF_SPECIALIST_ID,
      ...(overrides.chiefPromptVersion ? { chiefPromptVersion: overrides.chiefPromptVersion } : {}),
    },
  } as AgentSession;
}

async function settle() {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Chief card migration contract', () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;
  let launchActions: unknown[];

  beforeEach(() => {
    appStore.init();
    appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    appStore.dispatch(setActiveProvider('auggie'));
    appStore.dispatch(setChiefActiveAgentId(null));

    launchActions = [];
    const originalDispatch = appStore.dispatch.bind(appStore);
    dispatchSpy = vi.spyOn(appStore, 'dispatch').mockImplementation((action: any) => {
      if (action?.type === LAUNCH_TYPE) {
        launchActions.push(action);
        action.success({ id: 'agent-chief-created' } as unknown as AgentSession);
        return action;
      }
      return originalDispatch(action);
    });
  });

  afterEach(() => {
    cleanup();
    dispatchSpy.mockRestore();
    appStore.dispatch(removeSession(CURRENT_THREAD_ID));
    appStore.dispatch(removeSession(STALE_THREAD_ID));
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, false));
  });

  it('waits for daemon hydration before creating a Chief thread', async () => {
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, false));
    render(ChiefCard, { props: { expanded: true } });

    await settle();
    expect(launchActions).toHaveLength(0);

    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    await waitFor(() => expect(launchActions).toHaveLength(1));
    await settle();
    expect(launchActions).toHaveLength(1);
  });

  it('selects the latest current-identity thread instead of creating one once hydrated', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeChiefSession(CURRENT_THREAD_ID, {
          createdAt: '2026-09-02T12:00:00.000Z',
          chiefPromptVersion: CHIEF_PROMPT_VERSION,
        }),
      ]),
    );
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    render(ChiefCard, { props: { expanded: true } });

    await settle();
    expect(launchActions).toHaveLength(0);
    expect(appStore.state.sidebarNav.chiefActiveAgentId).toBe(CURRENT_THREAD_ID);
    expect(screen.getByTestId('mock-chat-panel').textContent).toBe(CURRENT_THREAD_ID);
  });

  it('creates a new thread when only stale-identity threads exist', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeChiefSession(STALE_THREAD_ID, { createdAt: '2099-01-01T00:00:00.000Z' }),
      ]),
    );
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    render(ChiefCard, { props: { expanded: true } });

    await waitFor(() => expect(launchActions).toHaveLength(1));
    await settle();
    expect(launchActions).toHaveLength(1);
  });

  it.each([undefined, 2])(
    'preserves a legacy selection with marker %s, but New chat creates instead of reusing it',
    async (chiefPromptVersion) => {
      const legacy = makeChiefSession(STALE_THREAD_ID, {
        createdAt: '2099-01-01T00:00:00.000Z',
        chiefPromptVersion,
      });
      legacy.name = 'My saved plan';
      legacy.nameExplicitlySet = true;
      appStore.dispatch(bulkUpsertSessions([legacy]));
      // The same requested-agent state is used for manual selection and deep links.
      appStore.dispatch(setChiefActiveAgentId(STALE_THREAD_ID));
      appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
      render(ChiefCard, { props: { expanded: true } });

      await settle();
      expect(launchActions).toHaveLength(0);
      expect(screen.getByTestId('mock-chat-panel').textContent).toBe(STALE_THREAD_ID);
      const saved = appStore.state.agentSessions.byAgentId[STALE_THREAD_ID];

      await fireEvent.click(
        screen.getByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
      );
      await waitFor(() => expect(launchActions).toHaveLength(1));
      expect(launchActions[0]).toMatchObject({
        payload: [
          CHIEF_WORKSPACE_ID,
          {
            agentType: 'workspace',
            metadata: { chiefPromptVersion: 3, specialist: 'chief-of-staff' },
          },
          { openAgent: false },
        ],
      });
      expect(appStore.state.agentSessions.byAgentId[STALE_THREAD_ID]).toBe(saved);
      expect(appStore.state.sidebarNav.chiefActiveAgentId).toBe('agent-chief-created');
    },
  );

  it('keeps legacy history and deep-link selection when a current blank thread exists', async () => {
    const legacy = makeChiefSession(STALE_THREAD_ID, { createdAt: '2099-01-01T00:00:00.000Z' });
    legacy.name = 'My saved plan';
    legacy.nameExplicitlySet = true;
    legacy.systemPrompt = 'Saved legacy instructions';
    legacy.messages = [
      {
        id: 'saved-message',
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Keep my history' }],
        timestamp: '2099-01-01T00:00:00.000Z',
      },
    ];
    appStore.dispatch(
      bulkUpsertSessions([
        legacy,
        makeChiefSession(CURRENT_THREAD_ID, {
          createdAt: '2026-09-24T00:00:00.000Z',
          chiefPromptVersion: 3,
        }),
      ]),
    );
    appStore.dispatch(setChiefActiveAgentId(STALE_THREAD_ID));
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    render(ChiefCard, { props: { expanded: true } });
    await waitFor(() =>
      expect(screen.getByTestId('mock-chat-panel').textContent).toBe(STALE_THREAD_ID),
    );
    const saved = appStore.state.agentSessions.byAgentId[STALE_THREAD_ID];
    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
    );
    await waitFor(() => {
      expect(appStore.state.sidebarNav.chiefActiveAgentId).toBe(CURRENT_THREAD_ID);
      expect(screen.getByTestId('mock-chat-panel').textContent).toBe(CURRENT_THREAD_ID);
    });
    expect(launchActions).toHaveLength(0);
    expect(appStore.state.agentSessions.byAgentId[STALE_THREAD_ID]).toBe(saved);
  });

  it('creates on New chat rather than reusing a current nonempty thread', async () => {
    const current = makeChiefSession(CURRENT_THREAD_ID, {
      createdAt: '2026-09-24T00:00:00.000Z',
      chiefPromptVersion: 3,
    });
    current.messageCount = 1;
    appStore.dispatch(bulkUpsertSessions([current]));
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    render(ChiefCard, { props: { expanded: true } });
    await settle();
    expect(launchActions).toHaveLength(0);

    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
    );
    await waitFor(() => expect(launchActions).toHaveLength(1));
    expect(appStore.state.sidebarNav.chiefActiveAgentId).toBe('agent-chief-created');
  });

  it('docks the embedded Chief chat to the bottom without an extra wrapper inset', () => {
    const { container } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: false, ontoggle: vi.fn() },
    });

    const content = container.querySelector<HTMLElement>('#combined-panel-chief-content')!;
    expect(content).not.toBeNull();
    for (const token of ['min-h-0', 'flex-1', 'overflow-clip', 'px-2', 'pt-0']) {
      expect(content.classList.contains(token)).toBe(true);
    }
    expect([...content.classList].some((token) => /^pb-/.test(token))).toBe(false);
  });

  it('clips at the padded wrapper with a clip margin so the composer aurora reaches the window edges', () => {
    const { container } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: false, ontoggle: vi.fn() },
    });

    const content = container.querySelector<HTMLElement>('#combined-panel-chief-content')!;
    expect(content.classList.contains('[overflow-clip-margin:0.5rem]')).toBe(true);
    const section = content.querySelector<HTMLElement>(':scope > section')!;
    expect(section).not.toBeNull();
    for (const token of ['flex', 'h-full', 'min-h-0', 'flex-col']) {
      expect(section.classList.contains(token)).toBe(true);
    }
    expect(section.classList.contains('overflow-hidden')).toBe(false);
    // No clip-path utility here: it would clip fixed-position dialogs rendered
    // in this subtree (e.g. RulesInspector), since clip-path clips all painted
    // descendants including position:fixed ones.
    const clipPathUser = [...container.querySelectorAll<HTMLElement>('*')].find((element) =>
      [...element.classList].some((token) => token.startsWith('[clip-path:')),
    );
    expect(clipPathUser).toBeUndefined();
  });

  it('goes directly to a blank chat instead of rendering a Chief empty state', async () => {
    appStore.dispatch(
      bulkUpsertSessions([
        makeChiefSession(CURRENT_THREAD_ID, {
          createdAt: '2026-09-02T12:00:00.000Z',
          chiefPromptVersion: CHIEF_PROMPT_VERSION,
        }),
      ]),
    );
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    const { container } = render(ChiefCard, { props: { expanded: true, embedded: true } });
    await settle();

    const content = container.querySelector<HTMLElement>('section')!;
    expect(screen.getByTestId('mock-chat-panel').textContent).toBe(CURRENT_THREAD_ID);
    expect(content.textContent?.trim()).toBe(CURRENT_THREAD_ID);
    expect(content.querySelector('svg')).toBeNull();
  });

  it('shares one in-flight Chief launch across mounted card hosts', async () => {
    appStore.dispatch(setAgentsLoaded(CHIEF_WORKSPACE_ID, true));
    render(ChiefCard, { props: { expanded: true } });
    render(ChiefCard, { props: { expanded: true, embedded: true } });

    await waitFor(() => expect(launchActions).toHaveLength(1));
    await settle();
    expect(launchActions).toHaveLength(1);
    expect(appStore.state.sidebarNav.chiefActiveAgentId).toBe('agent-chief-created');
  });
});
