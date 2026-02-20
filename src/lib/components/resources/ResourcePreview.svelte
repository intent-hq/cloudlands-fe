<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { resourceManager } from '../../../features/acp-official/resources/resource-manager';
  import type { Resource } from '../../../features/acp-official/resources/resource-manager';
  import { WorkspaceId } from '$shared/types/branded-ids';

  interface Props {
    uri: string;
    inline?: boolean;
    maxHeight?: number;
  }

  let { uri, inline = false, maxHeight = 400 }: Props = $props();

  let resource: Resource | undefined = $state(undefined);
  let expanded = $state(false);
  let loading = $state(true);
  let error: string | null = $state(null);

  async function loadResource() {
    try {
      loading = true;
      error = null;

      // Try to get from cache first
      resource = resourceManager.getResource(uri);

      if (!resource) {
        // Parse and add resource
        const parsed = await resourceManager.parseResourceFromUri(uri);
        if (parsed) {
          resource = parsed;
        } else {
          error = 'Failed to load resource';
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }

  function getPreviewType(mimeType?: string): string {
    if (!mimeType) return 'unknown';

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml'))
      return 'text';
    if (
      mimeType.includes('javascript') ||
      mimeType.includes('typescript') ||
      mimeType.startsWith('text/x-')
    )
      return 'code';

    return 'data';
  }

  function getLanguage(mimeType?: string): string {
    if (!mimeType) return 'plaintext';

    const langMap: Record<string, string> = {
      'application/javascript': 'javascript',
      'application/typescript': 'typescript',
      'text/x-python': 'python',
      'text/x-java': 'java',
      'text/x-c': 'c',
      'text/x-c++': 'cpp',
      'text/x-csharp': 'csharp',
      'text/x-go': 'go',
      'text/x-rust': 'rust',
      'text/x-ruby': 'ruby',
      'text/x-php': 'php',
      'text/html': 'html',
      'text/css': 'css',
      'application/json': 'json',
      'application/xml': 'xml',
      'application/yaml': 'yaml',
    };

    return langMap[mimeType] || 'plaintext';
  }

  function formatSize(bytes?: number): string {
    if (!bytes) return '';

    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  onMount(() => {
    loadResource();
  });
</script>

<div
  class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
  class:my-2={inline}
>
  {#if loading}
    <div class="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
      <span class="fa fa-spinner fa-spin"></span>
      Loading resource...
    </div>
  {:else if error}
    <div class="p-4 text-center text-sm text-red-600 dark:text-red-400">
      <span class="fa fa-exclamation-triangle"></span>
      {error}
    </div>
  {:else if resource}
    <!-- Header -->
    <button
      class="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
      onclick={() => (expanded = !expanded)}
    >
      <div class="flex items-start gap-3">
        <span class="text-lg text-gray-600 dark:text-gray-400 mt-0.5">
          {#if getPreviewType(resource.mimeType) === 'image'}
            <span class="fa fa-image"></span>
          {:else if getPreviewType(resource.mimeType) === 'code'}
            <span class="fa fa-code"></span>
          {:else if getPreviewType(resource.mimeType) === 'text'}
            <span class="fa fa-file-alt"></span>
          {:else}
            <span class="fa fa-file"></span>
          {/if}
        </span>

        <div class="flex-1 min-w-0">
          <div class="font-medium text-gray-900 dark:text-white flex items-center gap-2">
            {resource.title}
            {#if resource.cached}
              <span
                class="px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded"
                >Cached</span
              >
            {/if}
          </div>

          <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
            <span>{resource.mimeType || 'Unknown type'}</span>
            {#if resource.size}
              <span>•</span>
              <span>{formatSize(resource.size)}</span>
            {/if}
          </div>
        </div>
      </div>

      <span class="text-gray-400 transition-transform" class:rotate-180={expanded}>
        <span class="fa fa-chevron-down"></span>
      </span>
    </button>

    <!-- Preview Content -->
    {#if expanded && resource.preview}
      <div
        class="overflow-auto border-t border-gray-200 dark:border-gray-700"
        style="max-height: {maxHeight}px"
        transition:slide={{ duration: 200 }}
      >
        {#if getPreviewType(resource.mimeType) === 'image'}
          <img src={resource.preview} alt={resource.title} class="w-full h-auto" />
        {:else if getPreviewType(resource.mimeType) === 'code'}
          <pre
            class={`p-4 text-sm font-mono bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 whitespace-pre-wrap wrap-break-word language-${getLanguage(resource.mimeType)}`}><code
              >{resource.preview}</code
            ></pre>
        {:else}
          <pre
            class="p-4 text-sm font-mono bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 whitespace-pre-wrap wrap-break-word">{resource.preview}</pre>
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    {#if expanded}
      <div
        class="flex items-center gap-2 p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50"
        transition:slide={{ duration: 200 }}
      >
        <button
          class="px-3 py-1.5 text-xs font-medium rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
          onclick={() => navigator.clipboard.writeText(resource?.preview || '')}
          title="Copy content"
        >
          <span class="fa fa-copy"></span>
          Copy
        </button>

        <button
          class="px-3 py-1.5 text-xs font-medium rounded bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
          onclick={() => {
            if (resource?.uri) {
              const wsId = workspaceStore.current?.id;
              if (wsId) {
                handleLink(resource.uri, { workspaceId: WorkspaceId(wsId) });
              }
            }
          }}
          title="Open in new tab"
        >
          <span class="fa fa-external-link-alt"></span>
          Open
        </button>

        {#if resource.description}
          <div class="flex-1 text-xs text-gray-600 dark:text-gray-400 ml-auto text-right">
            {resource.description}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
