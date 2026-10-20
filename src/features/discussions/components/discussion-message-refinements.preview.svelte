<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    narrow?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'discussion-message-refinements',
    title: 'Discussion message refinements',
    defaultState: 'messages',
    states: { messages: { props: {} }, narrow: { props: { narrow: true } } },
  });
</script>

<script lang="ts">
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import DiscussionMessageView from './DiscussionMessageView.svelte';
  let { narrow = false }: Props = $props();
  const human = { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null };
  const agent = {
    principalId: null,
    agentId: 'reviewer',
    displayName: 'Reviewer',
    login: null,
    avatarUrl: null,
  };
  const base = { workspaceId: 'message-preview', createdAt: '2026-10-20T12:45:00Z' };
  const original: DiscussionMessage = {
    ...base,
    id: 'original',
    sequence: 1,
    author: human,
    body: 'Use three small avatars for group threads and one for a direct message.',
  };
  const addressed: DiscussionMessage = {
    ...base,
    id: 'addressed',
    sequence: 2,
    author: human,
    body: '@Reviewer can you make that change? Plain @Reviewer stays text.',
    recipientAgentIds: ['reviewer'],
  };
  const response: DiscussionMessage = {
    ...base,
    id: 'response',
    sequence: 3,
    author: agent,
    replyTo: { id: addressed.id, author: human, body: addressed.body },
    body: 'Two things to fix before this merges:\n\n- Copy link stays enabled while `createInviteLink` runs.\n- The GitHub search list has no empty state.\n\nEverything else matches the mockups, in light and dark.\n\nThe message row remains usable by keyboard, and the same request keeps its reply reference.\n\nThe list will stop at three items with a hairline above it. The remaining activity is available from the workspace.\n\nThe helper also preserves the selection after retry and keeps the existing recipient names.\n\n[Review notes](https://example.com/review)\n\n[#84](https://github.com/intent-hq/cloudlands-fe/pull/84) [ShareWorkspaceDialog.svelte](intent://local/message-preview/file/src/lib/components/workspace/ShareWorkspaceDialog.svelte)',
  };
  const followup: DiscussionMessage = {
    ...base,
    id: 'followup',
    sequence: 4,
    author: human,
    body: 'Agreed, three is plenty.',
    replyTo: { id: original.id, author: human, body: original.body },
  };
  let selected = $state<string>();
  let jumped = $state('');
  let copied = $state('');
  let root: HTMLDivElement | undefined = $state();
  function navigate(id: string) {
    jumped = id;
    const target = root?.querySelector<HTMLElement>(`[data-discussion-message="${id}"]`);
    target?.scrollIntoView({ block: 'nearest' });
    target?.focus({ preventScroll: true });
  }
</script>

<div
  bind:this={root}
  class="bg-background p-2 text-foreground"
  style:width={narrow ? '320px' : '420px'}
  data-message-refinements
>
  <DiscussionMessageView
    message={original}
    workspaceId={base.workspaceId}
    replySelected={selected === original.id}
    onReply={() => (selected = original.id)}
    onReaction={() => {}}
    onCopy={() => (copied = original.body)}
  />
  <DiscussionMessageView
    message={addressed}
    workspaceId={base.workspaceId}
    continuation
    agentMentions={[{ agentId: 'reviewer', name: 'Reviewer', start: 0, end: 9 }]}
    onReply={() => (selected = addressed.id)}
  />
  <DiscussionMessageView
    message={response}
    workspaceId={base.workspaceId}
    onReplyNavigate={navigate}
    onReply={() => (selected = response.id)}
    onCopy={() => (copied = response.body)}
  />
  <DiscussionMessageView
    message={followup}
    workspaceId={base.workspaceId}
    onReplyNavigate={navigate}
    onReply={() => (selected = followup.id)}
  />
  <output class="sr-only" data-jumped>{jumped}</output><output class="sr-only" data-copied
    >{copied}</output
  >
</div>
