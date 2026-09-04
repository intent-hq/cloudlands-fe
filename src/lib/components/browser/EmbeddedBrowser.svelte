<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * EmbeddedBrowser - Main content component using Electron's webview tag
   *
   * Provides a full-featured embedded browser with:
   * - Navigation controls (back, forward, refresh)
   * - URL bar with current URL display
   * - Loading indicator
   * - Error handling
   */
  import { onMount, tick } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import type { BrowserTabViewport } from '$shared/ipc/workspace-command-payloads';
  import { BROWSER_PANEL_PARTITION, BROWSER_PROTOCOLS } from '../../../shared/constants';
  import { writeTextToClipboard } from '$lib/utils/clipboard';

  import {
    addRecentUrl,
    browserElementCaptured,
    clearBrowserTabZoomRequest,
    updateUrlMetadata,
  } from '$store/renderer/slices/browser/browser-slice';
  import type { BrowserElement } from '$store/renderer/slices/browser/browser-types';
  import { selectPendingBrowserZoom } from '$store/renderer/slices/browser/browser-selectors';
  import { selectMostRecentAgentTab } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    createEmbeddedBrowserNavigationSyncState,
    navigateEmbeddedBrowserWebview,
    reconcileEmbeddedBrowserLoadCompletion,
    reconcileEmbeddedBrowserUrlProp,
    recordEmbeddedBrowserNavigation,
  } from './embedded-browser-navigation-sync';
  import { reportTabBounds } from './tab-bounds-action';
  import { isValidBrowserUrl } from './embedded-browser-url-validation';
  import { navigateToAgent } from '$lib/utils/workspace-navigation';
  import InlineAgentAvatar from '$lib/components/chat/InlineAgentAvatar.svelte';
  import Fa from 'svelte-fa';
  import {
    faArrowLeft,
    faArrowRight,
    faRefresh,
    faLock,
    faExclamationTriangle,
    faTimes,
  } from '@fortawesome/free-solid-svg-icons';
  import Input from '../ui/input/input.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { matchesShortcut } from '$lib/utils/shortcut-bindings';
  import { effectiveShortcutReadable } from '$lib/utils/effective-shortcuts';
  import { invoke } from '$lib/electron-bridge';
  import BrowserOverflowMenu from './BrowserOverflowMenu.svelte';
  import BrowserViewportMenu from './BrowserViewportMenu.svelte';
  import BrowserDeviceFrame from './BrowserDeviceFrame.svelte';
  import BrowserElementPickerButton from './BrowserElementPickerButton.svelte';
  import { toWebviewCaptureRect } from './element-picker-coordinates';
  import { parseElementPickerMessage } from './element-picker-payload';
  import { elementPickerScript } from './element-picker-script';
  import type { EmbeddedBrowserWebview } from './embedded-browser-webview';
  import { observeToolbarCollapse, type ToolbarCollapseState } from './toolbar-collapse';

  const logger = createLogger('EmbeddedBrowser');
  const copyBrowserUrlShortcut$ = effectiveShortcutReadable('panel.copy-browser-url');

  // Use shared protocol constants — single source of truth in src/shared/constants.ts
  const ALLOWED_PROTOCOLS = BROWSER_PROTOCOLS.NAVIGATION_ALLOWED;

  interface Props {
    url: string;
    workspaceId: string;
    /** Unique tab ID for CDP registration */
    tabId?: string;
    onNavigate?: (url: string) => void;
    onClose?: () => void;
    onTitleChange?: (title: string) => void;
    onFaviconChange?: (faviconUrl: string) => void;
    onFocus?: () => void;
    /** If true, focus the URL bar on mount */
    focusUrlBarOnMount?: boolean;
    /** Whether this browser panel is the focused panel (for handling global shortcuts like Cmd+R) */
    isFocused?: boolean;
    /** Whether this tab is visible; inactive cached tabs remain mounted but muted. */
    isActive?: boolean;
    /** Agent owning this tab (monorepo#2857); absent for unowned (user) tabs. */
    ownerAgentId?: string;
    /** Resolved display name of the owning agent for the toolbar chip. */
    ownerAgentName?: string;
    /** Persisted viewport mode for this tab; legacy tabs default to fit. */
    viewport?: BrowserTabViewport;
    onViewportChange?: (viewport: BrowserTabViewport) => void;
  }

  let {
    url,
    workspaceId: _workspaceId,
    tabId,
    onNavigate,
    onClose,
    onTitleChange,
    onFaviconChange,
    onFocus,
    focusUrlBarOnMount = false,
    isFocused = false,
    isActive = true,
    ownerAgentId,
    ownerAgentName,
    viewport = { mode: 'fit' },
    onViewportChange,
  }: Props = $props();

  // Reactive readable for per-tab pending zoom requests dispatched by the
  // menu zoom sagas. The selector form (called at component init) returns a
  // Svelte readable that updates only when the selected slice value changes,
  // so the $effect below is not woken by unrelated dispatches.
  // svelte-ignore state_referenced_locally - selector readables must be created at component init; tabId/workspaceId are stable per panel
  const pendingZoom$ = tabId ? selectPendingBrowserZoom(_workspaceId, tabId) : null;

  // Log the URL prop on mount and changes
  $effect(() => {
    logger.info('EmbeddedBrowser URL prop', {
      url,
      isValid: isValidBrowserUrl(url),
      appOrigin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
      workspaceId: _workspaceId,
    });
  });

  // Apply pending zoom requests targeting this tab. Redux is the single
  // source of truth: a queue of pending actions is drained in order and
  // then cleared. The effect re-runs when the selected value, webviewRef,
  // or webviewReady change, so requests that land before the webview is
  // attached are applied as soon as it is ready.
  $effect(() => {
    if (!pendingZoom$ || !tabId) return;
    const pending = $pendingZoom$;
    if (!pending || pending.length === 0) return;
    if (!webviewRef || !webviewReady) return;
    try {
      for (const action of pending) {
        const currentZoom = webviewRef.getZoomLevel?.() ?? 0;
        if (action === 'in') {
          webviewRef.setZoomLevel?.(currentZoom + 0.5);
        } else if (action === 'out') {
          webviewRef.setZoomLevel?.(currentZoom - 0.5);
        } else if (action === 'reset') {
          webviewRef.setZoomLevel?.(0);
        }
      }
    } catch {
      // WebView not yet attached to DOM
    }
    appStore.dispatch(clearBrowserTabZoomRequest(_workspaceId, tabId));
  });

  // Reference to the URL input for focusing while the identity is in edit mode.
  // The Input component exports focus, blur, select methods
  let urlInputRef: { focus: () => void; blur: () => void; select: () => void } | null =
    $state(null);

  // Electron webview types are unavailable in the renderer build.
  let webviewRef: EmbeddedBrowserWebview | null = $state(null);
  // displayUrl tracks the loaded URL and can differ from prop `url` after navigation.
  // Initialize from url prop so it's correct on first render (intentionally captures initial value)
  // svelte-ignore state_referenced_locally - intentional: we want initial value, effect syncs later changes
  let displayUrl = $state(url || '');
  let urlDraft = $state('');
  let isEditingUrl = $state(false);
  let pageTitle = $state('');
  let faviconUrl = $state('');
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let isLoading = $state(false);
  // svelte-ignore state_referenced_locally - intentional initial capture; navigation events keep this current
  let isSecure = $state(url?.startsWith('https://') ?? false);
  let errorMessage = $state('');
  let webviewReady = $state(false);
  let consoleErrorCount = $state(0);
  let isPickingElement = $state(false);
  let toolbarCollapse = $state<ToolbarCollapseState>('full');

  function handleToolbarCollapse(state: ToolbarCollapseState): void {
    toolbarCollapse = state;
  }

  // Flag to hide webview during URL switch to force recreation
  let isRecreatingWebview = $state(false);

  // Track the current URL that the webview should load.
  // Initialize from url prop if valid, otherwise use about:blank. The browser
  // loads exactly the URL it is given — programmatic entry points (script
  // URLs, terminal links) resolve loopback URLs BEFORE opening a tab, and
  // user-typed address-bar URLs load literally (intent-hq/monorepo#2404).
  // svelte-ignore state_referenced_locally - intentional: we want initial value, effect syncs later changes
  let currentWebviewUrl = $state<string>(isValidBrowserUrl(url) ? url : 'about:blank');

  // Cached browser tabs stay mounted to preserve page state. Keep inactive
  // guests silent while Chromium applies its normal background throttling.
  $effect(() => {
    if (!webviewRef) return;
    try {
      webviewRef.setAudioMuted?.(!isActive);
    } catch {
      // WebView may have been detached between the reactive update and call.
    }
  });

  // Track the previous URL prop value to detect when it changes externally.
  // This is intentionally non-reactive: navigation event handlers update it as
  // bookkeeping before notifying the parent, and those writes must not wake the
  // prop-change effect or they can cause a redundant webview load/reload.
  // svelte-ignore state_referenced_locally - intentional initial capture (see comment above)
  const navigationSync = createEmbeddedBrowserNavigationSyncState(url);

  function getHostname(value: string): string {
    if (!value || value === 'about:blank') return '';
    try {
      return new URL(value).hostname;
    } catch {
      return '';
    }
  }

  const pageHostname = $derived(getHostname(displayUrl));
  const identityTitle = $derived(
    pageTitle ||
      pageHostname ||
      (displayUrl && displayUrl !== 'about:blank'
        ? displayUrl
        : m.browser_embedded_url_placeholder()),
  );

  async function focusUrlInput() {
    urlDraft = displayUrl;
    isEditingUrl = true;
    await tick();
    requestAnimationFrame(() => {
      urlInputRef?.focus();
      urlInputRef?.select();
    });
  }

  function exitUrlEditMode() {
    isEditingUrl = false;
    urlDraft = '';
  }

  function handleUrlInputKeydown(event: KeyboardEvent) {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'l'
    ) {
      event.preventDefault();
      urlInputRef?.select();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    exitUrlEditMode();
  }

  // Check if we have a valid URL to display in the webview
  // Use currentWebviewUrl since that's what we actually load (can differ from url prop after user navigation)
  let isUrlValid = $derived(isValidBrowserUrl(currentWebviewUrl));

  // Track URL prop changes - when the url prop changes externally, navigate to it
  // This is for when the parent component changes the url prop (e.g., clicking a different URL in sidebar)
  // IMPORTANT: Only triggers when the PROP changes, not when user navigates internally
  $effect(() => {
    const decision = reconcileEmbeddedBrowserUrlProp(navigationSync, url, {
      // `|| !webviewRef` keeps prop-driven navigations alive when no webview
      // is mounted (about:blank / invalid current URL): loadUrl's no-webview
      // branch recreates the webview with the new URL.
      webviewReady: webviewReady || !webviewRef,
      isValidBrowserUrl,
    });

    if (decision.shouldLoad && decision.targetUrl) {
      displayUrl = decision.targetUrl;
      loadUrl(decision.targetUrl);
    }
  });

  // Store listener references for cleanup
  let webviewListeners: Array<{ event: string; handler: (e: any) => void }> = [];

  // The guest webContentsId last registered for CDP. dom-ready fires on
  // every top-level navigation AND when a reparented <webview> recreates
  // its guest (a panel drag does this, monorepo#3170); gating on the id
  // keeps registration once-per-guest — same-guest navigations skip, a new
  // guest re-registers (registerTab re-applies viewport emulation).
  let lastRegisteredWebContentsId: number | undefined;

  // Keyboard interceptor script to inject into webview
  // Since webview runs in a separate process, keyboard events don't bubble up.
  // We inject a script that captures keyboard shortcuts and logs special messages
  // that we can intercept via the console-message event.
  // i18n-ignore: This script is an internal webview protocol, not user-facing text.
  const keyboardInterceptorScript = `
    (function() {
      if (window.__augmentKeyboardInterceptorInstalled) return;
      window.__augmentKeyboardInterceptorInstalled = true;
      document.addEventListener('keydown', function(e) {
        const isMod = e.metaKey || e.ctrlKey;
        // Cmd+W / Ctrl+W - close tab
        if (isMod && (e.key === 'w' || e.key === 'W')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_CLOSE_TAB__');
        }
        // Cmd+R / Ctrl+R / F5 - refresh browser
        if (e.key === 'F5' || (isMod && (e.key === 'r' || e.key === 'R'))) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_REFRESH__');
        }
        // Cmd+L / Ctrl+L - edit the current address
        if (isMod && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_FOCUS_URL__');
        }
        // Forward pane and column bracket shortcuts to the panel system.
        if (isMod && !e.altKey && ['[', ']', '{', '}'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          console.log(
            '__INTENT_PANEL_BRACKET__:' +
              [e.key, e.shiftKey ? '1' : '0', e.metaKey ? '1' : '0', e.ctrlKey ? '1' : '0'].join(':')
          );
        }
        // Cmd+Shift+C / Ctrl+Shift+C - copy current browser URL
        if (isMod && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_COPY_URL__');
        }
        // Cmd+Option+I / Ctrl+Shift+I - open devtools
        if ((e.metaKey && e.altKey && (e.key === 'i' || e.key === 'I')) ||
            (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I'))) {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_DEVTOOLS__');
        }
      }, true);
    })();
  `;

  function injectKeyboardInterceptor() {
    if (!webviewRef) return;
    webviewRef
      .executeJavaScript(keyboardInterceptorScript)
      .then(() => {
        // Script injected successfully
      })
      .catch((err: Error) => {
        // Ignore errors during navigation - the page might be in the middle of loading
        logger.debug('Failed to inject keyboard interceptor', { error: err.message });
      });
  }

  // Set up webview listeners whenever webviewRef changes (including after {#key} recreates it)
  $effect(() => {
    const currentWebview = webviewRef;
    if (currentWebview) {
      // Ensure critical attributes are set on the webview DOM element.
      // Svelte may not reliably set attributes on custom elements like <webview>,
      // so we set them programmatically as a safety net.
      // - partition: isolates cookies/storage from the main app session
      // - allowpopups: enables popup windows (required for OAuth flows)
      // These MUST be set before the first navigation (Electron requirement for partition).
      if (!currentWebview.getAttribute('partition')) {
        currentWebview.setAttribute('partition', BROWSER_PANEL_PARTITION);
        logger.debug('Set partition attribute on webview', { partition: BROWSER_PANEL_PARTITION });
      }
      if (!currentWebview.hasAttribute('allowpopups')) {
        currentWebview.setAttribute('allowpopups', '');
        logger.debug('Set allowpopups attribute on webview');
      }

      setupWebviewListeners();
      // Wait for webview to be ready
      const handleDomReady = () => {
        webviewReady = true;
        logger.debug('Webview ready', { url: currentWebviewUrl });

        // Inject keyboard interceptor on initial load
        injectKeyboardInterceptor();

        // Register this webview for CDP access (browser:exec). Runs on
        // every dom-ready so a recreated guest re-registers, but skips
        // same-guest navigations to avoid stacking redundant registerTab
        // calls and destroyed-hooks in the main process.
        if (tabId) {
          try {
            const webContentsId = currentWebview.getWebContentsId();
            if (webContentsId !== lastRegisteredWebContentsId) {
              lastRegisteredWebContentsId = webContentsId;
              logger.info('Registering browser tab for CDP', { tabId, webContentsId });
              window.electronAPI
                ?.invoke('browser:register-tab', { tabId, webContentsId })
                .catch((err) => {
                  logger.error('Failed to register browser tab for CDP', {
                    tabId,
                    webContentsId,
                    error: err,
                  });
                  // Allow a later dom-ready from this guest to retry the
                  // registration instead of leaving the tab unregistered
                  // until the guest is recreated.
                  if (lastRegisteredWebContentsId === webContentsId) {
                    lastRegisteredWebContentsId = undefined;
                  }
                });
            }
          } catch {
            // WebView may have been destroyed between dom-ready and callback execution
            logger.debug('Failed to get webContentsId for CDP registration', { tabId });
          }
        }
      };
      // NOT { once: true }: reparenting the <webview> (panel drag) makes
      // Electron destroy and re-create the guest webContents, and the new
      // guest fires dom-ready again — registration must follow the live
      // guest or the tab loses CDP access and viewport emulation
      // (monorepo#3170).
      currentWebview.addEventListener('dom-ready', handleDomReady);
      webviewListeners.push({ event: 'dom-ready', handler: handleDomReady });

      // Re-inject keyboard interceptor after every navigation (page changes clear the injected script)
      const handleDidFinishLoad = () => {
        injectKeyboardInterceptor();
      };
      currentWebview.addEventListener('did-finish-load', handleDidFinishLoad);
      webviewListeners.push({ event: 'did-finish-load', handler: handleDidFinishLoad });

      return () => {
        cleanupWebviewListeners(currentWebview);
      };
    }
  });

  // Track the latest isFocused value for use in event handlers
  // (closures capture the initial value, so we need a mutable reference)
  // Using a plain object so the closure can read the current value
  const focusRef = { current: false };
  $effect(() => {
    focusRef.current = isFocused;
    logger.debug('isFocused changed', { isFocused, url });
  });

  onMount(() => {
    if (focusUrlBarOnMount) void focusUrlInput();

    // Keyboard shortcuts - use capture phase to intercept before panel shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when typing in an input field
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const isMod = e.metaKey || e.ctrlKey;
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

      // Escape cancels element picking when focus is in the app chrome.
      if (isPickingElement && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelElementPicker();
        return;
      }

      // Cmd+L / Ctrl+L - edit the current address when this panel is focused.
      if (
        focusRef.current &&
        !isInInput &&
        isMod &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'l'
      ) {
        e.preventDefault();
        e.stopPropagation();
        void focusUrlInput();
        return;
      }

      // Cmd+Shift+C / Ctrl+Shift+C - Copy current browser URL when this panel is focused.
      if (focusRef.current && !isInInput && matchesShortcut(e, $copyBrowserUrlShortcut$, isMac)) {
        e.preventDefault();
        e.stopPropagation();
        void copyCurrentUrl();
        return;
      }

      // Alt+Arrow shortcuts work regardless of focus
      if (e.altKey && e.key === 'ArrowLeft' && !isInInput) {
        if (webviewReady && webviewRef) {
          e.preventDefault();
          goBack();
        }
      } else if (e.altKey && e.key === 'ArrowRight' && !isInInput) {
        if (webviewReady && webviewRef) {
          e.preventDefault();
          goForward();
        }
      }

      // Cmd+R / Ctrl+R / F5 - Refresh browser when this panel is focused
      // Otherwise let default behavior (app reload) happen
      if (e.key === 'F5' || (isMod && e.key === 'r')) {
        if (focusRef.current) {
          e.preventDefault();
          e.stopPropagation();
          refresh();
        }
      }
    };

    // Use capture phase to intercept shortcuts before other handlers
    window.addEventListener('keydown', handleKeydown, true);

    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      // Clean up webview listeners
      cleanupWebviewListeners();
      // NOTE: We intentionally do NOT unregister the tab from CDP here.
      // The component may unmount when its panel cache entry expires, but the
      // backend filters destroyed webContents from tab discovery.
      // The backend's listTabs() filters out destroyed webContents,
      // so stale entries are automatically cleaned up.
    };
  });

  function cleanupWebviewListeners(target: typeof webviewRef = webviewRef) {
    if (target) {
      for (const { event, handler } of webviewListeners) {
        try {
          target.removeEventListener?.(event, handler);
        } catch {
          // Ignore errors during cleanup - webview may already be destroyed
        }
      }
    }
    webviewListeners = [];
  }

  function addWebviewListener(event: string, handler: (e: any) => void) {
    if (!webviewRef) return;
    webviewRef.addEventListener(event, handler);
    webviewListeners.push({ event, handler });
  }

  function setupWebviewListeners() {
    if (!webviewRef) return;

    // Loading events
    addWebviewListener('did-start-loading', () => {
      isLoading = true;
      isPickingElement = false;
    });

    addWebviewListener('did-stop-loading', () => {
      isLoading = false;
      webviewReady = true;
      syncCompletedWebviewNavigation(displayUrl);
      updateNavigationState();
    });

    // Navigation events - the webview reports the URL it actually loaded,
    // which is exactly what the address bar shows.
    addWebviewListener('did-navigate', (e: any) => {
      consoleErrorCount = 0;
      currentWebviewUrl = e.url;
      displayUrl = e.url;
      pageTitle = '';
      faviconUrl = '';
      isSecure = e.url?.startsWith('https://');
      errorMessage = '';
      // Update previousUrlProp to prevent the prop-change effect from re-triggering a load
      // when the parent updates its state in response to onNavigate
      recordEmbeddedBrowserNavigation(navigationSync, e.url);
      onNavigate?.(e.url);
      updateNavigationState();
    });

    addWebviewListener('did-navigate-in-page', (e: any) => {
      currentWebviewUrl = e.url;
      displayUrl = e.url;
      isSecure = e.url?.startsWith('https://');
      // Update previousUrlProp to prevent the prop-change effect from re-triggering a load
      recordEmbeddedBrowserNavigation(navigationSync, e.url);
      // Also call onNavigate for in-page navigation (e.g., clicking links that don't reload)
      onNavigate?.(e.url);
      updateNavigationState();
    });

    // Title and favicon
    addWebviewListener('page-title-updated', (e: any) => {
      pageTitle = e.title ?? '';
      appStore.dispatch(updateUrlMetadata(_workspaceId, displayUrl, e.title, undefined));
      onTitleChange?.(e.title);
    });

    addWebviewListener('page-favicon-updated', (e: any) => {
      if (e.favicons?.length > 0) {
        faviconUrl = e.favicons[0];
        appStore.dispatch(updateUrlMetadata(_workspaceId, displayUrl, undefined, e.favicons[0]));
        onFaviconChange?.(e.favicons[0]);
      }
    });

    // Error handling
    addWebviewListener('did-fail-load', (e: any) => {
      if (e.errorCode !== -3) {
        // Ignore aborted loads (error code -3)
        // Provide friendlier error messages for common scenarios
        const failedUrl = e.validatedURL || currentWebviewUrl;
        const isLocalhost = failedUrl?.includes('localhost') || failedUrl?.includes('127.0.0.1');

        if (e.errorCode === -102 && isLocalhost) {
          // ERR_CONNECTION_REFUSED on localhost - likely a dev server that isn't running
          const port = failedUrl?.match(/:(\d+)/)?.[1];
          errorMessage = port
            ? m.browser_embedded_localhostRefusedPort_error({ port })
            : m.browser_embedded_localhostRefused_error();
          logger.warn('Localhost connection refused', {
            url: failedUrl,
            errorCode: e.errorCode,
          });
        } else {
          errorMessage = e.errorDescription || m.browser_embedded_loadFailed_error();
          logger.error('Webview failed to load', {
            errorCode: e.errorCode,
            errorDescription: e.errorDescription,
          });
        }
      }
      isLoading = false;
    });

    // Focus event - notify parent when webview gains focus
    // This allows the panel system to mark this panel as focused
    addWebviewListener('focus', () => {
      onFocus?.();
    });

    // Listen for console messages from the webview to intercept keyboard shortcuts
    // The keyboard interceptor script injected on dom-ready logs special messages
    // when keyboard shortcuts are pressed inside the webview
    addWebviewListener('console-message', (e: any) => {
      if (e.level === 3) consoleErrorCount += 1;
      const message = e.message;
      if (message === '__INTENT_CLOSE_TAB__') {
        // Cmd+W was pressed - dispatch synthetic event for the panel system to handle
        const syntheticEvent = new KeyboardEvent('keydown', {
          key: 'w',
          code: 'KeyW',
          metaKey: true,
          ctrlKey: false,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(syntheticEvent);
      } else if (message === '__INTENT_REFRESH__') {
        // Cmd+R/F5 was pressed inside webview - refresh the browser
        refresh();
      } else if (message === '__INTENT_FOCUS_URL__') {
        void focusUrlInput();
      } else if (message.startsWith('__INTENT_PANEL_BRACKET__:')) {
        const [, key, shiftKey, metaKey, ctrlKey] = message.split(':');
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            shiftKey: shiftKey === '1',
            metaKey: metaKey === '1',
            ctrlKey: ctrlKey === '1',
            bubbles: true,
            cancelable: true,
          }),
        );
      } else if (message === '__INTENT_COPY_URL__') {
        // Cmd+Shift+C / Ctrl+Shift+C was pressed - copy current browser URL
        void copyCurrentUrl();
      } else if (message === '__INTENT_DEVTOOLS__') {
        // Cmd+Option+I / Ctrl+Shift+I was pressed - toggle devtools
        toggleDevTools();
      } else {
        const pickerMessage = parseElementPickerMessage(message);
        if (pickerMessage && !isPickingElement) {
          logger.debug('Ignored element picker message while picker was inactive');
          return;
        }
        if (pickerMessage?.type === 'cancelled') isPickingElement = false;
        if (pickerMessage?.type === 'malformed') {
          isPickingElement = false;
          logger.warn('Ignored malformed element picker payload', { issues: pickerMessage.issues });
        }
        if (pickerMessage?.type === 'picked') {
          isPickingElement = false;
          void capturePickedElement(pickerMessage.element);
        }
      }
    });
  }

  function updateNavigationState() {
    if (webviewRef && webviewReady) {
      try {
        canGoBack = webviewRef.canGoBack?.() ?? false;
        canGoForward = webviewRef.canGoForward?.() ?? false;
      } catch {
        canGoBack = false;
        canGoForward = false;
      }
    }
  }

  function syncCompletedWebviewNavigation(requestedUrl: string) {
    const completedUrl = reconcileEmbeddedBrowserLoadCompletion(
      navigationSync,
      requestedUrl,
      webviewRef?.getURL?.(),
    );
    if (!completedUrl) return;
    displayUrl = completedUrl;
    isSecure = completedUrl.startsWith('https://');
    onNavigate?.(completedUrl);
  }

  async function loadUrl(targetUrl: string) {
    if (!targetUrl) return;

    if (!isValidBrowserUrl(targetUrl)) {
      // Provide specific error messages for different failure cases
      try {
        const parsed = new URL(targetUrl);
        if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
          errorMessage = m.browser_embedded_protocolNotAllowed_error({
            protocol: parsed.protocol,
            protocols: ALLOWED_PROTOCOLS.join(', '),
          });
          logger.warn('Blocked disallowed protocol in webview', {
            url: targetUrl,
            protocol: parsed.protocol,
          });
        } else {
          errorMessage = m.browser_embedded_selfLoad_error();
          logger.warn('Prevented loading app URL in webview', { url: targetUrl });
        }
      } catch {
        errorMessage = m.browser_embedded_invalidUrlFormat_error();
        logger.warn('Invalid URL format', { url: targetUrl });
      }
      return;
    }

    try {
      new URL(targetUrl); // Validate URL format
      errorMessage = '';
      logger.info('loadUrl: validated URL', {
        url: targetUrl,
        webviewRef: !!webviewRef,
        webviewReady,
      });

      // An attached webview must navigate through loadURL so Electron emits
      // did-navigate and the owning panel can persist the new URL. dom-ready
      // can fire before our listener is installed, so webviewReady is not a
      // reliable gate for choosing this path.
      if (webviewRef) {
        // Navigate within the existing webview to preserve navigation history
        logger.info('loadUrl: calling webviewRef.loadURL', { targetUrl });
        const currentWebview = webviewRef;
        void navigateEmbeddedBrowserWebview(currentWebview, targetUrl)
          .then(() => {
            syncCompletedWebviewNavigation(targetUrl);
            updateNavigationState();
          })
          .catch((error) => {
            logger.warn('Webview navigation failed', { targetUrl, error });
          });
      } else {
        // Initial load or webview not ready - recreate the webview
        // This is needed for the first URL or when recovering from errors
        logger.info('loadUrl: recreating webview', { targetUrl });
        isRecreatingWebview = true;
        await tick(); // Wait for webview to be removed from DOM
        currentWebviewUrl = targetUrl;
        isRecreatingWebview = false;
        webviewReady = false;
      }
    } catch (error) {
      errorMessage = m.browser_embedded_invalidUrl_error();
      logger.error('Invalid URL', { url: targetUrl, error });
    }
  }

  function goBack() {
    if (!webviewReady || !webviewRef) return;
    try {
      if (webviewRef.canGoBack?.()) {
        webviewRef.goBack();
      }
    } catch {
      // WebView not yet attached to DOM
    }
  }

  function goForward() {
    if (!webviewReady || !webviewRef) return;
    try {
      if (webviewRef.canGoForward?.()) {
        webviewRef.goForward();
      }
    } catch {
      // WebView not yet attached to DOM
    }
  }

  function refresh() {
    // Only reload if webview is ready (dom-ready has fired)
    // Otherwise we get: "The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called"
    if (!webviewReady || !webviewRef) return;
    try {
      webviewRef.reload?.();
      // Re-focus the webview after reload to maintain focus state
      webviewRef.focus?.();
    } catch {
      // WebView not yet attached to DOM
    }
  }

  function currentLoadedUrl(): string {
    const loadedUrl = webviewRef?.getURL?.();
    if (loadedUrl && loadedUrl !== 'about:blank') return loadedUrl;
    return currentWebviewUrl !== 'about:blank' ? currentWebviewUrl : '';
  }

  async function copyCurrentUrl() {
    const urlToCopy = currentLoadedUrl();
    if (!urlToCopy) {
      toast.error(m.browser_embedded_noUrlToCopy_error());
      return;
    }
    try {
      await writeTextToClipboard(urlToCopy);
      toast.success(m.browser_embedded_urlCopied_label());
    } catch (error) {
      logger.error('Failed to copy browser URL', error, { url: urlToCopy });
      toast.error(m.browser_embedded_copyFailed_error());
    }
  }

  async function openInExternalBrowser() {
    const targetUrl = currentLoadedUrl();
    if (!targetUrl) {
      toast.error(m.browser_embedded_noUrlToOpen_error());
      return;
    }
    try {
      await invoke('shell:openExternal', { url: targetUrl });
    } catch (error) {
      logger.error('Failed to open browser URL externally', error, { url: targetUrl });
      toast.error(m.browser_embedded_openExternalFailed_error());
    }
  }

  function parseCapturedImage(dataUrl: string): { data: string; mimeType: string } {
    const prefix = 'data:';
    const marker = ';base64,';
    const markerIndex = dataUrl.indexOf(marker, prefix.length);
    const mimeType = dataUrl.slice(prefix.length, markerIndex);
    const data = dataUrl.slice(markerIndex + marker.length);
    if (!dataUrl.startsWith(prefix) || markerIndex < 0 || !mimeType.startsWith('image/') || !data) {
      throw new Error('Captured image did not produce a valid base64 data URL');
    }
    return { data, mimeType };
  }

  function dispatchBrowserCapture(
    image: { data: string; mimeType: string },
    element?: BrowserElement,
  ) {
    if (!tabId || !webviewRef) return;
    const pageUrl = element?.pageUrl || currentLoadedUrl();
    const targetAgentId =
      selectMostRecentAgentTab.select(appStore.state, _workspaceId)?.agentId ?? ownerAgentId;
    if (!targetAgentId) {
      toast.error(m.browser_embedded_noTargetAgent_error());
      return;
    }
    appStore.dispatch(
      browserElementCaptured(_workspaceId, {
        tabId,
        ownerAgentId,
        targetAgentId,
        pageUrl,
        title: pageTitle || getHostname(pageUrl) || pageUrl,
        viewport:
          viewport.mode === 'fit'
            ? { width: webviewRef.clientWidth, height: webviewRef.clientHeight }
            : { width: viewport.width, height: viewport.height },
        image,
        ...(element ? { element } : {}),
      }),
    );
  }

  async function captureScreenshot() {
    if (!webviewRef?.capturePage || !webviewReady || !tabId) return;
    try {
      const image = await webviewRef.capturePage();
      dispatchBrowserCapture(parseCapturedImage(image.toDataURL()));
    } catch (error) {
      logger.error('Failed to capture browser screenshot', error);
      toast.error(m.browser_embedded_screenshotFailed_error());
    }
  }

  async function capturePickedElement(element: BrowserElement) {
    if (!webviewRef?.capturePage || !webviewReady || !tabId) return;
    const clientSize = { width: webviewRef.clientWidth, height: webviewRef.clientHeight };
    const effectiveEmulatedSize =
      viewport.mode === 'fit' ? clientSize : { width: viewport.width, height: viewport.height };
    const captureRect = toWebviewCaptureRect(element.rect, clientSize, effectiveEmulatedSize);
    if (captureRect.width <= 0 || captureRect.height <= 0) {
      logger.warn('Ignored offscreen element picker rectangle', { rect: element.rect });
      return;
    }
    try {
      const image = await webviewRef.capturePage(captureRect);
      dispatchBrowserCapture(parseCapturedImage(image.toDataURL()), element);
    } catch (error) {
      logger.error('Failed to capture selected browser element', error);
      toast.error(m.browser_embedded_screenshotFailed_error());
    }
  }

  async function toggleElementPicker() {
    if (isPickingElement) {
      cancelElementPicker();
      return;
    }
    if (!webviewRef || !webviewReady || !tabId) return;
    try {
      await webviewRef.executeJavaScript(elementPickerScript);
      isPickingElement = true;
      webviewRef.focus?.();
    } catch (error) {
      logger.debug('Failed to inject element picker', { error });
      isPickingElement = false;
    }
  }

  function cancelElementPicker() {
    isPickingElement = false;
    void webviewRef
      ?.executeJavaScript(
        "typeof window.__intentElementPickerCleanup === 'function' && window.__intentElementPickerCleanup()",
      )
      .catch((error: unknown) => logger.debug('Failed to clean up element picker', { error }));
  }

  async function openDevToolsPanel(panel: 'console' | 'sources' | 'elements') {
    if (!webviewRef || !webviewReady) return;
    if (!tabId) {
      webviewRef.openDevTools?.();
      return;
    }
    try {
      await window.electronAPI?.invoke('browser:open-devtools-panel', { tabId, panel });
    } catch (error) {
      logger.warn('Failed to select DevTools panel; opening plain DevTools', { panel, error });
      webviewRef.openDevTools?.();
    }
  }

  function reloadWithoutCache() {
    if (!webviewRef || !webviewReady) return;
    try {
      webviewRef.reloadIgnoringCache?.();
      webviewRef.focus?.();
    } catch {
      // WebView not yet attached to DOM
    }
  }

  function toggleDevTools() {
    if (!webviewRef || !webviewReady) return;
    try {
      if (webviewRef.isDevToolsOpened?.()) {
        webviewRef.closeDevTools?.();
      } else {
        webviewRef.openDevTools?.();
      }
    } catch {
      // WebView not yet attached to DOM
    }
  }

  function handleFormSubmit(e: Event) {
    e.preventDefault();
    logger.info('Form submitted', {
      urlDraft,
      currentWebviewUrl,
      previousUrlProp: navigationSync.previousUrlProp,
      webviewReady,
      webviewRef: !!webviewRef,
    });

    if (urlDraft) {
      let urlToLoad = urlDraft.trim();
      // Only prepend a protocol if the input doesn't already have one (scheme://...).
      // This avoids turning "file:///path" into "https://file:///path" (ERR_NAME_NOT_RESOLVED).
      // loadUrl() will reject disallowed protocols with a clear error message.
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(urlToLoad)) {
        const isLocalhost =
          urlToLoad.includes('localhost') ||
          urlToLoad.includes('127.0.0.1') ||
          urlToLoad.includes('0.0.0.0');
        urlToLoad = (isLocalhost ? 'http://' : 'https://') + urlToLoad;
      }
      logger.info('Loading URL from form', { urlToLoad });
      loadUrl(urlToLoad);
      appStore.dispatch(
        addRecentUrl(_workspaceId, urlToLoad, undefined, undefined, new Date().toISOString()),
      );
      // Blur the input to indicate the action was taken
      exitUrlEditMode();
    }
  }
