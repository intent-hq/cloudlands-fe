import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceConversation } from './workspace-conversation';
import {
  bulkUpsertSessions,
  replaceMessages,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  chatTrackedWorkspaceSet,
  chatLiveStreamPhaseChanged,
  chatTranscriptSnapshotApplied,
  transcriptHydrationSettled,
  messageBlockHydrated,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentMessage, ContentBlock } from '$shared/types';

const { navigate, route, access } = vi.hoisted(() => ({
  navigate: vi.fn(),
  access: { authority: 'test-admission' as string | null, root: '/original' },
  route: { location: { state: {}, search: {} as Record<string, unknown> } },
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ state: route }),
  useLocation: () => route.location,
  Link: ({ children }: { children: ReactNode }) => <a href="#workspace">{children}</a>,
}));
// Admission and disclosure interaction are covered in their own native/owner tests.
// This mount exercises actual message updates, canonical selectors/cache, and ToolBody rendering.
vi.mock('@/store/workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectAdmittedWorkspaceReadContext: Object.assign(() => ({ value: access.authority }), {
    select: () => access.authority,
  }),
}));
vi.mock('@/features/chat/components/response-group', () => ({
  ResponseGroup: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}));

it('uses a hydrated slim block until newer complete content arrives for the same block ID', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const dispose = store.init();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const workspaceId = WorkspaceId('cache-update-workspace');
  const agentId = AgentId('cache-update-agent');
  const block: ContentBlock = {
    id: 'tool-result',
    type: 'tool_result',
    toolName: 'Read',
    output: 'slim preview',
    outputTruncated: true,
  };
  const message: AgentMessage = {
    id: 'message',
    role: 'assistant',
    timestamp: '2026-10-14T00:00:00Z',
    contentBlocks: [block],
  };
  const settle = async () =>
    act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  try {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          workspaceId,
          backendSessionId: null,
          name: 'Cache update',
          status: AgentStatus.Active,
          messages: [message],
          createdAt: '2026-10-14T00:00:00Z',
          updatedAt: '2026-10-14T00:00:00Z',
        },
      ]),
    );
    store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
    store.dispatch(chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 1 }));
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    store.dispatch(transcriptHydrationSettled(agentId));
    await act(async () =>
      root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
    );
    await act(async () => {
      store.dispatch(
        messageBlockHydrated(agentId, message.id, block.id!, {
          ...block,
          output: 'cached full A',
          outputTruncated: false,
        }),
      );
    });
    await settle();
    expect(container.querySelector('[data-block-id="tool-result"] pre')?.textContent).toBe(
      '"cached full A"',
    );
    await act(async () => {
      store.dispatch(
        replaceMessages(agentId, [
          {
            ...message,
            contentBlocks: [{ ...block, output: 'current complete B', outputTruncated: false }],
          },
        ]),
      );
    });
    await settle();
    const body = container.querySelector('[data-block-id="tool-result"]');
    expect(body?.getAttribute('data-hydration')).toBe('complete');
    expect(body?.querySelector('pre')?.textContent).toBe('"current complete B"');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    dispose();
    vi.unstubAllGlobals();
  }
});

it.each([undefined, 'initial-route-target'])(
  'captures the rendered source row, not route target %s',
  async (messageId) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const dispose = store.init();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const workspaceId = WorkspaceId('return-workspace');
    const agentId = AgentId('return-agent');
    const message: AgentMessage = {
      id: 'actual-clicked-row',
      role: 'assistant',
      timestamp: '2026-10-14T00:00:00Z',
      contentBlocks: [{ type: 'text', text: '[Read result](intent://local/file/docs/result.md)' }],
    };
    navigate.mockClear();
    try {
      store.dispatch(
        bulkUpsertSessions([
          {
            id: agentId,
            workspaceId,
            backendSessionId: null,
            name: 'Return test',
            status: AgentStatus.Active,
            messages: [message],
            createdAt: message.timestamp,
            updatedAt: message.timestamp,
          },
        ]),
      );
      store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
      store.dispatch(
        chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 1 }),
      );
      store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
      store.dispatch(transcriptHydrationSettled(agentId));
      await act(async () =>
        root.render(
          <WorkspaceConversation
            workspaceId={workspaceId}
            agentId={agentId}
            messageId={messageId}
          />,
        ),
      );
      const link = container.querySelector<HTMLAnchorElement>(
        'a[href="intent://local/file/docs/result.md"]',
      );
      expect(link).not.toBeNull();
      await act(async () => link!.click());
      expect(navigate).toHaveBeenCalledOnce();
      const destination = navigate.mock.calls[0][0];
      expect(destination.params).toEqual({ workspaceId });
      const search = destination.search({
        agent: agentId,
        message: messageId,
        q: 'retained-query',
      });
      expect(search).toMatchObject({
        file: 'docs/result.md',
        q: 'retained-query',
        fileOrigin: JSON.stringify({ workspaceId, agentId, messageId: message.id }),
      });
      expect(search.agent).toBeUndefined();
      expect(search.message).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      dispose();
      vi.unstubAllGlobals();
    }
  },
);

