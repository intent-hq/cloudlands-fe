<script lang="ts">
  import InlineHtmlPreview from './InlineHtmlPreview.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import type { ParsedContent } from '$lib/utils/messageParser';
  import type { MessageRole } from '$shared/types';

  let { block, role }: { block: ParsedContent; role: MessageRole } = $props();
</script>

{#if role === 'assistant'}
  <InlineHtmlPreview
    source={block.content}
    isStreaming={block.metadata?.isStreaming ?? false}
    isComplete={block.metadata?.fenceClosed ?? false}
  />
{:else}
  <CodeBlock code={block.content} language="html" />
{/if}
