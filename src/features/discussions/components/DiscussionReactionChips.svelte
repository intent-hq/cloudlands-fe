<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionReactionDisplay } from './discussion-display';
  import { discussionReactionPeople, orderedDiscussionReactions } from './discussion-reactions';
  import DiscussionReactionEmoji from './DiscussionReactionEmoji.svelte';
  import DiscussionReactionPicker from './DiscussionReactionPicker.svelte';
  let {
    reactions,
    expandedReactions = false,
    disabled = false,
    onReaction,
    open = $bindable(false),
  }: {
    reactions: readonly DiscussionReactionDisplay[];
    expandedReactions?: boolean;
    disabled?: boolean;
    onReaction?: (emoji: string) => void;
    open?: boolean;
  } = $props();
  let root: HTMLDivElement | null = $state(null);
  const ordered = $derived(orderedDiscussionReactions(reactions));
  $effect.pre(() => {
    const current = ordered;
    const focused = root?.querySelector<HTMLButtonElement>('[data-discussion-reaction]:focus');
    if (
      focused &&
      !current.some((reaction) => reaction.emoji === focused.dataset.discussionReaction)
    )
      root
        ?.closest('article')
        ?.querySelector<HTMLButtonElement>(
          '[data-discussion-message-actions] button:not(:disabled)',
        )
        ?.focus({ preventScroll: true });
  });
  function canReact(reaction: DiscussionReactionDisplay): boolean {
    if (disabled || !onReaction) return false;
    if (!expandedReactions) return reaction.emoji === '👍' || reaction.emoji === '🙂';
    return reaction.emoji !== '🙂' || reaction.reacted;
  }
</script>

{#if ordered.length}
  <div bind:this={root} class="flex flex-wrap items-center gap-1.5" data-discussion-reactions>
    {#each ordered as reaction (reaction.emoji)}
      <Tooltip contentClass="rounded-[5px] text-[11px] leading-4" disabled={!expandedReactions}>
        {#snippet content()}
          <span class="inline-flex flex-wrap items-center gap-1" data-discussion-reaction-people>
            <span
              >{m.workspace_discussion_reactedWith_label({
                names: discussionReactionPeople(reaction),
              })}</span
            >
            <DiscussionReactionEmoji emoji={reaction.emoji} size={13} />
          </span>
        {/snippet}
        <Button
          variant={reaction.reacted ? 'primary' : 'outline'}
          size="compact"
          wrapContent={false}
          class="h-6 gap-1 rounded-full px-2 aria-disabled:pointer-events-auto aria-disabled:opacity-100 text-xs font-medium leading-[18px]"
          aria-pressed={reaction.reacted}
          aria-label={m.workspace_discussion_reaction_label({
            emoji: reaction.emoji,
            count: formatInteger(reaction.count),
          })}
          aria-disabled={!canReact(reaction)}
          onclick={() => {
            if (canReact(reaction)) onReaction?.(reaction.emoji);
          }}
          data-discussion-reaction={reaction.emoji}
        >
          <DiscussionReactionEmoji emoji={reaction.emoji} />
          <span>{formatInteger(reaction.count)}</span>
        </Button>
      </Tooltip>
    {/each}
    {#if expandedReactions && onReaction}
      <div class="discussion-reaction-add" class:picker-open={open}>
        <DiscussionReactionPicker compact bind:open {disabled} {onReaction} {reactions} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .discussion-reaction-add {
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--spring-fast-exit) var(--spring-fast-ease);
  }
  :global(article:is(:hover, :focus-within)) .discussion-reaction-add,
  .discussion-reaction-add.picker-open {
    opacity: 1;
    pointer-events: auto;
    transition-duration: var(--spring-fast);
  }
  @media (hover: none) {
    .discussion-reaction-add {
      opacity: 1;
      pointer-events: auto;
    }
  }
  @container style(--motion-reduced: 1) {
    .discussion-reaction-add {
      transition: none;
    }
  }
</style>
