<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import DiscussionThread from '../DiscussionThread.svelte';
  import type { DiscussionPendingDisplay, DiscussionReactionDisplay } from '../discussion-display';

  let { focused = true, active = true }: { focused?: boolean; active?: boolean } = $props();
  const author = { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null };
  let messages = $state<DiscussionMessage[]>(
    Array.from({ length: 20 }, (_, i) => ({
      id: `message-${i}`,
      workspaceId: 'presentation',
      sequence: i + 1,
      body: `Review item ${i + 1}. Keep the discussion available while reviewing the workspace.`,
      author,
      createdAt: `2026-10-16T12:${String(i).padStart(2, '0')}:00Z`,
    })),
  );
  let draft = $state('Keep this draft');
  let reactions = $state<Record<string, DiscussionReactionDisplay[]>>({});
  let reply = $state<DiscussionMessage>();
  let copied = $state('');
  let readThrough = $state(0);
  let unreadAfterSequence = $state<number | null>(null);
  let unreadCount = $state(0);
  let pending = $state<DiscussionPendingDisplay[]>([]);
  let retried = $state('');
  let loaded = $state(true);
  function arrive() {
    unreadAfterSequence = messages.at(-1)!.sequence;
    unreadCount = 1;
    messages = [
      ...messages,
      {
        id: 'arrived',
        workspaceId: 'presentation',
        sequence: 21,
        body: 'The newly arrived message.',
        author,
        createdAt: '2026-10-16T13:00:00Z',
      },
    ];
  }
</script>

<div class="h-[540px] w-[360px] max-w-full" data-presentation-host>
  <DiscussionThread
    {messages}
    {draft}
    initialized={loaded}
    loading={!loaded}
    isPanelFocused={focused}
    isActive={active}
    reactionsByMessage={reactions}
    {unreadAfterSequence}
    {unreadCount}
    pendingMessages={pending}
    onDraftChange={(value) => (draft = value)}
    onSend={() => {}}
    onRetry={() => {}}
    onLoadOlder={() => {}}
    onReply={(message) => (reply = message)}
    onCopyMessage={(message) => (copied = message.body)}
    onReaction={(id, emoji) => {
      const prior = reactions[id]?.find((r) => r.emoji === emoji);
      reactions = { ...reactions, [id]: prior ? [] : [{ emoji, count: 1, reacted: true }] };
    }}
    onReadThrough={(sequence) => {
      readThrough = sequence;
      if (sequence === 21) {
        unreadCount = 0;
        unreadAfterSequence = null;
      }
    }}
    onRetryMessage={(id) => {
      retried = id;
      pending = pending.map((p) => ({ ...p, status: 'sending' }));
    }}
  >
    {#snippet composerContext()}{#if reply}<p data-reply-target>
          {reply.id}: {reply.body}
        </p>{/if}{/snippet}
  </DiscussionThread>
</div>
<Button onclick={arrive}>Receive new message</Button>
<Button
  onclick={() => {
    pending = [
      {
        id: 'retry-key',
        body: 'Retain the unsent body',
        author,
        createdAt: '2026-10-16T13:01:00Z',
        status: 'failed',
        error: 'Connection failed',
      },
    ];
  }}>Fail pending message</Button
>
<Button
  onclick={() => {
    loaded = !loaded;
    messages = [];
  }}>Toggle loading</Button
>
<output data-copied>{copied}</output><output data-read-through>{readThrough}</output><output
  data-retried>{retried}</output
>
