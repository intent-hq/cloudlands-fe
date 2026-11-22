<script lang="ts">
  /** Goal text with `http(s)://` and `intent://` links made clickable. */
  import { splitTextByUrls } from '$lib/components/chat/message-link-utils';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';

  let { text, workspaceId }: { text: string; workspaceId?: string } = $props();
  const parts = $derived(splitTextByUrls(text));
</script>

{#each parts as part, index (index)}{#if part.type === 'link'}<a
      href={part.url}
      class="cursor-pointer underline underline-offset-2 hover:opacity-80"
      onclick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleLink(part.url, {
          workspaceId: workspaceId ? WorkspaceId(workspaceId) : undefined,
          event,
        });
      }}>{part.url}</a
    >{:else}{part.content}{/if}{/each}
