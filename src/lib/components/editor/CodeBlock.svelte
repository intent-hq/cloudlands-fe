<script lang="ts">
  import { escapeCodeHtml, getCachedHighlight, highlightAsync } from '$lib/utils/code-highlighter';
  import '$lib/styles/syntax-highlighting.css';
  import '$lib/styles/code-block.css';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type Props = {
    code?: string;
    language?: string;
    showLineNumbers?: boolean;
    startLineNumber?: number;
    highlightLines?: number[];
    fileName?: string;
    filename?: string;
    maxHeight?: number | undefined;
    /** Hide the border around the code block */
    noBorder?: boolean;
    /** Remove top and bottom margins */
    noMargin?: boolean;
    doScroll?: boolean;
    className?: string;
  };

  const {
    code = '',
    language = 'plaintext',
    showLineNumbers = false,
    startLineNumber = 1,
    highlightLines = [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fileName = '',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    filename = '',
    maxHeight = undefined,
    noBorder = false,
    noMargin = false,
    doScroll = true,
    className = '',
  } = $props();

  // PERF: No synchronous highlight.js work on mount — render escaped plain
  // code (or a cache hit) immediately and swap in highlighted HTML async.
  // Initial values only; the $effect below tracks subsequent prop changes.
  // svelte-ignore state_referenced_locally
  let highlighted = $state(getCachedHighlight(code, language) ?? escapeCodeHtml(code));

  $effect(() => {
    // Re-highlight when code/language change (e.g. streaming appends)
    const currentCode = code;
    const currentLanguage = language;

    const cached = getCachedHighlight(currentCode, currentLanguage);
    if (cached !== null) {
      highlighted = cached;
      return;
    }

    // Show correct (unhighlighted) text right away; colors arrive async.
    // The stale flag suppresses superseded results AND lets highlightAsync
    // skip the highlight.js work entirely (e.g. replaced streaming chunks).
    highlighted = escapeCodeHtml(currentCode);
    let stale = false;
    highlightAsync(currentCode, currentLanguage, () => stale).then((html) => {
      if (!stale) highlighted = html;
    });
    return () => {
      stale = true;
    };
  });

  // Split highlighted HTML into lines for proper rendering
  const lines = $derived(highlighted.split('\n'));
  const lineNumbers = $derived(Array.from({ length: lines.length }, (_, i) => startLineNumber + i));
</script>

<!--
  Theme is keyed on the root `.dark` class (the signal behind `bg-background` and
  Tailwind's `dark:` variant) rather than the Redux theme flag, so the code surface,
  its text and the token palette can never disagree (intent-hq/intent#4647).
-->
<div
  class="code-block-container intent-code-block group rounded-md overflow-hidden relative {className}"
  class:mt-3={!noMargin}
  class:mb-5={!noMargin}
  class:no-border={noBorder}
  style={maxHeight ? `max-height: ${maxHeight}px; overflow-y: auto;` : ''}
>
  <!-- Floating copy button (appears on hover) -->
  <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
    <CopyButton
      text={code}
      size="xs"
      class="bg-background/80 hover:bg-hover text-muted-foreground hover:text-foreground backdrop-blur-sm"
    />
  </div>

  <!-- Code content with flex layout -->
  <div class="flex">
    {#if showLineNumbers}
      <div
        class="line-numbers-gutter intent-code-block select-none text-right flex-shrink-0 py-3 pl-3 pr-2"
      >
        {#each lineNumbers as lineNum (lineNum)}
          <div
            class="line-number intent-code-block"
            class:highlighted={highlightLines.includes(lineNum)}
          >
            {lineNum}
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex-1 {doScroll ? 'overflow-x-auto' : ''}">
      <pre
        class="code-pre intent-code-block py-3 pr-3 bg-background!"
        class:pl-3={!showLineNumbers}><code class="hljs intent-code-block language-{language}"
          >{#each lines as line, i}<div
              class="code-line intent-code-block"
              class:highlighted={highlightLines.includes(startLineNumber + i)}>{@html line ||
                ' '}</div>{/each}</code
        ></pre>
    </div>
  </div>
</div>
