/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { store } from '$store/renderer/store';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import { createAdmittedLegacyPrincipal } from '../../../../test/fixtures/admitted-legacy-principal';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
import { transcriptHydrationSettled } from '$store/renderer/slices/chat-state/chat-state-slice';
import {
  installMockBackend,
  resetMockBackend,
} from '../../../../test/mocks/backend-transport.mock';
import ChatPanel from '../ChatPanel.svelte';

vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspaceDetail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({ default: (await import('./mocks/FaIcon.svelte')).default }));
vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));
vi.mock('../input/SimpleRichInput.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../ChatMessage.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../MonitoredScriptsRow.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('../AuroraBackground.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

const REGENERATE = 'agentSessions/regenerateFromMessageRequested';
const workspace = { id: 'resend-ws', title: 'Resend', myRole: 'owner' } as Workspace;
const agentIds = ['resend-agent-a', 'resend-agent-b'] as const;
let dispose: () => void;

function session(id: string): AgentSession {
  return {
    id,
    workspaceId: workspace.id,
    name: id,
    status: AgentStatus.Idle,
    messages: [
      { id: `${id}-user`, role: 'user', content: 'Hi', timestamp: '2026-10-25T10:00:00Z' },
      {
        id: `${id}-assistant`,
        role: 'assistant',
        content: 'Hello',
        timestamp: '2026-10-25T10:00:01Z',
      },
    ],
  } as AgentSession;
}

beforeEach(() => {
  installMockBackend();
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(bulkUpsertSessions(agentIds.map(session)));
  for (const id of agentIds) store.dispatch(transcriptHydrationSettled(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo ??= function scrollTo() {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dispose();
  resetMockBackend();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function mountPanel(agentId: string, props: { isActive: boolean; isPanelFocused?: boolean }) {
  const host = document.createElement('div');
  host.dataset.testHost = agentId;
  document.body.append(host);
  render(ChatPanel, { target: host, props: { workspace, agentId, ...props } });
  return host.querySelector<HTMLElement>('.chat-panel-container')!;
}

function focusInside(panel: HTMLElement): HTMLElement {
  const probe = document.createElement('button');
  probe.textContent = 'probe';
  panel.append(probe);
  probe.focus();
  return probe;
}

async function resend(): Promise<string[]> {
  const dispatch = vi.spyOn(store, 'dispatch');
  window.dispatchEvent(new CustomEvent('chat:resend-message'));
  await tick();
  const regenerated = dispatch.mock.calls
    .map(([action]) => action as { type: string; payload?: unknown })
    .filter((action) => action.type === REGENERATE)
    .map((action) => JSON.stringify(action.payload))
    .map((payload) => agentIds.find((id) => payload.includes(`"${id}-assistant"`)) ?? payload);
  dispatch.mockRestore();
  return regenerated;
}

describe('Alt+Enter resend targets only the focused chat (intent-hq/intent#4618)', () => {
  it('regenerates only the chat that holds DOM focus when two active chats are visible', async () => {
    const [panelA, panelB] = [
      mountPanel(agentIds[0], { isActive: true }),
      mountPanel(agentIds[1], { isActive: true }),
    ];
    await tick();

    focusInside(panelA);
    await tick();
    expect(await resend()).toEqual([agentIds[0]]);

    focusInside(panelB);
    await tick();
    expect(await resend()).toEqual([agentIds[1]]);
  });

  it('does not regenerate on a retained panel selection while focus is on the body', async () => {
    mountPanel(agentIds[0], { isActive: true, isPanelFocused: false });
    mountPanel(agentIds[1], { isActive: true, isPanelFocused: true });
    await tick();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    expect(await resend()).toEqual([]);
  });

  it('regenerates only the Chief card when focus moves there from a selected agent chat', async () => {
    mountPanel(agentIds[0], { isActive: true, isPanelFocused: true });
    const chief = mountPanel(agentIds[1], { isActive: true });
    await tick();
    focusInside(chief);
    await tick();
    expect(await resend()).toEqual([agentIds[1]]);
  });

  it('does not regenerate a selected agent chat once focus moves to board controls', async () => {
    mountPanel(agentIds[0], { isActive: true, isPanelFocused: true });
    mountPanel(agentIds[1], { isActive: true });
    await tick();
    const board = document.createElement('button');
    board.textContent = 'board control';
    document.body.append(board);
    board.focus();
    await tick();
    expect(await resend()).toEqual([]);
  });

  it('does not regenerate any chat when focus is outside every chat surface', async () => {
    const panelA = mountPanel(agentIds[0], { isActive: true });
    mountPanel(agentIds[1], { isActive: true });
    await tick();
    const probe = focusInside(panelA);
    await tick();
    const outside = document.createElement('button');
    outside.textContent = 'board control';
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).not.toBe(probe);
    await tick();
    expect(await resend()).toEqual([]);
  });

  it('never regenerates an inactive chat, even when it holds focus', async () => {
    const panelA = mountPanel(agentIds[0], { isActive: false, isPanelFocused: true });
    mountPanel(agentIds[1], { isActive: true });
    await tick();
    focusInside(panelA);
    await tick();
    expect(await resend()).toEqual([]);
  });
});
