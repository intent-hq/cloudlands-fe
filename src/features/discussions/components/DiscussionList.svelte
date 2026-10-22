<script lang="ts">
  import Fa from 'svelte-fa';
  import { faComment } from '@fortawesome/free-regular-svg-icons';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import DiscussionUnreadBadge from './DiscussionUnreadBadge.svelte';
  let {
    workspaceId,
    rows,
    onOpen,
    loading = false,
    error = null,
    hasMore = false,
    onLoadMore,
    onRetry,
  }: {
    workspaceId: string;
    rows: readonly { id: string; title: string; avatarUrl?: string | null }[];
    onOpen: (id: string, title: string) => void;
    loading?: boolean;
    error?: string | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onRetry?: () => void;
  } = $props();
</script>

<section class="mb-4 min-w-0" aria-label={m.workspace_discussion_list_label()}>
  <h3 class="px-2.5 py-1.5 type-caption text-muted-foreground">
    {m.workspace_discussion_list_label()}
  </h3>
  <ListView
    items={rows}
    getKey={(row) => row.id}
    getText={(row) => row.title}
    onActivate={(row) => onOpen(row.id, row.title)}
    ariaLabel={m.workspace_discussion_list_label()}
    virtualize={false}
  >
    {#snippet row({ item })}
      <ListRow class="min-h-9 gap-2.5 px-2.5 py-2" data-workspace-discussion-open={item.id}>
        {#snippet leading()}
          {#if item.id === 'default'}<Fa
              icon={faComment}
              class="text-muted-foreground"
            />{:else}<PrincipalAvatar
              label={item.title}
              avatarUrl={item.avatarUrl}
              size={20}
            />{/if}
        {/snippet}
        {#snippet title()}{item.title}{/snippet}
        {#snippet trailing()}
          <DiscussionUnreadBadge {workspaceId} conversationId={item.id} />
        {/snippet}
      </ListRow>
    {/snippet}
  </ListView>
  {#if error}
    <ErrorState density="compact" {onRetry} retryLabel={m.ui_errorToast_retry_label()}
      >{#snippet message()}{error}{/snippet}</ErrorState
    >
  {:else if loading}<LoadingState label={m.workspace_discussion_loading_label()} count={1} />{/if}
  {#if hasMore}<Button variant="ghost" size="sm" {loading} onclick={onLoadMore}
      >{m.workspace_discussion_loadMore_label()}</Button
    >{/if}
</section>
