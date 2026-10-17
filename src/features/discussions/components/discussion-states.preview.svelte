<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  type State =
    | 'new'
    | 'direct'
    | 'unread'
    | 'sending'
    | 'failed'
    | 'references'
    | 'reactions'
    | 'loading'
    | 'sharing-off';
  interface Props {
    state?: State;
  }
  export const preview = definePreview<Props>({
    id: 'discussion-states',
    title: 'Discussion states',
    defaultState: 'direct',
    states: {
      new: { props: { state: 'new' } },
      direct: { props: { state: 'direct' } },
      unread: { props: { state: 'unread' } },
      sending: { props: { state: 'sending' } },
      failed: { props: { state: 'failed' } },
      references: { props: { state: 'references' } },
      reactions: { props: { state: 'reactions' } },
      loading: { props: { state: 'loading' } },
      'sharing-off': { props: { state: 'sharing-off' } },
    },
  });
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { DiscussionAuthor, DiscussionMessage } from '$shared/types/workspace-discussion';
  import { m } from '$shared/paraglide/messages.js';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import * as Menu from '$lib/components/ui/menu';
  import DiscussionRecipients from './DiscussionRecipients.svelte';
  import DiscussionThread from './DiscussionThread.svelte';
  import type { DiscussionPendingDisplay, DiscussionReactionDisplay } from './discussion-display';
  registerAllTabTypes();
  let { state: previewState = 'direct' }: Props = $props();
  const workspaceId = 'discussion-design-preview';
  const sam = { principalId: 'sam', displayName: 'Sam Breed', login: 'sam', avatarUrl: null };
  const alex = { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null };
  const jordan = { principalId: 'jordan', displayName: 'Jordan', login: 'jordan', avatarUrl: null };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  function at(minute: number, previous = false) {
    const date = new Date(today);
    date.setMinutes(minute);
    if (previous) date.setDate(date.getDate() - 1);
    return date.toISOString();
  }
  function message(
    id: number,
    body: string,
    author: DiscussionAuthor = alex,
    minute = id,
    previous = false,
  ): DiscussionMessage {
    return {
      id: `preview-${id}`,
      workspaceId,
      sequence: id,
      body,
      author,
      createdAt: at(minute, previous),
    };
  }
  let scene = $state<State>(untrack(() => previewState));
  let messages = $state<DiscussionMessage[]>([]);
  let pending = $state<DiscussionPendingDisplay[]>([]);
  let reactions = $state<Record<string, DiscussionReactionDisplay[]>>({});
  let draft = $state('');
  let reply = $state<DiscussionMessage | null>(null);
  let recipients = $state(['alex', 'jordan']);
  let unreadCount = $state(0);
  let firstUnreadSequence = $state<number | null>(null);
  let sharingOff = $state(false);
  let closed = $state(false);
  function reset(next: State) {
    scene = next;
    messages = [];
    pending = [];
    reactions = {};
    unreadCount = 0;
    firstUnreadSequence = null;
    sharingOff = next === 'sharing-off';
    reply = null;
    draft = '';
    closed = false;
    if (next === 'direct')
      messages = [
        message(1, 'Can you review the sidebar?', alex, 2, true),
        message(2, 'Looking now.', sam, 14),
        message(3, 'Spacing under People is tight. Can we add 8px?', sam, 15),
        message(4, 'Done, pushed a new mockup.', alex, 21),
      ];
    if (next === 'sending') {
      messages = [
        message(
          1,
          'I’ll build discussions and activity as separate sections, sharing this chat panel.',
          jordan,
          47,
        ),
        message(2, 'Sounds good.', sam, 48),
      ];
      pending = [
        {
          id: 'pending-send',
          body: 'Can the activity rows link to the PR?',
          author: sam,
          createdAt: at(48),
          status: 'sending',
        },
      ];
    }
    if (next === 'failed') {
      messages = [
        message(
          1,
          'Yes, keep them tight. Selecting a discussion should open the chat right here.',
          sam,
          46,
        ),
      ];
      pending = [
        {
          id: 'pending-failure',
          body: 'Agreed. I’ll update the mockup tonight.',
          author: sam,
          createdAt: at(49),
          status: 'failed',
          error: m.workspace_discussion_send_error(),
        },
      ];
    }
    if (next === 'references')
      messages = [
        message(
          1,
          'The merge agent landed it. Details are in the PR.\n[Merger Astra](intent://local/discussion-design-preview/agent/merger-astra) [#84](https://github.com/intent-hq/cloudlands-fe/pull/84) [ShareWorkspaceDialog.svelte](intent://local/discussion-design-preview/file/src/lib/components/workspace/ShareWorkspaceDialog.svelte)',
          alex,
          50,
        ),
        message(2, 'Nice, checking the dialog now.', sam, 51),
      ];
    if (next === 'reactions') {
      messages = [
        message(
          1,
          'Show just three activity items below a hairline. Keep search and + in the header.',
          jordan,
          44,
        ),
        message(
          2,
          'Use three small avatars for group threads and one for a direct message.',
          alex,
          45,
        ),
      ];
      reactions = {
        'preview-1': [
          { emoji: '👍', count: 2, reacted: true },
          { emoji: '🙂', count: 1, reacted: false },
        ],
      };
    }
    if (next === 'sharing-off')
      messages = [
        message(
          1,
          'Yes, keep them tight. Selecting a discussion should open the chat right here.',
          sam,
          46,
        ),
        message(
          2,
          'I’ll build discussions and activity as separate sections, sharing this chat panel.',
          jordan,
          47,
        ),
      ];
    if (next === 'unread') {
      messages = [
        message(
          1,
          'Discussions first. Activity will bury the chats if every update lands at the top.',
          sam,
          43,
        ),
        message(2, 'Three items is plenty.', sam, 44),
        message(3, 'Show just three activity items below a hairline.', jordan, 44),
        message(4, 'Keep search and + in the header.', jordan, 45),
        message(5, 'Use three small avatars for group threads.', alex, 45),
      ];
      unreadCount = 2;
      firstUnreadSequence = 3;
    }
  }
  untrack(() => reset(previewState));
  function send() {
    messages = [
      ...messages,
      {
        ...message((messages.at(-1)?.sequence ?? 0) + 1, draft, sam, 55),
        replyTo: reply ? { id: reply.id, body: reply.body, author: reply.author } : null,
      },
    ];
    draft = '';
    reply = null;
    if (scene === 'new') scene = 'direct';
  }
  function react(id: string, emoji: string) {
    const prior = reactions[id] ?? [];
    const found = prior.find((r) => r.emoji === emoji);
    reactions = {
      ...reactions,
      [id]: found
        ? prior
            .map((r) =>
              r.emoji === emoji
                ? { ...r, count: r.count + (r.reacted ? -1 : 1), reacted: !r.reacted }
                : r,
            )
            .filter((r) => r.count > 0)
        : [...prior, { emoji, count: 1, reacted: true }],
    };
  }
  const activeTabId = $derived(scene === 'new' ? 'new' : scene === 'direct' ? 'direct' : 'default');
  const tabs = $derived<PanelTab[]>([
    { id: 'default', type: 'discussion', title: 'Feature UI', closable: true },
    { id: 'direct', type: 'discussion', title: 'Alex', closable: true },
    ...(scene === 'new'
      ? [
          {
            id: 'new',
            type: 'discussion' as const,
            title: m.workspace_discussion_new_title(),
            closable: true,
          },
        ]
      : []),
  ]);
