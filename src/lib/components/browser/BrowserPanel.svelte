<script lang="ts">
  /**
   * BrowserPanel - Sidebar panel for entering URLs and viewing recent URLs
   *
   * Provides:
   * - URL input with Enter to submit
   * - List of recent URLs with click to open
   * - Delete individual URLs or clear all
   * - Highlights the currently focused browser tab's URL
   */
  import { Input } from '$lib/components/ui/input';
  import { ListContainer, ListItem } from '$lib/components/ui/list';
  import { cn } from '$lib/utils';
  import { browserStore } from '$features/browser/browser.store.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
  import { faGlobe, faTimes } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';

  interface Props {
    workspaceId: string;
    onOpenUrl: (url: string) => void;
    class?: string;
  }

  let { workspaceId, onOpenUrl, class: className }: Props = $props();

  // Get focused browser URL from panel layout manager
  const panelLayoutManager = $derived(getPanelLayoutManager(workspaceId));
  const focusedBrowserUrl = $derived(panelLayoutManager.focusedContent.browserUrl);

  // Local state
  let urlInput = $state('');
  let inputError = $state('');

  // Initialize store when workspace changes
  $effect(() => {
    if (workspaceId) {
      browserStore.initialize(workspaceId);
    }
  });

  // Validate and normalize URL
  function normalizeUrl(input: string): string | null {
    let url = input.trim();
    if (!url) return null;

    // Add protocol if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      new URL(url);
      return url;
    } catch {
      return null;
    }
  }

  // Handle URL submission
  function handleSubmit() {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) {
      inputError = 'Please enter a valid URL';
      return;
    }

    inputError = '';
    browserStore.addRecentUrl(normalized);
    onOpenUrl(normalized);
    urlInput = '';
  }

  // Handle keyboard events in input
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    // Clear error on typing
    if (inputError) {
      inputError = '';
    }
  }

  // Handle clicking a recent URL
  function handleUrlClick(url: string) {
    browserStore.addRecentUrl(url); // Move to top of recents
    onOpenUrl(url);
  }

  // Handle deleting a recent URL
  function handleDeleteUrl(e: MouseEvent, url: string) {
    e.stopPropagation();
    browserStore.removeRecentUrl(url);
  }

  // Handle clearing all recent URLs
  function handleClearAll() {
    browserStore.clearRecentUrls();
  }

  // Get display title for URL (use title if available, otherwise hostname)
  function getDisplayTitle(entry: { url: string; title?: string }): string {
    if (entry.title) return entry.title;
    try {
      const url = new URL(entry.url);
      return url.hostname;
    } catch {
      return entry.url;
    }
  }

  // Check if a URL matches the focused browser URL
  // URLs might differ slightly (trailing slashes, www prefix, etc.)
  function isUrlActive(url: string): boolean {
    if (!focusedBrowserUrl) return false;
    // Normalize URLs for comparison
    try {
      const a = new URL(url);
      const b = new URL(focusedBrowserUrl);
      // Compare origin + pathname (ignoring trailing slash)
      const normalizePathname = (p: string) => (p.endsWith('/') ? p.slice(0, -1) : p);
      return a.origin === b.origin && normalizePathname(a.pathname) === normalizePathname(b.pathname);
    } catch {
      // Fallback to simple string comparison
      return url === focusedBrowserUrl;
    }
  }
</script>

<div class={cn('flex flex-col', className)}>
  <!-- URL Input -->
  <div class="px-2.5 py-2">
    <div class="relative">
      <Input
        type="text"
        placeholder="Enter URL..."
        bind:value={urlInput}
        onkeydown={handleKeydown}
        noFocusStyle
        class={cn('h-8 pr-8 text-sm', inputError && 'border-destructive')}
      />
      <Button
        variant="ghost-light"
        size="icon-xs"
        class="absolute right-1 top-1/2 -translate-y-1/2"
        onclick={handleSubmit}
        disabled={!urlInput}
        title="Open URL"
      >
        <Fa icon={faGlobe} size="sm" />
      </Button>
    </div>
    {#if inputError}
      <p class="text-xs text-destructive mt-1">{inputError}</p>
    {/if}
  </div>

  <!-- Recent URLs -->
  {#if browserStore.recentUrls.length > 0}
    <div class="flex items-center justify-between px-4 py-1">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground/70">Recent</span>
      <button
        type="button"
        class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
        onclick={handleClearAll}
        title="Clear all"
      >
        Clear
      </button>
    </div>
    <ListContainer class="px-3" spacing="compact">
      {#each browserStore.recentUrls as entry (entry.url)}
        <div class="group/url relative">
          <ListItem
            icon={faGlobe}
            iconClass="text-muted-foreground/50"
            title={getDisplayTitle(entry)}
            onclick={() => handleUrlClick(entry.url)}
            class="cursor-pointer pr-6"
            size="sm"
            active={isUrlActive(entry.url)}
          />
          <button
            type="button"
            class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/url:opacity-100 p-1 text-muted-foreground/50 hover:text-destructive transition-all cursor-pointer"
            onclick={(e) => handleDeleteUrl(e, entry.url)}
            title="Remove"
          >
            <Fa icon={faTimes} size="xs" />
          </button>
        </div>
      {/each}
    </ListContainer>
  {/if}
</div>
