<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    narrow?: boolean;
    state?: 'ready' | 'empty' | 'loading' | 'error' | 'send-error' | 'history' | 'typing';
  }
  export const preview = definePreview<Props>({
    id: 'workspace-discussion',
    title: 'Workspace discussion',
    defaultState: 'workspace',
    states: {
      workspace: { props: {} },
      narrow: { props: { narrow: true } },
      typing: { props: { state: 'typing' } },
      'typing-narrow': { props: { narrow: true, state: 'typing' } },
      empty: { props: { narrow: true, state: 'empty' } },
      loading: { props: { narrow: true, state: 'loading' } },
      error: { props: { narrow: true, state: 'error' } },
      'send-error': { props: { narrow: true, state: 'send-error' } },
      history: { props: { narrow: true, state: 'history' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { faComment } from '@fortawesome/free-regular-svg-icons';
  import { ContentHeader } from '$features/layout/components/content-header';
  import { presenceTypingLabel } from '$features/presence/components/presence-person';
  import PeoplePreview from '$features/presence/components/workspace-people-tile.preview.svelte';
  import { store } from '$store/renderer/store';
  import {
    initializeLayout,
    clearPanelLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import DiscussionThread from './DiscussionThread.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { narrow = false, state: previewState = 'ready' }: Props = $props();
  const workspaceId = 'people-tile-preview';
  const authors = [
    {
      principalId: 'person-0',
      displayName: 'Sam',
      login: 'sam',
      avatarUrl: 'https://avatars.githubusercontent.com/u/84644?v=4',
    },
    {
      principalId: 'person-1',
      displayName: 'Luke',
      login: 'luke',
      avatarUrl: 'https://avatars.githubusercontent.com/u/296156?v=4',
    },
    { principalId: 'person-2', displayName: 'Morgan', login: 'morgan', avatarUrl: null },
  ];
  const bodies = [
    'I’ve added the first pass of the People sidebar. What do you think?',
    'Looks good. Can we keep the discussion next to the activity while we review?',
    'Yes, that makes it easier to follow along. I’ll check the narrow layout too.',
    'Nice. Let’s keep this first version simple: one conversation for everyone in the workspace.',
    'Agreed. I’ll try it with a second window and check that the messages arrive.',
  ];
  let messages = $state<DiscussionMessage[]>([]);
  let draft = $state('');
  let error = $state<string | null>(null);
  let sendError = $state<string | null>(null);
  let initialized = $state(true);
  let hasMore = $state(false);
  untrack(() => {
    initialized = previewState !== 'loading';
    error = previewState === 'error' ? m.workspace_discussion_load_error() : null;
    sendError = previewState === 'send-error' ? m.workspace_discussion_send_error() : null;
    draft = previewState === 'send-error' ? 'I’ll check the keyboard shortcuts next.' : '';
    hasMore = previewState === 'history';
    if (!['loading', 'error', 'empty'].includes(previewState)) {
      messages = bodies.map((body, index) => ({
        id: `discussion-${index}`,
        workspaceId,
        sequence: index + 11,
        body,
        author: authors[index % authors.length],
        createdAt: `2026-10-14T10:${String(30 + index * 2).padStart(2, '0')}:00Z`,
      }));
    }
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'discussion-preview' },
        focusedPanelId: 'discussion-preview',
        panels: {
          'discussion-preview': {
            id: 'discussion-preview',
            activeTabId: 'discussion-preview-tab',
            tabs: [
              {
                id: 'discussion-preview-tab',
                type: 'discussion',
                title: m.workspace_discussion_title(),
                workspaceId,
                closable: true,
              },
            ],
          },
        },
      }),
    );
  });
  function send() {
    messages = [
      ...messages,
      {
        id: crypto.randomUUID(),
        workspaceId,
        sequence: (messages.at(-1)?.sequence ?? 0) + 1,
        body: draft,
        author: authors[0],
        createdAt: '2026-10-14T10:42:00Z',
      },
    ];
    draft = '';
    sendError = null;
  }
  function loadOlder() {
    messages = [
      {
        id: 'older-discussion',
        workspaceId,
        sequence: 1,
        body: 'I’ve put the reference in the spec so we can compare it as we go.',
        author: authors[1],
        createdAt: '2026-10-14T10:20:00Z',
      },
      ...messages,
    ];
    hasMore = false;
  }
  onDestroy(() => store.dispatch(clearPanelLayout(workspaceId)));
</script>

<div
  class="flex h-[780px] w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background"
  class:max-w-[390px]={narrow}
  data-discussion-preview
>
  {#if !narrow}
    <aside class="w-[320px] shrink-0 overflow-hidden border-r border-border bg-sidebar">
      <PeoplePreview sidebar expanded />
    </aside>
  {/if}
  <section class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <ContentHeader title={m.workspace_discussion_title()} icon={faComment} />
    <div class="min-h-0 flex-1">
      <DiscussionThread
        {messages}
        {draft}
        typingLabel={previewState === 'typing' ? presenceTypingLabel(authors.slice(1)) : null}
        {initialized}
        loading={!initialized}
        {hasMore}
        {error}
        {sendError}
        onDraftChange={(value) => {
          draft = value;
        }}
        onSend={send}
        onLoadOlder={loadOlder}
        onRetry={() => {
          error = null;
        }}
      />
    </div>
  </section>
</div>
