<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    narrow?: boolean;
    initial?: 'mixed' | 'empty' | 'large' | 'legacy' | 'picker' | 'focused';
  }
  export const preview = definePreview<Props>({
    id: 'discussion-reactions',
    title: 'Discussion reactions',
    defaultState: 'mixed',
    states: {
      mixed: { props: {} },
      empty: { props: { initial: 'empty' } },
      large: { props: { initial: 'large' } },
      legacy: { props: { initial: 'legacy' } },
      picker: { props: { initial: 'picker' } },
      focused: { props: { initial: 'focused' } },
      narrow: { props: { narrow: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { DiscussionMessage } from '$shared/types/workspace-discussion';
  import type { DiscussionReactionDisplay } from './discussion-display';
  import DiscussionThread from './DiscussionThread.svelte';
  import { discussionReactionChoices } from './discussion-reactions';
  let { narrow = false, initial = 'mixed' }: Props = $props();
  const human = { principalId: 'alex', displayName: 'Alex', login: 'alex', avatarUrl: null };
  const agent = {
    principalId: null,
    agentId: 'developer',
    displayName: 'Developer',
    login: null,
    avatarUrl: null,
  };
  const self = { principalId: 'sam', displayName: 'Sam', login: 'sam', avatarUrl: null };
  const base = { workspaceId: 'reaction-preview', createdAt: '2026-10-20T12:45:00Z' };
  const messages: DiscussionMessage[] = [
    {
      ...base,
      id: 'reaction-first',
      sequence: 1,
      author: human,
      body: 'The updated discussion layout is ready to review.',
    },
    {
      ...base,
      id: 'reaction-last',
      sequence: 2,
      author: agent,
      body: 'The picker, reactions and reply controls are ready.',
    },
  ];
  function initialReactions(): DiscussionReactionDisplay[] {
    if (initial === 'empty') return [];
    if (initial === 'legacy')
      return [{ emoji: '🙂', count: 2, reacted: true, reactors: [human, self] }];
    if (initial === 'large')
      return [
        {
          emoji: '👀',
          count: 1234,
          reacted: false,
          reactors: Array.from({ length: 20 }, (_, i) => ({
            ...human,
            principalId: `person-${i}`,
            displayName: `Reviewer ${i + 1}`,
          })),
        },
      ];
    return discussionReactionChoices.map((emoji, index) => ({
      emoji,
      count: index === 0 ? 2 : 1,
      reacted: index === 0,
      reactors: index === 0 ? [human, self] : index === 2 ? [agent] : [human],
    }));
  }
  let reactions = $state<DiscussionReactionDisplay[]>(initialReactions());
  let root: HTMLDivElement;
  let copied = $state('');
  let selected = $state('');
  let draft = $state('Keep this draft while reacting');
  let lastReaction = $state('');
  function react(emoji: string) {
    lastReaction = emoji;
    const existing = reactions.find((reaction) => reaction.emoji === emoji);
    if (!existing) {
      reactions = [...reactions, { emoji, count: 1, reacted: true, reactors: [self] }];
      return;
    }
    reactions = reactions
      .map((reaction) =>
        reaction.emoji !== emoji
          ? reaction
          : {
              ...reaction,
              count: reaction.count + (reaction.reacted ? -1 : 1),
              reacted: !reaction.reacted,
              reactors: reaction.reacted
                ? reaction.reactors?.filter((author) => author.principalId !== 'sam')
                : [...(reaction.reactors ?? []), self],
            },
      )
      .filter((reaction) => reaction.count > 0);
  }
  onMount(async () => {
    await tick();
    if (initial === 'picker')
      root
        .querySelector<HTMLButtonElement>('[data-discussion-reaction-trigger="toolbar"]')
        ?.click();
    if (initial === 'focused')
      root.querySelector<HTMLButtonElement>('[data-discussion-reaction="👀"]')?.focus();
  });
</script>

<div
  bind:this={root}
  class="group/panel relative h-[440px] max-w-full overflow-hidden bg-background text-foreground [container-type:size]"
  style:width={narrow ? '280px' : '460px'}
  data-reaction-preview
>
  <DiscussionThread
    {messages}
    {draft}
    focusComposer={false}
    expandedReactions
    reactionsByMessage={{
      'reaction-first': [{ emoji: '👀', count: 2, reacted: false, reactors: [human, agent] }],
      'reaction-last': reactions,
    }}
    onDraftChange={(value) => (draft = value)}
    onSend={() => {}}
    onRetry={() => {}}
    onLoadOlder={() => {}}
    onReaction={(_id, emoji) => react(emoji)}
    onCopyMessage={(message) => (copied = message.body)}
    onReply={(message) => (selected = message.id)}
  />
  <output class="sr-only" data-reaction-last>{lastReaction}</output>
  <output class="sr-only" data-reaction-copied>{copied}</output>
  <output class="sr-only" data-reaction-reply>{selected}</output>
</div>
