<script lang="ts">
  /**
   * WebBrowserPanel Component
   *
   * Displays external web content in a sandboxed webview with browser controls
   */

  import { onMount, onDestroy } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { track, extractDomain } from '$lib/services/analytics';
  import {
    faArrowLeft,
    faArrowRight,
    faRefresh,
    faHome,
    faExternalLinkAlt,
    faShield,
    faLock,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import Button from '../ui/button/button.svelte';
  import { BROWSER_PROTOCOLS } from '../../../shared/constants';
  import { TooltipShortcut } from '../ui/tooltip';
  import { toast } from '../ui/toast';

  const logger = createLogger('WebBrowserPanel');

  // Props
  let {
    url = $bindable(''),
    workspaceId,
    sourceId,
    onClose,
    onNavigate,
  }: {
    url: string;
    workspaceId?: string;
    sourceId?: string;
    onClose?: () => void;
    onNavigate?: (url: string) => void;
  } = $props();

  // State
  let webviewRef: any = $state(null);
  let currentUrl = $state(url);
  let displayUrl = $state(url);
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let isLoading = $state(false);
  let isSecure = $state(false);
  let errorMessage = $state('');

  // Update display URL when prop changes
  $effect(() => {
    if (url && url !== currentUrl) {
      navigateTo(url);
    }
  });

  onMount(() => {
    // Load initial URL
    if (url) {
      navigateTo(url);
    }

    // Add keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      // Alt+Left for back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleGoBack();
      }
      // Alt+Right for forward
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleGoForward();
      }
      // F5 or Cmd/Ctrl+R for refresh
      else if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && e.key === 'r')) {
        e.preventDefault();
        handleRefresh();
      }
      // Escape to close
      else if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    // Additional cleanup if needed
  });

  // Note: iframe limitations mean we can't control navigation or access content
  // for cross-origin sites. This is a security feature of browsers.

  function navigateTo(targetUrl: string) {
    if (!webviewRef || !targetUrl) return;

    try {
      // Validate URL
      const urlObj = new URL(targetUrl);

      // Only allow protocols from the shared constant
      if (!BROWSER_PROTOCOLS.NAVIGATION_ALLOWED.includes(urlObj.protocol)) {
        throw new Error(`Invalid protocol: ${urlObj.protocol}`);
      }

      currentUrl = targetUrl;
      displayUrl = targetUrl;
      errorMessage = '';

      // Navigate webview
      webviewRef.loadURL(targetUrl);

      // Track navigation event
      track('Navigated Browser', { url_domain: extractDomain(targetUrl) });

      logger.info('Navigating to URL', { url: targetUrl });
    } catch (error) {
      logger.error('Invalid URL', error);
      errorMessage = `Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}`;
      toast.error(errorMessage);
    }
  }

  function handleGoBack() {
    // Navigation control not available with iframe
    toast.info('Browser navigation is limited for security reasons');
  }

  function handleGoForward() {
    // Navigation control not available with iframe
    toast.info('Browser navigation is limited for security reasons');
  }

  function handleRefresh() {
    if (webviewRef) {
      // Reload iframe
      webviewRef.src = currentUrl;
      isLoading = true;
    }
  }

  function handleGoHome() {
    if (url) {
      navigateTo(url);
    }
  }

  function handleOpenExternal() {
    if (currentUrl) {
      // Track open external event
      track('Opened External Browser', { url_domain: extractDomain(currentUrl) });
      // Open in default browser
      window.electronAPI?.invoke('shell:openExternal', { url: currentUrl });
    }
  }

  // Simplified handlers for iframe
  function handleIframeLoad() {
    isLoading = false;
    // Check if URL is HTTPS
    isSecure = currentUrl.startsWith('https://');
  }

  function handleIframeError() {
    isLoading = false;
    errorMessage = 'Unable to load content. The site may block embedding.';
  }

  function handleUrlSubmit(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      let urlToNavigate = displayUrl;

      // Only prepend a protocol if the input doesn't already have one (scheme://...).
      // This avoids turning "file:///path" into "https://file:///path" (ERR_NAME_NOT_RESOLVED).
      // navigateTo() will reject disallowed protocols with a clear error message.
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(urlToNavigate)) {
        urlToNavigate = `https://${urlToNavigate}`;
      }

      navigateTo(urlToNavigate);
    }
  }
