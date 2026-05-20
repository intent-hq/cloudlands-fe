<script lang="ts">
  /**
   * AgentGrid
   *
   * Product-card style horizontal wrapping grid showing ACP providers.
   * Each card has a brand-color top area with provider logo, and a bottom
   * area with name + connection status / connect controls.
   *
   * Connected cards use their brand color (feel active).
   * Disconnected cards use grey (muted).
   */
  import { onMount } from 'svelte';
  import { invoke } from '$lib/electron-bridge';
  import { ACP_PROVIDERS } from '$shared/config/provider-config';
  import {
  AUGGIE_CHANNELS,
  PROVIDERS_CHANNELS,
} from '$shared/ipc/channels';
  import ProviderCard from './ProviderCard.svelte';
  import type { ProviderBrandColors } from './ProviderCard.svelte';

  import { selectIsFeatureEnabled } from '$lib/store/slices/feature-codes/feature-codes-selectors';
  import {
  setActiveProvider,
  setProviderEnabled,
} from '$lib/store/slices/provider-settings/provider-settings-slice';
  import {
  reloadModelsForProvider,
  retryLoadModels,
} from '$lib/store/slices/model/model-slice';


  import { identifyUser } from '$lib/services/analytics';
  import { createLogger } from '$lib/utils/client-logger';

  import {
  selectProviderStatusMap,
  selectProviderLoadingMap,
  selectHasCheckedOnce,
} from '$lib/store/slices/agent-availability/agent-availability-selectors';
  import {
  checkSingleProviderSuccess,
  checkSingleProviderFailure,
  checkAllProvidersRequested,
  ensureProvidersChecked as ensureProvidersCheckedAction,
} from '$lib/store/slices/agent-availability/agent-availability-slice';
  import type { ProviderStatus } from '$lib/store/slices/agent-availability/agent-availability-types';

  import { fly } from 'svelte/transition';
  import { toast } from 'svelte-sonner';
  import { store as appStore } from '$lib/store/store';

  interface Props {
    /** Called when user selects a provider to start using */
    onProviderSelected?: (providerId: string) => void;
    /** Called when the availability of any provider changes */
    onAvailabilityChange?: (hasAny: boolean) => void;
    /**
     * Layout mode.
     *  - `false` (default): wrapping flex grid where cards stretch via `flex-1`
     *    to share the row in wide containers.
     *  - `true`: single-row layout with fixed-width cards. The grid sizes to
     *    its content (`w-max`) so the parent can clip/scroll horizontally
     *    via `overflow-x-auto`. Used in the workspace onboarding panel where
     *    the available width is narrower than the natural width of all cards.
     */
    horizontal?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Svelte prop used by parent
  let { onProviderSelected, onAvailabilityChange, horizontal = false }: Props = $props();


  // Reactive Redux selectors — init at component top level
  const providerStatusMap$ = selectProviderStatusMap();
  const providerLoadingMap$ = selectProviderLoadingMap();
  const hasCheckedOnce$ = selectHasCheckedOnce();

  /**
   * Check a single provider via IPC and dispatch the result to Redux.
   * Returns the status for callers that need the immediate result.
   */
  async function checkSingleProvider(providerId: string): Promise<ProviderStatus | undefined> {
    try {
      const result = await invoke<{
        success: boolean;
        providerId: string;
        data?: ProviderStatus;
        error?: string;
      }>(PROVIDERS_CHANNELS.CHECK_SINGLE, providerId);
      if (result.success && result.data) {
        appStore.dispatch(checkSingleProviderSuccess(providerId, result.data));
        return result.data;
      }
      appStore.dispatch(checkSingleProviderFailure(providerId));
    } catch (err) {
      logger.error(`Failed to check provider ${providerId}`, err as Error);
      appStore.dispatch(checkSingleProviderFailure(providerId));
    }
    return undefined;
  }

  /** Brand colors per provider for the card top area.
   *  `color` is the solid brand color; the gradient fades it vertically
   *  from full opacity at the top to transparent at the bottom so the
   *  dark card background shows through — matching the reference design. */
  const PROVIDER_BRAND_COLORS: Record<string, ProviderBrandColors> = {
    auggie: { color1: '#8B8BF8cc', color2: '#8B8BF8' },
    'claude-code': { color1: '#D97757', color2: '#D97757' },
    codex: { color1: '#CBE6FF', color2: '#DDBEFC', isLight: true },
    opencode: { color1: '#000', color2: '#1E1E1E' },
    cortex: { color1: '#FFA2A3', color2: '#FFA2A3' },
  };

  const DEFAULT_BRAND: ProviderBrandColors = { color1: '#555', color2: '#555' };

  /** Short descriptions for each provider */
  const PROVIDER_DESCRIPTIONS: Record<string, string> = {
    auggie:
      "Using Augment's agent, you get real-time codebase context, GitHub, Linear, and Sentry integrations.",
  };

  /**
   * Install command + docs URL for each provider.
   * Shown on the card so users can copy/run them without leaving the app.
   * Only the install command is surfaced — users uninstall via their package
   * manager directly when they want to remove a provider.
   */
  const PROVIDER_METADATA: Record<
    string,
    { installCommand: string; loginCommand?: string; docsUrl: string }
  > = {
    auggie: {
      installCommand: 'npm install -g @augmentcode/auggie',
      loginCommand: 'auggie login',
      docsUrl: 'https://docs.augmentcode.com/cli/overview',
    },
    'claude-code': {
      installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
      // The Claude Code CLI has no top-level `login` subcommand — auth is under
      // the `auth` group (`claude auth login/logout/status`).
      loginCommand: 'claude auth login',
      docsUrl: 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code',
    },
    codex: {
      installCommand: 'npm i -g @openai/codex',
      loginCommand: 'codex login',
      docsUrl: 'https://developers.openai.com/codex/cli#cli-setup',
    },
    opencode: {
      installCommand: 'curl -fsSL https://opencode.ai/install | bash',
      loginCommand: 'opencode auth login',
      docsUrl: 'https://opencode.ai/docs#install',
    },
    cortex: {
      installCommand: 'curl -LsS https://ai.snowflake.com/static/cc-scripts/install.sh | sh',
      loginCommand: 'cortex login',
      docsUrl: 'https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code-cli',
    },
  };

  /** Visible providers (not hidden by env var / feature code gates) */
  const visibleProviders = $derived.by(() => {
    const state = appStore.state;
    // Reactive reads from Redux selectors
    const statusMap = $providerStatusMap$;
    const loadingMap = $providerLoadingMap$;
    const hasCheckedOnce = $hasCheckedOnce$;
    return Object.values(ACP_PROVIDERS)
      .filter((p) => {
        // Client-side feature code gate — never show if the feature code isn't activated
        if (p.requiresFeatureCode && !selectIsFeatureEnabled.select(state, p.requiresFeatureCode)) {
          return false;
        }
        return true;
      })
      .map((p) => {
        const meta = PROVIDER_METADATA[p.id];
        const status = statusMap[p.id];
        return {
          id: p.id,
          name: p.displayName,
          available: status?.available ?? false,
          /** Whether the user is authenticated. undefined = not checked yet. */
          authenticated: status?.authenticated,
          /** Whether the availability check is still in-flight for this provider.
           *  Once we have a cached status for the provider, don't flip back to
           *  "loading" on background refreshes — avoids visual jitter where the
           *  card briefly shows "Checking…" every poll cycle. */
          statusLoading: (loadingMap[p.id] && !status) ?? !hasCheckedOnce,
          /**
           * User identity extracted from the provider's CLI (email / username).
           * Only set when the provider is authenticated AND we could parse
           * something useful out of the CLI stdout — may be undefined.
           */
          authDetails: status?.authDetails,
          docsUrl: meta?.docsUrl ?? p.loginDocsUrl ?? '',
          installCommand: meta?.installCommand ?? '',
          loginCommand: meta?.loginCommand ?? '',
          description: PROVIDER_DESCRIPTIONS[p.id] ?? '',
        };
      });
  });

  const hasAnyProvider = $derived(
    visibleProviders.some((p) => {
      if (!p.available || p.statusLoading) return false;
      const isAuggieNeedsUpdate = p.id === 'auggie' && auggieNeedsUpdate;
      const isNotAuthenticated = p.authenticated !== true;
      return !isAuggieNeedsUpdate && !isNotAuthenticated;
    }),
  );

  $effect(() => {
    onAvailabilityChange?.(hasAnyProvider);
  });

  async function handleSelectProvider(providerId: string) {
    appStore.dispatch(setProviderEnabled({ providerId, enabled: true }));
    appStore.dispatch(setActiveProvider(providerId));
    appStore.dispatch(reloadModelsForProvider());
    onProviderSelected?.(providerId);
  }

  // ---------------------------------------------------------------------------
  // Auggie-specific install & login (mirrors AuggieSetupGate flows)
  // ---------------------------------------------------------------------------
  const logger = createLogger('AgentGrid');

  let auggieActionInProgress = $state(false);
  let auggieAuthUrl = $state<string | null>(null);
  let auggieWaitingForBrowser = $state(false);
  let auggieShowManualAuth = $state(false);
  let auggieManualAuthInput = $state('');
  let auggieAuthError = $state<string | null>(null);
  let auggieAuthPollHandle: ReturnType<typeof setInterval> | null = null;
  let auggieAuthPollInFlight = false;
  let auggieVersionOk = $state<boolean | undefined>(undefined);
  let auggieNeedsUpdate = $derived(auggieVersionOk === false);

  /** Fetch auggie version status from AUGGIE_CHANNELS.STATUS. */
  async function checkAuggieVersion() {
    try {
      const result = await invoke<{
        success: boolean;
        data?: { versionOk: boolean; version?: string; minimumVersion?: string };
      }>(AUGGIE_CHANNELS.STATUS);
      if (result.data) {
        auggieVersionOk = result.data.versionOk;
      }
    } catch (err) {
      logger.debug('Failed to check auggie version', { error: err });
    }
  }

  /** Called after successful auggie install or login to refresh models + analytics. */
  /** Reset all auggie auth UI state (manual paste, waiting, error). */
  function clearAuggieAuthUI() {
    auggieShowManualAuth = false;
    auggieWaitingForBrowser = false;
    auggieAuthError = null;
    auggieManualAuthInput = '';
    auggieAuthUrl = null;
    stopAuggieAuthPolling();
  }

  async function onAuggieReady() {
    clearAuggieAuthUI();
    await Promise.all([checkSingleProvider('auggie'), checkAuggieVersion()]);
    identifyUser({ force: true }).catch(() => {});
    appStore.dispatch(retryLoadModels());
  }

  // Auto-clear auth UI when auggie becomes authenticated (e.g. after refresh)
  $effect(() => {
    const statusMap = $providerStatusMap$;
    if (statusMap.auggie?.authenticated === true) {
      clearAuggieAuthUI();
    }
  });

  /** Download the auggie binary via the managed install path (no npm needed). */
  async function installAuggieBinary() {
    try {
      auggieActionInProgress = true;
      const result = await invoke<{ success: boolean; error?: string }>(AUGGIE_CHANNELS.INSTALL);
      if (!result.success) throw new Error(result.error || 'Installation failed');
      toast.success('Auggie installed');
      await onAuggieReady();
    } catch (err) {
      const message = (err as Error).message;
      toast.error('Install failed', { description: message });
    } finally {
      auggieActionInProgress = false;
    }
  }

  function stopAuggieAuthPolling() {
    if (auggieAuthPollHandle) {
      clearInterval(auggieAuthPollHandle);
      auggieAuthPollHandle = null;
    }
  }

  /** Poll the running auth process to see if the browser OAuth completed. */
  async function pollAuggieAuthOnce() {
    if (auggieAuthPollInFlight) return;
    auggieAuthPollInFlight = true;
    try {
      const result = await invoke<{
        success: boolean;
        data?: { completed?: boolean; authenticated?: boolean };
        error?: string;
      }>(AUGGIE_CHANNELS.AUTHENTICATE, { action: 'poll' });
      if (result.success && result.data?.completed) {
        stopAuggieAuthPolling();
        auggieWaitingForBrowser = false;
        if (result.data.authenticated) {
          logger.info('Auggie auth completed via browser callback');
          toast.success('Logged in to Auggie');
          await onAuggieReady();
        } else {
          logger.info('Auggie login process ended without authenticating, showing manual paste');
          auggieShowManualAuth = true;
        }
      }
    } catch (err) {
      logger.error('Error polling auggie auth status', { error: err });
    } finally {
      auggieAuthPollInFlight = false;
    }
  }

  function startAuggieAuthPolling() {
    stopAuggieAuthPolling();
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLL_TIME_MS = 120_000;
    const startTime = Date.now();
    auggieAuthPollHandle = setInterval(async () => {
      await pollAuggieAuthOnce();
      if (Date.now() - startTime > MAX_POLL_TIME_MS && auggieWaitingForBrowser) {
        logger.info('Auggie auth polling timed out, falling back to manual paste');
        stopAuggieAuthPolling();
        auggieWaitingForBrowser = false;
        auggieShowManualAuth = true;
      }
    }, POLL_INTERVAL_MS);
  }

  /** Normalize manual auth input: JSON passthrough, URL→JSON, or plain code. */
  function normalizeAuthResponse(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      /* not JSON */
    }
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
      /* not a URL */
    }
    return JSON.stringify({ code: trimmed });
  }

  /** Start the auggie OAuth login flow (opens browser). Retries up to 2 times. */
  async function loginAuggie(retryCount = 0) {
    try {
      auggieActionInProgress = true;
      auggieAuthError = null;
      auggieAuthUrl = null;
      auggieManualAuthInput = '';
      auggieShowManualAuth = false;
      auggieWaitingForBrowser = false;
      stopAuggieAuthPolling();

      const result = await invoke<{
        success: boolean;
        data?: {
          autoCompleted?: boolean;
          processStarted?: boolean;
          authUrl?: string;
          isJsonPasteFlow?: boolean;
        };
        error?: string;
      }>(AUGGIE_CHANNELS.AUTHENTICATE, { action: 'start' });

      if (!result.success) throw new Error(result.error || 'Failed to start authentication');

      if (result.data?.autoCompleted) {
        toast.success('Logged in to Auggie');
        await onAuggieReady();
        return;
      }
      if (!result.data?.processStarted) throw new Error('Failed to start authentication process');

      // Capture auth URL for fallback link
      if (result.data.authUrl) auggieAuthUrl = result.data.authUrl;

      // JSON paste flow (remote/SSH session) — go straight to paste textarea
      if (result.data.isJsonPasteFlow) {
        auggieShowManualAuth = true;
        auggieActionInProgress = false;
        return;
      }

      // Normal browser flow — poll for completion
      auggieWaitingForBrowser = true;
      auggieActionInProgress = false;
      startAuggieAuthPolling();
    } catch (err) {
      if (retryCount < 2) {
        logger.debug('Auggie auth failed, retrying...', { retryCount });
        await new Promise((r) => setTimeout(r, 1000));
        return loginAuggie(retryCount + 1);
      }
      const message = (err as Error).message;
      auggieAuthError = message;
      toast.error('Login failed', { description: message });
      auggieActionInProgress = false;
    }
  }

  /** Complete manual auth by submitting the pasted token/JSON. */
  async function completeAuggieManualAuth(retryCount = 0) {
    if (!auggieManualAuthInput.trim()) {
      toast.error('Please paste the session code or JSON response');
      return;
    }
    try {
      auggieActionInProgress = true;
      auggieAuthError = null;
      const normalized = normalizeAuthResponse(auggieManualAuthInput);
      const result = await invoke<{ success: boolean; error?: string }>(
        AUGGIE_CHANNELS.AUTHENTICATE,
        { action: 'complete', authResponse: normalized },
      );
      if (!result.success) {
        // Check if auth actually succeeded despite error response
        const status = await checkSingleProvider('auggie');
        if (status?.authenticated === true) {
          auggieManualAuthInput = '';
          auggieShowManualAuth = false;
          toast.success('Logged in to Auggie');
          await onAuggieReady();
          return;
        }
        throw new Error(result.error || 'Failed to complete authentication');
      }
      auggieManualAuthInput = '';
      auggieShowManualAuth = false;
      toast.success('Logged in to Auggie');
      await onAuggieReady();
    } catch (err) {
      const message = (err as Error).message;
      const isSessionExpired = message.includes('session has expired');
      if (!isSessionExpired && retryCount < 2) {
        await new Promise((r) => setTimeout(r, 1000));
        return completeAuggieManualAuth(retryCount + 1);
      }
      auggieAuthError = message;
      toast.error('Authentication failed', { description: message });
    } finally {
      auggieActionInProgress = false;
    }
  }

  onMount(() => {
    appStore.dispatch(ensureProvidersCheckedAction());
    checkAuggieVersion();

    // Re-check all provider statuses on window focus/visibility
    // (user may have installed a CLI tool or logged in via browser)
    const handleFocus = () => {
      appStore.dispatch(checkAllProvidersRequested());
      if (auggieWaitingForBrowser) pollAuggieAuthOnce();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        appStore.dispatch(checkAllProvidersRequested());
        if (auggieWaitingForBrowser) pollAuggieAuthOnce();
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      stopAuggieAuthPolling();
    };
  });
</script>

<div class="flex gap-4 w-full">
  {#each visibleProviders as provider, i (provider.id)}
    <div
      class="overflow-hidden transition-all flex flex-col flex-1 min-w-66"
      in:fly={{ y: 20, duration: 300, delay: i * 60 }}
    >
      <ProviderCard
        {provider}
        brand={PROVIDER_BRAND_COLORS[provider.id] ?? DEFAULT_BRAND}
        {auggieNeedsUpdate}
        {auggieActionInProgress}
        {auggieWaitingForBrowser}
        {auggieShowManualAuth}
        {auggieManualAuthInput}
        {auggieAuthUrl}
        {auggieAuthError}
        onSelect={handleSelectProvider}
        onAuggieInstall={installAuggieBinary}
        onAuggieLogin={() => loginAuggie()}
        onAuggieManualAuth={() => completeAuggieManualAuth()}
        onAuggieManualAuthInputChange={(v) => (auggieManualAuthInput = v)}
      />
    </div>
  {/each}
</div>
