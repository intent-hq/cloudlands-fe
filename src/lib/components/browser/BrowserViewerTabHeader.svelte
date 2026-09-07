<script lang="ts">
  /**
   * Toolbar of a viewer (mirror) browser tab — a tab whose live webview runs
   * on another client (REV-2, spec Model 3). Mirrors the EmbeddedBrowser
   * toolbar: navigation controls and the page identity / editable address.
   * Which client drives the tab is shown by the sidebar indicator, not here.
   * While the host is offline the controls are disabled and a banner explains
   * why. Presentational — no wire calls.
   */
  import {
    faArrowLeft,
    faArrowRight,
    faLock,
    faRefresh,
    faTriangleExclamation,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { m } from '$shared/paraglide/messages.js';
  import type { BrowserTabHost } from './browser-tab-host';
  import {
    isValidBrowserUrl,
    normalizeBrowserAddressInput,
  } from './embedded-browser-url-validation';

  interface Props {
    /** Canonical URL as last reported by the host. */
    url: string;
    /** Canonical page title as last reported by the host. */
    title?: string;
    host: BrowserTabHost;
    canGoBack?: boolean;
    canGoForward?: boolean;
    /** Request navigation on the host (`browser.navigateTab`). */
    onNavigate?: (url: string) => void;
    onGoBack?: () => void;
    onGoForward?: () => void;
    onRefresh?: () => void;
    /** Close on the host, or force-close the daemon row while it is offline. */
    onClose?: (options: { force: boolean }) => void;
  }

  let {
    url,
    title,
    host,
    canGoBack = true,
    canGoForward = true,
    onNavigate,
    onGoBack,
    onGoForward,
    onRefresh,
    onClose,
  }: Props = $props();

  let isEditingUrl = $state(false);
  let urlDraft = $state('');
  let urlDraftInvalid = $state(false);
  let urlInputRef: { focus: () => void; select: () => void } | null = $state(null);

  const offline = $derived(!host.connected);
  const isSecure = $derived(url.startsWith('https://'));
  const pageHostname = $derived.by(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  });
  const identityTitle = $derived(title?.trim() || pageHostname || url);

  async function startEditingUrl() {
    if (offline) return;
    urlDraft = url;
    urlDraftInvalid = false;
    isEditingUrl = true;
    await tick();
    urlInputRef?.focus();
    urlInputRef?.select();
  }

  // Same normalization and validation as the local address bars, so a bare
  // hostname is accepted here exactly as it is on a locally hosted tab.
  function submitUrl(event: SubmitEvent) {
    event.preventDefault();
    if (!urlDraft.trim()) {
      isEditingUrl = false;
      return;
    }
    const next = normalizeBrowserAddressInput(urlDraft);
    if (!next || !isValidBrowserUrl(next)) {
      urlDraftInvalid = true;
      return;
    }
    isEditingUrl = false;
    if (next !== url) onNavigate?.(next);
  }

  function handleUrlKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      isEditingUrl = false;
    }
  }
</script>

<div class="flex flex-col" data-browser-viewer-header={offline ? 'offline' : 'online'}>
  <div
    class="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2"
    data-browser-toolbar
  >
    <div class="flex gap-0.5">
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onGoBack?.()}
        disabled={offline || !canGoBack}
        tooltip={m.browser_embedded_goBack_tooltip()}
        tooltipSide="bottom"
        aria-label={m.browser_embedded_goBack_ariaLabel()}
      >
        <Fa icon={faArrowLeft} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onGoForward?.()}
        disabled={offline || !canGoForward}
        tooltip={m.browser_embedded_goForward_tooltip()}
        tooltipSide="bottom"
        aria-label={m.browser_embedded_goForward_ariaLabel()}
      >
        <Fa icon={faArrowRight} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={() => onRefresh?.()}
        disabled={offline}
        tooltip={m.browser_embedded_refresh_tooltip()}
        tooltipSide="bottom"
        aria-label={m.browser_embedded_refresh_ariaLabel()}
      >
        <Fa icon={faRefresh} size="xs" />
      </Button>
    </div>

    <div
      class="flex h-8 min-w-0 flex-1 items-center rounded-md bg-background px-2 {offline
        ? 'opacity-60'
        : ''}"
    >
      {#if isEditingUrl}
        <form onsubmit={submitUrl} class="flex h-full min-w-0 flex-1 items-center">
          <Input
            bind:this={urlInputRef}
            type="text"
            bind:value={urlDraft}
            oninput={() => (urlDraftInvalid = false)}
            onkeydown={handleUrlKeydown}
            onblur={() => (isEditingUrl = false)}
            noFocusStyle
            class="h-full flex-1 rounded-none border-0 bg-transparent px-0 hover:border-transparent"
            placeholder={m.browser_embedded_url_placeholder()}
            aria-label={m.browser_embedded_addressInput_ariaLabel()}
            aria-invalid={urlDraftInvalid || undefined}
            title={urlDraftInvalid ? m.browser_panel_invalidUrl_error() : undefined}
          />
          <Button type="submit" variant="ghost" size="xs" class="sr-only">
            {m.browser_embedded_go_label()}
          </Button>
        </form>
      {:else}
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:bg-transparent"
          onclick={() => void startEditingUrl()}
          disabled={offline}
          aria-label={m.browser_embedded_editAddress_ariaLabel()}
          title={offline
            ? m.browser_viewer_navigationPaused_tooltip({ host: host.name })
            : undefined}
        >
          {#if isSecure}
            <Fa icon={faLock} class="shrink-0 text-muted-foreground" size="sm" />
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            >{identityTitle}</span
          >
          {#if title && pageHostname && pageHostname !== title}
            <span class="browser-viewer-hostname truncate text-xs text-muted-foreground"
              >{pageHostname}</span
            >
          {/if}
        </button>
      {/if}
    </div>

    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={() => onClose?.({ force: false })}
      disabled={offline}
      tooltip={m.browser_embedded_close_tooltip()}
      tooltipSide="bottom"
      aria-label={m.browser_embedded_close_ariaLabel()}
    >
      <Fa icon={faXmark} size="xs" />
    </Button>
  </div>

  {#if offline}
    <div
      class="flex items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning"
      data-browser-viewer-offline-banner
      role="status"
    >
      <Fa icon={faTriangleExclamation} class="shrink-0" />
      <span class="min-w-0 flex-1">
        {m.browser_viewer_hostOffline_description({ host: host.name })}
      </span>
      <Button variant="outline" size="xs" onclick={() => onClose?.({ force: true })}>
        {m.browser_viewer_forceClose_label()}
      </Button>
    </div>
  {/if}
</div>

<style>
  .browser-viewer-hostname {
    max-width: 40%;
  }
</style>
