<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    selected?: boolean;
    narrow?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'new-discussion',
    title: 'New discussion',
    defaultState: 'selected',
    states: {
      empty: { props: {} },
      selected: { props: { selected: true } },
      narrow: { props: { selected: true, narrow: true } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { faComment } from '@fortawesome/free-regular-svg-icons';
  import { ContentHeader } from '$features/layout/components/content-header';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import DiscussionRecipients from './DiscussionRecipients.svelte';
  import DiscussionThread from './DiscussionThread.svelte';
  let { selected = false, narrow = false }: Props = $props();
  const members = [
    { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null },
    { principalId: 'jordan', displayName: 'Jordan', login: 'jordan', avatarUrl: null },
    { principalId: 'morgan', displayName: 'Morgan', login: 'morgan', avatarUrl: null },
  ];
  let selectedIds = $state<string[]>(untrack(() => (selected ? ['alex', 'jordan'] : [])));
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
    title={sent
      ? selectedIds
          .map((id) => members.find((member) => member.principalId === id)?.displayName)
          .join(', ')
      : m.workspace_discussion_new_title()}
    icon={faComment}
  />
  <div class="min-h-0 flex-1">
    <DiscussionThread
      {messages}
      {draft}
      focusComposer={false}
      showEmptyState={false}
      canCompose
      canSend={selectedIds.length > 0}
      composerPlaceholder={m.workspace_discussion_selectedComposer_placeholder()}
      onDraftChange={(value) => (draft = value)}
      onSend={send}
      onRetry={() => {}}
      onLoadOlder={() => {}}
    >
      {#snippet header()}
        {#if !sent}<DiscussionRecipients
            {members}
            {selectedIds}
            onChange={(ids) => (selectedIds = ids)}
          />{/if}
      {/snippet}
    </DiscussionThread>
  </div>
</div>
