import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { setChiefCollapsed } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectIsChiefCollapsed } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import ChiefCard from '../cards/ChiefCard.svelte';

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

describe('ChiefCard combined header', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(setChiefCollapsed(true));
    appStore.dispatch(bulkUpsertSessions([makeChiefSession()]));
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(removeSession(agentId));
  });

  it('keeps the labeled disclosure row visible while its chat content is collapsed', async () => {
    const ontoggle = vi.fn();
    const { container, rerender } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: true, ontoggle },
    });
    const toggle = screen.getByRole('button', { name: m.layout_chiefCard_title() });
    const content = container.querySelector<HTMLElement>('#combined-panel-chief-content');

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('combined-panel-chief-content');
    expect(content?.hidden).toBe(true);
    expect(screen.getAllByRole('button')).toHaveLength(3);

    await fireEvent.click(toggle);
    expect(ontoggle).toHaveBeenCalledOnce();

    await rerender({ expanded: true, embedded: true, collapsed: false, ontoggle });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content?.hidden).toBe(false);
  });

  it('expands the section when a thread is selected or a new thread is requested', async () => {
    const { rerender } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: true, ontoggle: vi.fn() },
    });

    await fireEvent.click(screen.getByRole('button', { name: threadTitle }));
    await fireEvent.click(await screen.findByRole('option', { name: threadTitle }));
    expect(selectIsChiefCollapsed.select(appStore.state)).toBe(false);

    appStore.dispatch(setChiefCollapsed(true));
    await rerender({ expanded: true, embedded: true, collapsed: true, ontoggle: vi.fn() });
    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_chiefCard_newThread_tooltip() }),
    );
    await waitFor(() => expect(selectIsChiefCollapsed.select(appStore.state)).toBe(false));
  });
});
