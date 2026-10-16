<script lang="ts">
  import type { Snippet } from 'svelte';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import Fa from 'svelte-fa';
  import CaretUpDownIcon from 'phosphor-svelte/lib/CaretUpDownIcon';
  import {
    faComment,
    faCheck,
    faPlus,
    faEllipsisVertical,
    faXmark,
    faRotateRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { m } from '$shared/paraglide/messages.js';

  let {
    title,
    avatar,
    avatarName,
    paneItems,
    paneActions,
    conversationId,
    rows,
    onSelect,
    onNew,
    onClose,
    onRefresh,
    loading = false,
    hasMore = false,
    onLoadMore,
    error = null,
  }: {
    title: string;
    avatar?: string | null;
    avatarName?: string;
    paneItems?: Snippet;
    paneActions?: Snippet;
    conversationId: string;
    rows: readonly { id: string; title: string }[];
    onSelect: (id: string, title: string) => void;
    onNew: () => void;
    onClose: () => void;
    onRefresh: () => void;
    loading?: boolean;
    hasMore?: boolean;
    onLoadMore?: () => void;
    error?: string | null;
  } = $props();
</script>

<div
  class="flex h-[54px] w-full min-w-0 items-center justify-between gap-3 px-2.5"
  data-discussion-header
>
  <Menu.Root>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="sm"
          class="h-[34px] w-[180px] min-w-0 justify-start gap-2 bg-sidebar px-1.5"
          aria-label={m.workspace_discussion_list_label()}
        >
          {#if avatarName}
            <PrincipalAvatar label={avatarName} avatarUrl={avatar ?? null} size={24} />
          {:else}
            <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted"
              ><Fa icon={faComment} size="sm" /></span
            >
          {/if}
          <span class="min-w-0 flex-1 truncate text-left">{title}</span><CaretUpDownIcon
            size={14}
          />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content
      align="start"
      maxHeight="min(24rem, var(--bits-dropdown-menu-content-available-height))"
      aria-label={m.workspace_discussion_list_label()}
    >
      {#each rows as row (row.id)}
        <Menu.Item
          onclick={() => onSelect(row.id, row.title)}
          aria-current={row.id === conversationId ? 'page' : undefined}
        >
          <span class="min-w-0 flex-1 truncate">{row.title}</span>
          {#if row.id === conversationId}<Fa icon={faCheck} size="xs" />{/if}
        </Menu.Item>
      {/each}
      {#if loading}<Menu.Item disabled>{m.workspace_discussion_loading_label()}</Menu.Item>{/if}
      {#if error}<Menu.Item onclick={onRefresh}>{m.ui_errorToast_retry_label()}</Menu.Item>{/if}
      {#if hasMore}<Menu.Item disabled={loading} onclick={onLoadMore}
          >{m.workspace_discussion_loadMore_label()}</Menu.Item
        >{/if}
      {#if paneItems}
        <Menu.Separator />
        {@render paneItems()}
      {/if}
      <Menu.Separator />
      <Menu.Item onclick={onNew}
        >{#snippet leading()}<Fa
            icon={faPlus}
          />{/snippet}{m.workspace_discussion_new_title()}</Menu.Item
      >
    </Menu.Content>
  </Menu.Root>
  <div class="flex shrink-0 items-center gap-1">
    {#if paneActions}
      {@render paneActions()}
    {:else}
      <Menu.Root>
        <Menu.Trigger
          >{#snippet child({ props })}<Button
              {...props}
              variant="ghost"
              size="icon-sm"
              aria-label={m.layout_panelTabBar_paneMenu_ariaLabel()}
              ><Fa icon={faEllipsisVertical} size="sm" /></Button
            >{/snippet}</Menu.Trigger
        >
        <Menu.Content align="end">
          <Menu.Item onclick={onNew}
            >{#snippet leading()}<Fa
                icon={faPlus}
              />{/snippet}{m.workspace_discussion_new_title()}</Menu.Item
          >
          <Menu.Item onclick={onRefresh}
            >{#snippet leading()}<Fa
                icon={faRotateRight}
              />{/snippet}{m.workspace_commitsTimeline_refresh_label()}</Menu.Item
          >
          <Menu.Separator />
          <Menu.Item onclick={onClose}
            >{#snippet leading()}<Fa
                icon={faXmark}
              />{/snippet}{m.layout_panelTabBar_close_label()}</Menu.Item
          >
        </Menu.Content>
      </Menu.Root>
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onClose}
        aria-label={m.layout_panelTabBar_close_label()}><Fa icon={faXmark} size="sm" /></Button
      >
    {/if}
  </div>
</div>