</script>

<div class="web-browser-panel">
  <!-- Browser Toolbar -->
  <div class="browser-toolbar">
    <div class="navigation-controls">
      <TooltipShortcut label="Go back" shortcut="alt+left" side="bottom" delayDuration={300}>
        <Button
          variant="ghost"
          size="icon"
          onclick={handleGoBack}
          disabled={!canGoBack}
          aria-label="Navigate back"
        >
          <Fa icon={faArrowLeft} />
        </Button>
      </TooltipShortcut>

      <TooltipShortcut label="Go forward" shortcut="alt+right" side="bottom" delayDuration={300}>
        <Button
          variant="ghost"
          size="icon"
          onclick={handleGoForward}
          disabled={!canGoForward}
          aria-label="Navigate forward"
        >
          <Fa icon={faArrowRight} />
        </Button>
      </TooltipShortcut>

      <TooltipShortcut label="Refresh" shortcut="cmd+r" side="bottom" delayDuration={300}>
        <Button
          variant="ghost"
          size="icon"
          onclick={handleRefresh}
          disabled={isLoading}
          aria-label="Refresh page"
        >
          <Fa icon={faRefresh} class={isLoading ? 'animate-spin' : ''} />
        </Button>
      </TooltipShortcut>

      <TooltipShortcut label="Go to original URL" side="bottom" delayDuration={300}>
        <Button variant="ghost" size="icon" onclick={handleGoHome} aria-label="Go to original URL">
          <Fa icon={faHome} />
        </Button>
      </TooltipShortcut>
    </div>

    <div class="url-bar">
      {#if isSecure}
        <Fa icon={faLock} class="text-green-500 mr-2" title="Secure connection" />
      {:else}
        <Fa icon={faShield} class="text-muted-foreground mr-2" title="Not secure" />
      {/if}

      <input
        type="text"
        bind:value={displayUrl}
        onkeydown={handleUrlSubmit}
        class="url-input"
        placeholder="Enter URL..."
      />
    </div>

    <div class="toolbar-actions">
      <TooltipShortcut label="Open in external browser" side="bottom" delayDuration={300}>
        <Button variant="ghost" size="icon" onclick={handleOpenExternal}>
          <Fa icon={faExternalLinkAlt} />
        </Button>
      </TooltipShortcut>

      {#if onClose}
        <TooltipShortcut label="Close browser" shortcut="esc" side="bottom" delayDuration={300}>
          <Button variant="ghost" size="icon" onclick={onClose}>×</Button>
        </TooltipShortcut>
      {/if}
    </div>
  </div>

  <!-- Error Message -->
  {#if errorMessage}
    <div class="error-banner">
      {errorMessage}
    </div>
  {/if}

  <!-- Browser Content -->
  <div class="browser-content">
    {#if currentUrl}
      <iframe
        bind:this={webviewRef}
        class="webview"
        src={currentUrl}
        title="External content"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy"
        onload={handleIframeLoad}
        onerror={handleIframeError}
      ></iframe>
    {:else}
      <div class="empty-state">
        <div class="text-center">
          <div class="text-4xl mb-3 opacity-50">🌐</div>
          <p class="text-lg font-medium mb-2">No URL specified</p>
          <p class="text-sm text-muted-foreground">Enter a URL in the address bar above</p>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .web-browser-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--vscode-editor-background);
  }

  .browser-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border);
  }

  .navigation-controls {
    display: flex;
    gap: 0.25rem;
  }

  .url-bar {
    flex: 1;
    display: flex;
    align-items: center;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 0 0.5rem;
  }

  .url-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--vscode-input-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }

  .toolbar-actions {
    display: flex;
    gap: 0.25rem;
  }

  .error-banner {
    padding: 0.5rem 1rem;
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
  }

  .browser-content {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .webview {
    width: 100%;
    height: 100%;
    border: none;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-foreground);
    opacity: 0.6;
  }

  :global(.animate-spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
