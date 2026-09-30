<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch -- Test-only mock transport and event injection exercise production read services. */
  import { onMount } from 'svelte';
  import NoteWithComments from '../../NoteWithComments.svelte';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$store/renderer/store';
  import { selectComments } from '$store/renderer/slices/comments/comments-selectors';
  import { selectCommentAction } from '$store/renderer/slices/comments/comments-slice';
  import { applyCommentFromEvent } from '$features/comments/comments-read-service';
  import { installMockElectronBridge } from '../../../../../test/ct-mock-electron-bridge';
  import type { Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';

  let {
    second = false,
    noteId = 'spec',
    generation = 0,
  } = $props<{
    second?: boolean;
    noteId?: string;
    generation?: number;
  }>();
  let ready = $state(false);
  let requests = $state<unknown[]>([]);
  let updated = false;
  const comments = selectComments();
  const workspace = (id: string) => ({ id: WorkspaceId(id), title: id }) as Workspace;
  const firstWorkspace = workspace('isolation-a');
  const secondWorkspace = workspace('isolation-b');

  onMount(() => {
    const previous = window.electronAPI;
    installMockElectronBridge({
      'comment.list': (params) => {
        const request = params as { workspaceId: string; noteId: string };
        requests.push(request);
        const id = `${request.workspaceId}-${request.noteId}`;
        return {
          threads: [
            {
              id,
              comments: [
                {
                  id,
                  threadId: id,
                  noteId: request.noteId,
                  content:
                    updated && request.workspaceId === 'isolation-a'
                      ? 'Updated own comment'
                      : `Comment owned by ${id}`,
                  author: 'Reviewer',
                  authorType: 'user',
                  type: 'comment',
                  status: 'open',
                  section: 'Shared note text',
                  createdAt: '2026-09-30T00:00:00Z',
                  updatedAt: '2026-09-30T00:00:00Z',
                },
              ],
            },
          ],
        };
      },
      'principal.me': () => ({ id: 'reviewer' }),
      'note.presence.subscribe': () => ({ subscriptionId: 'test-presence' }),
      'note.presence.unsubscribe': () => ({}),
      'note.presence.update': () => ({}),
    });
    ready = true;
    return () => {
      window.electronAPI = previous;
    };
  });
</script>

<Button
  onclick={() => {
    updated = true;
    applyCommentFromEvent('isolation-a', 'spec', 'added');
  }}>Own event</Button
>
<Button onclick={() => applyCommentFromEvent('isolation-b', 'task', 'added')}>Foreign event</Button>
<Button onclick={() => applyCommentFromEvent('isolation-b', 'spec', 'added')}>Same ID event</Button>
<Button
  onclick={(event) => {
    event.stopPropagation();
    store.dispatch(selectCommentAction('isolation-a-spec'));
  }}>Select first</Button
>
<Button
  onclick={(event) => {
    event.stopPropagation();
    store.dispatch(selectCommentAction('isolation-b-spec'));
  }}>Select second</Button
>
<output data-testid="cached-comments"
  >{JSON.stringify($comments.map((comment) => comment.id))}</output
>
<output data-testid="requests">{JSON.stringify(requests)}</output>
{#if ready}
  {#key generation}
    <div data-testid="first-note" style="height: 600px; width: 1000px;">
      <NoteWithComments
        workspace={firstWorkspace}
        {noteId}
        content="Shared note text"
        editable={false}
        showComments={true}
        showSuggestions={false}
      />
    </div>
    {#if second}
      <div data-testid="second-note" style="height: 600px; width: 1000px;">
        <NoteWithComments
          workspace={secondWorkspace}
          noteId="spec"
          content="Shared note text"
          editable={false}
          showComments={true}
          showSuggestions={false}
        />
      </div>
    {/if}
  {/key}
{/if}
