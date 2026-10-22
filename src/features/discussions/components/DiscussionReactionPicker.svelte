<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import { Button } from '$lib/components/ui/button';
  import SmileyIcon from 'phosphor-svelte/lib/SmileyIcon';
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
  import { m } from '$shared/paraglide/messages.js';
  import DiscussionReactionEmoji from './DiscussionReactionEmoji.svelte';
  import { discussionReactionChoices, discussionReactionName } from './discussion-reactions';
  import type { DiscussionReactionDisplay } from './discussion-display';
  let {
    open = $bindable(false),
    disabled = false,
    compact = false,
    onReaction,
    reactions = [],
  }: {
    open?: boolean;
    disabled?: boolean;
    compact?: boolean;
    onReaction: (emoji: string) => void;
    reactions?: readonly DiscussionReactionDisplay[];
  } = $props();
  let trigger: HTMLButtonElement | HTMLAnchorElement | null = $state(null);
  // Anchor above the entire persistent row so wrapping never puts chips beneath the picker.
  const reactionAnchor = $derived.by(() =>
    open
      ? trigger?.closest('article')?.querySelector<HTMLElement>('[data-discussion-reactions]')
      : undefined,
  );
  function navigate(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const buttons = Array.from(
      target.querySelectorAll<HTMLButtonElement>('[data-discussion-reaction-choice]'),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        bind:ref={trigger}
        variant={compact ? 'outline' : 'ghost'}
        size="icon-compact"
        class={compact ? 'h-6 w-[30px] rounded-full text-muted-foreground' : 'size-6'}
        {disabled}
        aria-label={m.workspace_discussion_react_label()}
        data-discussion-reaction-trigger={compact ? 'plus' : 'toolbar'}
      >
        {#if compact}<PlusIcon size={13} />{:else}<SmileyIcon size={15} />{/if}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    customAnchor={reactionAnchor}
    side="top"
    align="end"
    class="flex w-fit gap-0.5 rounded-[10px] p-1"
    preventScroll={false}
    aria-label={m.workspace_discussion_react_label()}
    data-discussion-reaction-picker
    onkeydown={navigate}
  >
    {#each discussionReactionChoices as emoji}
      <Button
        variant="ghost"
        size="icon"
        class="size-8 rounded-lg"
        aria-label={discussionReactionName(emoji)}
        onpointerenter={(event) => event.currentTarget.focus({ preventScroll: true })}
        data-discussion-reaction-choice={emoji}
        onclick={() => {
          open = false;
          if (!reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted))
            onReaction(emoji);
        }}
      >
        <DiscussionReactionEmoji {emoji} size={20} />
      </Button>
    {/each}
  </Popover.Content>
</Popover.Root>
