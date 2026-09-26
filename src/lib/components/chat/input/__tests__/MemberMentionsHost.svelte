<script lang="ts">
  import { onMount } from 'svelte';
  import SimpleRichInput from '../SimpleRichInput.svelte';
  import ChatMessage from '../../ChatMessage.svelte';
  import Comment from '$lib/components/tiptap/comments/Comment.svelte';
  import { Button } from '$lib/components/ui/button';
  import type { Workspace, AgentMessage } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import { store } from '$store/renderer/store';
  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  // eslint-disable-next-line themis/forbidden-component-import -- Isolated fixture runs the production membership lifecycle against a mock transport.
  import { presenceSaga } from '$store/renderer/slices/presence/sagas/presence-saga';
  import { presenceReset } from '$store/renderer/slices/presence/presence-slice';
  import { selectWorkspaceMentionMembers } from '$store/renderer/slices/presence/presence-selectors';
  import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { installMockElectronBridge } from '../../../../../test/ct-mock-electron-bridge';
  import { loadCommentsAction } from '$store/renderer/slices/comments/comments-slice';
  import { selectCommentById } from '$store/renderer/slices/comments/comments-selectors';
  import type { CommentV2 } from '$features/comments/comment-types-v2';
  import type { ContextItem } from '../context-api';

  const workspace = {
    id: WorkspaceId('member-mentions-workspace'),
    title: 'Member mentions',
    memberCount: 5,
    myRole: 'owner',
    ownerPrincipalId: 'self',
  } as Workspace;
  const members: WorkspaceMember[] = [
    {
      principalId: 'self',
      login: 'viewer',
      displayName: 'Viewer',
      avatarUrl: null,
      role: 'owner',
      addedAt: '2026-09-01T00:00:00Z',
      identity: { provider: 'github', host: 'github.com', externalUserId: '1' },
    },
    {
      principalId: 'github-alex',
      login: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
      role: 'collaborator',
      addedAt: '2026-09-01T00:00:00Z',
      identity: { provider: 'github', host: 'github.com', externalUserId: '42' },
    },
    {
      principalId: 'gitlab-alex',
      login: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
      role: 'collaborator',
      addedAt: '2026-09-01T00:00:00Z',
      identity: { provider: 'gitlab', host: 'code.example:8443', externalUserId: '42' },
    },
    {
      principalId: 'gitlab-alice',
      login: 'alice.dev_ops-team',
      displayName: 'Alice',
      avatarUrl: null,
      role: 'collaborator',
      addedAt: '2026-09-01T00:00:00Z',
      identity: { provider: 'gitlab', host: 'gitlab.com', externalUserId: '73' },
    },
    {
      principalId: 'legacy',
      login: 'legacy.dev',
      displayName: null,
      avatarUrl: null,
      role: 'collaborator',
      addedAt: '2026-09-01T00:00:00Z',
    },
  ];
  let value = $state('');
  let draft = $state('');
  let generation = $state(0);
  let composer = $state<SimpleRichInput>();
  let submitted = $state('');
  let context = $state<ContextItem[]>([]);
  let requests = $state<{ method: string; params: unknown }[]>([]);
  const mentionMembers = selectWorkspaceMentionMembers(workspace.id);
  const savedComment = selectCommentById('member-comment');
  const message = $derived<AgentMessage>({
    id: 'member-message',
    role: 'user',
    timestamp: new Date('2026-09-01T00:00:00Z'),
    contentBlocks: [{ type: 'text', text: submitted }],
  });

  onMount(() => {
    const previousBridge = window.electronAPI;
    const response = (method: string, result: unknown) => (params: unknown) => {
      requests = [...requests, { method, params }];
      return result;
    };
    // Only transport is mocked: the production saga hydrates Redux and all mention providers run.
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Test fixture installs a mock transport; domain reads remain in production sagas/providers.
    installMockElectronBridge({
      'principal.me': response('principal.me', {
        id: 'self',
        login: 'viewer',
        displayName: 'Viewer',
        avatarUrl: null,
        isAdministrator: false,
        identity: members[0].identity,
      }),
      'workspace.members.list': response('workspace.members.list', {
        members,
        guestCount: 4,
        guestLimit: 5,
      }),
      'presence.snapshot': response('presence.snapshot', {
        workspaceId: workspace.id,
        members: [],
      }),
      'search.fileNames': response('search.fileNames', { files: [] }),
      'note.list': response('note.list', { notes: [] }),
    });
    store.dispatch(presenceReset());
    store.dispatch(replaceWorkspaceList([workspace]));
    store.dispatch(openWorkspaceTab(workspace.id));
    const cancel = store.runSaga(presenceSaga);
    store.dispatch(daemonEventsSubscribed());
    return () => {
      cancel();
      store.dispatch(presenceReset());
      window.electronAPI = previousBridge;
    };
  });

  function submit(text: string) {
    context = composer?.getMentionContextItems() ?? [];
    submitted = text;
    store.dispatch(
      loadCommentsAction([
        {
          id: 'member-comment',
          type: 'comment',
          author: 'Viewer',
          content: text,
          createdAt: '2026-09-01T00:00:00Z',
          status: 'open',
        } as CommentV2,
      ]),
    );
  }
</script>

<!-- i18n-ignore (isolated test fixture controls and synthetic data) -->
<div class="member-flow" data-testid="member-flow" data-ready={$mentionMembers.length === 4}>
  <div data-testid="composer">
    {#key generation}
      <SimpleRichInput bind:this={composer} bind:value {workspace} onsubmit={submit} />
    {/key}
  </div>
  <div class="flex gap-2">
    <Button
      variant="secondary"
      onclick={() => {
        draft = value;
        value = '';
        generation++;
      }}>Save draft and close</Button
    >
    <Button
      variant="secondary"
      onclick={() => {
        value = draft;
        generation++;
      }}>Restore draft</Button
    >
  </div>
  {#if submitted}
    <div data-testid="submitted-chat">
      <ChatMessage {message} {workspace} onEditSubmit={(text) => (submitted = text)} />
    </div>
    <div data-testid="submitted-comment">
      {#if $savedComment}<Comment comment={$savedComment} {workspace} />{/if}
    </div>
  {/if}
  <output hidden data-testid="stored-text">{submitted}</output>
  <output hidden data-testid="stored-comment">{$savedComment?.content ?? ''}</output>
  <output hidden data-testid="file-context">{JSON.stringify(context)}</output>
  <output hidden data-testid="wire-requests">{JSON.stringify(requests)}</output>
</div>

<style>
  .member-flow {
    display: grid;
    gap: var(--space-4);
    padding-top: 260px;
    width: 100%;
    min-width: 0;
  }
</style>
