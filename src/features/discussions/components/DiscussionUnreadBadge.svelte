<script lang="ts">
  import { writable } from 'svelte/store';
  import { Badge } from '$lib/components/ui/badge';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectDiscussionUnread } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';

  let { workspaceId, conversationId }: { workspaceId: string; conversationId: string } = $props();
  const workspaceId$ = writable('');
  const conversationId$ = writable('default');
  $effect(() => workspaceId$.set(workspaceId));
  $effect(() => conversationId$.set(conversationId));
  const unread$ = selectDiscussionUnread(workspaceId$, conversationId$);
  const multiplayer$ = selectLabsMultiplayerEnabled();
</script>

{#if $multiplayer$ && $unread$.count > 0}
  <Badge size="compact" variant="solid" color="blue" data-discussion-unread-badge>
    {m.workspace_discussion_jumpNew_label({ count: formatInteger($unread$.count) })}
  </Badge>
{/if}
