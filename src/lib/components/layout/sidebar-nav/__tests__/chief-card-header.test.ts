import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { CHIEF_PROMPT_VERSION, CHIEF_SPECIALIST_ID } from '$shared/chief-agent-config';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import ChiefCard from '../cards/ChiefCard.svelte';
import { deleteAgentWithUndoRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

const agentId = 'agent-chief-header';
const threadTitle = 'Header test thread';

function makeChiefSession(): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: CHIEF_WORKSPACE_ID,
    name: threadTitle,
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
    lastActivity: '2026-09-02T12:00:00.000Z',
    metadata: {
      specialist: CHIEF_SPECIALIST_ID,
      chiefPromptVersion: CHIEF_PROMPT_VERSION,
    },
  } as AgentSession;
}

describe('ChiefCard header', () => {
  beforeEach(() => {
    appStore.init();
    admitLegacyPrincipal();
    // A settled owner window (no joined host), so the new-thread action is offered.
    appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    appStore.dispatch(bulkUpsertSessions([makeChiefSession()]));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    appStore.dispatch(removeSession(agentId));
  });

  it.each([false, true])(
    'defers chat mount until activation, then retains it across tab switches (late hydration: %s)',
    async (lateHydration) => {
      if (lateHydration) appStore.dispatch(removeSession(agentId));
      const { rerender } = render(ChiefCard, {
        props: { isActive: false },
      });
      if (lateHydration) {
        expect(screen.queryByTestId('mock-chat-panel')).toBeNull();
        appStore.dispatch(bulkUpsertSessions([makeChiefSession()]));
      }
      // Confirm the existing thread has reached the card before checking its child lifecycle.
      const picker = await screen.findByRole('combobox', {
        name: m.layout_chiefCard_threadPicker_ariaLabel(),
      });
      await waitFor(() => expect(picker.textContent).toContain(threadTitle));
      expect(screen.queryByTestId('mock-chat-panel')).toBeNull();

      await rerender({ isActive: true });
      const chat = await screen.findByTestId('mock-chat-panel');
      expect(chat.getAttribute('data-active')).toBe('true');
      expect(chat.getAttribute('data-autofocus')).toBe('false');

      await rerender({ isActive: false });
      expect(screen.getByTestId('mock-chat-panel')).toBe(chat);
      expect(chat.getAttribute('data-active')).toBe('false');

      await rerender({ isActive: true });
      expect(screen.getByTestId('mock-chat-panel')).toBe(chat);
      expect(chat.getAttribute('data-active')).toBe('true');
    },
  );

  it('deletes the selected thread through an independent named command without selecting a row', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    render(ChiefCard, { props: {} });
    dispatch.mockClear();
    await fireEvent.click(
      screen.getByRole('button', {
        name: m.layout_chiefCard_deleteThread_ariaLabel({ title: threadTitle }),
      }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    const expected = deleteAgentWithUndoRequested(CHIEF_WORKSPACE_ID, agentId, threadTitle);
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      type: expected.type,
      payload: expected.payload,
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
