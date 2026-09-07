<script lang="ts">
  /**
   * Viewer (mirror) of a browser tab whose live webview runs on another
   * client — REV-2 Model 3. Renders its own webview at the canonical URL the
   * host last reported and forwards navigations the user makes here to the
   * host (`onNavigate`); the host's echo comes back as a new canonical `url`.
   * The follow/forward loop is guarded by `browser-viewer-navigation.ts`.
   * The mirror never registers for CDP or reports bounds — those belong to
   * the host's live webview.
   */
  import { onDestroy } from 'svelte';
  import { BROWSER_PANEL_PARTITION } from '$shared/constants';
  import BrowserViewerTabHeader from './BrowserViewerTabHeader.svelte';
  import type { BrowserTabHost } from './browser-tab-host';
  import type { EmbeddedBrowserWebview } from './embedded-browser-webview';
  import { isValidBrowserUrl } from './embedded-browser-url-validation';
  import {
    completeViewerFollow,
    createViewerNavigationState,
    reconcileViewerCanonicalUrl,
    recordViewerNavigation,
  } from './browser-viewer-navigation';

  interface Props {
    /** Canonical URL as last reported by the host (daemon registry row). */
    url: string;
    title?: string;
    host: BrowserTabHost;
    isActive?: boolean;
    /** Forward a navigation to the host (`browser.navigateTab`). */
    onNavigate?: (url: string) => void;
    /** Close on the host, or force-close the daemon row while it is offline. */
    onClose?: (options: { force: boolean }) => void;
    /** The mirror's favicon; the title stays canonical (registry row). */
    onFaviconChange?: (faviconUrl: string) => void;
    onFocus?: () => void;
  }

  let {
    url,
    title,
    host,
    isActive = true,
    onNavigate,
    onClose,
    onFaviconChange,
    onFocus,
  }: Props = $props();

  // svelte-ignore state_referenced_locally - the webview is created once at the initial canonical URL
  const initialUrl = isValidBrowserUrl(url) ? url : 'about:blank';
  const navigation = createViewerNavigationState();

  let webviewRef: EmbeddedBrowserWebview | null = $state(null);
  let webviewReady = $state(false);
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let listeners: Array<{ event: string; handler: (e: any) => void }> = [];

  function addListener(target: EmbeddedBrowserWebview, event: string, handler: (e: any) => void) {
    target.addEventListener(event, handler);
    listeners.push({ event, handler });
  }

  function removeListeners(target: EmbeddedBrowserWebview | null) {
    if (target) {
      for (const { event, handler } of listeners) {
        try {
          target.removeEventListener?.(event, handler);
        } catch {
          // The guest may already be destroyed.
        }
      }
    }
    listeners = [];
  }

  function updateHistoryState(target: EmbeddedBrowserWebview) {
    try {
      canGoBack = target.canGoBack();
      canGoForward = target.canGoForward();
    } catch {
      // Not yet attached.
    }
  }

  function handleNavigated(target: EmbeddedBrowserWebview, navigatedUrl: string) {
    if (!navigatedUrl) return;
    const { forward } = recordViewerNavigation(navigation, navigatedUrl);
    if (forward) onNavigate?.(navigatedUrl);
    updateHistoryState(target);
  }

  $effect(() => {
    const target = webviewRef;
    if (!target) return;
    if (!target.getAttribute('partition'))
      target.setAttribute('partition', BROWSER_PANEL_PARTITION);
    if (!target.hasAttribute('allowpopups')) target.setAttribute('allowpopups', '');

    addListener(target, 'dom-ready', () => {
      webviewReady = true;
      updateHistoryState(target);
    });
    addListener(target, 'did-stop-loading', () => {
      webviewReady = true;
      completeViewerFollow(navigation);
      updateHistoryState(target);
    });
    addListener(target, 'did-fail-load', () => completeViewerFollow(navigation));
    addListener(target, 'did-navigate', (e) => handleNavigated(target, e.url));
    addListener(target, 'did-navigate-in-page', (e) => handleNavigated(target, e.url));
    addListener(target, 'page-favicon-updated', (e) => {
      if (e.favicons?.length > 0) onFaviconChange?.(e.favicons[0]);
    });
    addListener(target, 'focus', () => onFocus?.());

    return () => removeListeners(target);
  });

  // Follow the host: a canonical URL change the mirror is not already showing
  // is loaded here. Re-runs on readiness so a change during the initial load
  // is picked up once the webview can navigate.
  $effect(() => {
    const target = webviewRef;
    const decision = reconcileViewerCanonicalUrl(navigation, url, {
      webviewReady,
      isValidBrowserUrl,
    });
    if (!decision.shouldLoad || !decision.targetUrl || !target) return;
    target.loadURL(decision.targetUrl).catch(() => completeViewerFollow(navigation));
  });

  $effect(() => {
    webviewRef?.setAudioMuted?.(!isActive);
  });

  onDestroy(() => removeListeners(webviewRef));
</script>

<div class="flex h-full flex-col bg-background" data-browser-viewer-tab>
  <BrowserViewerTabHeader
    {url}
    {title}
    {host}
    {canGoBack}
    {canGoForward}
    onNavigate={(next) => onNavigate?.(next)}
    onGoBack={() => webviewRef?.goBack()}
    onGoForward={() => webviewRef?.goForward()}
    onRefresh={() => webviewRef?.reload()}
    {onClose}
  />
  <div class="relative min-h-0 flex-1" class:pointer-events-none={!host.connected}>
    <webview
      bind:this={webviewRef}
      class="h-full w-full border-none"
      src={initialUrl}
      partition={BROWSER_PANEL_PARTITION}
      allowpopups
    ></webview>
  </div>
</div>