it.each([false, true])(
  'keeps exact source return identity and fences retired link activation (%s)',
  async (retire) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const dispose = store.init();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const workspaceId = WorkspaceId('message-return-workspace'),
      agentId = AgentId('message-return-agent');
    const href = 'intent://local/message-return-workspace/agent/other-agent/message/exact-target';
    const message: AgentMessage = {
      id: 'clicked-source',
      role: 'user',
      timestamp: '2026-10-15T00:00:00Z',
      contentBlocks: [{ type: 'text', text: `Open ${href}.` }],
    };
    let resolveReplace!: () => void;
    const replaced = new Promise<void>((resolve) => {
      resolveReplace = resolve;
    });
    navigate.mockReset();
    route.location.search = {
      agent: agentId,
      message: 'unrelated-route-target',
      homeQuery: 'kept',
    };
    navigate.mockImplementation(async (options) => {
      if (options.replace) {
        route.location.search = options.search(route.location.search);
        await replaced;
      }
    });
    let mounted = true;
    try {
      store.dispatch(
        bulkUpsertSessions([
          {
            id: agentId,
            workspaceId,
            backendSessionId: null,
            name: 'Return',
            status: AgentStatus.Active,
            messages: [message],
            createdAt: message.timestamp,
            updatedAt: message.timestamp,
          },
        ]),
      );
      store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
      store.dispatch(
        chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 1 }),
      );
      store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
      store.dispatch(transcriptHydrationSettled(agentId));
      await act(async () =>
        root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
      );
      const link = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
      expect(link).not.toBeNull();
      await act(async () => link!.click());
      expect(navigate).toHaveBeenCalledOnce();
      const source = navigate.mock.calls[0][0];
      expect(source.replace).toBe(true);
      expect(source.resetScroll).toBe(false);
      expect(route.location.search).toEqual({
        agent: agentId,
        message: message.id,
        homeQuery: 'kept',
      });
      expect(source.state({}).messageReturn).toMatchObject({
        workspaceId,
        agentId,
        messageId: message.id,
        authority: 'test-admission',
      });
      if (retire) {
        await act(async () => root.unmount());
        mounted = false;
      }
      await act(async () => {
        resolveReplace();
        await replaced;
      });
      expect(navigate).toHaveBeenCalledTimes(retire ? 1 : 2);
      if (!retire)
        expect(navigate.mock.calls[1][0]).toMatchObject({
          params: { workspaceId },
          search: { agent: 'other-agent', message: 'exact-target' },
        });
    } finally {
      if (mounted) await act(async () => root.unmount());
      host.remove();
      dispose();
      navigate.mockReset();
      vi.unstubAllGlobals();
    }
  },
);

