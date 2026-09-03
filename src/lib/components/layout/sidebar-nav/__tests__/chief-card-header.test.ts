import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

  it('toggles exactly once from every part of the collapsed header without opening the dropdown', async () => {
    const ontoggle = vi.fn();
    const { container, rerender } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: true, ontoggle },
    });
    const row = container.querySelector<HTMLElement>('[data-chief-header-row]');
    const toggle = screen.getByRole('button', { name: m.layout_chiefCard_title() });
    const titleButton = screen.getByRole('button', { name: threadTitle });
    const content = container.querySelector<HTMLElement>('#combined-panel-chief-content');

    expect(row).not.toBeNull();
    expect(toggle.hasAttribute('data-chief-section-toggle')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('combined-panel-chief-content');
    expect(titleButton.getAttribute('aria-expanded')).toBe('false');
    expect(titleButton.getAttribute('aria-controls')).toBe('combined-panel-chief-content');
    expect(content?.hidden).toBe(true);

    await fireEvent.click(titleButton);
    expect(ontoggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole('option')).toBeNull();

    ontoggle.mockClear();
    await fireEvent.click(row!);
    expect(ontoggle).toHaveBeenCalledOnce();

    ontoggle.mockClear();
    await fireEvent.click(toggle);
    expect(ontoggle).toHaveBeenCalledOnce();

    await rerender({ expanded: true, embedded: true, collapsed: false, ontoggle });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(content?.hidden).toBe(false);
  });

  it('keeps the new-thread action mounted but unavailable while collapsed', async () => {
    const { container, rerender } = render(ChiefCard, {
      props: { expanded: true, embedded: true, collapsed: true, ontoggle: vi.fn() },
    });
    const newThread = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.layout_chiefCard_newThread_tooltip()}"]`,
    );

    expect(newThread).not.toBeNull();
    expect(newThread?.disabled).toBe(true);
    expect(newThread?.tabIndex).toBe(-1);
    expect(newThread?.getAttribute('aria-hidden')).toBe('true');

    await rerender({ expanded: true, embedded: true, collapsed: false, ontoggle: vi.fn() });
    expect(newThread?.disabled).toBe(false);
    expect(newThread?.tabIndex).toBe(0);
    expect(newThread?.hasAttribute('aria-hidden')).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: threadTitle }));
    expect(await screen.findByRole('option', { name: threadTitle })).toBeTruthy();
  });
});
