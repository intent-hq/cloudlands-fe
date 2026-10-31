import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), show: vi.fn(async () => true) }));
const agents$ = writable<Array<Record<string, unknown>>>([]);
const readRevision$ = writable(3);
const pickedId$ = writable<string | null>(null);

vi.mock('./HomeWorkspaceChat.svelte', async () => ({
  default: (await import('./__tests__/HomeWorkspaceChatStub.svelte')).default,
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/AgentAvatar.svelte')).default,
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/utils/show-workspace', () => ({ openAndShowWorkspace: mocks.show }));
vi.mock('$features/workspace/workspace-detail-hydration', () => ({
  ensureWorkspaceDetail: vi.fn(async () => undefined),
}));
vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch, state: {} },
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceDetailHydrated: { select: () => true },
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => agents$,
  selectAgentsReadRevision: () => readRevision$,
}));
vi.mock('./home-workspaces-selectors', () => ({
  selectHomePreviewAgentId: () => pickedId$,
}));

import HomeWorkspaceDetail from './HomeWorkspaceDetail.svelte';
import { m } from '$shared/paraglide/messages.js';
import { setHomePreviewAgent } from './home-workspaces-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import type { Workspace } from '$shared/types';

const workspace = { id: 'ws-1', title: 'Workspace' } as unknown as Workspace;
const at = (hour: number) => `2026-03-19T${String(hour).padStart(2, '0')}:00:00.000Z`;
const agent = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Agent ${id}`,
  workspaceId: 'ws-1',
  status: 'active',
  messages: [],
  createdAt: at(0),
  updatedAt: at(0),
  ...extra,
});

const shownAgent = () => screen.getByTestId('home-chat').getAttribute('data-shown-agent');
const renderDetail = () => render(HomeWorkspaceDetail, { workspace, onclose: vi.fn() });

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs the bits-ui select calls.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});
beforeEach(() => {
  mocks.dispatch.mockClear();
  readRevision$.set(3);
  pickedId$.set(null);
  agents$.set([
    agent('initial', { isInitialAgent: true, lastActivity: at(1) }),
    agent('recent', { lastActivity: at(5) }),
    agent('helper', { isBackground: true, lastActivity: at(9) }),
  ]);
});
afterEach(cleanup);

describe('Home workspace preview agent choice', () => {
  it('opens the workspace and its tab through the shared helper', async () => {
    renderDetail();

    await fireEvent.click(screen.getByRole('button', { name: m.home_open_workspace() }));

    expect(mocks.show).toHaveBeenCalledExactlyOnceWith('ws-1');
  });

  it('shows the most recently active top-level agent instead of the initial agent', async () => {
    renderDetail();
    await tick();

    expect(shownAgent()).toBe('recent');
    expect(screen.getByRole('combobox').textContent).toContain('Agent recent');
  });

  it('keeps the shown agent once a fresh read has landed', async () => {
    renderDetail();
    await tick();
    readRevision$.set(4);
    await tick();
    agents$.set([
      agent('initial', { isInitialAgent: true, lastActivity: at(10) }),
      agent('recent', { lastActivity: at(5) }),
    ]);
    await tick();

    expect(shownAgent()).toBe('recent');
  });

  it("follows newer activity until the preview's own read lands, then locks", async () => {
    renderDetail();
    await tick();
    const refreshed = [
      agent('initial', { isInitialAgent: true, lastActivity: at(8) }),
      agent('recent', { lastActivity: at(5) }),
    ];
    agents$.set(refreshed);
    await tick();
    expect(shownAgent()).toBe('initial');

    readRevision$.set(4);
    await tick();
    agents$.set([
      agent('initial', { lastActivity: at(8) }),
      agent('recent', { lastActivity: at(9) }),
    ]);
    await tick();
    expect(shownAgent()).toBe('initial');
  });

  it('resolves the latest agent again for a newly opened preview', async () => {
    const first = renderDetail();
    await tick();
    first.unmount();
    agents$.set([
      agent('initial', { isInitialAgent: true, lastActivity: at(10) }),
      agent('recent', { lastActivity: at(5) }),
    ]);
    renderDetail();
    await tick();

    expect(shownAgent()).toBe('initial');
  });

  it('shows the agent the user picked in Home', async () => {
    pickedId$.set('initial');
    renderDetail();
    await tick();

    expect(shownAgent()).toBe('initial');
  });

  it('falls back to the default when the picked agent is retired', async () => {
    pickedId$.set('initial');
    agents$.set([
      agent('initial', { lastActivity: at(1), retiredAt: at(2) }),
      agent('recent', { lastActivity: at(5) }),
    ]);
    renderDetail();
    await tick();

    expect(shownAgent()).toBe('recent');
  });

  it('records a dropdown choice as the Home pick and the active agent', async () => {
    renderDetail();
    await tick();
    const trigger = screen.getByRole('combobox');
    await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(trigger);
    const option = await waitFor(() => screen.getByRole('option', { name: /Agent initial/ }));
    await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    await fireEvent.click(option);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(setHomePreviewAgent('ws-1', 'initial')),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(setActiveAgentId('ws-1', 'initial'));
  });
});
