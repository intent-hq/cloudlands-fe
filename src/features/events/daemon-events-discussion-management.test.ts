/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import type { DiscussionConversation } from '$shared/types/workspace-discussion';
import { admitLegacyPrincipal } from '@/test/fixtures/principal-state';
import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionManagementCapabilityReceived,
} from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
import {
  selectDiscussionContext,
  selectDiscussionOwner,
  selectDiscussionConversations,
} from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
import { __resetDaemonEventsBridgeForTests } from './daemon-events-bridge.client';
import { installMockBackend, resetMockBackend } from '@/test/mocks/backend-transport.mock';

vi.mock(
  '$lib/client/live/backend-transport',
  async () => (await import('@/test/mocks/backend-transport.mock')).mockBackendTransportModule,
);

let dispose: (() => void) | undefined;
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  dispose?.();
  resetMockBackend();
  __resetDaemonEventsBridgeForTests();
});

it('delivers remote discussion creation, rename and deletion through the subscribed event filter', async () => {
  const backend = installMockBackend();
  backend.onSubscribe(() => ({ subscriptionId: 'discussion-management-sub' }));
  dispose = store.init();
  __resetDaemonEventsBridgeForTests();
  stop = store.runSaga(daemonEventsSaga);
  await waitFor(() => expect(backend.subscribes).toHaveLength(1));
  await waitFor(() => expect(store.state.workspaceEvents.subscriptionPending).toBe(false));
  store.dispatch(setLabsMultiplayerEnabled(true));
  admitLegacyPrincipal();
  store.dispatch(replaceWorkspaceList([{ id: WorkspaceId('ws') }] as Workspace[]));
  const context = selectDiscussionContext.select(store.state)!;
  store.dispatch(discussionContextChanged(context, selectDiscussionOwner.select(store.state)));
  store.dispatch(discussionWorkspacesChanged(['ws']));
  store.dispatch(discussionManagementCapabilityReceived(context, true));

  const conversation: DiscussionConversation = {
    id: 'remote-discussion',
    workspaceId: 'ws',
    kind: 'workspace',
    name: 'Design',
    participants: [],
    createdAt: '2026-10-23T21:00:00Z',
  };
  const deliver = (type: string, row?: DiscussionConversation) => {
    // The daemon filters before delivery: test the actual subscribe request,
    // not a direct router call that would bypass missing subscriptions.
    const subscribed = backend.subscribes.some((params) =>
      (params as { eventTypes: string[] }).eventTypes.some(
        (pattern) =>
          pattern === type || (pattern.endsWith(':*') && type.startsWith(pattern.slice(0, -1))),
      ),
    );
    if (!subscribed) return;
    backend.pushEvent({
      type,
      workspaceId: 'ws',
      subscriptionId: 'discussion-management-sub',
      data: {
        workspaceId: 'ws',
        conversationId: conversation.id,
        ...(row ? { conversation: row } : {}),
      },
    });
  };
  const current = () => selectDiscussionConversations.select(store.state, 'ws');
  deliver('discussion:created', conversation);
  await waitFor(() => expect(current()).toEqual([conversation]));
  const renamed = { ...conversation, name: 'Release planning' };
  deliver('discussion:updated', renamed);
  await waitFor(() => expect(current()).toEqual([renamed]));
  deliver('discussion:deleted');
  await waitFor(() => expect(current()).toEqual([]));
  expect(store.state.workspaceDiscussion.deletedKeys).toContain(
    JSON.stringify(['ws', conversation.id]),
  );
});
