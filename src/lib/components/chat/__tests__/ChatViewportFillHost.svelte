<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import ChatPanel from '../ChatPanel.svelte';
  import { seekConversationToMessage } from '$lib/utils/open-message';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import type { AgentMessage, AgentSession, Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { startChatFixtureSagas } from '../../../../test/chat-fixture-sagas';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    replaceMessages,
    updateMessage,
    seedHistoryAround,
    setHistoryOldestReached,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    chatTranscriptSnapshotApplied,
    transcriptHydrationSettled,
    scrollbackSeekSettled,
  } from '$store/renderer/slices/chat-state/chat-state-slice';
  // eslint-disable-next-line themis/forbidden-component-import -- CT exercises the production subscription owner.
  import { chatSubscribeSaga } from '$store/renderer/slices/chat-state/sagas/chat-subscribe-saga';
  // eslint-disable-next-line themis/forbidden-component-import -- CT exercises production hydration completion.
  import { chatReadSaga } from '$store/renderer/slices/chat-state/sagas/chat-read-saga';
  // eslint-disable-next-line themis/forbidden-component-import -- CT runs the real paging owner against the scripted wire.
  import { chatScrollbackSaga } from '$store/renderer/slices/chat-state/sagas/chat-scrollback-saga';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../test/ct-mock-electron-bridge';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';

  let {
    progressive,
    received = 1,
    complete = false,
    height = 900,
    active = true,
    agent = 'primary',
    scenario = 'short',
    compact = false,
    retained = false,
    refreshSnapshot = false,
    controlled = false,
    releasedPages = 0,
    expanded = false,
  }: {
    progressive?: number;
    received?: number;
    complete?: boolean;
    height?: number;
    active?: boolean;
    agent?: string;
    scenario?:
      | 'short'
      | 'large'
      | 'filtered'
      | 'error'
      | 'stalled'
      | 'exhausted'
      | 'gap-error-once'
      | 'gap-error'
      | 'gap-stalled'
      | 'seek';
    expanded?: boolean;
    controlled?: boolean;
    releasedPages?: number;
    refreshSnapshot?: boolean;
    retained?: boolean;
    compact?: boolean;
  } = $props();
  const fixture = untrack(() => scenario);
  const forwardGap = fixture.startsWith('gap-');
  // One missing row lets a five-row inclusive fallback overlap the tail
  // and close the gap with exactly one successful retry.
  const progressiveTotal = untrack(() => progressive);
  const total =
    progressiveTotal ??
    (forwardGap ? 11 : fixture === 'seek' ? 1000 : fixture === 'exhausted' ? 8 : 100);
  const initialCount = progressiveTotal !== undefined ? 0 : untrack(() => retained) ? 40 : 5;
  const timestamp = '2026-09-01T00:00:00.000Z';
  const workspace = {
    id: WorkspaceId('viewport-fill'),
    title: 'Viewport fill',
    branch: 'test',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    path: '/tmp/viewport-fill',
    status: WorkspaceStatus.Active,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as Workspace;
  let requests = $state<
    {
      agentId: string;
      limit: number;
      nextToken?: string;
      aroundMessageId?: string;
      placeholders: number;
    }[]
  >([]);
  const pendingPages: (() => void)[] = [];
  $effect(() => {
    for (let i = 0; i < releasedPages; i++) pendingPages[i]?.();
  });
  let inFlight = 0;
  let maxInFlight = $state(0);
  const message = (index: number, large = false): AgentMessage =>
    ({
      id: `m-${index}`,
      ...(fixture === 'seek' || progressiveTotal !== undefined ? { seq: index } : {}),
      role: index % 2 ? 'assistant' : 'user',
      timestamp: new Date(Date.parse(timestamp) + index * 1000).toISOString(),
      contentBlocks: [
        {
          type: 'text',
          text: large
            ? Array.from({ length: 90 }, (_, i) => `Long message line ${i}.`).join('\n\n')
            : `Message ${index}.`,
        },
      ],
    }) as AgentMessage;
  let subscribed = $state(false);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT serves scripted wire responses; the production saga owns every request.
  installMockElectronBridge({
    'agent.get': (input) =>
      store.state.agentSessions.byAgentId[(input as { agentId: string }).agentId],
    'chat.subscribe': () => {
      subscribed = true;
      return { subscriptionId: 'progressive-initial' };
    },
    'chat.unsubscribe': () => ({}),
    'agent.getQueue': () => ({ success: true, queue: [] }),
    'agent.getConversation': async (input) => {
      const params = input as {
        agentId: string;
        limit: number;
        nextToken?: string;
        aroundMessageId?: string;
      };
      requests = [
        ...requests,
        {
          ...params,
          placeholders: document.querySelectorAll('[data-lazy-visible="false"]').length,
        },
      ];
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      if (controlled) {
        await new Promise<void>((resolve) => {
          pendingPages.push(resolve);
          if (pendingPages.length <= releasedPages) resolve();
        });
      } else await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      if (fixture === 'seek') {
        const anchor = Number(params.aroundMessageId?.replace('m-', ''));
        const start = params.nextToken?.startsWith('before-')
          ? Math.max(0, Number(params.nextToken.slice(7)) - params.limit)
          : params.nextToken?.startsWith('after-')
            ? Number(params.nextToken.slice(6)) + 1
            : Math.max(0, anchor - 2);
        const end = Math.min(total, start + params.limit);
        return {
          messages: Array.from({ length: end - start }, (_, i) => message(start + i)),
          totalMessages: total,
          truncated: start > 0,
          nextToken: start ? `before-${start}` : null,
          prevToken: end < total ? `after-${end - 1}` : null,
        };
      }
      if (forwardGap) {
        if (fixture === 'gap-error' || (fixture === 'gap-error-once' && requests.length === 1)) {
          throw new Error('Forward paging fixture failure');
        }
        const start = params.nextToken
          ? Number(params.nextToken.replace('after-', '')) + 1
          : Math.max(0, Number(params.aroundMessageId?.replace('m-', '')) - 2);
        const end = Math.min(total, start + params.limit);
        return {
          messages:
            fixture === 'gap-stalled'
              ? []
              : Array.from({ length: end - start }, (_, i) => message(start + i)),
          totalMessages: total,
          truncated: start > 0,
          nextToken: start ? `before-${start}` : null,
          prevToken:
            fixture === 'gap-stalled' ? params.nextToken : end < total ? `after-${end - 1}` : null,
        };
      }
      if (fixture === 'error') throw new Error('Paging fixture failure');
      const end = Number(params.nextToken?.replace('before-', '') ?? total - initialCount);
      const start = Math.max(0, end - params.limit);
      const messages =
        fixture === 'filtered' && end > 80
          ? []
          : Array.from({ length: end - start }, (_, i) => message(start + i));
      return {
        messages,
        totalMessages: total,
        truncated: start > 0,
        nextToken: fixture === 'stalled' ? params.nextToken : start ? `before-${start}` : null,
        prevToken: `after-${end - 1}`,
      };
    },
  });
  let notify: ((value: unknown) => void) | undefined;
  if (progressiveTotal !== undefined) {
    const api = window.electronAPI!;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Test fixture captures the notification transport, not domain data.
    const originalOn = api.on.bind(api);
    api.on = (channel, handler) => {
      if (channel === 'backend:notification') notify = handler;
      return originalOn(channel, handler);
    };
  }
  const dispose = startRootStoreLifecycle(store, {
    startSagas: () => [
      ...startChatFixtureSagas(store),
      store.runSaga(chatScrollbackSaga),
      ...(progressiveTotal !== undefined
        ? [store.runSaga(chatSubscribeSaga), store.runSaga(chatReadSaga)]
        : []),
    ],
  });
  admitLegacyPrincipal();
  store.dispatch(setWorkspaceEntity(workspace));
  for (const id of ['primary', 'secondary']) {
    store.dispatch(
      bulkUpsertSessions([
        {
          id,
          workspaceId: workspace.id,
          name: id,
          status: 'idle',
          messages: Array.from({ length: initialCount }, (_, i) =>
            message(total - initialCount + i, fixture === 'large' || fixture === 'seek'),
          ),
          createdAt: timestamp,
          updatedAt: timestamp,
        } as AgentSession,
      ]),
    );
    if (progressiveTotal !== undefined) continue;
    store.dispatch(
      chatTranscriptSnapshotApplied(id, {
        truncated: true,
        totalMessages: total,
        oldestMessageId: `m-${total - initialCount}`,
        nextToken: `before-${total - initialCount}`,
      }),
    );
    if (forwardGap) {
      store.dispatch(
        seedHistoryAround(
          id,
          Array.from({ length: 5 }, (_, i) => message(i)),
          0,
        ),
      );
      store.dispatch(setHistoryOldestReached(id));
      store.dispatch(scrollbackSeekSettled(id, { nextToken: null, prevToken: 'after-4' }, false));
    }
    store.dispatch(transcriptHydrationSettled(id));
  }
  let sent = -1;
  let sequence = 0;
  let finished = false;
  $effect(() => {
    if (progressiveTotal === undefined || !subscribed) return;
    const count = Math.min(received, progressiveTotal, 20);
    const finish = complete;
    untrack(() => {
      const push = (kind: string, payload: object) =>
        notify?.({
          method: 'subscription.push',
          params: {
            subscriptionId: 'progressive-initial',
            kind,
            seq: sequence++,
            [kind]: payload,
          },
        });
      if (sent === -1) {
        if (total === 0 && !finish) return;
        sent = count > 0 ? 1 : 0;
        push('snapshot', {
          agentId: 'primary',
          messages: sent ? [message(total - 1)] : [],
          totalMessages: total,
          historyDelivery: 'progressive',
          initialHistory: { target: 20, received: sent, complete: total === 0 },
          ...(total === 0 ? { nextToken: null, truncated: false } : {}),
        });
      }
      if (total === 0) finished = true;
      while (sent < count) {
        sent++;
        push('history', {
          message: message(total - sent),
          target: 20,
          received: sent,
          complete: false,
        });
      }
      if (finish && !finished) {
        finished = true;
        push('history', {
          target: 20,
          received: sent,
          complete: true,
          totalMessages: total,
          truncated: total > sent,
          nextToken: total > sent ? `before-${total - sent}` : null,
        });
      }
    });
  });
  $effect(() => {
    if (!compact) return;
    untrack(() =>
      store.dispatch(
        replaceMessages(
          'primary',
          Array.from({ length: 5 }, (_, i) => message(95 + i)),
        ),
      ),
    );
  });
  $effect(() => {
    if (!refreshSnapshot) return;
    untrack(() =>
      store.dispatch(
        chatTranscriptSnapshotApplied('primary', {
          truncated: true,
          totalMessages: total,
          oldestMessageId: `m-${total - initialCount}`,
          nextToken: `before-${total - initialCount}`,
        }),
      ),
    );
  });
  $effect(() => {
    if (!expanded) return;
    untrack(() =>
      store.dispatch(updateMessage('primary', `m-${total - 3}`, message(total - 3, true))),
    );
  });
  async function seekMiddle() {
    if (await seekConversationToMessage('primary', 'm-500', workspace.id)) {
      dispatchWindowEvent('chat:open-message', {
        agentId: 'primary',
        messageId: 'm-500',
        requestId: 'seek-middle',
      });
    }
  }
  onDestroy(dispose);
</script>

{#if fixture === 'seek'}
  <button data-testid="seek-middle" onclick={seekMiddle}>Open message 500</button>
{/if}
<div style:height="{height}px" style:width="640px" data-testid="fill-host">
  <ChatPanel {workspace} agentId={agent} isActive={active} />
</div>
<output data-testid="requests">{JSON.stringify({ requests, maxInFlight })}</output>
