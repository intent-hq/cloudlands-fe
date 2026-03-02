<script lang="ts">
  import CodeBlock from './CodeBlock.svelte';
  import Fa from 'svelte-fa';
  import { faFileCode, faExternalLinkAlt, faFile } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    code?: string;
    language?: string;
    path?: string;
    mode?: string;
    showLineNumbers?: boolean;
    /** Callback for opening a file. Includes openInAdjacentPanel and sourcePanelId for panel layout support. */
    onOpenFile?: (detail: {
      path: string;
      openInAdjacentPanel?: boolean;
      sourcePanelId?: string;
    }) => void;
  }

  const {
    code = '',
    language = 'plaintext',
    path = '',
    mode = 'EXCERPT',
    showLineNumbers = true,
    onOpenFile,
  } = $props();

  function handleOpenFile(event: MouseEvent) {
    if (path) {
      const openInAdjacentPanel = event.metaKey || event.ctrlKey;
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      onOpenFile?.({ path, openInAdjacentPanel, sourcePanelId });
    }
  }

  // Extract line numbers from path if present (e.g., "file.ts:10-20")
  const pathParts = $derived(path.split(':'));
  const filePath = $derived(pathParts[0]);
  const lineRange = $derived(pathParts[1] || '');
</script>

<div class="my-4 group">
  <!-- Header with file path and mode -->
  <div class="flex items-center justify-between mb-1 px-3">
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <button
        class="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:text-muted-foreground transition-colors text-inherit cursor-pointer"
        onclick={handleOpenFile}
        title="Click to open file"
      >
        <span
          class="text-muted-foreground truncate group-hover:text-muted-foreground transition-colors"
        >
          {filePath.split('/').pop()}
        </span>
        {#if lineRange}
          <span class="text-subtle">:{lineRange}</span>
        {/if}
        <!-- <Fa
          icon={faFile}
          size="xs"
          class="text-ghost opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        /> -->
      </button>
    </div>

    {#if mode && mode !== 'EXCERPT'}
      <span
        class="text-ui uppercase tracking-wider font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded"
      >
        {mode}
      </span>
    {/if}
  </div>

  <!-- Code block -->
  <CodeBlock {code} {language} fileName={filePath} {showLineNumbers} />
</div>
