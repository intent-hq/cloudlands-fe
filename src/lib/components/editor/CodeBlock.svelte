<script lang="ts">
  import { escapeCodeHtml, getCachedHighlight, highlightAsync } from '$lib/utils/code-highlighter';
  import '$lib/styles/syntax-highlighting.css';
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
  class="code-block-container group rounded-md overflow-hidden relative {className}"
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
      class="bg-white/80 hover:bg-gray-100 text-gray-500 hover:text-gray-700 backdrop-blur-sm dark:bg-[#2d2d3a]/80 dark:hover:bg-[#3d3d4a] dark:text-gray-400 dark:hover:text-gray-200"
    />
  </div>

  <!-- Code content with flex layout -->
  <div class="flex">
    {#if showLineNumbers}
      <div class="line-numbers-gutter select-none text-right flex-shrink-0 py-3 pl-3 pr-2">
        {#each lineNumbers as lineNum (lineNum)}
          <div class="line-number" class:highlighted={highlightLines.includes(lineNum)}>
            {lineNum}
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex-1 {doScroll ? 'overflow-x-auto' : ''}">
      <pre class="code-pre py-3 pr-3 bg-background!" class:pl-3={!showLineNumbers}><code
          class="hljs language-{language}"
          >{#each lines as line, i}<div
              class="code-line"
              class:highlighted={highlightLines.includes(startLineNumber + i)}>{@html line ||
                ' '}</div>{/each}</code
        ></pre>
    </div>
  </div>
</div>

<style>
  /* Container themes - Monaco-like appearance */
  :global(.dark) .code-block-container {
    background: #1e1e1e;
    border: 1px solid #3c3c3c;
  }

  :global(:root:not(.dark)) .code-block-container {
    background: #ffffff;
    border: 1px solid #e5e7eb;
  }

  /* No border variant - transparent background with higher specificity to override theme */
  .no-border,
  :global(:root:not(.dark)) .code-block-container.no-border,
  :global(.dark) .code-block-container.no-border {
    background: transparent;
    border: none;
  }

  /* Line numbers gutter - Monaco style */
  .line-numbers-gutter {
    min-width: 3rem;
  }

  :global(.dark) .code-block-container .line-numbers-gutter {
    background: #1e1e1e;
    border-right: 1px solid #3c3c3c;
  }

  :global(:root:not(.dark)) .code-block-container .line-numbers-gutter {
    background: #f8f9fa;
    border-right: 1px solid #e5e7eb;
  }

  /* Higher specificity to override theme backgrounds */
  .no-border .line-numbers-gutter,
  :global(:root:not(.dark)) .code-block-container.no-border .line-numbers-gutter,
  :global(.dark) .code-block-container.no-border .line-numbers-gutter {
    background: transparent;
    border-right: 1px solid rgba(128, 128, 128, 0.2);
  }

  .line-number {
    font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 20px;
    color: rgba(133, 133, 133, 0.5);
  }

  .line-number.highlighted {
    background: rgba(86, 156, 214, 0.15);
  }

  /* Code area */
  .code-pre {
    margin: 0;
    font-family: 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
    line-height: 20px;
    background: transparent;
  }

  :global(.dark) .code-block-container .code-pre {
    color: #d4d4d4;
  }

  :global(:root:not(.dark)) .code-block-container .code-pre {
    color: #1f2937;
  }

  .code-line {
    min-height: 20px;
  }

  .code-line.highlighted {
    background: rgba(86, 156, 214, 0.15);
  }

  /* VS Code Dark+ syntax highlighting */
  :global(.dark) .code-block-container :global(.hljs-keyword),
  :global(.dark) .code-block-container :global(.hljs-built_in) {
    color: #569cd6;
  }

  :global(.dark) .code-block-container :global(.hljs-tag) {
    color: #569cd6;
  }

  :global(.dark) .code-block-container :global(.hljs-string),
  :global(.dark) .code-block-container :global(.hljs-attr-value) {
    color: #ce9178;
  }

  :global(.dark) .code-block-container :global(.hljs-number),
  :global(.dark) .code-block-container :global(.hljs-literal) {
    color: #b5cea8;
  }

  :global(.dark) .code-block-container :global(.hljs-function),
  :global(.dark) .code-block-container :global(.hljs-title) {
    color: #dcdcaa;
  }

  :global(.dark) .code-block-container :global(.hljs-class),
  :global(.dark) .code-block-container :global(.hljs-name) {
    color: #4ec9b0;
  }

  :global(.dark) .code-block-container :global(.hljs-comment),
  :global(.dark) .code-block-container :global(.hljs-meta) {
    color: #6a9955;
    font-style: italic;
  }

  :global(.dark) .code-block-container :global(.hljs-variable),
  :global(.dark) .code-block-container :global(.hljs-params) {
    color: #9cdcfe;
  }

  :global(.dark) .code-block-container :global(.hljs-attr),
  :global(.dark) .code-block-container :global(.hljs-attribute),
  :global(.dark) .code-block-container :global(.hljs-attr-name) {
    color: #9cdcfe;
  }

  :global(.dark) .code-block-container :global(.hljs-type) {
    color: #4ec9b0;
  }

  :global(.dark) .code-block-container :global(.hljs-symbol),
  :global(.dark) .code-block-container :global(.hljs-bullet) {
    color: #d7ba7d;
  }

  /* VS Code Light+ syntax highlighting */
  :global(:root:not(.dark)) .code-block-container :global(.hljs-keyword),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-built_in) {
    color: #0000ff;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-tag) {
    color: #800000;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-string),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-attr-value) {
    color: #a31515;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-number),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-literal) {
    color: #098658;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-function),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-title) {
    color: #795e26;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-class),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-name) {
    color: #267f99;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-comment),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-meta) {
    color: #008000;
    font-style: italic;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-variable),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-params) {
    color: #001080;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-attr),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-attribute),
  :global(:root:not(.dark)) .code-block-container :global(.hljs-attr-name) {
    color: #e50000;
  }

  :global(:root:not(.dark)) .code-block-container :global(.hljs-type) {
    color: #267f99;
  }
</style>