vi.mock('@/store/workspace/workspace-selectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/workspace/workspace-selectors')>()),
  selectWorkspaceById: Object.assign(() => ({ value: { worktreePath: access.root } }), {
    select: () => ({ worktreePath: access.root }),
  }),
}));
it.each([
  'control',
  'unmount',
  'principal-before',
  'principal-pending',
  'root-before',
  'root-pending',
  'route-superseded',
  'second-click',
])('fences async message navigation on %s', async (mode) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  access.authority = 'test-admission';
  access.root = '/original';
  const dispose = store.init();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const workspaceId = WorkspaceId('message-return-workspace'),
    agentId = AgentId('message-return-agent');
  const href = 'intent://local/message-return-workspace/agent/other-agent/message/exact-target';
  const message: AgentMessage = {
    id: 'clicked-source',
    role: 'user',
    timestamp: '2026-10-15T00:00:00Z',
    contentBlocks: [{ type: 'text', text: `Open ${href}. Next ${href}-new.` }],
  };
  let resolveReplace!: () => void;
  const replaced = new Promise<void>((resolve) => {
    resolveReplace = resolve;
  });
  navigate.mockReset();
  route.location.search = {
    agent: agentId,
    message: 'unrelated-route-target',
    homeQuery: 'kept',
  };
  navigate.mockImplementation(async (options) => {
    if (options.replace) {
      route.location.search = options.search(route.location.search);
      await replaced;
    }
  });
  let mounted = true;
  try {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          workspaceId,
          backendSessionId: null,
          name: 'Return',
          status: AgentStatus.Active,
          messages: [message],
          createdAt: message.timestamp,
          updatedAt: message.timestamp,
        },
      ]),
    );
    store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
    store.dispatch(chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 1 }));
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    store.dispatch(transcriptHydrationSettled(agentId));
    await act(async () =>
      root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
    );
    const link = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
    expect(link).not.toBeNull();
    if (mode === 'principal-before') access.authority = 'replacement-principal';
    if (mode === 'root-before') access.root = '/replacement';
    await act(async () => link!.click());
    if (mode.endsWith('-before')) {
      expect(navigate).not.toHaveBeenCalled();
      return;
    }
    expect(navigate).toHaveBeenCalledOnce();
    const source = navigate.mock.calls[0][0];
    expect(source.replace).toBe(true);
    expect(source.resetScroll).toBe(false);
    expect(route.location.search).toEqual({
      agent: agentId,
      message: message.id,
      homeQuery: 'kept',
    });
    expect(source.state({}).messageReturn).toMatchObject({
      workspaceId,
      agentId,
      messageId: message.id,
      authority: 'test-admission',
    });
    if (mode === 'principal-pending') access.authority = 'replacement-principal';
    if (mode === 'root-pending') access.root = '/replacement';
    if (mode === 'route-superseded')
      route.location.search = { agent: agentId, message: 'new-user-navigation' };
    if (mode === 'second-click')
      await act(async () =>
        host.querySelector<HTMLAnchorElement>(`a[href="${href}-new"]`)!.click(),
      );
    if (mode === 'unmount') {
      await act(async () => root.unmount());
      mounted = false;
    }
    await act(async () => {
      resolveReplace();
      await replaced;
    });
    expect(navigate).toHaveBeenCalledTimes(
      mode === 'control' ? 2 : mode === 'second-click' ? 3 : 1,
    );
    if (mode === 'control')
      expect(navigate.mock.calls[1][0]).toMatchObject({
        params: { workspaceId },
        search: { agent: 'other-agent', message: 'exact-target' },
      });
    if (mode === 'second-click')
      expect(navigate.mock.calls.at(-1)![0].search).toEqual({
        agent: 'other-agent',
        message: 'exact-target-new',
      });
  } finally {
    if (mounted) await act(async () => root.unmount());
    host.remove();
    dispose();
    navigate.mockReset();
    access.authority = 'test-admission';
    access.root = '/original';
    vi.unstubAllGlobals();
  }
});

