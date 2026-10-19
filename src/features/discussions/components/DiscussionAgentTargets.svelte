<script lang="ts">
  import { writable } from 'svelte/store';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import type { DiscussionAgentMention } from '../discussion-agent-mentions';
  import { m } from '$shared/paraglide/messages.js';

  let {
    ids,
    workspaceId,
    mentions = [],
  }: {
    ids: readonly string[];
    workspaceId?: string;
    mentions?: readonly DiscussionAgentMention[];
  } = $props();
  const workspaceId$ = writable('');
  $effect(() => workspaceId$.set(workspaceId ?? ''));
  const agents$ = selectAllWorkspaceAgents(workspaceId$);
</script>

<div
  class="flex min-w-0 flex-wrap gap-x-2 gap-y-1 type-caption text-muted-foreground"
  data-discussion-message-agents
  aria-label={m.workspace_discussion_agentRecipients_label()}
>
  <span>{m.workspace_discussion_to_label()}</span>
  {#each ids as id (id)}
    <span class="max-w-full truncate" title={id}
      >@{mentions.find((mention) => mention.agentId === id)?.name ||
        $agents$.find((agent) => agent.id === id)?.name ||
        id}</span
    >
  {/each}
</div>
