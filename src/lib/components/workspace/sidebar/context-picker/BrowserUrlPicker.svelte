<script lang="ts">
  /**
   * BrowserUrlPicker - Picker component for adding browser URLs
   *
   * Simple URL input with recent URLs list.
   */
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import {
  faGlobe,
  faPlus,
  faHistory,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { onMount } from 'svelte';

  import { selectBrowserRecentUrls } from '$store/renderer/slices/browser/browser-selectors';
  import {
  addRecentUrl,
  initBrowserWorkspace,
} from '$store/renderer/slices/browser/browser-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    onSelect: (item: { type: string; title: string; url: string; identifier: string; metadata?: Record<string, unknown> }) => void;
    onClose: () => void;
  }

  let { workspaceId, onSelect, onClose }: Props = $props();

  const recentUrls$ = selectBrowserRecentUrls(workspaceId);

  let urlInput = $state('');
  let urlError = $state('');

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

  function getDisplayTitle(url: string): string {
    try {
      const urlObj = new URL(url);
      // file:// URLs have no hostname — show the filename instead
      if (urlObj.protocol === 'file:') {
        const path = urlObj.pathname;
        return path.split('/').pop() || path;
      }
      return urlObj.hostname;
    } catch {
      return url;
    }
  }

  function handleSubmit() {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) {
      urlError = 'Please enter a valid URL';
      return;
    }

    urlError = '';

    // Add to browser store for history
    appStore.dispatch(addRecentUrl(workspaceId, normalized, undefined, undefined, new Date().toISOString()));

    onSelect({
      type: 'browser-url',
      title: getDisplayTitle(normalized),
      url: normalized,
      identifier: normalized,
    });
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (urlError) {
      urlError = '';
    }
  }

  function handleRecentClick(entry: { url: string; title?: string }) {
    onSelect({
      type: 'browser-url',
      title: entry.title || getDisplayTitle(entry.url),
      url: entry.url,
      identifier: entry.url,
    });
    onClose();
  }

  onMount(() => {
    appStore.dispatch(initBrowserWorkspace(workspaceId));
  });
</script>

<div class="p-4">
  <!-- URL Input -->
  <div class="space-y-2">
    <label for="url-input" class="text-sm font-medium">Enter URL</label>
    <div class="flex gap-2">
      <div class="flex-1 relative">
        <Fa icon={faGlobe} class="absolute left-3 top-1/2 -translate-y-1/2 text-ghost" size="sm" />
        <Input
          bind:value={urlInput}
          placeholder="https://example.com"
          class="pl-9 h-10"
          onkeydown={handleKeydown}
          id="url-input"
          autofocus
        />
      </div>
      <Button onclick={handleSubmit} disabled={!urlInput.trim()}>
        <Fa icon={faPlus} class="mr-1.5" size="sm" />
        Add
      </Button>
    </div>
    {#if urlError}
      <p class="text-xs text-destructive-foreground">{urlError}</p>
    {/if}
  </div>

  <!-- Recent URLs -->
  {#if $recentUrls$.length > 0}
    <div class="mt-6">
      <div class="flex items-center gap-2 text-sm text-subtle mb-2">
        <Fa icon={faHistory} size="sm" />
        <span>Recent URLs</span>
      </div>
      <div class="space-y-1 max-h-48 overflow-y-auto">
        {#each $recentUrls$.slice(0, 10) as entry (entry.url)}
          <button
            type="button"
            class="w-full text-left px-3 py-2 rounded hover:bg-muted/50 transition-colors cursor-pointer flex items-center gap-2"
            onclick={() => handleRecentClick(entry)}
          >
            <Fa icon={faGlobe} size="sm" class="text-ghost shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate">{entry.title || getDisplayTitle(entry.url)}</p>
              <p class="text-xs text-subtle truncate">{entry.url}</p>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