</script>

{#snippet browserWebview()}
  <!--
    Workaround for Electron bug #43314: Hide webview during URL switch.
    When isRecreatingWebview is true, the webview is removed from DOM.
    When it becomes false, a fresh webview is created with the new URL.
  -->
  <webview
    bind:this={webviewRef}
    class="w-full h-full border-none"
    src={currentWebviewUrl}
    partition={BROWSER_PANEL_PARTITION}
    allowpopups
    use:reportTabBounds={tabId}
  ></webview>
{/snippet}

<div class="flex flex-col h-full bg-background">
  <!-- Browser Toolbar -->
  <div
    class="browser-toolbar flex h-12 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2"
    data-browser-toolbar
    use:observeToolbarCollapse={handleToolbarCollapse}
  >
    <!-- Navigation controls -->
    <div class="flex gap-0.5">
      <div class="browser-toolbar-history flex gap-0.5">
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={goBack}
          disabled={!canGoBack}
          tooltip={m.browser_embedded_goBack_tooltip()}
          tooltipShortcut="alt+←"
          tooltipSide="bottom"
          aria-label={m.browser_embedded_goBack_ariaLabel()}
        >
          <Fa icon={faArrowLeft} size="xs" />
        </Button>
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={goForward}
          disabled={!canGoForward}
          tooltip={m.browser_embedded_goForward_tooltip()}
          tooltipShortcut="alt+→"
          tooltipSide="bottom"
          aria-label={m.browser_embedded_goForward_ariaLabel()}
        >
          <Fa icon={faArrowRight} size="xs" />
        </Button>
      </div>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={refresh}
        disabled={isLoading}
        tooltip={m.browser_embedded_refresh_tooltip()}
        tooltipShortcut="mod+r"
        tooltipSide="bottom"
        aria-label={m.browser_embedded_refresh_ariaLabel()}
      >
        <Fa icon={faRefresh} size="xs" class={isLoading ? 'animate-spin' : ''} />
      </Button>
    </div>

    <!-- Page identity / editable address -->
    <div class="flex min-w-0 flex-1 items-center gap-2">
      {#if ownerAgentId}
        <span data-browser-owner-chip={ownerAgentId} class="flex shrink-0">
          <InlineAgentAvatar
            agentId={ownerAgentId}
            agentName={ownerAgentName}
            onclick={() => void navigateToAgent(ownerAgentId)}
          />
        </span>
      {:else if faviconUrl}
        <img src={faviconUrl} alt="" class="size-5 shrink-0 rounded-sm" data-browser-page-favicon />
      {/if}

      <div class="flex h-8 min-w-0 flex-1 items-center rounded-md bg-background px-2">
        {#if isEditingUrl}
          <form onsubmit={handleFormSubmit} class="flex h-full min-w-0 flex-1 items-center">
            <Input
              bind:this={urlInputRef}
              type="text"
              bind:value={urlDraft}
              onkeydown={handleUrlInputKeydown}
              onblur={exitUrlEditMode}
              noFocusStyle
              class="h-full flex-1 rounded-none border-0 bg-transparent px-0 hover:border-transparent"
              placeholder={m.browser_embedded_url_placeholder()}
              aria-label={m.browser_embedded_addressInput_ariaLabel()}
            />
            <button type="submit" class="sr-only">{m.browser_embedded_go_label()}</button>
          </form>
        {:else}
          <button
            type="button"
            class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none hover:bg-muted/30 focus-visible:ring-1 focus-visible:ring-ring"
            onclick={() => void focusUrlInput()}
            aria-label={m.browser_embedded_editAddress_ariaLabel()}
          >
            {#if isSecure}
              <Fa icon={faLock} class="shrink-0 text-muted-foreground" size="sm" />
            {/if}
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >{identityTitle}</span
            >
            {#if pageTitle && pageHostname && pageHostname !== pageTitle}
              <span class="browser-toolbar-hostname truncate text-xs text-muted-foreground"
                >{pageHostname}</span
              >
            {/if}
          </button>
        {/if}
      </div>
    </div>

    <!-- Element picker -->
    <div class="browser-toolbar-picker h-7 w-7 shrink-0" data-browser-select-element-slot>
      <BrowserElementPickerButton
        active={isPickingElement}
        disabled={!webviewReady || !tabId}
        onToggle={() => void toggleElementPicker()}
      />
    </div>

    <!-- Viewport mode -->
    <div class="browser-toolbar-viewport flex shrink-0 items-center" data-browser-viewport-slot>
      <BrowserViewportMenu
        {viewport}
        onViewportChange={(nextViewport) => onViewportChange?.(nextViewport)}
      />
    </div>

    <div class="flex h-7 w-7 shrink-0 items-center" data-browser-overflow-slot>
      <BrowserOverflowMenu
        errorCount={consoleErrorCount}
        disabled={!webviewReady}
        collapsed={toolbarCollapse === 'controls-collapsed'}
        {canGoBack}
        {canGoForward}
        canSelectElement={webviewReady && !!tabId}
        selectingElement={isPickingElement}
        {viewport}
        onGoBack={goBack}
        onGoForward={goForward}
        onToggleElementPicker={() => void toggleElementPicker()}
        onViewportChange={(nextViewport) => onViewportChange?.(nextViewport)}
        onOpenExternal={openInExternalBrowser}
        onCopyUrl={copyCurrentUrl}
        onScreenshot={captureScreenshot}
        onOpenConsole={() => openDevToolsPanel('console')}
        onOpenSource={() => openDevToolsPanel('sources')}
        onOpenInspector={() => openDevToolsPanel('elements')}
        onReloadWithoutCache={reloadWithoutCache}
      />
    </div>

    <!-- Actions -->
    <div class="flex gap-0.5">
      {#if onClose}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={onClose}
          tooltip={m.browser_embedded_close_tooltip()}
          tooltipShortcut="esc"
          tooltipSide="bottom"
          aria-label={m.browser_embedded_close_ariaLabel()}
        >
          <Fa icon={faTimes} size="xs" />
        </Button>
      {/if}
    </div>
  </div>

  <!-- Error banner -->
  {#if errorMessage}
    <div
      class="flex items-center gap-2 px-3 py-2 bg-destructive/10 text-error-foreground text-sm border-b border-destructive/20"
    >
      <Fa icon={faExclamationTriangle} />
      <span>{errorMessage}</span>
    </div>
  {/if}

  <!-- Browser content -->
  <div class="flex-1 relative overflow-hidden">
    {#if isUrlValid && !isRecreatingWebview}
      <BrowserDeviceFrame
        {viewport}
        onViewportChange={(nextViewport) => onViewportChange?.(nextViewport)}
      >
        {@render browserWebview()}
      </BrowserDeviceFrame>
    {:else if url && !isRecreatingWebview}
      <!-- URL is invalid or blocked - show error with details -->
      <div class="flex items-center justify-center h-full text-subtle">
        <div class="text-center">
          <div class="text-4xl mb-3 opacity-50">⚠️</div>
          <p class="text-lg font-medium mb-1">{m.browser_embedded_cannotLoadUrl_label()}</p>
          <p class="text-sm">
            {#if url.startsWith('javascript:') || url.startsWith('data:')}
              {m.browser_embedded_protocolBlocked_description()}
            {:else}
              {m.browser_embedded_selfLoadBlocked_description()}
            {/if}
          </p>
          <p class="text-xs mt-2 opacity-50 max-w-md break-all">{url}</p>
        </div>
      </div>
    {:else}
      <div class="flex items-center justify-center h-full text-subtle">
        <div class="text-center">
          <div class="text-4xl mb-3 opacity-50">🌐</div>
          <p class="text-lg font-medium mb-1">{m.browser_embedded_noUrl_label()}</p>
          <p class="text-sm">{m.browser_embedded_noUrl_description()}</p>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .browser-toolbar {
    container-type: inline-size;
  }

  .browser-toolbar-hostname {
    max-width: 40%;
  }

  @container (max-width: 399px) {
    .browser-toolbar-history,
    .browser-toolbar-picker,
    .browser-toolbar-viewport {
      display: none;
    }
  }
</style>
