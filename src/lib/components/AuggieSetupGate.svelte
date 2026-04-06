<script lang="ts">
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import { invoke, shell } from '$lib/electron-bridge';
  import { identifyUser } from '$lib/services/analytics';
  import { retryLoadModels } from '$lib/store/slices/model/model-slice';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { createLogger } from '$lib/utils/client-logger';
  import { MINIMUM_AUGGIE_VERSION, type InstallErrorType } from '$shared/constants/auggie';
  import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
  import { ACP_PROVIDERS } from '$shared/config/provider-config';
  import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
  import {
    faArrowUpRightFromSquare,
    faCircleCheck,
    faCircleNotch,
    faDownload,
    faPaste,
    faExternalLinkAlt,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { fade } from 'svelte/transition';

  const logger = createLogger('AuggieSetupGate');
  const dispatch = getDispatch();

  // =============================================================================
  // Feature flags for testing setup UX (set one to true to test that state)
  // =============================================================================
  const MIMIC_NO_AUGGIE = false; // Simulates Auggie not installed
  const MIMIC_OUTDATED_AUGGIE = false; // Simulates Auggie installed but version too old
  const MIMIC_UNAUTHENTICATED_AUGGIE = false; // Simulates Auggie installed & up-to-date but not authenticated
  const MIMIC_WAITING_FOR_AUTH_PASTE = false; // Simulates waiting for user to paste token after browser opened
  const MIMIC_NO_PROVIDERS = false; // Simulates no providers available (for testing multi-provider setup)

  type AuggieStatus = {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    versionOk: boolean;
    minimumVersion: string;
    authDetails?: string;
    binaryInstallAvailable?: boolean;
  };

  const STATUS_REFRESH_INTERVAL_MS = 15000;
  // Minimum time between status checks to prevent rapid re-checks and EAGAIN errors
  const STATUS_CHECK_DEBOUNCE_MS = 3000;



  let status: AuggieStatus | null = $state(null);
  let loading = $state(true);
  let actionInProgress = $state(false); // Unified loading state for actions
  let statusPollHandle: ReturnType<typeof setInterval> | null = null;
  let statusCheckPromise: Promise<void> | null = null;
  // Timestamp of last successful status check for debouncing
  let lastStatusCheckTime: number = 0;

  // Provider availability state (checks all providers: auggie, claude-code, codex)
  let providerAvailability: ProviderAvailabilityResult | null = $state(null);
  let providerCheckError: string | null = $state(null);

  // Error states
  let statusError: string | null = $state(null);
  let installError: string | null = $state(null);
  let installErrorType: InstallErrorType | null = $state(null);
  let showManualInstall = $state(false);

  // Authentication flow states
  let authInProgress = $state(false);
  let showManualAuth = $state(false);
  let waitingForBrowserAuth = $state(false);
  let manualAuthInput = $state('');
  let authUrl: string | null = $state(null);
  let authError: string | null = $state(null);
  let authPollHandle: ReturnType<typeof setInterval> | null = null;

  // Skip gating on sandbox/test routes
  const isSandboxPage = $derived(
    $page.url.pathname.startsWith('/sandbox') || $page.url.pathname.startsWith('/test'),
  );

  // Check if any provider is available (allows bypassing Auggie-specific setup)
  const hasAnyProvider = $derived.by(() => {
    if (MIMIC_NO_PROVIDERS) return false;
    return providerAvailability?.hasAnyProvider ?? false;
  });

  // Check if we should show the gate (no providers available)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const shouldShowSetupGate = $derived.by(() => {
    if (isSandboxPage) return false;
    if (loading) return false;
    // If any provider is available, don't block
    if (hasAnyProvider) return false;
    // If provider check failed, show gate with error
    if (providerCheckError) return true;
    // If no providers available, show gate
    return providerAvailability !== null && !providerAvailability.hasAnyProvider;
  });

  /**
   * Check provider availability from all ACP providers
   */
  async function checkProviderAvailability(): Promise<void> {
    try {
      logger.info('Checking provider availability (auggie, claude-code, codex)');
      const result = await invoke<{
        success: boolean;
        data?: ProviderAvailabilityResult;
        error?: string;
      }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);

      if (!result.success) {
        throw new Error(result.error || 'Failed to check provider availability');
      }

      providerAvailability = result.data ?? null;
      providerCheckError = null;

      if (MIMIC_NO_PROVIDERS && providerAvailability) {
        // Override for testing
        providerAvailability = {
          hasAnyProvider: false,
          providers: {
            auggie: { available: false },
            claudeCode: { available: false },
            codex: { available: false },
            opencode: { available: false },
            cortex: { available: false },
          },
          hiddenProviders: [],
        };
      }

      logger.info('Provider availability check complete', {
        hasAnyProvider: providerAvailability?.hasAnyProvider,
        auggie: providerAvailability?.providers.auggie.available,
        claudeCode: providerAvailability?.providers.claudeCode.available,
        codex: providerAvailability?.providers.codex.available,
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to check provider availability', { error: err });
      providerCheckError = message;
    }
  }

  onMount(() => {
    // Check provider availability first (this is the fast path for users with alternative providers)
    checkProviderAvailability().then(() => {
      // Only check Auggie status if no alternative providers are available
      // This avoids unnecessary auggie status checks when the user has claude-code or codex
      if (!hasAnyProvider) {
        checkStatus({ showLoading: true, clearError: true, force: true });
      } else {
        // Alternative provider available - skip Auggie-specific checks
        loading = false;
        logger.info('Alternative provider available, skipping Auggie setup gate');
      }
    });

    if (!isSandboxPage) {
      const handleFocus = () => {
        if (waitingForBrowserAuth) {
          checkAuthPollOnce();
        }
        if (shouldBlock && !shouldPauseStatusRefresh) {
          // Don't force - let debouncing prevent rapid checks
          checkStatus({ showLoading: false, clearError: false });
        }
      };

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && waitingForBrowserAuth) {
          checkAuthPollOnce();
        }
        if (document.visibilityState === 'visible' && shouldBlock && !shouldPauseStatusRefresh) {
          checkStatus({ showLoading: false, clearError: false });
        }
      };

      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      statusPollHandle = setInterval(() => {
        if (shouldBlock && !shouldPauseStatusRefresh) {
          checkStatus({ showLoading: false, clearError: false });
        }
      }, STATUS_REFRESH_INTERVAL_MS);

      return () => {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (statusPollHandle) {
          clearInterval(statusPollHandle);
          statusPollHandle = null;
        }
        if (authPollHandle) {
          clearInterval(authPollHandle);
          authPollHandle = null;
        }
      };
    }

    return undefined;
  });

  function normalizeAuthResponse(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    // Already valid JSON — pass through
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // Not JSON — check if it's a callback URL with OAuth params
      // e.g. http://localhost:12345/callback?code=ABC&state=XYZ&tenant_url=https://...
      try {
        const url = new URL(trimmed);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const tenantUrl = url.searchParams.get('tenant_url');
        if (code) {
          return JSON.stringify({
            code,
            ...(state ? { state } : {}),
            ...(tenantUrl ? { tenant_url: tenantUrl } : {}),
          });
        }
      } catch {
        // Not a URL either
      }
      // Treat as a plain code string
      return JSON.stringify({ code: trimmed });
    }
  }

  function deriveInstallErrorType(
    explicitType: InstallErrorType | undefined,
    message: string,
  ): InstallErrorType | null {
    if (explicitType) return explicitType;
    const lowerMessage = message.toLowerCase();
    if (
      lowerMessage.includes('permission') ||
      lowerMessage.includes('eacces') ||
      lowerMessage.includes('sudo') ||
      lowerMessage.includes('administrator')
    ) {
      return 'permission';
    }
    if (
      lowerMessage.includes('npm is not installed') ||
      lowerMessage.includes('npm/npx is not available') ||
      lowerMessage.includes('node.js') ||
      lowerMessage.includes('not in path')
    ) {
      return 'missing_npm';
    }
    return 'unknown';
  }

  async function checkStatus(options?: {
    showLoading?: boolean;
    clearError?: boolean;
    showSuccessToast?: boolean;
    /** Force check even if debounce period hasn't elapsed */
    force?: boolean;
  }) {
    // If a check is already in progress, wait for it and return (no need to start another)
    if (statusCheckPromise) {
      await statusCheckPromise;
      // Only retry if forced, otherwise the in-progress check result is sufficient
      if (options?.force) {
        return checkStatus({ ...options, force: false });
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastCheck = now - lastStatusCheckTime;

    // Debounce: skip if we checked recently (unless forced or initial load)
    // This prevents EAGAIN errors from rapid status checks (focus events, visibility changes)
    if (!options?.force && timeSinceLastCheck < STATUS_CHECK_DEBOUNCE_MS && status !== null) {
      logger.debug('Skipping status check - debounce period not elapsed', {
        timeSinceLastCheck,
        debounceMs: STATUS_CHECK_DEBOUNCE_MS,
      });
      return;
    }

    statusCheckPromise = (async () => {
      const showLoading = options?.showLoading ?? false;
      const clearError = options?.clearError ?? false;
      const showSuccessToast = options?.showSuccessToast ?? false;

      try {
        if (showLoading) loading = true;
        if (clearError) statusError = null;
        const result = await invoke<{ success: boolean; data?: AuggieStatus; error?: string }>(
          AUGGIE_CHANNELS.STATUS,
        );

        if (!result.success) throw new Error(result.error || 'Unable to check Auggie status');
        status = result.data ?? {
          installed: false,
          authenticated: false,
          versionOk: false,
          minimumVersion: MINIMUM_AUGGIE_VERSION,
        };

        // Apply mimic flags for testing (override real status)
        if (MIMIC_NO_AUGGIE) {
          status = {
            installed: false,
            authenticated: false,
            versionOk: false,
            minimumVersion: MINIMUM_AUGGIE_VERSION,
          };
          logger.debug('MIMIC_NO_AUGGIE: Simulating Auggie not installed');
        } else if (MIMIC_OUTDATED_AUGGIE) {
          status = {
            installed: true,
            authenticated: false,
            version: '0.1.0', // Fake old version
            versionOk: false,
            minimumVersion: MINIMUM_AUGGIE_VERSION,
          };
          logger.debug('MIMIC_OUTDATED_AUGGIE: Simulating outdated Auggie');
        } else if (MIMIC_UNAUTHENTICATED_AUGGIE) {
          status = {
            installed: true,
            authenticated: false,
            version: status.version || MINIMUM_AUGGIE_VERSION,
            versionOk: true,
            minimumVersion: MINIMUM_AUGGIE_VERSION,
          };
          logger.debug('MIMIC_UNAUTHENTICATED_AUGGIE: Simulating unauthenticated Auggie');
        } else if (MIMIC_WAITING_FOR_AUTH_PASTE) {
          status = {
            installed: true,
            authenticated: false,
            version: status.version || MINIMUM_AUGGIE_VERSION,
            versionOk: true,
            minimumVersion: MINIMUM_AUGGIE_VERSION,
          };
          // Simulate the state after clicking "Login with Augment" - browser opened, waiting for paste
          showManualAuth = true;
          authUrl = 'link-does-not-exist-in-mimic-state';
          logger.debug('MIMIC_WAITING_FOR_AUTH_PASTE: Simulating waiting for auth token paste');
        }

        statusError = null;
        // Update last check time on successful check
        lastStatusCheckTime = Date.now();

        // If we just finished an action and status is good, give a small success toast
        // (Skip toast when mimicking states to avoid confusion)
        const isMimicking =
          MIMIC_NO_AUGGIE ||
          MIMIC_OUTDATED_AUGGIE ||
          MIMIC_UNAUTHENTICATED_AUGGIE ||
          MIMIC_WAITING_FOR_AUTH_PASTE;
        if (
          showSuccessToast &&
          !isMimicking &&
          status?.installed &&
          status?.versionOk &&
          status?.authenticated
        ) {
          toast.success('Ready to go.');
          // Re-identify the user now that auth succeeded (force bypasses dedupe guard)
          identifyUser({ force: true }).catch(() => {});
          // Refresh models now that auggie is fully ready
          // This ensures fresh models are loaded from the newly installed/authenticated CLI
          logger.info('Auggie is ready, refreshing model list...');
          dispatch(retryLoadModels());
        }
      } catch (err) {
        const message = (err as Error).message;
        logger.error('Failed to check Auggie status', { error: err });
        statusError = message;
        // Still update the timestamp to prevent rapid retries on error
        lastStatusCheckTime = Date.now();
      } finally {
        if (showLoading) {
          loading = false;
        }
      }
    })();

    try {
      await statusCheckPromise;
    } finally {
      statusCheckPromise = null;
    }
  }

  function stopAuthPolling() {
    if (authPollHandle) {
      clearInterval(authPollHandle);
      authPollHandle = null;
    }
  }

  let authPollCheckInFlight = $state(false);

  async function checkAuthPollOnce() {
    if (authPollCheckInFlight) return;
    authPollCheckInFlight = true;
    try {
      const result = await invoke<{
        success: boolean;
        data?: { completed?: boolean; authenticated?: boolean };
        error?: string;
      }>(AUGGIE_CHANNELS.AUTHENTICATE, { action: 'poll' });

      if (result.success && result.data?.completed) {
        stopAuthPolling();
        waitingForBrowserAuth = false;

        if (result.data.authenticated) {
          logger.info('Authentication completed via browser callback');
          await checkStatus({ clearError: true, showSuccessToast: true });
        } else {
          logger.info('Login process ended without authentication, showing manual paste');
          showManualAuth = true;
        }
      }
    } catch (err) {
      logger.error('Error polling auth status', { error: err });
    } finally {
      authPollCheckInFlight = false;
    }
  }

  function startAuthPolling() {
    stopAuthPolling();
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLL_TIME_MS = 120000; // 2 minutes before falling back to manual paste
    const startTime = Date.now();

    authPollHandle = setInterval(async () => {
      await checkAuthPollOnce();
      if (Date.now() - startTime > MAX_POLL_TIME_MS && waitingForBrowserAuth) {
        logger.info('Auth polling timed out, falling back to manual paste');
        stopAuthPolling();
        waitingForBrowserAuth = false;
        showManualAuth = true;
      }
    }, POLL_INTERVAL_MS);
  }

  async function startAuthentication(retryCount = 0): Promise<void> {
    try {
      authInProgress = true;
      authError = null;
      authUrl = null;
      manualAuthInput = '';
      showManualAuth = false;
      waitingForBrowserAuth = false;
      stopAuthPolling();

      const result = await invoke<{
        success: boolean;
        data?: {
          authUrl?: string;
          processStarted?: boolean;
          autoCompleted?: boolean;
          isJsonPasteFlow?: boolean;
        };
        error?: string;
      }>(AUGGIE_CHANNELS.AUTHENTICATE, { action: 'start' });

      if (!result.success) {
        throw new Error(result.error || 'Failed to start authentication');
      }

      // If the localhost OAuth flow already completed (process exited with code 0)
      if (result.data?.autoCompleted) {
        logger.info('Authentication auto-completed via localhost OAuth flow');
        await checkStatus({ clearError: true, showSuccessToast: true });
        authInProgress = false;
        return;
      }

      if (!result.data?.processStarted) {
        throw new Error('Failed to start authentication process');
      }

      // Capture the auth URL for fallback display
      if (result.data?.authUrl) {
        authUrl = result.data.authUrl;
        logger.debug('Captured auth URL for fallback', { authUrl });
      }

      // If the old JSON paste flow is detected (remote/SSH session), skip the
      // "waiting for browser" state and go straight to the paste textarea.
      if (result.data?.isJsonPasteFlow) {
        logger.info('Detected JSON paste flow (remote session)');
        showManualAuth = true;
        authInProgress = false;
        return;
      }

      // Show "waiting for browser" state and start polling for completion.
      // The localhost flow will complete automatically when the user authenticates
      // in the browser. If it doesn't complete within 2 minutes, we fall back to
      // showing the manual paste textarea.
      waitingForBrowserAuth = true;
      authInProgress = false;
      startAuthPolling();
    } catch (err) {
      // Retry up to 2 times with a delay
      if (retryCount < 2) {
        logger.debug('Start authentication failed, retrying...', { retryCount });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return startAuthentication(retryCount + 1);
      }

      const message = (err as Error).message;
      logger.error('Failed to start authentication', { error: err });
      authError = message;
      toast.error('Authentication failed', { description: message });
      authInProgress = false;
    }
  }

  async function completeManualAuth(retryCount = 0): Promise<void> {
    if (!manualAuthInput.trim()) {
      toast.error('Please paste the session code or JSON response');
      return;
    }

    try {
      authInProgress = true;
      authError = null;
      const normalizedResponse = normalizeAuthResponse(manualAuthInput);

      const result = await invoke<{ success: boolean; error?: string }>(
        AUGGIE_CHANNELS.AUTHENTICATE,
        { action: 'complete', authResponse: normalizedResponse },
      );

      if (!result.success) {
        await checkStatus({ clearError: true, showSuccessToast: true });
        if (status?.authenticated) {
          manualAuthInput = '';
          showManualAuth = false;
        } else {
          throw new Error(result.error || 'Failed to complete authentication');
        }
        return;
      }

      await checkStatus({ clearError: true, showSuccessToast: true });
      manualAuthInput = '';
      showManualAuth = false;
    } catch (err) {
      const message = (err as Error).message;

      // Don't retry session-expired errors — the login process is dead and
      // retrying will just hit the same error. User needs to start a new session.
      const isSessionExpired = message.includes('session has expired');

      // Retry up to 2 times with a delay (but not for session-expired errors)
      if (!isSessionExpired && retryCount < 2) {
        logger.debug('Authentication attempt failed, retrying...', { retryCount });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return completeManualAuth(retryCount + 1);
      }

      logger.error('Failed to complete authentication', { error: err });
      authError = message;
      toast.error('Authentication failed', { description: message });
    } finally {
      authInProgress = false;
    }
  }

  async function installAuggie() {
    try {
      actionInProgress = true;
      installError = null;
      installErrorType = null;
      const result = await invoke<{
        success: boolean;
        error?: string;
        errorType?: InstallErrorType;
      }>(AUGGIE_CHANNELS.INSTALL);
      if (!result.success) {
        const message = result.error || 'Installation failed';
        installError = message;
        installErrorType = deriveInstallErrorType(result.errorType, message);
        showManualInstall = true;
        throw new Error(message);
      }

      await checkStatus({ clearError: true, showSuccessToast: true });
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to install Auggie', { error: err });
      toast.error('Install failed', { description: message });
    } finally {
      actionInProgress = false;
    }
  }

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy command');
    }
  }

  const shouldPauseStatusRefresh = $derived(actionInProgress || authInProgress || showManualAuth);

  // DEPRECATED: Blocking behavior removed in Phase 2 of optional Auggie onboarding.
  // Provider status is now shown inline on the homepage via ProviderStatusPanel.
  // Users can create workspaces even without providers (with a warning).
  // Keeping this component for now in case we need the auth flow logic elsewhere.
  const shouldBlock = $derived.by(() => {
    // Never block - provider setup is now non-blocking on the homepage
    return false;
  });

  // Derived: is the version outdated (installed but below minimum)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const needsUpdate = $derived.by(() => {
    return !!status && status.installed && !status.versionOk;
  });

  // Calculate current step for progress bar
  // Step 1: Install (or update if version is too old)
  // Step 2: Authenticate
  // Step 3: Ready
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const currentStep = $derived.by(() => {
    if (!status?.installed || !status?.versionOk) return 1;
    if (!status?.authenticated) return 2;
    return 3;
  });

  // Get available provider options for the setup screen
  // Filter out providers hidden by env var gate
  const providerOptions = $derived.by(() => {
    const hidden = providerAvailability?.hiddenProviders ?? [];
    return [
      {
        id: 'auggie',
        name: ACP_PROVIDERS.auggie.displayName,
        command: ACP_PROVIDERS.auggie.command,
        installCommand: 'npm install -g @augmentcode/auggie',
        description: "Augment's official CLI agent with cloud features",
        available: providerAvailability?.providers.auggie.available ?? false,
        requiresAuth: true,
        docsUrl: 'https://docs.augmentcode.com/cli/overview',
      },
      {
        id: 'claude-code',
        name: ACP_PROVIDERS['claude-code'].displayName,
        command: ACP_PROVIDERS['claude-code'].command,
        installCommand: 'npm install -g @anthropic-ai/claude-code-acp',
        description: "Anthropic's Claude Code as an ACP agent",
        available: providerAvailability?.providers.claudeCode.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://github.com/anthropics/claude-code',
      },
      {
        id: 'codex',
        name: ACP_PROVIDERS.codex.displayName,
        command: ACP_PROVIDERS.codex.command,
        installCommand: 'npm install -g @openai/codex-acp',
        description: "OpenAI's Codex as an ACP agent",
        available: providerAvailability?.providers.codex.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://github.com/openai/codex',
      },
      {
        id: 'cortex',
        name: ACP_PROVIDERS.cortex.displayName,
        command: ACP_PROVIDERS.cortex.command,
        installCommand: 'pip install snowflake-cli',
        description: "Snowflake's AI coding agent",
        available: providerAvailability?.providers.cortex?.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://docs.snowflake.com/en/developer-guide/cortex',
      },
    ].filter((p) => !hidden.includes(p.id));
  });

  function openProviderDocs(url: string) {
    shell.open(url);
  }
