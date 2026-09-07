<script lang="ts">
  /**
   * Viewer (mirror) of a browser tab whose live webview runs on another
   * client — REV-2 Model 3. Renders its own webview at the canonical URL the
   * host last reported and forwards navigations the user makes here to the
   * host (`onNavigate`); the host's echo comes back as a new canonical `url`.
   * The follow/forward loop is decided by the fenced reconciler in
   * `browser-viewer-navigation.ts`: this component only feeds it events and
   * executes its commands. The mirror never registers for CDP or reports
   * bounds — those belong to the host's live webview.
   */
  import { onDestroy } from 'svelte';
  import { BROWSER_PANEL_PARTITION } from '$shared/constants';
  import BrowserViewerTabHeader from './BrowserViewerTabHeader.svelte';
  import type { BrowserTabHost } from './browser-tab-host';
  import type { EmbeddedBrowserWebview } from './embedded-browser-webview';
  import { isValidBrowserUrl } from './embedded-browser-url-validation';
  import {
    applyViewerNavigationEvent,
    createViewerNavigationState,
    type ViewerNavigationCommand,
    type ViewerNavigationEvent,
  } from './browser-viewer-navigation';

  interface Props {
    /** Canonical URL as last reported by the host (daemon registry row). */
    url: string;
    title?: string;
    host: BrowserTabHost;
    isActive?: boolean;
    /**
     * Forward a navigation to the host (`browser.navigateTab`). A returned
     * promise that rejects means the host stayed put; the mirror then
     * reloads the canonical URL.
     */
    onNavigate?: (url: string) => Promise<unknown> | void;
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
  const navigation = createViewerNavigationState({ isValidBrowserUrl });
  /** The initial `src` load is follow #1 (see the reconciler). */
  const INITIAL_FOLLOW_SEQ = 1;

  let webviewRef: EmbeddedBrowserWebview | null = $state(null);
  let webviewReady = $state(false);
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let listeners: Array<{ event: string; handler: (e: any) => void }> = [];

  function runCommand(command: ViewerNavigationCommand) {
    if (command.type === 'load') {
      const target = webviewRef;
      const settle = () => dispatch({ type: 'follow-settled', seq: command.seq });
      if (!target) return settle();
      try {
        target.loadURL(command.url).then(settle, settle);
      } catch {
        settle();
      }
      return;
    }
    const settle = (ok: boolean) => dispatch({ type: 'forward-settled', seq: command.seq, ok });
    // Nothing reaches an offline host: a navigation the guest still makes
    // (keyboard, in-page script) is treated as rejected, so the mirror
    // returns to the canonical URL instead of drifting from the host.
    if (!host.connected) {
      queueMicrotask(() => settle(false));
      return;
    }
    try {
      Promise.resolve(onNavigate?.(command.url)).then(
        () => settle(true),
        () => settle(false),
      );
    } catch {
      settle(false);
    }
  }

  function dispatch(event: ViewerNavigationEvent) {
    for (const command of applyViewerNavigationEvent(navigation, event)) runCommand(command);
  }

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

  /** `did-navigate` is main-frame only; `did-navigate-in-page` carries `isMainFrame`. */
  function handleNavigated(
    target: EmbeddedBrowserWebview,
    e: { url?: string; isMainFrame?: boolean },
    inPage: boolean,
  ) {
    dispatch({
      type: 'guest-navigated',
      url: e.url ?? '',
      isMainFrame: e.isMainFrame !== false,
      inPage,
    });
    updateHistoryState(target);
  }

  /**
   * The address bar is a request to the host: forwarded outright, and
   * mirrored here as a follow-load whose own navigations are not forwarded
   * again. The host request does not depend on the mirror reaching the URL.
   */
  function navigateFromAddressBar(nextUrl: string) {
    if (!host.connected) return;
    dispatch({ type: 'address', url: nextUrl });
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
    // Follow #1 (the `src` load) has no `loadURL` promise: it settles here.
    // Later follows settle through their promise; for them these are stale.
    addListener(target, 'did-stop-loading', () => {
      webviewReady = true;
      dispatch({ type: 'follow-settled', seq: INITIAL_FOLLOW_SEQ });
      updateHistoryState(target);
    });
    addListener(target, 'did-fail-load', (e) => {
      if (e.isMainFrame === false) return;
      dispatch({ type: 'follow-settled', seq: INITIAL_FOLLOW_SEQ });
    });
    addListener(target, 'did-navigate', (e) => handleNavigated(target, e, false));
    addListener(target, 'did-navigate-in-page', (e) => handleNavigated(target, e, true));
    addListener(target, 'page-favicon-updated', (e) => {
      if (e.favicons?.length > 0) onFaviconChange?.(e.favicons[0]);
    });
    addListener(target, 'focus', () => onFocus?.());

    return () => removeListeners(target);
  });

  // Follow the host: the reconciler decides whether the canonical URL must be
  // loaded. Re-runs on readiness so a change during the initial load is
  // picked up once the webview can navigate.
  $effect(() => {
    dispatch({ type: 'canonical', url, webviewReady });
  });

  // Guest methods need an attached guest (dom-ready); re-applied on readiness.
  $effect(() => {
    const target = webviewRef;
    if (!target || !webviewReady) return;
    try {
      target.setAudioMuted?.(!isActive);
    } catch {
      // The guest may have been detached between the reactive update and call.
    }
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
    onNavigate={navigateFromAddressBar}
    onGoBack={() => webviewReady && webviewRef?.goBack()}
    onGoForward={() => webviewReady && webviewRef?.goForward()}
    onRefresh={() => webviewReady && dispatch({ type: 'refresh' })}
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
