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
  import {
  ListContainer,
  ListItem,
} from '$lib/components/ui/list';
  import { cn } from '$lib/utils';

  import { selectBrowserRecentUrls } from '$store/renderer/slices/browser/browser-selectors';
  import { selectActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
  addRecentUrl,
  removeRecentUrl,
  clearRecentUrls,
  initBrowserWorkspace,
} from '$store/renderer/slices/browser/browser-slice';
  import {
  faGlobe,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    onOpenUrl: (url: string) => void;
    class?: string;
  }

  let { workspaceId, onOpenUrl, class: className }: Props = $props();

  const recentUrls$ = selectBrowserRecentUrls(workspaceId);

  // Get focused browser URL from reactive selector
  const activeTab$ = selectActiveTab(workspaceId);
  const focusedBrowserUrl = $derived($activeTab$?.browserUrl ?? null);

  // Local state
  let urlInput = $state('');
  let inputError = $state('');

  // Initialize store when workspace changes
  $effect(() => {
    if (workspaceId) {
      appStore.dispatch(initBrowserWorkspace(workspaceId));
    }
  });

  // Validate and normalize URL
  function normalizeUrl(input: string): string | null {
    let url = input.trim();
    if (!url) return null;

    // Only prepend a protocol if the input doesn't already have one (scheme://...).
    // This avoids turning "file:///path" into "https://file:///path".
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      const isLocalhost =
        url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0');
      url = (isLocalhost ? 'http://' : 'https://') + url;
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
      inputError = m.browser_panel_invalidUrl_error();
      return;
    }

    inputError = '';
    appStore.dispatch(addRecentUrl(workspaceId, normalized, undefined, undefined, new Date().toISOString()));
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
    appStore.dispatch(addRecentUrl(workspaceId, url, undefined, undefined, new Date().toISOString())); // Move to top of recents
    onOpenUrl(url);
  }

  // Handle deleting a recent URL
  function handleDeleteUrl(e: MouseEvent, url: string) {
    e.stopPropagation();
    appStore.dispatch(removeRecentUrl(workspaceId, url));
  }

  // Handle clearing all recent URLs
  function handleClearAll() {
    appStore.dispatch(clearRecentUrls(workspaceId));
  }

  // Get display title for URL (use title if available, otherwise hostname)
  function getDisplayTitle(entry: { url: string; title?: string }): string {
    if (entry.title) return entry.title;
    try {
      const urlObj = new URL(entry.url);
      // file:// URLs have no hostname — show the filename instead
      if (urlObj.protocol === 'file:') {
        const path = urlObj.pathname;
        return path.split('/').pop() || path;
      }
      return urlObj.hostname;
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
        placeholder={m.browser_panel_url_placeholder()}
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
        title={m.browser_panel_openUrl_tooltip()}
      >
        <Fa icon={faGlobe} size="sm" />
      </Button>
    </div>
    {#if inputError}
      <p class="text-xs text-destructive-foreground mt-1">{inputError}</p>
    {/if}
  </div>

  <!-- Recent URLs -->
  {#if $recentUrls$.length > 0}
    <div class="flex items-center justify-between px-4 py-1">
      <span class="text-ui uppercase tracking-wider text-muted-foreground">{m.browser_panel_recent_label()}</span>
      <button
        type="button"
        class="text-ui text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer"
        onclick={handleClearAll}
        title={m.browser_panel_clearAll_tooltip()}
      >
        {m.browser_panel_clear_label()}
      </button>
    </div>
    <ListContainer class="px-3" spacing="compact">
      {#each $recentUrls$ as entry (entry.url)}
        <div class="group/url relative">
          <ListItem
            icon={faGlobe}
            iconClass="text-ghost"
            title={getDisplayTitle(entry)}
            onclick={() => handleUrlClick(entry.url)}
            class="cursor-pointer pr-6"
            size="sm"
            active={isUrlActive(entry.url)}
          />
          <button
            type="button"
            class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/url:opacity-100 p-1 text-muted-foreground hover:text-destructive-foreground transition-all cursor-pointer"
            onclick={(e) => handleDeleteUrl(e, entry.url)}
            title={m.browser_panel_remove_tooltip()}
          >
            <Fa icon={faTimes} size="xs" />
          </button>
        </div>
      {/each}
    </ListContainer>
  {/if}
</div>