</script>

<!-- Multi-Provider Setup Gate -->
{#if shouldBlock}
  <div class="gate-layout fixed inset-0 bg-background">
    <section class="intro">
      <div class="logo">
        <svg class="wordmark" viewBox="0 0 59 8" xmlns="http://www.w3.org/2000/svg">
          <path
            fill="currentColor"
            d="M2.315 7.749c0 .171-.092.251-.275.251H.264C.08 8 0 7.92 0 7.749V.25C0 .091.08 0 .264 0H2.04c.183 0 .275.091.275.251V7.75ZM11.084 8c-.183 0-.31-.069-.367-.206L7.714 1.83v5.92c0 .171-.091.251-.263.251H5.846c-.183 0-.263-.08-.263-.251V.25c0-.16.08-.251.263-.251h3.015c.183 0 .298.069.366.206l3.003 5.977V.25c0-.16.092-.251.275-.251h1.593c.172 0 .264.091.264.251V7.75c0 .171-.092.251-.264.251h-3.014ZM20.065 1.84h-2.739c-.183 0-.263-.08-.263-.251V.25c0-.16.08-.251.263-.251h7.794c.172 0 .263.091.263.251V1.59c0 .171-.091.251-.263.251h-2.74v5.909c0 .171-.091.251-.263.251h-1.788c-.183 0-.264-.08-.264-.251V1.84ZM35.904 0c.171 0 .263.091.263.251V1.59c0 .171-.092.251-.264.251h-5.478v1.246h4.585c.172 0 .263.091.263.251v1.257c0 .172-.092.252-.264.252h-4.584V6.16h5.479c.171 0 .263.091.263.251V7.75c0 .171-.092.251-.264.251h-7.53c-.183 0-.263-.08-.263-.251V.25c0-.16.08-.251.264-.251h7.53ZM44.7 8c-.183 0-.309-.069-.366-.206L41.33 1.83v5.92c0 .171-.092.251-.264.251h-1.604c-.183 0-.264-.08-.264-.251V.25c0-.16.08-.251.264-.251h3.014c.184 0 .298.069.367.206l3.003 5.977V.25c0-.16.091-.251.275-.251h1.593c.172 0 .263.091.263.251V7.75c0 .171-.091.251-.263.251H44.7ZM53.682 1.84h-2.74c-.182 0-.263-.08-.263-.251V.25c0-.16.08-.251.264-.251h7.793c.172 0 .264.091.264.251V1.59c0 .171-.092.251-.264.251h-2.739v5.909c0 .171-.091.251-.263.251h-1.788c-.184 0-.264-.08-.264-.251V1.84Z"
          ></path>
        </svg>
      </div>
      <p class="text-subtle">
        An experimental workspace for parallel agents, from <em> Augment Code</em>.
      </p>
    </section>

    <!-- Loading State -->
    {#if loading}
      <section class="providers-section">
        <div class="loading-spinner">
          <Fa icon={faCircleNotch} size="2x" class="animate-spin text-subtle" />
        </div>
        <p class="text-subtle text-center">Checking available providers...</p>
      </section>

      <!-- Error State -->
    {:else if providerCheckError}
      <section class="providers-section">
        <h2>Something went wrong</h2>
        <p class="text-subtle">We couldn't check for available agent providers.</p>
        <div class="error-message">
          {providerCheckError}
        </div>
        <Button
          onclick={() => {
            loading = true;
            checkProviderAvailability().then(() => {
              loading = false;
            });
          }}
          variant="outline"
        >
          Try Again
        </Button>
      </section>

      <!-- No Providers Available - Show Setup Options -->
    {:else}
      <section class="providers-section">
        <h2>Install an Agent Provider</h2>
        <p class="text-subtle mb-4">
          Intent needs an ACP-compatible agent to run. Install one of the following:
        </p>

        <div class="provider-cards">
          {#each providerOptions as provider (provider.id)}
            <div class="provider-card" class:recommended={provider.id === 'auggie'}>
              <div class="provider-header">
                <h3>{provider.name}</h3>
                {#if provider.id === 'auggie'}
                  <span class="recommended-badge">Recommended</span>
                {/if}
                {#if provider.available}
                  <span class="available-badge">
                    <Fa icon={faCircleCheck} class="inline" size="sm" /> Available
                  </span>
                {/if}
              </div>
              <p class="provider-description">{provider.description}</p>

              <div class="provider-actions">
                {#if provider.id === 'auggie'}
                  <Button onclick={installAuggie} disabled={actionInProgress} size="sm">
                    {#if actionInProgress}
                      <Fa icon={faCircleNotch} class="animate-spin mr-2" />
                      Installing...
                    {:else}
                      <Fa icon={faDownload} class="mr-2" /> Install
                    {/if}
                  </Button>
                {:else}
                  <button
                    class="install-command-button"
                    onclick={() => copyCommand(provider.installCommand)}
                    title="Click to copy"
                  >
                    <code>{provider.installCommand}</code>
                    <Fa icon={faPaste} class="copy-icon" size="sm" />
                  </button>
                {/if}
                <button class="docs-link" onclick={() => openProviderDocs(provider.docsUrl)}>
                  <Fa icon={faExternalLinkAlt} size="sm" class="mr-1" />
                  Docs
                </button>
              </div>

              {#if provider.requiresAuth && provider.id === 'auggie'}
                <p class="auth-note">Requires Augment account login after install</p>
              {/if}
            </div>
          {/each}
        </div>

        <div class="refresh-section">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => {
              loading = true;
              checkProviderAvailability().then(() => {
                if (!hasAnyProvider) {
                  checkStatus({ showLoading: false, clearError: true, force: true });
                }
                loading = false;
              });
            }}
          >
            <Fa icon={faCircleNotch} class="mr-2" /> Check Again
          </Button>
        </div>
      </section>

      <!-- Auggie-specific auth flow (shown after Auggie is installed but not authenticated) -->
      {#if status?.installed && status?.versionOk && !status?.authenticated}
        <section class="authenticate">
          <h2>Authenticate with Augment</h2>
          {#if !showManualAuth && !waitingForBrowserAuth}
            <div class="actions">
              <Button onclick={() => startAuthentication()} disabled={authInProgress}>
                {#if authInProgress}
                  <Fa icon={faCircleNotch} class="animate-spin mr-2" /> Opening browser...
                {:else}
                  <Fa icon={faArrowUpRightFromSquare} class="mr-2" /> Login with Augment
                {/if}
              </Button>
            </div>

            {#if authError}
              <div class="error-message">
                {authError}
              </div>
            {/if}
          {/if}

          <!-- Waiting for browser authentication (localhost OAuth flow) -->
          {#if waitingForBrowserAuth}
            <div class="manual-auth-section" in:fade>
              <p class="text-sm text-subtle mb-3">
                <Fa icon={faCircleNotch} class="animate-spin mr-2" />
                Waiting for you to authenticate in the browser...
              </p>
              {#if authUrl}
                <button
                  class="browser-fallback-link"
                  onclick={() => authUrl && shell.open(authUrl)}
                >
                  Browser didn't open? <span class="underline">Click here</span>
                </button>
              {/if}
              <div class="auth-actions mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => checkAuthPollOnce()}
                  disabled={authPollCheckInFlight}
                >
                  {#if authPollCheckInFlight}
                    <Fa icon={faCircleNotch} class="animate-spin mr-1" size="xs" />
                  {/if}
                  Check now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => {
                    stopAuthPolling();
                    waitingForBrowserAuth = false;
                    showManualAuth = true;
                  }}
                >
                  Paste code manually instead
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => startAuthentication()}
                  disabled={authInProgress}
                >
                  Restart Login
                </Button>
              </div>
            </div>
          {/if}

          <!-- Manual Auth Paste Input (fallback for remote sessions or manual entry) -->
          {#if showManualAuth}
            <div class="manual-auth-section" in:fade>
              {#if authError}
                <div class="error-message">
                  {authError}
                </div>
              {/if}
              <textarea
                bind:value={manualAuthInput}
                placeholder={'e.g. {"code":"...","state":"...","tenant_url":"..."}'}
                class="auth-textarea"
              ></textarea>
              {#if authUrl}
                <button
                  class="browser-fallback-link"
                  onclick={() => authUrl && shell.open(authUrl)}
                >
                  Browser didn't open? <span class="underline">Click here</span>
                </button>
              {/if}
              <div class="auth-actions">
                <Button
                  size="sm"
                  onclick={() => completeManualAuth()}
                  disabled={authInProgress || !manualAuthInput.trim()}
                  class="flex-1"
                >
                  {#if authInProgress}
                    <Fa icon={faCircleNotch} class="animate-spin mr-2" /> Verifying...
                  {:else}
                    <Fa icon={faCircleCheck} class="mr-2" /> Complete Login
                  {/if}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => {
                    showManualAuth = false;
                    manualAuthInput = '';
                    authUrl = null;
                    authError = null;
                  }}
                >
                  Back
                </Button>
              </div>
              <div class="restart-auth">
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => startAuthentication()}
                  disabled={authInProgress}
                >
                  Restart Login
                </Button>
              </div>
            </div>
          {:else if !waitingForBrowserAuth}
            <button
              class="text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
              onclick={() => {
                showManualAuth = true;
              }}
            >
              {authError ? 'Try manual authentication' : 'Having trouble?'}
            </button>
          {/if}
        </section>
      {/if}
    {/if}
  </div>
{/if}

<!-- Add styles for the logo gradients -->
<style>
  :global(:root) {
    /* Brand Gradient Colors for the SVG */
    --stop-1: #3b82f6; /* Blue 500 */
    --stop-2: #8b5cf6; /* Violet 500 */
    --stop-a: #06b6d4; /* Cyan 500 */
    --stop-b: #3b82f6; /* Blue 500 */
    --stop-c: #8b5cf6; /* Violet 500 */
    --stop-d: #d946ef; /* Fuchsia 500 */
  }

  .gate-layout {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    padding: 0 calc((100vw - 40rem) / 2);
    gap: 3rem;
    height: 100vh;
    z-index: 100;
  }

  .logo {
    margin: 1rem 0;
  }

  .wordmark {
    width: 10rem;
    height: auto;
  }

  .loading-spinner {
    margin: 1rem 0;
    display: flex;
    justify-content: center;
  }

  /* Inline error/loading states within sections */
  section h3 {
    font-size: 1rem;
    font-weight: 500;
    margin: 0.5rem 0 0;
  }

  .gate-layout h2 {
    position: relative;
    font-size: 1.25rem;
    font-weight: 500;
  }

  .ordinal-indicator {
    position: absolute;
    left: -0.25rem;
    top: 0;
    transform: translate(-100%, 0);
  }

  .actions {
    display: flex;
    flex-direction: row;
    gap: 1rem;
    align-items: center;
    margin: 0.5rem 0 0;
  }

  section.isNotCurrentStep {
    opacity: 0.3;
    pointer-events: none;
  }

  /* Install command button */
  .install-command-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    font-family: monospace;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .install-command-button:hover {
    background: hsl(var(--muted) / 0.8);
  }

  .install-command-button .copy-icon {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .install-command-button:hover .copy-icon {
    opacity: 1;
  }

  .error-message {
    padding: 0.5rem;
    background: hsl(var(--destructive) / 0.1);
    color: hsl(var(--destructive));
    border-radius: 0.5rem;
    font-size: 0.75rem;
    font-family: monospace;
    word-break: break-all;
  }

  .manual-link {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    text-decoration: underline;
    text-underline-offset: 4px;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    margin-top: 0.5rem;
    transition: color 0.2s;
  }

  .manual-link:hover {
    color: hsl(var(--foreground));
  }

  /* Manual auth section */
  .manual-auth-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .browser-fallback-link {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    text-align: left;
    background: none;
    border: none;
    padding: 0;
    margin-top: -0.5rem;
    cursor: pointer;
    transition: color 0.2s;
  }

  .browser-fallback-link:hover {
    color: hsl(var(--foreground));
  }

  .auth-textarea {
    width: 100%;
    height: 6rem;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 0.5rem;
    padding: 0.75rem;
    font-family: monospace;
    font-size: 0.75rem;
    resize: none;
    outline: none;
    transition: all 0.2s;
  }

  .auth-textarea:focus {
    border-color: hsl(var(--primary) / 0.5);
    box-shadow: 0 0 0 2px hsl(var(--primary) / 0.1);
  }

  .auth-actions {
    display: flex;
    gap: 0.5rem;
  }

  .restart-auth {
    display: flex;
    justify-content: center;
  }

  /* Provider cards section */
  .providers-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .providers-section h2 {
    margin-bottom: 0;
  }

  .provider-cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .provider-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    background: hsl(var(--muted) / 0.5);
    border: 1px solid hsl(var(--border));
    border-radius: 0.75rem;
    transition: all 0.2s;
  }

  .provider-card:hover {
    background: hsl(var(--muted) / 0.8);
    border-color: hsl(var(--border) / 0.8);
  }

  .provider-card.recommended {
    border-color: hsl(var(--primary) / 0.5);
    background: hsl(var(--primary) / 0.05);
  }

  .provider-card.recommended:hover {
    border-color: hsl(var(--primary) / 0.7);
    background: hsl(var(--primary) / 0.1);
  }

  .provider-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .provider-header h3 {
    font-size: 1rem;
    font-weight: 500;
    margin: 0;
  }

  .recommended-badge {
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.125rem 0.375rem;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border-radius: 0.25rem;
  }

  .available-badge {
    font-size: 0.75rem;
    color: hsl(142.1 76.2% 36.3%);
    margin-left: auto;
  }

  .provider-description {
    font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
    margin: 0;
  }

  .provider-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .docs-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: color 0.2s;
  }

  .docs-link:hover {
    color: hsl(var(--foreground));
  }

  .auth-note {
    font-size: 0.75rem;
    color: hsl(var(--muted-foreground));
    margin: 0;
    font-style: italic;
  }

  .refresh-section {
    display: flex;
    justify-content: center;
    margin-top: 0.5rem;
  }
</style>
