<script lang="ts">
  /**
   * ProviderSelector
   *
   * Settings panel for selecting which ACP provider to use.
   * Self-contained component with inline rendering matching ProviderStatusPanel design
   * so it can be independently tweaked for settings-specific needs.
   */
  import { onMount } from 'svelte';
  import { invoke, shell } from '$lib/electron-bridge';
  import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { ACP_PROVIDERS } from '$shared/config/provider-config';
  import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
  import {
    MINIMUM_AUGGIE_VERSION,
    MINIMUM_NODE_VERSION,
    type InstallErrorType,
  } from '$shared/constants/auggie';
  import { createLogger } from '$lib/utils/client-logger';
  import { track } from '$lib/services/analytics';
  import type { ProviderAvailabilityResult } from '$features/providers/main/provider-availability.service';
  import {
    faCheck,
    faCircleNotch,
    faPaste,
    faTerminal,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import NodeVersionWarning from '$lib/components/NodeVersionWarning.svelte';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { toast } from 'svelte-sonner';
  import Logo from '../Logo.svelte';
  import ProviderPathConfig from './ProviderPathConfig.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import Button from '../ui/button/button.svelte';

  const logger = createLogger('ProviderSelector');

  const INSTALL_COMMAND = 'npm install -g @augmentcode/auggie';

  // Provider availability state
  let providerAvailability: ProviderAvailabilityResult | null = $state(null);
  let checkError: string | null = $state(null);
  let loading = $state(true);
  let hasLoadedOnce = $state(false);

  // Auggie-specific state (for auth flow)
  type AuggieStatus = {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    versionOk: boolean;
    minimumVersion: string;
    nodeVersion?: string;
    nodePath?: string;
    nodeVersionOk: boolean;
  };
  let auggieStatus: AuggieStatus | null = $state(null);
  let auggieLoading = $state(true);
  let actionInProgress = $state(false);

  // Install error handling
  let installError: string | null = $state(null);
  let installErrorType: InstallErrorType | null = $state(null);
  let showManualInstall = $state(false);

  // Auth flow state
  let authInProgress = $state(false);
  let showAuthInput = $state(false);
  let waitingForBrowserAuth = $state(false);
  let authInput = $state('');
  let authUrl: string | null = $state(null);
  let authError: string | null = $state(null);
  let authPollHandle: ReturnType<typeof setInterval> | null = null;

  // MCP state
  let mcpLoading = $state(true);
  let mcpConfigured = $state<Record<string, boolean>>({
    'claude-code': false,
    codex: false,
    opencode: false,
    cortex: false,
  });
  let setupInProgress = $state<Record<string, boolean>>({});
  let uninstallInProgress = $state<Record<string, boolean>>({});

  // Derived: is the version outdated (installed but below minimum)
  const needsUpdate = $derived.by(() => {
    return !!auggieStatus && auggieStatus.installed && !auggieStatus.versionOk;
  });

  // Track if we're waiting to check provider availability on focus
  let pendingFocusCheck = $state(false);

  // Loading state for "Start using" / select buttons
  let selectingProviderId = $state<string | null>(null);

  // Provider path configuration state
  // Configured paths (user-set overrides)
  let providerPaths = $state<Record<string, string>>({});
  // Resolved paths (auto-detected)
  let resolvedPaths = $state<Record<string, string>>({});

  // Provider metadata for docs URLs and auth requirements
  const PROVIDER_METADATA: Record<string, { docsUrl: string; requiresAuth: boolean }> = {
    auggie: { docsUrl: 'https://docs.augmentcode.com/cli/overview', requiresAuth: true },
    'claude-code': { docsUrl: 'https://code.claude.com/docs/en/quickstart', requiresAuth: false },
    codex: { docsUrl: 'https://developers.openai.com/codex/cli/', requiresAuth: false },
    opencode: { docsUrl: 'https://opencode.ai/docs', requiresAuth: false },
    cortex: {
      docsUrl: 'https://docs.snowflake.com/en/developer-guide/cortex',
      requiresAuth: false,
    },
  };

  // Map provider IDs to keys used in ProviderAvailabilityResult
  const providerKeyMap: Record<string, keyof ProviderAvailabilityResult['providers']> = {
    auggie: 'auggie',
    'claude-code': 'claudeCode',
    codex: 'codex',
    opencode: 'opencode',
    cortex: 'cortex',
  };

  // Helper to get provider availability from result (handles different key formats)
  function getProviderAvailable(providerId: string): boolean {
    if (!providerAvailability) return false;
    const key = providerKeyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].available;
    }
    return false;
  }

  // Helper to get provider auth status
  function getProviderAuthenticated(providerId: string): boolean | undefined {
    if (!providerAvailability) return undefined;
    const key = providerKeyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].authenticated;
    }
    return undefined;
  }

  // Provider options for display - dynamically generated from ACP_PROVIDERS
  // Filter out providers that are hidden (env var gated and not enabled)
  const providerOptions = $derived.by(() =>
    Object.values(ACP_PROVIDERS)
      .filter((provider) => !providerAvailability?.hiddenProviders?.includes(provider.id))
      .map((provider) => ({
        id: provider.id,
        name: provider.displayName,
        command: provider.command,
        available: getProviderAvailable(provider.id),
        authenticated: getProviderAuthenticated(provider.id),
        requiresAuth: PROVIDER_METADATA[provider.id]?.requiresAuth ?? false,
        docsUrl: PROVIDER_METADATA[provider.id]?.docsUrl ?? '',
        loginDocsUrl: provider.loginDocsUrl,
      })),
  );

  onMount(() => {
    checkProviderAvailability();
    loadProviderPaths();

    // Focus/visibility listener to silently recheck provider availability (including auth)
    // when the app returns to focus, so status updates after the user logs in via CLI or browser.
    const handleFocus = () => {
      if (waitingForBrowserAuth) {
        checkAuthPollOnce();
      }
      pendingFocusCheck = false;
      silentRefreshProviderAvailability();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (waitingForBrowserAuth) {
        checkAuthPollOnce();
      }
      pendingFocusCheck = false;
      silentRefreshProviderAvailability();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (authPollHandle) {
        clearInterval(authPollHandle);
        authPollHandle = null;
      }
    };
  });

  /** Load configured and resolved paths for all providers */
  async function loadProviderPaths() {
    try {
      // Load configured paths from settings
      const settingsResult = await invoke<{ success: boolean; data?: Record<string, any> }>(
        'settings:getAll',
      );
      if (settingsResult?.data) {
        const settings = settingsResult.data;
        providerPaths = {
          auggie: settings.auggiePath || '',
          'claude-code': settings['claude-codePath'] || '',
          codex: settings['codexPath'] || '',
        };
      }

      // Load resolved paths for all providers
      const pathsResult = await invoke<{
        success: boolean;
        data?: { auggie: string | null; 'claude-code': string | null; codex: string | null };
      }>(PROVIDERS_CHANNELS.GET_PATHS);
      if (pathsResult?.success && pathsResult.data) {
        resolvedPaths = {
          auggie: pathsResult.data.auggie || '',
          'claude-code': pathsResult.data['claude-code'] || '',
          codex: pathsResult.data.codex || '',
        };
      }
    } catch (err) {
      logger.error('Failed to load provider paths', { error: err });
    }
  }

  /** Handle path change from ProviderPathConfig */
  function handlePathChange(providerId: string, newPath: string) {
    providerPaths = { ...providerPaths, [providerId]: newPath };
    // Refresh provider availability after path change
    checkProviderAvailability(true);
  }

  /**
   * Kick off all three loading tracks concurrently.
   * Each track updates its own state slice and unblocks its own UI section.
   */
  async function checkProviderAvailability(refreshModels = false) {
    checkError = null;
    await Promise.all([
      loadAuggieStatus(),
      loadProviderAvailability(refreshModels),
      loadMcpStatus(),
    ]);
  }

  /** Silent recheck — updates data without showing loading spinners */
  async function silentRefreshProviderAvailability() {
    try {
      const providerResult = await invoke<{
        success: boolean;
        data?: ProviderAvailabilityResult;
        error?: string;
      }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);

      if (providerResult.success && providerResult.data) {
        // Reconcile auggie status if already loaded
        if (auggieStatus?.installed) {
          providerResult.data.providers.auggie.available = true;
          providerResult.data.hasAnyProvider = true;
        }
        providerAvailability = providerResult.data;
      }
    } catch (err) {
      logger.error('Silent provider refresh failed', { error: err });
    }
  }

  /** Track 1: Auggie install/auth status -- unblocks the auggie row */
  async function loadAuggieStatus() {
    auggieLoading = true;
    try {
      const result = await invoke<{ success: boolean; data?: AuggieStatus; error?: string }>(
        AUGGIE_CHANNELS.STATUS,
      );
      // Read data regardless of success — when auggie --version fails (e.g. Node too old),
      // the handler still returns data with nodeVersionOk/nodeVersion so the warning shows.
      if (result.data) {
        auggieStatus = result.data;
        if (providerAvailability && auggieStatus.installed) {
          providerAvailability.providers.auggie.available = true;
          providerAvailability.hasAnyProvider = true;
        }
      }
    } catch (err) {
      logger.warn('Failed to check Auggie status', { error: err });
    } finally {
      auggieLoading = false;
    }
  }

  /** Track 2: Other provider availability -- unblocks the provider rows */
  async function loadProviderAvailability(refreshModels = false) {
    loading = true;
    try {
      const providerResult = await invoke<{
        success: boolean;
        data?: ProviderAvailabilityResult;
        error?: string;
      }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);

      if (!providerResult.success) {
        checkError = providerResult.error || 'Failed to check providers';
        return;
      }
      providerAvailability = providerResult.data || null;

      // If auggie status already arrived, reconcile
      if (providerAvailability && auggieStatus?.installed) {
        providerAvailability.providers.auggie.available = true;
        providerAvailability.hasAnyProvider = true;
      }

      if (refreshModels) {
        await modelStore.retryLoadModels();
      }
    } catch (err) {
      logger.error('Failed to check provider availability', { error: err });
      checkError = err instanceof Error ? err.message : 'Unknown error';
    } finally {
      loading = false;
      hasLoadedOnce = true;
    }
  }

  /** Track 3: MCP configuration -- fills in Context Engine buttons */
  async function loadMcpStatus() {
    mcpLoading = true;
    try {
      const hidden = providerAvailability?.hiddenProviders ?? [];
      const isCortexHidden = hidden.includes('cortex');

      const [
        checkMcpClaudeCodeResult,
        checkMcpCodexResult,
        checkMcpOpenCodeResult,
        checkMcpCortexResult,
      ] = await Promise.all([
        invoke<{ success: boolean; configured?: boolean }>(AUGGIE_CHANNELS.CHECK_MCP_CLAUDE_CODE),
        invoke<{ success: boolean; configured?: boolean }>(AUGGIE_CHANNELS.CHECK_MCP_CODEX),
        invoke<{ success: boolean; configured?: boolean }>(AUGGIE_CHANNELS.CHECK_MCP_OPENCODE),
        isCortexHidden
          ? Promise.resolve({ success: true, configured: false })
          : invoke<{ success: boolean; configured?: boolean }>(AUGGIE_CHANNELS.CHECK_MCP_CORTEX),
      ]);

      mcpConfigured = {
        'claude-code': checkMcpClaudeCodeResult?.configured ?? false,
        codex: checkMcpCodexResult?.configured ?? false,
        opencode: checkMcpOpenCodeResult?.configured ?? false,
        cortex: checkMcpCortexResult?.configured ?? false,
      };
    } catch (err) {
      logger.warn('Failed to check MCP status', { error: err });
    } finally {
      mcpLoading = false;
    }
  }

  async function handleSetupMcp(providerId: string) {
    setupInProgress = { ...setupInProgress, [providerId]: true };
    try {
      // Map provider ID to channel
      const channelMap: Record<string, string> = {
        'claude-code': AUGGIE_CHANNELS.SETUP_MCP_CLAUDE_CODE,
        codex: AUGGIE_CHANNELS.SETUP_MCP_CODEX,
        opencode: AUGGIE_CHANNELS.SETUP_MCP_OPENCODE,
        cortex: AUGGIE_CHANNELS.SETUP_MCP_CORTEX,
      };

      const channel = channelMap[providerId];
      if (!channel) {
        throw new Error(`Unknown provider: ${providerId}`);
      }

      const result = await invoke<{ success: boolean; error?: string }>(channel);

      if (result?.success) {
        mcpConfigured = { ...mcpConfigured, [providerId]: true };
        toast.success(`${ACP_PROVIDERS[providerId].displayName} Context Engine setup complete`);
        track('Enabled Context Engine', {
          provider_id: providerId,
          success: true,
        });
      } else {
        toast.error(
          `Failed to setup ${ACP_PROVIDERS[providerId].displayName}: ${result?.error || 'Unknown error'}`,
        );
        track('Enabled Context Engine', {
          provider_id: providerId,
          success: false,
        });
      }
    } catch (err) {
      logger.error(`Failed to setup MCP for ${providerId}:`, err);
      toast.error(`Error setting up ${ACP_PROVIDERS[providerId].displayName}`);
    } finally {
      setupInProgress = { ...setupInProgress, [providerId]: false };
    }
  }

  async function handleUninstallMcp(providerId: string) {
    uninstallInProgress = { ...uninstallInProgress, [providerId]: true };
    try {
      const channelMap: Record<string, string> = {
        'claude-code': AUGGIE_CHANNELS.UNINSTALL_MCP_CLAUDE_CODE,
        codex: AUGGIE_CHANNELS.UNINSTALL_MCP_CODEX,
        opencode: AUGGIE_CHANNELS.UNINSTALL_MCP_OPENCODE,
        cortex: AUGGIE_CHANNELS.UNINSTALL_MCP_CORTEX,
      };

      const channel = channelMap[providerId];
      if (!channel) {
        throw new Error(`Unknown provider: ${providerId}`);
      }

      const result = await invoke<{ success: boolean; error?: string }>(channel);

      if (result?.success) {
        mcpConfigured = { ...mcpConfigured, [providerId]: false };
        toast.success(`${ACP_PROVIDERS[providerId].displayName} Context Engine removed`);
        track('Disabled Context Engine', {
          provider_id: providerId,
          success: true,
        });
      } else {
        toast.error(
          `Failed to remove ${ACP_PROVIDERS[providerId].displayName}: ${result?.error || 'Unknown error'}`,
        );
        track('Disabled Context Engine', {
          provider_id: providerId,
          success: false,
        });
      }
    } catch (err) {
      logger.error(`Failed to uninstall MCP for ${providerId}:`, err);
      toast.error(`Error removing ${ACP_PROVIDERS[providerId].displayName} Context Engine`);
    } finally {
      uninstallInProgress = { ...uninstallInProgress, [providerId]: false };
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
      lowerMessage.includes('sudo')
    ) {
      return 'permission';
    }
    if (lowerMessage.includes('npm is not installed') || lowerMessage.includes('node.js')) {
      return 'missing_npm';
    }
    return 'unknown';
  }

  async function installAuggie() {
    actionInProgress = true;
    installError = null;
    installErrorType = null;
    showManualInstall = false;
    try {
      const result = await invoke<{
        success: boolean;
        error?: string;
        errorType?: InstallErrorType;
      }>(AUGGIE_CHANNELS.INSTALL);
      if (result.success) {
        toast.success('Auggie installed successfully');
        await checkProviderAvailability();
        await modelStore.retryLoadModels();
      } else {
        const message = result.error || 'Installation failed';
        installError = message;
        installErrorType = deriveInstallErrorType(result.errorType, message);
        showManualInstall = true;
        toast.error('Install failed', { description: message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Installation failed';
      installError = message;
      installErrorType = deriveInstallErrorType(undefined, message);
      showManualInstall = true;
      toast.error('Install failed', { description: message });
    } finally {
      actionInProgress = false;
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
      }>(AUGGIE_CHANNELS.AUTHENTICATE, { action: 'poll' });

      if (result.success && result.data?.completed) {
        stopAuthPolling();
        waitingForBrowserAuth = false;
        if (result.data.authenticated) {
          toast.success('Logged in successfully');
          await checkProviderAvailability();
          await modelStore.reloadModelsForProvider();
        } else {
          showAuthInput = true;
        }
      }
    } catch {
      // ignore poll errors
    } finally {
      authPollCheckInFlight = false;
    }
  }

  function startAuthPolling() {
    stopAuthPolling();
    const POLL_INTERVAL_MS = 2000;
    const MAX_POLL_TIME_MS = 120000;
    const startTime = Date.now();

    authPollHandle = setInterval(async () => {
      await checkAuthPollOnce();
      if (Date.now() - startTime > MAX_POLL_TIME_MS && waitingForBrowserAuth) {
        stopAuthPolling();
        waitingForBrowserAuth = false;
        showAuthInput = true;
      }
    }, POLL_INTERVAL_MS);
  }

  async function startAuth() {
    authInProgress = true;
    authError = null;
    waitingForBrowserAuth = false;
    showAuthInput = false;
    stopAuthPolling();
    try {
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

      if (result.success && result.data?.autoCompleted) {
        toast.success('Logged in successfully');
        await checkProviderAvailability();
        await modelStore.reloadModelsForProvider();
        return;
      }

      if (result.success && result.data?.processStarted) {
        if (result.data.authUrl) {
          authUrl = result.data.authUrl;
        }
        // Old JSON paste flow (remote/SSH) — go straight to paste textarea
        if (result.data.isJsonPasteFlow) {
          showAuthInput = true;
        } else {
          waitingForBrowserAuth = true;
          startAuthPolling();
        }
      } else {
        authError = result.error || 'Failed to start authentication';
      }
    } catch {
      authError = 'Failed to start authentication';
    } finally {
      authInProgress = false;
    }
  }

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

  async function completeAuth() {
    if (!authInput.trim()) return;
    authInProgress = true;
    authError = null;
    try {
      const normalizedResponse = normalizeAuthResponse(authInput);
      const result = await invoke<{ success: boolean; error?: string }>(
        AUGGIE_CHANNELS.AUTHENTICATE,
        { action: 'complete', authResponse: normalizedResponse },
      );
      if (result.success) {
        toast.success('Logged in successfully');
        showAuthInput = false;
        authInput = '';
        authUrl = null;
        await checkProviderAvailability();
        await modelStore.reloadModelsForProvider();
      } else {
        await loadAuggieStatus();
        if (auggieStatus?.authenticated) {
          toast.success('Logged in successfully');
          showAuthInput = false;
          authInput = '';
          authUrl = null;
          await modelStore.reloadModelsForProvider();
        } else {
          authError = result.error || 'Authentication failed';
        }
      }
    } catch {
      authError = 'Authentication failed';
    } finally {
      authInProgress = false;
    }
  }

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd);
    toast.success('Copied to clipboard');
  }

  function openDocs(url: string, enableFocusCheck = false) {
    if (enableFocusCheck) {
      pendingFocusCheck = true;
    }
    shell.open(url);
  }

  async function handleSelectProvider(providerId: string) {
    selectingProviderId = providerId;
    const previousProviderId = activeProviderStore.activeProviderId;
    try {
      logger.info('Selecting provider:', {
        from: previousProviderId,
        to: providerId,
      });
      activeProviderStore.setActiveProvider(providerId);
      await modelStore.reloadModelsForProvider();
      toast.success(`Switched to ${ACP_PROVIDERS[providerId]?.displayName || providerId}`);

      // Track provider selection
      track('Selected Provider', {
        provider_id: providerId,
        previous_provider_id: previousProviderId,
      });
    } finally {
      selectingProviderId = null;
    }
  }
