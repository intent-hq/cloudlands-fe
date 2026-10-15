import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopConversation } from './desktop-conversation';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  bulkUpsertSessions,
  updateSession,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTrackedWorkspaceSet,
  chatLiveStreamPhaseChanged,
  transcriptHydrationSettled,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type Workspace } from '$shared/types';
const mounts = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('@/features/workspace/workspace-conversation-composer', () => ({
  WorkspaceConversationComposer: () => {
    useEffect(() => {
      mounts.start();
      return mounts.stop;
    }, []);
    return <textarea aria-label="draft host" />;
  },
}));
const ws = WorkspaceId('desktop-cold'),
  agent = AgentId('desktop-agent');
let dispose: () => void, host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: ws, title: 'Desktop', myRole: 'owner' } as Workspace));
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  mounts.start.mockClear();
  mounts.stop.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.unstubAllGlobals();
});
const render = (active = true) =>
  act(async () =>
    root.render(
      <DesktopConversation
        workspaceId={ws}
        agentId={agent}
        panelId="pane"
        tabId="tab"
        active={active}
        onUnavailable={() => {}}
      />,
    ),
  );
const settle = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
function session() {
  store.dispatch(
    bulkUpsertSessions([
      {
        id: agent,
        workspaceId: ws,
        name: 'Desktop agent',
        backendSessionId: null,
        status: AgentStatus.Active,
        createdAt: '2026-10-15T18:00:00Z',
        updatedAt: '2026-10-15T18:00:00Z',
        messages: [
          {
            id: 'u',
            role: 'user',
            timestamp: '2026-10-15T18:00:00Z',
            contentBlocks: [{ type: 'text', text: 'Hello Ω' }],
          },
          {
            id: 'a',
            role: 'assistant',
            timestamp: '2026-10-15T18:00:00Z',
            contentBlocks: [{ type: 'text', text: 'Saved response' }],
          },
        ],
        metadata: { lastSeenMessageId: 'u' },
      },
    ]),
  );
}
it('waits for canonical session and tracked workspace before mounting the draft owner, then preserves it across pane parking', async () => {
  await render();
  expect(mounts.start).not.toHaveBeenCalled();
  await act(async () => session());
  await settle();
  expect(mounts.start).not.toHaveBeenCalled();
  await act(async () => store.dispatch(chatTrackedWorkspaceSet(agent, ws)));
  await settle();
  expect(mounts.start).toHaveBeenCalledTimes(1);
  await render(false);
  await render(true);
  expect(mounts.start).toHaveBeenCalledTimes(1);
  expect(mounts.stop).not.toHaveBeenCalled();
  await act(async () =>
    store.dispatch(setWorkspaceHasLoaded(false, store.state.connections.windowBackendId, null)),
  );
  await settle();
  expect(mounts.stop).toHaveBeenCalledTimes(1);
});
it('renders the shared frozen divider and source prose inset after real transcript readiness', async () => {
  session();
  store.dispatch(chatTrackedWorkspaceSet(agent, ws));
  store.dispatch(chatLiveStreamPhaseChanged(agent, 'live'));
  store.dispatch(transcriptHydrationSettled(agent));
  await render();
  await settle();
  expect(host.querySelector('[data-assistant-prose]')?.textContent).toBe('Saved response');
  expect(host.querySelector('[data-new-messages-divider]')).not.toBeNull();
  const userRow = host.querySelector<HTMLElement>('[data-pinned-prompt-id="u"]');
  expect(
    userRow?.closest('[data-conversation-turn]')?.querySelector('[data-message-id="a"]'),
  ).not.toBeNull();
  expect(
    (userRow as HTMLElement & { __pinnedPromptMessage?: { id: string } }).__pinnedPromptMessage?.id,
  ).toBe('u');

  expect(store.state.unreadTracking.dividerSessionByAgentId[agent]).toEqual({ anchorId: 'u' });
});

it('uses the source card-to-body seam between saved conversation turns', async () => {
  session();
  store.dispatch(
    updateSession(agent, {
      messages: [
        {
          id: 'u1',
          role: 'user',
          timestamp: '2026-10-15T18:00:00Z',
          contentBlocks: [{ type: 'text', text: 'First request' }],
        },
        {
          id: 'a1',
          role: 'assistant',
          timestamp: '2026-10-15T18:00:01Z',
          contentBlocks: [{ type: 'text', text: 'First reply' }],
        },
        {
          id: 'u2',
          role: 'user',
          timestamp: '2026-10-15T18:00:02Z',
          contentBlocks: [{ type: 'text', text: 'Follow-up' }],
        },
        {
          id: 'a2',
          role: 'assistant',
          timestamp: '2026-10-15T18:00:03Z',
          contentBlocks: [{ type: 'text', text: 'Second reply' }],
        },
      ],
    }),
  );
  store.dispatch(chatTrackedWorkspaceSet(agent, ws));
  store.dispatch(chatLiveStreamPhaseChanged(agent, 'live'));
  store.dispatch(transcriptHydrationSettled(agent));
  await render();
  await settle();
  const gap = host.querySelector('[data-testid="conversation-turn-gap"]');
  expect(gap?.getAttribute('data-subscription-card-seam')).toBe('content');
  expect(gap?.classList.contains('h-6')).toBe(true);
  expect(host.querySelectorAll('[data-conversation-turn]')).toHaveLength(2);
});
