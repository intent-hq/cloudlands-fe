<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { menuItem, menuOverlay } from '$lib/components/ui/menu';
  import { Separator } from '$lib/components/ui/separator';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { DiscussionMentionOption } from './discussion-mention-query';

  let {
    id,
    options,
    activeIndex,
    loading = false,
    error = null,
    hasMore = false,
    onLoadMore,
    onHighlight,
    onSelect,
  }: {
    id: string;
    options: readonly DiscussionMentionOption[];
    activeIndex: number;
    loading?: boolean;
    error?: string | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onHighlight: (index: number) => void;
    onSelect: (option: DiscussionMentionOption) => void;
  } = $props();

  $effect(() => {
    const optionId = `${id}-option-${activeIndex}`;
    void tick().then(() => document.getElementById(optionId)?.scrollIntoView({ block: 'nearest' }));
  });
</script>

<div
  class={menuOverlay({ class: 'absolute left-0 bottom-full mb-2 w-72 max-w-full p-1' })}
  data-discussion-mention-picker
>
  <div
    {id}
    role="listbox"
    aria-label={m.workspace_discussion_mentions_label()}
    aria-busy={loading}
    class="max-h-64 overflow-y-auto overscroll-contain"
  >
    {#each ['agent', 'user'] as kind (kind)}
      {@const group = options.filter((option) => option.kind === kind)}
      {#if group.length}
        {#if kind === 'user' && options.some((option) => option.kind === 'agent')}
          <Separator decorative class="my-1" />
        {/if}
        <div
          role="group"
          aria-label={kind === 'agent'
            ? m.workspace_discussion_mentionAgents_label()
            : m.workspace_discussion_mentionUsers_label()}
        >
          <p class="px-2 py-1 type-caption text-muted-foreground" aria-hidden="true">
            {kind === 'agent'
              ? m.workspace_discussion_mentionAgents_label()
              : m.workspace_discussion_mentionUsers_label()}
          </p>
          {#each group as option (option.key)}
            {@const index = options.indexOf(option)}
            <Button
              id={`${id}-option-${index}`}
              variant="plain"
              size="sm"
              wrapContent={false}
              role="option"
              tabindex={-1}
              aria-selected={index === activeIndex}
              data-menu-item
              data-highlighted={index === activeIndex ? '' : undefined}
              class={menuItem({
                class: 'h-auto min-h-9 items-center gap-2.5 data-[highlighted]:bg-hover',
              })}
              onmousedown={(event) => event.preventDefault()}
              onpointermove={() => onHighlight(index)}
              onclick={() => onSelect(option)}
            >
              {#if option.kind === 'agent'}
                <AgentAvatar agentId={option.agent.id} variant="emphasized" />
              {:else}
                <PrincipalAvatar label={option.label} avatarUrl={option.user.avatarUrl} size={24} />
              {/if}
              <span class="min-w-0 flex-1 truncate">{option.label}</span>
              {#if option.kind === 'agent' && option.agent.status}
                <span class="text-muted-foreground">
                  {option.agent.status === 'working'
                    ? m.workspace_discussion_agentWorking_label()
                    : m.workspace_discussion_agentIdle_label()}
                </span>
              {/if}
              {#if option.kind === 'user' && option.user.login && option.user.login.toLocaleLowerCase() !== option.label.toLocaleLowerCase()}
                <span class="max-w-1/2 truncate text-muted-foreground">@{option.user.login}</span>
              {:else if option.kind === 'agent' && options.some((other) => other.kind === 'agent' && other.key !== option.key && other.label === option.label)}
                <span class="text-muted-foreground">{option.agent.id.slice(-6)}</span>
              {/if}
            </Button>
          {/each}
        </div>
      {/if}
    {/each}
  </div>
  {#if error}
    <p class="px-2 py-2 type-caption text-danger" role="alert">{error}</p>
  {:else if loading}
    <p class="px-2 py-2 type-caption text-muted-foreground" role="status">
      {m.workspace_discussion_loading_label()}
    </p>
  {:else if !options.length}
    <p class="px-2 py-2 type-caption text-muted-foreground" role="status">
      {m.workspace_discussion_noMentions_label()}
    </p>
  {/if}
  {#if hasMore}
    <Button
      variant="ghost"
      size="sm"
      {loading}
      class="w-full"
      onmousedown={(event) => event.preventDefault()}
      onclick={onLoadMore}>{m.workspace_discussion_loadMoreMembers_label()}</Button
    >
  {/if}
</div>