</script>

<div class="space-y-6">
  {#if loading && !hasLoadedOnce}
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          {@render providerIcon('auggie')}
          <span class="text-sm text-foreground">{ACP_PROVIDERS.auggie.displayName}</span>
          <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
        </div>
        <ul class="list-disc pl-12 text-xs text-subtle">
          <li><p>Real-time codebase understanding with Context Engine</p></li>
          <li><p>Github, Linear, and Sentry workflow integration</p></li>
          <li><p>Multiple AI model provider selection & use</p></li>
        </ul>
      </div>
      <div class="h-4 w-20 bg-muted/50 rounded animate-pulse"></div>
    </div>

    {@render skeleton('claude-code')}

    {@render skeleton('codex')}

    {@render skeleton('opencode')}

    {#if providerAvailability && !providerAvailability.hiddenProviders?.includes('cortex')}
      {@render skeleton('cortex')}
    {/if}
  {:else if checkError}
    <div class="flex items-center justify-between gap-4">
      <p class="text-sm text-destructive-foreground">{checkError}</p>
      <button
        type="button"
        class="text-primary hover:text-primary/80 cursor-pointer transition-colors text-xs font-medium"
        onclick={() => checkProviderAvailability(true)}
      >
        Try Again
      </button>
    </div>
  {/if}

  {#if !loading || hasLoadedOnce}
    <!-- Auggie provider row -->
    {#if auggieLoading}
      {@render skeleton('auggie', true)}
    {:else}
      {@const auggieProvider = providerOptions.find((p) => p.id === 'auggie')}
      {@const isAuggieActive = activeProviderStore.activeProviderId === 'auggie'}
      {#if auggieProvider}
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2 h-7">
              {@render providerIcon('auggie')}
              <span class="text-sm text-foreground">{auggieProvider.name}</span>
              <div class="-my-1">
                <!-- Path configuration -->
                <ProviderPathConfig
                  providerId="auggie"
                  providerName={auggieProvider.name}
                  cliCommand={auggieProvider.command}
                  configuredPath={providerPaths['auggie']}
                  resolvedPath={resolvedPaths['auggie']}
                  isInstalled={auggieStatus?.installed}
                  onPathChange={(path) => handlePathChange('auggie', path)}
                />
              </div>
              {#if auggieStatus?.installed && auggieStatus?.authenticated}
                <span class="text-xs text-subtle flex items-center gap-1">
                  <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
                  {isAuggieActive ? 'Active' : 'Installed'}
                </span>
              {/if}
            </div>
            <ul class="list-disc pl-12 text-xs text-subtle">
              <li>
                <p>Real-time codebase understanding with Context Engine</p>
              </li>
              <li>
                <p>Github, Linear, and Sentry workflow integration</p>
              </li>
              <li>
                <p>Multiple AI model provider selection & use</p>
              </li>
            </ul>
            {#if needsUpdate}
              <p class="text-xs text-amber-500">
                v{auggieStatus?.version} installed (needs {MINIMUM_AUGGIE_VERSION}+)
              </p>
            {/if}
          </div>

          <div class="flex items-center gap-2 text-xs">
            {#if !auggieStatus?.installed}
              {#if actionInProgress}
                <span class="text-subtle">Installing...</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={installAuggie}
                >
                  Install
                </button>
              {/if}
            {:else if needsUpdate}
              {#if actionInProgress}
                <span class="text-subtle">Updating...</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={installAuggie}
                >
                  Update
                </button>
              {/if}
            {:else if !auggieStatus?.authenticated}
              {#if authInProgress || waitingForBrowserAuth}
                <span class="text-subtle">Waiting for authorization...</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={startAuth}
                >
                  Login
                </button>
              {/if}
            {:else if !isAuggieActive}
              <button
                type="button"
                class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                onclick={() => handleSelectProvider('auggie')}
                disabled={selectingProviderId !== null}
              >
                {selectingProviderId === 'auggie' ? 'Switching...' : 'Set as default'}
              </button>
            {:else if isAuggieActive}
              <span class="text-xs text-subtle flex items-center gap-1"> Default </span>
            {/if}
          </div>
        </div>

        <!-- Node.js version warning -->
        {#if auggieStatus && auggieStatus.nodeVersionOk === false}
          <NodeVersionWarning nodeVersion={auggieStatus.nodeVersion} class="mt-1" />
        {/if}

        <!-- Waiting for browser auth (localhost OAuth flow) -->
        {#if waitingForBrowserAuth}
          <div
            class="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg ml-0"
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            <p class="text-xs text-subtle">Waiting for browser authentication...</p>
            {#if authUrl}
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-foreground text-left bg-transparent border-none p-0 cursor-pointer transition-colors"
                onclick={() => authUrl && shell.open(authUrl)}
              >
                Browser didn't open? <span class="underline">Click here</span>
              </button>
            {/if}
            <div class="flex gap-2 text-xs">
              <button
                type="button"
                class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium disabled:opacity-50"
                onclick={() => checkAuthPollOnce()}
                disabled={authPollCheckInFlight}
              >
                {authPollCheckInFlight ? 'Checking...' : 'Check now'}
              </button>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                onclick={() => {
                  stopAuthPolling();
                  waitingForBrowserAuth = false;
                  showAuthInput = true;
                }}
              >
                Paste code manually instead
              </button>
            </div>
          </div>
        {/if}

        <!-- Auth input (for Auggie) -->
        {#if showAuthInput}
          <div
            class="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg ml-0"
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            {#if authError}
              <p class="text-xs text-destructive-foreground">{authError}</p>
            {/if}
            <textarea
              bind:value={authInput}
              placeholder={'e.g. {"code":"...","state":"...","tenant_url":"..."}'}
              class="w-full h-16 p-2 bg-background border border-border rounded font-mono text-xs resize-none outline-none focus:border-primary/50 transition-colors"
            ></textarea>
            {#if authUrl}
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-foreground text-left bg-transparent border-none p-0 cursor-pointer transition-colors"
                onclick={() => authUrl && shell.open(authUrl)}
              >
                Browser didn't open? <span class="underline">Click here</span>
              </button>
            {/if}
            <div class="flex gap-2 text-xs">
              <button
                type="button"
                class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium disabled:opacity-50"
                onclick={completeAuth}
                disabled={authInProgress || !authInput.trim()}
              >
                {authInProgress ? 'Completing...' : 'Complete Login'}
              </button>
              <span class="text-ghost">·</span>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                onclick={() => {
                  showAuthInput = false;
                  authInput = '';
                  authError = null;
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}

        <!-- Manual install fallback -->
        {#if showManualInstall && installError}
          <div
            class="flex flex-col gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg"
            transition:slide={{ axis: 'y', duration: 200 }}
          >
            <p class="text-xs text-destructive-foreground">{installError}</p>
            {#if installErrorType === 'permission'}
              <p class="text-xs text-subtle">Try running with sudo or fix npm permissions.</p>
            {:else if installErrorType === 'node_too_old'}
              <p class="text-xs text-muted-foreground">
                Update <a
                  href="https://nodejs.org"
                  class="underline text-primary"
                  onclick={(e) => {
                    e.preventDefault();
                    const wsId = workspaceStore.current?.id;
                    if (wsId)
                      handleLink('https://nodejs.org', {
                        workspaceId: wsId as WorkspaceId,
                        event: e,
                      });
                  }}>Node.js</a
                >
                to version {MINIMUM_NODE_VERSION.split('.')[0]} or later.
              </p>
            {:else if installErrorType === 'missing_npm'}
              <p class="text-xs text-subtle">
                Install <a
                  href="https://nodejs.org"
                  class="underline text-primary"
                  onclick={(e) => {
                    e.preventDefault();
                    const wsId = workspaceStore.current?.id;
                    if (wsId)
                      handleLink('https://nodejs.org', {
                        workspaceId: wsId as WorkspaceId,
                        event: e,
                      });
                  }}>Node.js</a
                > first.
              </p>
            {/if}
            <button
              type="button"
              class="flex items-center gap-1.5 px-2 py-1 bg-muted border border-border rounded text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors w-fit cursor-pointer"
              onclick={() => copyCommand(INSTALL_COMMAND)}
            >
              <code class="font-mono">{INSTALL_COMMAND}</code>
              <Fa icon={faPaste} size="xs" />
            </button>
          </div>
        {/if}
      {/if}
    {/if}

    <!-- Other providers -->
    {#each providerOptions.filter((p) => p.id !== 'auggie') as provider (provider.id)}
      {@const isActive = activeProviderStore.activeProviderId === provider.id}
      <div>
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2 h-7">
              {@render providerIcon(provider.id)}
              <span class="text-sm text-foreground">{provider.name}</span>
              <!-- Path configuration -->
              <div class="-my-1">
                <ProviderPathConfig
                  providerId={provider.id}
                  providerName={provider.name}
                  cliCommand={provider.command}
                  configuredPath={providerPaths[provider.id]}
                  resolvedPath={resolvedPaths[provider.id]}
                  isInstalled={provider.available}
                  onPathChange={(path) => handlePathChange(provider.id, path)}
                />
              </div>
              {#if provider.available && (auggieLoading || mcpLoading)}
                <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
              {:else if provider.available && auggieStatus?.installed && auggieStatus?.authenticated}
                <!-- MCP button for auggie-enabled providers -->
                {#if setupInProgress[provider.id]}
                  <Button size="xs" variant="ghost" class="flex items-center gap-1">
                    <Fa icon={faCircleNotch} class="w-3 h-3 text-ghost animate-spin" />
                    <span class="text-xs text-subtle">Setting up...</span>
                  </Button>
                {:else if uninstallInProgress[provider.id]}
                  <Button size="xs" variant="ghost" class="flex items-center gap-1">
                    <Fa icon={faCircleNotch} class="w-3 h-3 text-ghost animate-spin" />
                    <span class="text-xs text-subtle">Removing...</span>
                  </Button>
                {:else if mcpConfigured[provider.id]}
                  <Button
                    onclick={() => handleUninstallMcp(provider.id)}
                    title="Remove Auggie Context Engine MCP from {provider.name}"
                    size="xs"
                    variant="ghost"
                    class="group"
                  >
                    <Logo width={11} />
                    <span>Context Engine</span>
                    <Fa
                      icon={faXmark}
                      class="w-2.5 h-2.5 text-destructive-foreground hidden group-hover:inline"
                    />
                  </Button>
                {:else}
                  <Button
                    onclick={() => handleSetupMcp(provider.id)}
                    size="xs"
                    variant="outline"
                    title="Add Auggie Context Engine MCP to {provider.name}"
                  >
                    <Logo width={11} class="group-hover:hidden" />
                    <span>Enable Context Engine</span>
                  </Button>
                {/if}
              {/if}
            </div>
          </div>

          <div class="flex items-center gap-5 text-xs">
            {#if provider.available}
              <!-- Auth status -->
              {#if provider.authenticated === true}
                <span class="text-xs text-subtle flex items-center gap-1">
                  <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
                  Logged in
                </span>
              {:else if provider.authenticated === false && provider.loginDocsUrl}
                <button
                  type="button"
                  class="text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400 cursor-pointer transition-colors"
                  onclick={() => openDocs(provider.loginDocsUrl!, true)}
                >
                  Log in
                </button>
              {/if}
              <!-- Default / Set as default -->
              {#if isActive}
                <span class="text-xs text-subtle flex items-center gap-1"> Default </span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={() => handleSelectProvider(provider.id)}
                  disabled={selectingProviderId !== null}
                >
                  {selectingProviderId === provider.id ? 'Switching...' : 'Set as default'}
                </button>
              {/if}
            {:else}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                onclick={() => openDocs(provider.docsUrl, true)}
              >
                Install
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

{#snippet providerIcon(providerId: string)}
  <span class="w-7 text-subtle">
    {#if providerId === 'auggie'}
      <Logo width={22} />
    {:else if providerId === 'claude-code'}
      <svg class="size-5" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
        <g id="g314">
          <path
            id="path147"
            fill="currentColor"
            stroke="none"
            d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z"
          />
        </g>
      </svg>
    {:else if providerId === 'codex'}
      <svg
        fill="currentColor"
        class="size-5"
        viewBox="0 0 24 24"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        ><title>OpenAI icon</title><path
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        /></svg
      >
    {:else if providerId === 'opencode'}
      <svg class="size-5" viewBox="0 0 240 300" fill="none" xmlns="http://www.w3.org/2000/svg"
        ><g clip-path="url(#clip0_1401_86283)"
          ><mask
            id="mask0_1401_86283"
            style="mask-type:luminance"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="240"
            height="300"><path d="M240 0H0V300H240V0Z" fill="currentColor" /></mask
          ><g mask="url(#mask0_1401_86283)"
            ><path d="M180 240H60V120H180V240Z" fill="#4B4646" /><path
              d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z"
              fill="#F1ECEC"
            /></g
          ></g
        ><defs
          ><clipPath id="clip0_1401_86283"
            ><rect width="240" height="300" fill="currentColor" /></clipPath
          ></defs
        ></svg
      >
    {:else if providerId === 'cortex'}
      <svg
        class="size-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 2L13.09 4.26L15.5 3.5L14.74 5.91L17 7L14.74 8.09L15.5 10.5L13.09 9.74L12 12L10.91 9.74L8.5 10.5L9.26 8.09L7 7L9.26 5.91L8.5 3.5L10.91 4.26L12 2Z"
        />
        <path
          d="M12 12L13.09 14.26L15.5 13.5L14.74 15.91L17 17L14.74 18.09L15.5 20.5L13.09 19.74L12 22L10.91 19.74L8.5 20.5L9.26 18.09L7 17L9.26 15.91L8.5 13.5L10.91 14.26L12 12Z"
        />
        <path
          d="M2 12L4.26 13.09L3.5 15.5L5.91 14.74L7 17L8.09 14.74L10.5 15.5L9.74 13.09L12 12L9.74 10.91L10.5 8.5L8.09 9.26L7 7L5.91 9.26L3.5 8.5L4.26 10.91L2 12Z"
        />
        <path
          d="M12 12L14.26 13.09L13.5 15.5L15.91 14.74L17 17L18.09 14.74L20.5 15.5L19.74 13.09L22 12L19.74 10.91L20.5 8.5L18.09 9.26L17 7L15.91 9.26L13.5 8.5L14.26 10.91L12 12Z"
        />
      </svg>
    {:else}
      <!-- Fallback for unknown providers -->
      <Fa icon={faTerminal} class="size-5" />
    {/if}
  </span>
{/snippet}

{#snippet skeleton(providerid: string, showDescription = false)}
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2 h-7">
        {@render providerIcon(providerid)}
        <span class="text-sm text-foreground">{ACP_PROVIDERS[providerid].displayName}</span>
        <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
      </div>
      {#if showDescription && providerid === 'auggie'}
        <ul class="list-disc pl-12 text-xs text-subtle">
          <li><p>Real-time codebase understanding with Context Engine</p></li>
          <li><p>Github, Linear, and Sentry workflow integration</p></li>
          <li><p>Multiple AI model provider selection & use</p></li>
        </ul>
      {/if}
    </div>
    <div class="h-4 w-20 bg-muted/50 rounded animate-pulse"></div>
  </div>
{/snippet}