</script>

{#snippet discussionActions()}
  <Menu.Item onclick={() => reset('new')}>{m.workspace_discussion_new_title()}</Menu.Item>
  <Menu.Item onclick={() => reset(scene)}>{m.workspace_commitsTimeline_refresh_label()}</Menu.Item>
{/snippet}

<div
  class="flex h-[720px] w-full min-w-0 max-w-[420px] flex-col overflow-hidden rounded-[10px] border border-border bg-background"
  data-discussion-states-preview
>
  {#if closed}<Button onclick={() => (closed = false)}>{m.workspace_discussion_title()}</Button
    >{:else}
    <PanelTabBar
      {tabs}
      {activeTabId}
      panelId="discussion-preview"
      {workspaceId}
      contentActions={{ actions: discussionActions }}
      onTabClick={(id) => reset(id === 'direct' ? 'direct' : id === 'new' ? 'new' : 'reactions')}
      onTabClose={() => (closed = true)}
    />
    <div class="min-h-0 flex-1">
      <DiscussionThread
        {workspaceId}
        conversationId={scene === 'new' ? 'new' : scene === 'direct' ? 'direct' : 'default'}
        {messages}
        {draft}
        composerPlaceholder={scene === 'direct'
          ? m.workspace_discussion_composerPerson_placeholder({ name: 'Alex' })
          : scene === 'new'
            ? m.workspace_discussion_composerPair_placeholder({ first: 'Alex', second: 'Jordan' })
            : undefined}
        pendingMessages={pending}
        reactionsByMessage={reactions}
        {unreadCount}
        {firstUnreadSequence}
        {sharingOff}
        canEnableSharing
        onEnableSharing={() => (sharingOff = false)}
        replyTo={reply}
        onCancelReply={() => (reply = null)}
        typingAuthors={scene === 'sending' ? [alex] : []}
        typingLabel={scene === 'sending' ? 'Alex is typing' : null}
        initialized={scene !== 'loading'}
        loading={scene === 'loading'}
        showEmptyState={false}
        focusComposer={false}
        isPanelFocused
        canCompose={!sharingOff}
        canSend={!sharingOff && scene !== 'loading' && (scene !== 'new' || recipients.length > 0)}
        onDraftChange={(value) => (draft = value)}
        onSend={send}
        onRetry={() => reset(scene)}
        onLoadOlder={() => {}}
        onReply={(message) => (reply = message)}
        onReaction={react}
        onCopyMessage={(message) => void navigator.clipboard.writeText(message.body)}
        onRetryMessage={(id) => {
          const item = pending.find((p) => p.id === id);
          if (item) {
            messages = [
              ...messages,
              message((messages.at(-1)?.sequence ?? 0) + 1, item.body, item.author, 55),
            ];
            pending = pending.filter((p) => p.id !== id);
          }
        }}
      >
        {#snippet header()}{#if scene === 'new'}<DiscussionRecipients
              members={[alex, jordan]}
              selectedIds={recipients}
              onChange={(ids) => (recipients = ids)}
            />{/if}{/snippet}
      </DiscussionThread>
    </div>
  {/if}
</div>
