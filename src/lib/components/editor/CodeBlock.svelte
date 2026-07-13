<script lang="ts">
  import hljs from 'highlight.js';
  import '$lib/styles/syntax-highlighting.css';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { selectIsDarkTheme } from '$store/renderer/slices/theme/theme-selectors';

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
  }

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

  let highlighted = $state('');
  const isDarkTheme = selectIsDarkTheme();

  $effect(() => {
    // Highlight code when it changes
    try {
      if (language && hljs.getLanguage(language)) {
        highlighted = hljs.highlight(code, { language }).value;
      } else {
        highlighted = hljs.highlightAuto(code).value;
      }
    } catch {
      highlighted = escapeHtml(code);
    }
  });

  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Split highlighted HTML into lines for proper rendering
  const lines = $derived(highlighted.split('\n'));
  const lineNumbers = $derived(Array.from({ length: lines.length }, (_, i) => startLineNumber + i));
</script>

<div
  class="code-block-container group rounded-md overflow-hidden relative {className}"
  class:mt-3={!noMargin}
  class:mb-5={!noMargin}
  class:dark-theme={$isDarkTheme}
  class:light-theme={!$isDarkTheme}
  class:no-border={noBorder}
  style={maxHeight ? `max-height: ${maxHeight}px; overflow-y: auto;` : ''}
  data-theme={$isDarkTheme ? 'dark' : 'light'}
>
  <!-- Floating copy button (appears on hover) -->
  <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
    <CopyButton
      text={code}
      size="xs"
      class={$isDarkTheme
        ? 'bg-[#2d2d3a]/80 hover:bg-[#3d3d4a] text-gray-400 hover:text-gray-200 backdrop-blur-sm'
        : 'bg-white/80 hover:bg-gray-100 text-gray-500 hover:text-gray-700 backdrop-blur-sm'}
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
  .dark-theme {
    background: #1e1e1e;
    border: 1px solid #3c3c3c;
  }

  .light-theme {
    background: #ffffff;
    border: 1px solid #e5e7eb;
  }

  /* No border variant - transparent background with higher specificity to override theme */
  .no-border,
  .no-border.light-theme,
  .no-border.dark-theme {
    background: transparent;
    border: none;
  }

  /* Line numbers gutter - Monaco style */
  .line-numbers-gutter {
    min-width: 3rem;
  }

  .dark-theme .line-numbers-gutter {
    background: #1e1e1e;
    border-right: 1px solid #3c3c3c;
  }

  .light-theme .line-numbers-gutter {
    background: #f8f9fa;
    border-right: 1px solid #e5e7eb;
  }

  /* Higher specificity to override theme backgrounds */
  .no-border .line-numbers-gutter,
  .no-border.light-theme .line-numbers-gutter,
  .no-border.dark-theme .line-numbers-gutter {
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

  .dark-theme .code-pre {
    color: #d4d4d4;
  }

  .light-theme .code-pre {
    color: #1f2937;
  }

  .code-line {
    min-height: 20px;
  }

  .code-line.highlighted {
    background: rgba(86, 156, 214, 0.15);
  }

  /* VS Code Dark+ syntax highlighting */
  .dark-theme :global(.hljs-keyword),
  .dark-theme :global(.hljs-built_in) {
    color: #569cd6;
  }

  .dark-theme :global(.hljs-tag) {
    color: #569cd6;
  }

  .dark-theme :global(.hljs-string),
  .dark-theme :global(.hljs-attr-value) {
    color: #ce9178;
  }

  .dark-theme :global(.hljs-number),
  .dark-theme :global(.hljs-literal) {
    color: #b5cea8;
  }

  .dark-theme :global(.hljs-function),
  .dark-theme :global(.hljs-title) {
    color: #dcdcaa;
  }

  .dark-theme :global(.hljs-class),
  .dark-theme :global(.hljs-name) {
    color: #4ec9b0;
  }

  .dark-theme :global(.hljs-comment),
  .dark-theme :global(.hljs-meta) {
    color: #6a9955;
    font-style: italic;
  }

  .dark-theme :global(.hljs-variable),
  .dark-theme :global(.hljs-params) {
    color: #9cdcfe;
  }

  .dark-theme :global(.hljs-attr),
  .dark-theme :global(.hljs-attribute),
  .dark-theme :global(.hljs-attr-name) {
    color: #9cdcfe;
  }

  .dark-theme :global(.hljs-type) {
    color: #4ec9b0;
  }

  .dark-theme :global(.hljs-symbol),
  .dark-theme :global(.hljs-bullet) {
    color: #d7ba7d;
  }

  /* VS Code Light+ syntax highlighting */
  .light-theme :global(.hljs-keyword),
  .light-theme :global(.hljs-built_in) {
    color: #0000ff;
  }

  .light-theme :global(.hljs-tag) {
    color: #800000;
  }

  .light-theme :global(.hljs-string),
  .light-theme :global(.hljs-attr-value) {
    color: #a31515;
  }

  .light-theme :global(.hljs-number),
  .light-theme :global(.hljs-literal) {
    color: #098658;
  }

  .light-theme :global(.hljs-function),
  .light-theme :global(.hljs-title) {
    color: #795e26;
  }

  .light-theme :global(.hljs-class),
  .light-theme :global(.hljs-name) {
    color: #267f99;
  }

  .light-theme :global(.hljs-comment),
  .light-theme :global(.hljs-meta) {
    color: #008000;
    font-style: italic;
  }

  .light-theme :global(.hljs-variable),
  .light-theme :global(.hljs-params) {
    color: #001080;
  }

  .light-theme :global(.hljs-attr),
  .light-theme :global(.hljs-attribute),
  .light-theme :global(.hljs-attr-name) {
    color: #e50000;
  }

  .light-theme :global(.hljs-type) {
    color: #267f99;
  }
</style>
