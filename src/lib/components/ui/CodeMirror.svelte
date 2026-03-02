<script lang="ts">
  /**
   * Simple code viewer component
   * A lightweight alternative to CodeMirror for displaying code with syntax highlighting
   */
  import { cn } from '$lib/utils';

  interface Props {
    value?: string;
    language?: string;
    readonly?: boolean;
    lineNumbers?: boolean;
    className?: string;
  }

  let {
    value = '',
    language = 'typescript',
    readonly = true,
    lineNumbers = true,
    className = '',
  }: Props = $props();

  let codeElement: HTMLElement | undefined = $state();

  // PERF: Cache for highlighted code to avoid re-processing on unrelated updates
  let lastHighlightKey = '';
  let cachedHighlightedCode = '';

  // Simple syntax highlighting for common tokens
  function highlightCode(code: string, _lang: string): string {
    // Escape HTML
    let highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Basic syntax highlighting patterns
    const patterns = {
      // Comments
      comment: /\/\/.*$/gm,
      blockComment: /\/\*[\s\S]*?\*\//g,
      // Strings
      string: /(['"`])(?:(?=(\\?))\2.)*?\1/g,
      // Keywords (common across languages)
      keyword:
        /\b(const|let|var|function|class|interface|type|export|import|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|this|super|extends|implements|async|await|yield|static|public|private|protected|readonly|abstract|namespace|module|enum|declare|as|from|default)\b/g,
      // Numbers
      number: /\b\d+\.?\d*\b/g,
      // Functions
      function: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g,
    };

    // Apply highlighting
    highlighted = highlighted
      .replace(patterns.blockComment, '<span class="text-subtle">$&</span>')
      .replace(patterns.comment, '<span class="text-subtle">$&</span>')
      .replace(patterns.string, '<span class="text-green-600 dark:text-green-400">$&</span>')
      .replace(
        patterns.keyword,
        '<span class="text-blue-600 dark:text-blue-400 font-medium">$&</span>',
      )
      .replace(patterns.number, '<span class="text-orange-600 dark:text-orange-400">$&</span>')
      .replace(patterns.function, '<span class="text-purple-600 dark:text-purple-400">$1</span>(');

    return highlighted;
  }

  // PERF: Memoized highlighted code with caching
  const highlightedCode = $derived.by(() => {
    const key = `${value}:${language}`;
    if (key === lastHighlightKey) {
      return cachedHighlightedCode;
    }
    const result = highlightCode(value, language);
    lastHighlightKey = key;
    cachedHighlightedCode = result;
    return result;
  });

  // PERF: Memoized line numbers - only recalculate when value changes
  const lines = $derived(value.split('\n'));
  const lineNumbersArray = $derived(Array.from({ length: lines.length }, (_, i) => i + 1));
</script>

<div class={cn('relative overflow-hidden rounded-md border bg-muted/30', className)}>
  <div class="flex">
    {#if lineNumbers}
      <div class="select-none border-r bg-muted/50 px-3 py-3 text-right">
        {#each lineNumbersArray as lineNum (lineNum)}
          <div class="text-xs text-subtle leading-6">
            {lineNum}
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex-1 overflow-x-auto">
      <pre
        bind:this={codeElement}
        class="p-3 text-sm leading-6"
        contenteditable={!readonly}
        spellcheck="false"
        autocorrect="off"
        autocapitalize="off"><code class="language-{language}">{@html highlightedCode}</code></pre>
    </div>
  </div>
</div>

<style>
  pre {
    margin: 0;
    font-family:
      'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    tab-size: 2;
  }

  code {
    font-family: inherit;
  }

  pre:focus {
    outline: none;
  }

  /* Ensure proper text wrapping */
  pre {
    white-space: pre;
    word-wrap: normal;
    overflow-x: auto;
  }

  /* Custom scrollbar */
  pre::-webkit-scrollbar {
    height: 6px;
  }

  pre::-webkit-scrollbar-track {
    background: transparent;
  }

  pre::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.3);
    border-radius: 3px;
  }

  pre::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.5);
  }
</style>
