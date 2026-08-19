<script lang="ts">
  import { renderInlineMarkdownSnippet } from './inline-markdown-snippet';

  interface Props {
    content: string;
    maxVisibleCharacters?: number;
    class?: string;
    testId?: string;
  }

  let { content, maxVisibleCharacters = 80, class: className = '', testId }: Props = $props();
  let inlineHTML = $state('');

  $effect(() => {
    const markdown = content;
    const limit = maxVisibleCharacters;
    let cancelled = false;
    void renderInlineMarkdownSnippet(markdown, limit).then((html) => {
      if (!cancelled) inlineHTML = html;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<!-- The shared Markdown pipeline sanitizes this strict inline-only projection. -->
<span class="inline-markdown-snippet {className}" data-inline-markdown-snippet data-testid={testId}
  >{@html inlineHTML}</span
>

<style>
  .inline-markdown-snippet {
    display: inline;
  }
  .inline-markdown-snippet :global(strong) {
    font-weight: 600;
  }
  .inline-markdown-snippet :global(em) {
    font-style: italic;
  }
  .inline-markdown-snippet :global(code) {
    border-radius: 0.2rem;
    background: hsl(var(--muted));
    padding-inline: 0.2em;
    font-family: var(--font-code);
    font-size: 0.95em;
  }
</style>