it.each([
  'confirmed',
  'denied',
  'unavailable',
  'principal-before',
  'root-before',
  'removed-before',
  'route-before',
  'principal-pending',
  'unmount-pending',
  'replacement-pending',
])('copies only the admitted persisted owning message: %s', async (mode) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  access.authority = 'copy-authority';
  access.root = '/copy-root';
  const dispose = store.init();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const workspaceId = WorkspaceId('copy-workspace'),
    agentId = AgentId('owning-conversation');
  route.location.search = { agent: agentId, message: 'unrelated-route-target' };
  const message: AgentMessage = {
    id: 'persisted-message',
    agentId: AgentId('sender-is-not-owner'),
    seq: 7,
    role: 'user',
    timestamp: '2026-10-15T00:00:00Z',
    contentBlocks: [{ type: 'text', text: 'Persisted content' }],
  };
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const writeText = vi.fn(() => pending);
  const preload = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: mode === 'unavailable' ? undefined : { writeText },
  });
  try {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          workspaceId,
          backendSessionId: null,
          name: 'Copy',
          status: AgentStatus.Active,
          messages: [
            message,
            { ...message, id: 'optimistic', seq: undefined },
            { ...message, id: 'provisional', provisional: true },
            { ...message, id: 'system', role: 'system' },
          ],
          createdAt: message.timestamp,
          updatedAt: message.timestamp,
        },
      ]),
    );
    store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
    store.dispatch(chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 4 }));
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    store.dispatch(transcriptHydrationSettled(agentId));
    await act(async () =>
      root.render(
        <WorkspaceConversation
          workspaceId={workspaceId}
          agentId={agentId}
          messageId="unrelated-route-target"
        />,
      ),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.includes('Copy message link'),
    );
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    if (mode === 'principal-before') access.authority = 'other';
    if (mode === 'root-before') access.root = '/other';
    if (mode === 'route-before') route.location.search = {};
    await act(async () => {
      if (mode === 'removed-before') store.dispatch(replaceMessages(agentId, []));
      button.click();
      button.click();
    });
    if (mode.endsWith('-before')) {
      expect(writeText).not.toHaveBeenCalled();
      return;
    }
    if (mode === 'unavailable') {
      expect(host.textContent).toContain('Could not copy.');
      return;
    }
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'intent://local/copy-workspace/agent/owning-conversation/message/persisted-message',
    );
    expect(host.textContent).not.toContain('Message link copied');
    if (mode === 'principal-pending') access.authority = 'other';
    if (mode === 'replacement-pending') {
      access.authority = 'new-authority';
      await act(async () =>
        root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
      );
    }
    if (mode === 'unmount-pending') {
      await act(async () => root.unmount());
      mounted = false;
    }
    await act(async () => {
      if (mode === 'denied') reject(new Error('NotAllowedError'));
      else resolve();
      await pending.catch(() => {});
    });
    if (mode === 'denied') {
      expect(host.textContent).toContain('Could not copy.');
      writeText.mockResolvedValueOnce();
      await act(async () => button.click());
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain('Message link copied');
    } else if (mode === 'confirmed') expect(host.textContent).toContain('Message link copied');
    else expect(host.textContent).not.toContain('Message link copied');
  } finally {
    if (mounted) await act(async () => root.unmount());
    host.remove();
    dispose();
    if (preload) Object.defineProperty(window, 'electronAPI', preload);
    else Reflect.deleteProperty(window, 'electronAPI');
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    access.authority = 'test-admission';
    access.root = '/original';
    vi.unstubAllGlobals();
  }
});

