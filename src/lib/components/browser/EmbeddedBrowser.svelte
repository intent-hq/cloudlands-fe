<script lang="ts">
  /**
   * EmbeddedBrowser - Main content component using Electron's webview tag
   *
   * Provides a full-featured embedded browser with:
   * - Navigation controls (back, forward, refresh)
   * - URL bar with current URL display
   * - Loading indicator
   * - Error handling
   */
  import {
  onMount,
  tick,
} from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import { invoke } from '$shared/generated/ipc-client';
  import {
  BROWSER_PANEL_PARTITION,
  BROWSER_PROTOCOLS,
} from '../../../shared/constants';
  import { writeTextToClipboard } from '$lib/utils/clipboard';

  import {
  addRecentUrl,
  clearBrowserTabZoomRequest,
  updateUrlMetadata,
} from '$store/renderer/slices/browser/browser-slice';
  import { selectPendingBrowserZoom } from '$store/renderer/slices/browser/browser-selectors';
  import {
  createEmbeddedBrowserNavigationSyncState,
  reconcileEmbeddedBrowserUrlProp,
  recordEmbeddedBrowserNavigation,
} from './embedded-browser-navigation-sync';
  import Fa from 'svelte-fa';
  import {
  faArrowLeft,
  faArrowRight,
  faRefresh,
  faExternalLinkAlt,
  faLock,
  faExclamationTriangle,
  faTimes,
  faCode,
} from '@fortawesome/free-solid-svg-icons';
  import Input from '../ui/input/input.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('EmbeddedBrowser');

  // Use shared protocol constants — single source of truth in src/shared/constants.ts
  const ALLOWED_PROTOCOLS = BROWSER_PROTOCOLS.NAVIGATION_ALLOWED;

  // Check if URL is valid and safe to load
  // - Must use an allowed protocol (see BROWSER_PROTOCOLS.NAVIGATION_ALLOWED)
  // - Must not be the app's own URL
  // Defined early so it can be used during state initialization
  function isValidBrowserUrl(targetUrl: string): boolean {
    if (!targetUrl) {
      logger.debug('isValidBrowserUrl: empty URL');
      return false;
    }
    try {
      const parsedUrl = new URL(targetUrl);
      // Block dangerous protocols
      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        logger.debug('isValidBrowserUrl: blocked protocol', {
          url: targetUrl,
          protocol: parsedUrl.protocol,
        });
        return false;
      }
      // Don't allow loading the app itself
      const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const isValid = parsedUrl.origin !== appOrigin;
      if (!isValid) {
        logger.debug('isValidBrowserUrl: URL matches app origin', {
          url: targetUrl,
          appOrigin,
          urlOrigin: parsedUrl.origin,
        });
      }
      return isValid;
    } catch (e) {
      logger.debug('isValidBrowserUrl: URL parse error', { url: targetUrl, error: e });
      return false;
    }
  }

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
  }: Props = $props();


  // Reactive readable for per-tab pending zoom requests dispatched by the
  // menu zoom sagas. The selector form (called at component init) returns a
  // Svelte readable that updates only when the selected slice value changes,
  // so the $effect below is not woken by unrelated dispatches.
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

  // Reference to the URL input for focusing
  // The Input component exports focus, blur, select methods
  let urlInputRef: { focus: () => void; blur: () => void; select: () => void } | null =
    $state(null);

  // State
  // Electron's webview element type - using any since Electron types aren't available in renderer
  let webviewRef:
    | (HTMLElement & {
        src: string;
        canGoBack: () => boolean;
        canGoForward: () => boolean;
        goBack: () => void;
        goForward: () => void;
        reload: () => void;
        stop: () => void;
        loadURL: (url: string) => Promise<void>;
        executeJavaScript: (code: string) => Promise<unknown>;
        addEventListener: (event: string, handler: (e: any) => void) => void;
        removeEventListener?: (event: string, handler: (e: any) => void) => void;
        openDevTools: () => void;
        closeDevTools: () => void;
        isDevToolsOpened: () => boolean;
        getURL?: () => string;
        getWebContentsId: () => number;
        getZoomLevel: () => number;
        setZoomLevel: (level: number) => void;
        getZoomFactor: () => number;
        setZoomFactor: (factor: number) => void;
      })
    | null = $state(null);
  // displayUrl tracks the URL shown in the URL bar - can differ from prop `url` after navigation
  // Initialize from url prop so it's correct on first render (intentionally captures initial value)
  // svelte-ignore state_referenced_locally - intentional: we want initial value, effect syncs later changes
  let displayUrl = $state(url || '');
  let canGoBack = $state(false);
  let canGoForward = $state(false);
  let isLoading = $state(false);
  let isSecure = $state(false);
  let errorMessage = $state('');
  let webviewReady = $state(false);

  // Flag to hide webview during URL switch to force recreation
  let isRecreatingWebview = $state(false);

  // Track the current URL that the webview should load
  // Initialize from url prop if valid, otherwise use about:blank
  // This ensures the webview starts with the correct URL on first render
  // svelte-ignore state_referenced_locally - intentional: we want initial value, effect syncs later changes
  let currentWebviewUrl = $state<string>(isValidBrowserUrl(url) ? url : 'about:blank');

  // Track the previous URL prop value to detect when it changes externally.
  // This is intentionally non-reactive: navigation event handlers update it as
  // bookkeeping before notifying the parent, and those writes must not wake the
  // prop-change effect or they can cause a redundant webview load/reload.
  const navigationSync = createEmbeddedBrowserNavigationSyncState(url);

  // Focus URL bar on mount if requested
  $effect(() => {
    if (focusUrlBarOnMount && urlInputRef) {
      // Use a small delay to ensure the input is fully mounted
      requestAnimationFrame(() => {
        urlInputRef?.focus();
        urlInputRef?.select();
      });
    }
  });

  // Check if we have a valid URL to display in the webview
  // Use currentWebviewUrl since that's what we actually load (can differ from url prop after user navigation)
  let isUrlValid = $derived(isValidBrowserUrl(currentWebviewUrl));

  // Track URL prop changes - when the url prop changes externally, navigate to it
  // This is for when the parent component changes the url prop (e.g., clicking a different URL in sidebar)
  // IMPORTANT: Only triggers when the PROP changes, not when user navigates internally
  $effect(() => {
    const decision = reconcileEmbeddedBrowserUrlProp(navigationSync, url, {
      webviewReady,
      isValidBrowserUrl,
    });

    if (decision.shouldLoad && decision.targetUrl) {
      displayUrl = decision.targetUrl;
      loadUrl(decision.targetUrl);
    }
  });

  // Store listener references for cleanup
  let webviewListeners: Array<{ event: string; handler: (e: any) => void }> = [];

  // Keyboard interceptor script to inject into webview
  // Since webview runs in a separate process, keyboard events don't bubble up.
  // We inject a script that captures keyboard shortcuts and logs special messages
  // that we can intercept via the console-message event.
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
        // Cmd+[ / Ctrl+[ - go back
        if (isMod && e.key === '[') {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_GO_BACK__');
        }
        // Cmd+] / Ctrl+] - go forward
        if (isMod && e.key === ']') {
          e.preventDefault();
          e.stopPropagation();
          console.log('__INTENT_GO_FORWARD__');
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

        // Register this webview for CDP access (browser:exec)
        if (tabId && webviewRef) {
          try {
            const webContentsId = webviewRef.getWebContentsId();
            logger.info('Registering browser tab for CDP', { tabId, webContentsId });
            window.electronAPI
              ?.invoke('browser:register-tab', { tabId, webContentsId })
              .catch((err) => {
                logger.error('Failed to register browser tab for CDP', {
                  tabId,
                  webContentsId,
                  error: err,
                });
              });
          } catch {
            // WebView may have been destroyed between dom-ready and callback execution
            logger.debug('Failed to get webContentsId for CDP registration', { tabId });
          }
        }
      };
      currentWebview.addEventListener('dom-ready', handleDomReady, { once: true });
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
    // Keyboard shortcuts - use capture phase to intercept before panel shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts when typing in an input field
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const isMod = e.metaKey || e.ctrlKey;

      // Cmd+Shift+C / Ctrl+Shift+C - Copy current browser URL when this panel is focused.
      if (
        focusRef.current &&
        !isInInput &&
        isMod &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'c'
      ) {
        e.preventDefault();
        e.stopPropagation();
        void copyCurrentUrl();
        return;
      }

      // Only handle shortcuts when this browser panel is focused
      if (focusRef.current && webviewReady && webviewRef) {
        try {
          // Cmd+[ / Ctrl+[ - Go back in browser history
          if (isMod && e.key === '[' && !e.shiftKey && !e.altKey) {
            if (webviewRef.canGoBack?.()) {
              e.preventDefault();
              e.stopPropagation();
              goBack();
              return;
            }
          }

          // Cmd+] / Ctrl+] - Go forward in browser history
          if (isMod && e.key === ']' && !e.shiftKey && !e.altKey) {
            if (webviewRef.canGoForward?.()) {
              e.preventDefault();
              e.stopPropagation();
              goForward();
              return;
            }
          }
        } catch {
          // WebView may have been detached between the guard check and method call
        }
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
      // The component may unmount due to tab caching (Panel.svelte evicts
      // inactive tabs after 30s), but the webview/tab still exists.
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
    });

    addWebviewListener('did-stop-loading', () => {
      isLoading = false;
      updateNavigationState();
    });

    // Navigation events
    addWebviewListener('did-navigate', (e: any) => {
      displayUrl = e.url;
      isSecure = e.url?.startsWith('https://');
      errorMessage = '';
      // Update previousUrlProp to prevent the prop-change effect from re-triggering a load
      // when the parent updates its state in response to onNavigate
      recordEmbeddedBrowserNavigation(navigationSync, e.url);
      onNavigate?.(e.url);
      updateNavigationState();
    });

    addWebviewListener('did-navigate-in-page', (e: any) => {
      displayUrl = e.url;
      // Update previousUrlProp to prevent the prop-change effect from re-triggering a load
      recordEmbeddedBrowserNavigation(navigationSync, e.url);
      // Also call onNavigate for in-page navigation (e.g., clicking links that don't reload)
      onNavigate?.(e.url);
      updateNavigationState();
    });

    // Title and favicon
    addWebviewListener('page-title-updated', (e: any) => {
      appStore.dispatch(updateUrlMetadata(_workspaceId, displayUrl, e.title, undefined));
      onTitleChange?.(e.title);
    });

    addWebviewListener('page-favicon-updated', (e: any) => {
      if (e.favicons?.length > 0) {
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
      } else if (message === '__INTENT_GO_BACK__') {
        // Cmd+[ was pressed - navigate back in browser history
        goBack();
      } else if (message === '__INTENT_GO_FORWARD__') {
        // Cmd+] was pressed - navigate forward in browser history
        goForward();
      } else if (message === '__INTENT_COPY_URL__') {
        // Cmd+Shift+C / Ctrl+Shift+C was pressed - copy current browser URL
        void copyCurrentUrl();
      } else if (message === '__INTENT_DEVTOOLS__') {
        // Cmd+Option+I / Ctrl+Shift+I was pressed - toggle devtools
        toggleDevTools();
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

      // If webview is ready, navigate directly to preserve history (back/forward)
      // Only recreate webview on initial load or when webview isn't ready
      if (webviewRef && webviewReady) {
        // Navigate within the existing webview to preserve navigation history
        logger.info('loadUrl: setting webviewRef.src', { targetUrl });
        webviewRef.src = targetUrl;
        currentWebviewUrl = targetUrl;
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

  function openExternal() {
    if (displayUrl && hasCapability('shellIntegration')) {
      void invoke('shell:openExternal', { url: displayUrl });
    }
  }

  async function copyCurrentUrl() {
    const loadedUrl = webviewRef?.getURL?.();
    let urlToCopy = '';
    if (loadedUrl && loadedUrl !== 'about:blank') {
      urlToCopy = loadedUrl;
    } else if (currentWebviewUrl !== 'about:blank') {
      urlToCopy = currentWebviewUrl;
    }
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
      displayUrl,
      currentWebviewUrl,
      previousUrlProp: navigationSync.previousUrlProp,
      webviewReady,
      webviewRef: !!webviewRef,
    });

    if (displayUrl) {
      let urlToLoad = displayUrl.trim();
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
      appStore.dispatch(addRecentUrl(_workspaceId, urlToLoad, undefined, undefined, new Date().toISOString()));
      // Blur the input to indicate the action was taken
      urlInputRef?.blur();
    }
  }
</script>

<div class="flex flex-col h-full bg-background">
  <!-- Browser Toolbar -->
  <div class="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-muted/30">
    <!-- Navigation controls -->
    <div class="flex gap-0.5">
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

    <!-- URL bar -->
    <form
      onsubmit={handleFormSubmit}
      class="flex-1 flex items-center gap-2 bg-background border border-border rounded px-2 py-1 text-sm"
    >
      {#if isSecure}
        <Fa icon={faLock} class="text-emerald-500 shrink-0" size="xs" />
      {/if}
      <Input
        bind:this={urlInputRef}
        type="text"
        bind:value={displayUrl}
        class="flex-1 border-none py-0 h-auto px-0"
        noFocusStyle
        placeholder={m.browser_embedded_url_placeholder()}
      />
      <button type="submit" class="sr-only">{m.browser_embedded_go_label()}</button>
    </form>

    <!-- Actions -->
    <div class="flex gap-0.5">
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={toggleDevTools}
        tooltip={m.browser_embedded_devtools_tooltip()}
        tooltipShortcut="mod+alt+i"
        tooltipSide="bottom"
        aria-label={m.browser_embedded_devtools_ariaLabel()}
      >
        <Fa icon={faCode} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-xs"
        onclick={openExternal}
        tooltip={m.browser_embedded_openExternal_tooltip()}
        tooltipSide="bottom"
        aria-label={m.browser_embedded_openExternal_ariaLabel()}
      >
        <Fa icon={faExternalLinkAlt} size="xs" />
      </Button>
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
      class="flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive-foreground text-sm border-b border-destructive/20"
    >
      <Fa icon={faExclamationTriangle} />
      <span>{errorMessage}</span>
    </div>
  {/if}

  <!-- Browser content -->
  <div class="flex-1 relative overflow-hidden">
    {#if isUrlValid && !isRecreatingWebview}
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
      ></webview>
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
