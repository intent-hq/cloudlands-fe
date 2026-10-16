<script lang="ts">
  import Fa from 'svelte-fa';
  import { faRobot, faFileLines, faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { discussionBodyParts, type DiscussionReference } from '../discussion-references';
  import { openDiscussionReference } from '../discussion-reference-navigation';
  let {
    body,
    workspaceId,
    sourcePanelId,
    mode = 'inline',
  }: {
    body: string;
    workspaceId: string;
    sourcePanelId?: string;
    mode?: 'inline' | 'text' | 'references';
  } = $props();
  const parts = $derived(discussionBodyParts(body, workspaceId));
  const references = $derived(
    parts.filter((part): part is DiscussionReference => typeof part !== 'string'),
  );
</script>

{#if mode === 'references'}
  {#if references.length}<div class="flex flex-wrap items-start gap-1.5">
      {#each references as reference}{@render chip(reference)}{/each}
    </div>{/if}
{:else if mode === 'text'}
  {parts
    .filter((part) => typeof part === 'string')
    .join('')
    .trim()}
{:else}
  <span class="whitespace-pre-wrap wrap-break-word"
    >{#each parts as part}{#if typeof part === 'string'}{part}{:else}{@render chip(
          part,
        )}{/if}{/each}</span
  >
{/if}

{#snippet chip(reference: DiscussionReference)}
  <Button
    variant="outline"
    size="sm"
    class="max-w-full gap-1.5 align-middle type-caption"
    onclick={(event) => openDiscussionReference(reference, workspaceId, sourcePanelId, event)}
    title={reference.url}
  >
    <Fa
      icon={reference.kind === 'agent'
        ? faRobot
        : reference.kind === 'pr'
          ? faCodePullRequest
          : faFileLines}
      size="xs"
    />
    <span class="min-w-0 truncate">{reference.label}</span>
  </Button>
{/snippet}
