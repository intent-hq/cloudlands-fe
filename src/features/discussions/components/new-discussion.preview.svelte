<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    narrow?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'new-discussion',
    title: 'New discussion',
    defaultState: 'empty',
    states: {
      empty: { props: {} },
      narrow: { props: { narrow: true } },
    },
  });
</script>

<script lang="ts">
  import { faComment } from '@fortawesome/free-regular-svg-icons';
  import { ContentHeader } from '$features/layout/components/content-header';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import DiscussionThread from './DiscussionThread.svelte';
  let { narrow = false }: Props = $props();
  let draft = $state('');
  let messages = $state<DiscussionMessage[]>([]);
  let sent = $state(false);
  function send() {
    messages = [
      {
        id: 'first-message',
        workspaceId: 'preview',
        sequence: 1,
        body: draft,
        author: { principalId: 'sam', displayName: 'Sam', login: 'sam', avatarUrl: null },
        createdAt: '2026-10-16T10:42:00Z',
      },
    ];
    sent = true;
    draft = '';
  }
</script>

<div
  class="flex h-[780px] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background"
  class:max-w-[390px]={narrow}
  data-new-discussion-preview
>
  <ContentHeader
    title={sent ? m.workspace_discussion_conversation_title() : m.workspace_discussion_new_title()}
    icon={faComment}
  />
  <div class="min-h-0 flex-1">
    <DiscussionThread
      {messages}
      {draft}
      focusComposer={false}
      showEmptyState={false}
      canCompose
      canSend
      onDraftChange={(value) => (draft = value)}
      onSend={send}
      onRetry={() => {}}
      onLoadOlder={() => {}}
    >
      {#snippet header()}
        {#if !sent}
          <p class="px-4 py-3 type-caption text-muted-foreground" data-discussion-audience>
            {m.workspace_discussion_everyone_label()}
          </p>
        {/if}
      {/snippet}
    </DiscussionThread>
  </div>
</div>