it.each([
  'confirmed',
  'denied',
  'unavailable',
  'principal-before',
  'root-before',
  'removed-before',
  'route-before',
  'principal-pending',
  'unmount-pending',
  'replacement-pending',
  'newer-before',
  'newer-pending',
  'partial-before',
])('copies current complete text with exact acknowledgement: %s', async (mode) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  access.authority = 'copy-authority';
  access.root = '/copy-root';
  const dispose = store.init();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounted = true;
  const workspaceId = WorkspaceId('copy-workspace'),
    agentId = AgentId('owning-conversation');
  route.location.search = { agent: agentId, message: 'unrelated-route-target' };
  const message: AgentMessage = {
    id: 'persisted-message',
    agentId: AgentId('sender-is-not-owner'),
    seq: 7,
    role: 'user',
    timestamp: '2026-10-15T00:00:00Z',
    contentBlocks: [{ type: 'text', text: 'Persisted content' }],
  };
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const writeText = vi.fn(() => pending);
  const preload = Object.getOwnPropertyDescriptor(window, 'electronAPI');
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: mode === 'unavailable' ? undefined : { writeText },
  });
  try {
    store.dispatch(
      bulkUpsertSessions([
        {
          id: agentId,
          workspaceId,
          backendSessionId: null,
          name: 'Copy',
          status: AgentStatus.Active,
          messages: [
            message,
            { ...message, id: 'optimistic', seq: undefined },
            { ...message, id: 'provisional', provisional: true },
            { ...message, id: 'system', role: 'system' },
          ],
          createdAt: message.timestamp,
          updatedAt: message.timestamp,
        },
      ]),
    );
    store.dispatch(chatTrackedWorkspaceSet(agentId, workspaceId));
    store.dispatch(chatTranscriptSnapshotApplied(agentId, { truncated: false, totalMessages: 4 }));
    store.dispatch(chatLiveStreamPhaseChanged(agentId, 'live'));
    store.dispatch(transcriptHydrationSettled(agentId));
    await act(async () =>
      root.render(
        <WorkspaceConversation
          workspaceId={workspaceId}
          agentId={agentId}
          messageId="unrelated-route-target"
        />,
      ),
    );
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
      b.textContent?.includes('Copy text'),
    );
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    if (mode === 'principal-before') access.authority = 'other';
    if (mode === 'root-before') access.root = '/other';
    if (mode === 'route-before') route.location.search = {};
    await act(async () => {
      if (mode === 'newer-before')
        store.dispatch(
          replaceMessages(agentId, [
            {
              ...message,
              contentBlocks: [
                { type: 'text', text: 'New canonical text 👩‍💻\n\n```ts\nnewText()\n```\n' },
              ],
            },
          ]),
        );
      if (mode === 'partial-before')
        store.dispatch(replaceMessages(agentId, [{ ...message, isStreaming: true }]));
      if (mode === 'removed-before') store.dispatch(replaceMessages(agentId, []));
      button.click();
      button.click();
    });
    if (mode.endsWith('-before') && mode !== 'newer-before') {
      expect(writeText).not.toHaveBeenCalled();
      return;
    }
    if (mode === 'unavailable') {
      expect(host.textContent).toContain('Could not copy.');
      return;
    }
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      mode === 'newer-before'
        ? 'New canonical text 👩‍💻\n\n```ts\nnewText()\n```\n'
        : 'Persisted content',
    );
    expect(host.textContent).not.toContain('Message text copied');
    if (mode === 'newer-pending')
      await act(async () => {
        store.dispatch(
          replaceMessages(agentId, [
            { ...message, contentBlocks: [{ type: 'text', text: 'Replacement canonical body' }] },
          ]),
        );
      });
    if (mode === 'principal-pending') access.authority = 'other';
    if (mode === 'replacement-pending') {
      access.authority = 'new-authority';
      await act(async () =>
        root.render(<WorkspaceConversation workspaceId={workspaceId} agentId={agentId} />),
      );
    }
    if (mode === 'unmount-pending') {
      await act(async () => root.unmount());
      mounted = false;
    }
    await act(async () => {
      if (mode === 'denied') reject(new Error('NotAllowedError'));
      else resolve();
      await pending.catch(() => {});
    });
    if (mode === 'denied') {
      expect(host.textContent).toContain('Could not copy.');
      writeText.mockResolvedValueOnce();
      await act(async () => button.click());
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain('Message text copied');
    } else if (mode === 'confirmed' || mode === 'newer-before')
      expect(host.textContent).toContain('Message text copied');
    else expect(host.textContent).not.toContain('Message text copied');
  } finally {
    if (mounted) await act(async () => root.unmount());
    host.remove();
    dispose();
    if (preload) Object.defineProperty(window, 'electronAPI', preload);
    else Reflect.deleteProperty(window, 'electronAPI');
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
    access.authority = 'test-admission';
    access.root = '/original';
    vi.unstubAllGlobals();
  }
});

it('renders the same legacy and context-stripped user bytes offered by Copy text', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { WorkspaceConversationMessage } = await import('./workspace-conversation-message');
  const { getCopyableMessageText } = await import('./message-copy-text');
  const body = '\n\n  Visible legacy body Ω\n';
  const message: AgentMessage = {
    id: 'legacy-persisted',
    role: 'user',
    seq: 3,
    timestamp: '2026-10-15',
    contentBlocks: [{ type: 'text', content: '[Currently viewing note: Plan]\n\n' + body }],
  };
  const presented: ContentBlock[] = [];
  renderToStaticMarkup(
    <WorkspaceConversationMessage
      message={message}
      workspaceId="copy-workspace"
      navigation={{
        workspaceContext: { workspaceId: WorkspaceId('copy-workspace') },
        onOpenLink: vi.fn(() => false),
        onOpenFile: vi.fn(),
        onOpenNote: vi.fn(),
      }}
      onOpenAgent={vi.fn()}
      renderContent={(blocks) => {
        presented.push(...blocks);
        return null;
      }}
    />,
  );
  expect(
    presented
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? block.content ?? '')
      .join(''),
  ).toBe(body);
  expect(getCopyableMessageText(message)).toBe(body);
});
