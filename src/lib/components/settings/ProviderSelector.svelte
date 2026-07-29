<script lang="ts">
   
  /**
   * ProviderSelector
   *
   * Settings panel for selecting which ACP provider to use.
   * Self-contained component with inline rendering
   * that can be independently tweaked for settings-specific needs.
   */
  import { onMount } from 'svelte';
  import {
  invoke,
  shell,
} from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import {
  selectActiveProviderId,
  selectEnabledProviders,
} from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { selectProviderInUseReasons } from '$store/renderer/slices/provider-settings/provider-in-use-selectors';
  import {
  setActiveProvider,
  setProviderEnabled,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import {
  retryLoadModels,
  reloadModelsForProvider,
} from '$store/renderer/slices/model/model-slice';

  import {
  selectProviderCatalogEntries,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { selectIsProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
  AUGGIE_CHANNELS,
  PROVIDERS_CHANNELS,
} from '$shared/ipc/channels';
  import { MINIMUM_AUGGIE_VERSION } from '$shared/constants/auggie';
  import { CLAUDE_CODE_NPX_MISSING_WARNING } from '$shared/constants/claude-code';
  import { createLogger } from '$lib/utils/client-logger';
  import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
  import {
  faCheck,
  faCircleNotch,
  faTerminal,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
  import NodeVersionWarning from '$lib/components/NodeVersionWarning.svelte';
  import AuggieInstructionsPanel from '$lib/components/AuggieInstructionsPanel.svelte';
  import Fa from 'svelte-fa';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import GrokLogo from '../ui/GrokLogo.svelte';
  import Logo from '../Logo.svelte';
  import ProviderPathConfig from './ProviderPathConfig.svelte';
  import {
  checkPiMcpAdapterInstalled,
  installPiMcpAdapter,
} from '$features/pi/pi-models.client';
  import Button from '../ui/button/button.svelte';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('ProviderSelector');
  const activeProviderId = selectActiveProviderId();
  const enabledProviders$ = selectEnabledProviders();
  const providerInUseReasons$ = selectProviderInUseReasons();
  const catalogEntries$ = selectProviderCatalogEntries();

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
    binaryInstallAvailable?: boolean;
    managedBinaryInstalled?: boolean;
  };
  let auggieStatus: AuggieStatus | null = $state(null);
  let auggieLoading = $state(true);
  let actionInProgress = $state(false);
  let authInProgress = $state(false);

  // Instructions returned by AUGGIE_CHANNELS.INSTALL / AUTHENTICATE. Post-P2-12c
  // the FE renders manual steps + a copyable command instead of driving install
  // or OAuth flows itself.
  let auggieInstructions = $state<string[] | null>(null);
  let auggieCommand = $state<string | null>(null);

  // MCP state
  let setupInProgress = $state<Record<string, boolean>>({});
  let piMcpAdapterInstalled: boolean | null = $state(null);
  let piMcpAdapterLoading = $state(false);
  let piMcpAdapterChecked = $state(false);

  // Derived: is the version outdated (installed but below minimum)
  const needsUpdate = $derived.by(() => {
    return !!auggieStatus && auggieStatus.installed && !auggieStatus.versionOk;
  });

  // Track if we're waiting to check provider availability on focus

  // Loading state for "Start using" / select buttons
  let selectingProviderId = $state<string | null>(null);

  // Provider path configuration state
  // Configured paths (user-set overrides)
  let providerPaths = $state<Record<string, string>>({});
  // Resolved paths (daemon auto-detected)
  let resolvedPaths = $state<Record<string, string>>({});
  // Secondary-binary resolved paths for dual-binary providers (unsloth CLI)
  let secondaryResolvedPaths = $state<Record<string, string>>({});

  // Provider metadata for docs URLs and auth requirements
  const PROVIDER_METADATA: Record<string, { docsUrl: string; requiresAuth: boolean }> = {
    auggie: { docsUrl: 'https://docs.augmentcode.com/cli/overview', requiresAuth: true },
    'claude-code': { docsUrl: 'https://code.claude.com/docs/en/quickstart#step-1-install-claude-code', requiresAuth: false },
    codex: { docsUrl: 'https://developers.openai.com/codex/cli#cli-setup', requiresAuth: false },
    opencode: { docsUrl: 'https://opencode.ai/docs#install', requiresAuth: false },
    droid: { docsUrl: 'https://docs.factory.ai/cli/getting-started/overview', requiresAuth: false },
    grok: { docsUrl: 'https://docs.x.ai/build/overview', requiresAuth: false },
    unsloth: { docsUrl: 'https://docs.unsloth.ai', requiresAuth: false },
    cortex: {
      docsUrl: 'https://docs.snowflake.com/en/developer-guide/cortex',
      requiresAuth: false,
    },
    pi: { docsUrl: 'https://pi.dev/docs/latest/quickstart', requiresAuth: false },
  };

  // Map provider IDs to keys used in ProviderAvailabilityResult
  const providerKeyMap: Record<string, keyof ProviderAvailabilityResult['providers']> = {
    auggie: 'auggie',
    'claude-code': 'claudeCode',
    codex: 'codex',
    mock: 'mock',
    opencode: 'opencode',
    droid: 'droid',
    grok: 'grok',
    unsloth: 'unsloth',
    cortex: 'cortex',
    pi: 'pi',
  };

  // Helper to get provider availability from result (handles different key formats)
  function getProviderAvailable(providerId: string): boolean {
    if (providerId === 'auggie') {
      return !!auggieStatus?.installed;
    }

    if (!providerAvailability) return false;
    const key = providerKeyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].available;
    }
    return false;
  }

  // Helper to get provider auth status
  function getProviderAuthenticated(providerId: string): boolean | undefined {
    if (providerId === 'auggie') {
      return auggieStatus?.authenticated;
    }

    if (!providerAvailability) return undefined;
    const key = providerKeyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].authenticated;
    }
    return undefined;
  }

  // Provider options for display - dynamically generated from the catalog
  // Filter out providers that are hidden (env var gated and not enabled)
  // Alphabetically sorted by display name for provider neutrality
  const providerOptions = $derived.by(() =>
    $catalogEntries$
      .filter((provider) => !providerAvailability?.hiddenProviders?.includes(provider.id))
      .map((provider) => {
        const statusKey = providerKeyMap[provider.id];
        const status = statusKey ? providerAvailability?.providers[statusKey] : null;
        return {
          id: provider.id,
          name: provider.displayName,
          command: provider.command,
          available: getProviderAvailable(provider.id),
          authenticated: getProviderAuthenticated(provider.id),
          requiresAuth: PROVIDER_METADATA[provider.id]?.requiresAuth ?? false,
          docsUrl: PROVIDER_METADATA[provider.id]?.docsUrl ?? '',
          loginDocsUrl: provider.loginDocsUrl,
          hasNpxFallback: status?.hasNpxFallback ?? false,
          warning: status?.warning,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  const piProviderAvailable = $derived.by(() => {
    return providerOptions.find((provider) => provider.id === 'pi')?.available ?? false;
  });

  $effect(() => {
    if (!piProviderAvailable) {
      piMcpAdapterInstalled = null;
      piMcpAdapterChecked = false;
      return;
    }

    if (piMcpAdapterChecked || piMcpAdapterLoading) return;
    void loadPiMcpAdapterStatus();
  });

  function isProviderReadyForUse(providerId: string): boolean {
    if (providerId === 'auggie') {
      return (
        !!auggieStatus?.installed &&
        !!auggieStatus?.authenticated &&
        !needsUpdate &&
        (auggieStatus?.nodeVersionOk !== false || !!auggieStatus?.managedBinaryInstalled)
      );
    }

    if (!getProviderAvailable(providerId)) return false;
    return getProviderAuthenticated(providerId) !== false;
  }

  // Reactive helper to check if a provider is enabled
  function isProviderEnabled(providerId: string): boolean {
    // Reactive via $enabledProviders$; catalog metadata read via selector.
    void $enabledProviders$;
    return selectIsProviderEnabled.select(appStore.state, providerId);
  }

  function canManageProviderEnablement(providerId: string): boolean {
    return $catalogEntries$.find((p) => p.id === providerId)?.canBeDisabled !== false;
  }

  function handleToggleProvider(providerId: string, enabled: boolean) {
    if (!enabled) {
      const reason = $providerInUseReasons$[providerId];
      if (reason) {
        toast.error(
          m.settings_providers_cannotDisable({
            name: selectProviderDisplayName.select(appStore.state, providerId),
          }),
          { description: reason },
        );
        return;
      }
    }
    appStore.dispatch(setProviderEnabled({ providerId, enabled }));
  }

  onMount(() => {
    checkProviderAvailability();
    loadProviderPaths();

    // Focus/visibility listener to silently recheck provider availability
    // when the app returns to focus — the user may have finished the manual
    // install/login in their terminal.
    const handleFocus = () => {
      silentRefreshProviderAvailability();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      silentRefreshProviderAvailability();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  /** Load configured and resolved paths for all providers */
  async function loadProviderPaths() {
    try {
      // Load configured path overrides from the daemon settings catalog
      // (providers.paths, PROTOCOL §5.12) — the same seam ProviderPathConfig
      // writes to. The legacy settings:getAll bulk read is not bridged.
      const entry = await appClient.settings.get('providers.paths');
      const configured =
        entry?.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
          ? (entry.value as Record<string, unknown>)
          : {};
      const configuredPaths: Record<string, string> = {};
      for (const [providerId, value] of Object.entries(configured)) {
        if (typeof value === 'string') {
          configuredPaths[providerId] = value;
        }
      }
      providerPaths = configuredPaths;

      // Load daemon-resolved paths for all providers (host.providerDiscovery)
      const pathsResult = await invoke<{
        success: boolean;
        data?: {
          paths: Record<string, string | null>;
          secondaryPaths: Record<string, string | null>;
        };
      }>(PROVIDERS_CHANNELS.GET_PATHS);
      if (pathsResult?.success && pathsResult.data) {
        const resolved: Record<string, string> = {};
        for (const [providerId, path] of Object.entries(pathsResult.data.paths)) {
          if (path) resolved[providerId] = path;
        }
        resolvedPaths = resolved;
        const secondary: Record<string, string> = {};
        for (const [providerId, path] of Object.entries(pathsResult.data.secondaryPaths ?? {})) {
          if (path) secondary[providerId] = path;
        }
        secondaryResolvedPaths = secondary;
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
   * Kick off both loading tracks concurrently.
   * Each track updates its own state slice and unblocks its own UI section.
   */
  async function checkProviderAvailability(refreshModels = false) {
    checkError = null;
    await Promise.all([loadAuggieStatus(), loadProviderAvailability(refreshModels)]);
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
        checkError = providerResult.error || m.settings_providers_checkError();
        return;
      }
      providerAvailability = providerResult.data || null;

      if (refreshModels) {
        appStore.dispatch(retryLoadModels());
      }
    } catch (err) {
      logger.error('Failed to check provider availability', { error: err });
      checkError = err instanceof Error ? err.message : m.settings_providers_unknownError();
    } finally {
      loading = false;
      hasLoadedOnce = true;
    }
  }

  async function loadPiMcpAdapterStatus() {
    piMcpAdapterLoading = true;
    try {
      piMcpAdapterInstalled = await checkPiMcpAdapterInstalled();
    } catch (err) {
      logger.warn('Failed to check Pi MCP adapter status', { error: err });
      piMcpAdapterInstalled = null;
    } finally {
      piMcpAdapterChecked = true;
      piMcpAdapterLoading = false;
    }
  }

  async function handleInstallPiMcpAdapter() {
    setupInProgress = { ...setupInProgress, pi: true };
    try {
      const result = await installPiMcpAdapter();
      if (result?.success) {
        await loadPiMcpAdapterStatus();
        toast.success(m.settings_providers_piAdapterInstalled());
      } else {
        toast.error(m.settings_providers_piAdapterInstallFailed(), {
          description: result?.error || m.settings_providers_unknownError(),
        });
      }
    } catch (err) {
      logger.error('Failed to install pi-mcp-adapter', err);
      toast.error(m.settings_providers_piAdapterInstallFailed(), {
        description: err instanceof Error ? err.message : m.settings_providers_unknownError(),
      });
    } finally {
      setupInProgress = { ...setupInProgress, pi: false };
    }
  }

  type InstructionResponse = {
    success: boolean;
    error?: string;
    data?: {
      instructions?: string[];
      command?: string;
      authenticated?: boolean;
    };
  };

  function applyInstructionResponse(result: InstructionResponse): void {
    if (result.data?.instructions && result.data.instructions.length > 0) {
      auggieInstructions = result.data.instructions;
      auggieCommand = result.data.command ?? null;
    } else if (result.error) {
      auggieInstructions = [result.error];
      auggieCommand = result.data?.command ?? null;
    }
  }

  /** Ask the daemon for install instructions and render them. */
  async function installAuggie() {
    actionInProgress = true;
    try {
      const result = await invoke<InstructionResponse>(AUGGIE_CHANNELS.INSTALL);
      applyInstructionResponse(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : m.settings_providers_installInstructionsError();
      auggieInstructions = [message];
      auggieCommand = null;
    } finally {
      actionInProgress = false;
    }
  }

  /** Ask the daemon whether auggie is authenticated; otherwise render login instructions. */
  async function startAuth() {
    authInProgress = true;
    try {
      const result = await invoke<InstructionResponse>(AUGGIE_CHANNELS.AUTHENTICATE, {
        action: 'start',
      });
      if (result.success && result.data?.authenticated) {
        toast.success(m.settings_providers_loggedIn());
        auggieInstructions = null;
        auggieCommand = null;
        await checkProviderAvailability();
        appStore.dispatch(reloadModelsForProvider());
        return;
      }
      applyInstructionResponse(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : m.settings_providers_loginInstructionsError();
      auggieInstructions = [message];
      auggieCommand = null;
    } finally {
      authInProgress = false;
    }
  }

  /** Re-run detection after the user completes the manual step. */
  async function recheckAuggie() {
    actionInProgress = true;
    try {
      await checkProviderAvailability();
      if (auggieStatus?.installed && auggieStatus?.versionOk && auggieStatus?.authenticated) {
        auggieInstructions = null;
        auggieCommand = null;
        toast.success(m.settings_providers_auggieReady());
        appStore.dispatch(reloadModelsForProvider());
        return;
      }
      const channel =
        auggieStatus?.installed && auggieStatus?.versionOk
          ? AUGGIE_CHANNELS.AUTHENTICATE
          : AUGGIE_CHANNELS.INSTALL;
      const args = channel === AUGGIE_CHANNELS.AUTHENTICATE ? [{ action: 'start' }] : [];
      const result = await invoke<InstructionResponse>(channel, ...args);
      if (result.success && result.data?.authenticated) {
        auggieInstructions = null;
        auggieCommand = null;
        return;
      }
      applyInstructionResponse(result);
    } finally {
      actionInProgress = false;
    }
  }

  function dismissAuggieInstructions() {
    auggieInstructions = null;
    auggieCommand = null;
  }

  function openDocs(url: string) {
    shell.open(url);
  }

  async function handleSelectProvider(providerId: string) {
    selectingProviderId = providerId;
    const previousProviderId = $activeProviderId;
    try {
      logger.info('Selecting provider:', {
        from: previousProviderId,
        to: providerId,
      });
      appStore.dispatch(setActiveProvider(providerId));
      appStore.dispatch(reloadModelsForProvider());
      toast.success(
        m.settings_providers_switchedTo({
          name: selectProviderDisplayName.select(appStore.state, providerId),
        }),
      );
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
          <span class="text-sm text-foreground"
            >{selectProviderDisplayName.select(appStore.state, 'auggie')}</span
          >
          <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
        </div>
      </div>
      <div class="h-4 w-20 bg-muted/50 rounded animate-pulse"></div>
    </div>

    {@render skeleton('claude-code')}

    {@render skeleton('codex')}

    {@render skeleton('opencode')}

    {@render skeleton('pi')}

    {@render skeleton('droid')}

    {@render skeleton('grok')}

    {@render skeleton('unsloth')}

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
        {m.settings_providers_tryAgain()}
      </button>
    </div>
  {/if}

  {#if !loading || hasLoadedOnce}
    <!-- Auggie provider row -->
    {#if auggieLoading}
      {@render skeleton('auggie')}
    {:else}
      {@const auggieProvider = providerOptions.find((p) => p.id === 'auggie')}
      {@const isAuggieActive = $activeProviderId === 'auggie'}
      {@const isAuggieEnabled = isProviderEnabled('auggie')}
      {@const isAuggieReady = isProviderReadyForUse('auggie')}
      {@const canManageAuggieEnablement = canManageProviderEnablement('auggie')}
      {@const auggieInUseReason = $providerInUseReasons$['auggie'] ?? null}
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
            </div>
            {#if needsUpdate}
              <p class="text-xs text-amber-500">
                {m.settings_providers_needsUpdate({
                  version: auggieStatus?.version ?? '',
                  minimum: MINIMUM_AUGGIE_VERSION,
                })}
              </p>
            {/if}
          </div>

          <div class="flex items-center gap-3 text-xs">
            {#if !auggieStatus?.managedBinaryInstalled && (!auggieStatus?.installed || (!auggieStatus?.nodeVersionOk && auggieStatus?.binaryInstallAvailable))}
              {#if actionInProgress}
                <span class="text-subtle">{m.settings_providers_installing()}</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={installAuggie}
                >
                  {m.settings_providers_install()}
                </button>
              {/if}
            {:else if needsUpdate}
              {#if actionInProgress}
                <span class="text-subtle">{m.settings_providers_updating()}</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={installAuggie}
                >
                  {m.settings_providers_update()}
                </button>
              {/if}
            {:else if !auggieStatus?.authenticated}
              {#if authInProgress}
                <span class="text-subtle">{m.settings_providers_loading()}</span>
              {:else}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={startAuth}
                >
                  {m.settings_providers_login()}
                </button>
              {/if}
            {/if}

            {#if canManageAuggieEnablement && !isAuggieActive && isAuggieEnabled}
              <button
                type="button"
                class="font-medium transition-colors {auggieInUseReason
                  ? 'text-muted-foreground/50 cursor-not-allowed'
                  : 'text-muted-foreground hover:text-foreground cursor-pointer'}"
                disabled={!!auggieInUseReason}
                title={auggieInUseReason ?? undefined}
                onclick={() => handleToggleProvider('auggie', false)}
              >
                {m.settings_providers_disable()}
              </button>
            {:else if canManageAuggieEnablement && !isAuggieActive && !isAuggieEnabled && isAuggieReady}
              <button
                type="button"
                class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                onclick={() => handleToggleProvider('auggie', true)}
              >
                {m.settings_providers_enable()}
              </button>
            {/if}

            {#if !isAuggieActive && isAuggieReady}
              <button
                type="button"
                class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                onclick={() => handleSelectProvider('auggie')}
                disabled={selectingProviderId !== null}
              >
                {selectingProviderId === 'auggie'
                  ? m.settings_providers_switching()
                  : m.settings_providers_setAsDefault()}
              </button>
            {:else if isAuggieActive}
              <span class="text-xs text-subtle flex items-center gap-1">
                {m.settings_providers_default()}
              </span>
            {/if}
          </div>
        </div>

        <!-- Node.js version warning (suppress when binary install is available as fallback) -->
        {#if auggieStatus && auggieStatus.nodeVersionOk === false && !auggieStatus.binaryInstallAvailable && !auggieStatus.installed}
          <NodeVersionWarning nodeVersion={auggieStatus.nodeVersion} class="mt-1" />
        {/if}

        <!-- Soft warning: Node version is incompatible, binary install available (but not yet installed) -->
        {#if auggieStatus && !auggieStatus.nodeVersionOk && auggieStatus.binaryInstallAvailable && !auggieStatus.managedBinaryInstalled}
          <div
            class="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-amber-600 dark:text-amber-400 mt-1"
          >
            <Fa icon={faTriangleExclamation} class="w-4 h-4 flex-shrink-0" />
            <span class="text-xs">
              {#if auggieStatus.installed}
                {m.settings_providers_nodeWarning_installed_before()}
                <strong>{m.settings_providers_install()}</strong>
                {m.settings_providers_nodeWarning_installed_after()}
              {:else}
                {m.settings_providers_nodeWarning_notInstalled_before()}
                <strong>{m.settings_providers_install()}</strong>
                {m.settings_providers_nodeWarning_notInstalled_after()}
              {/if}
            </span>
          </div>
        {/if}

        <!-- Instructions panel from AUGGIE_CHANNELS.INSTALL / AUTHENTICATE -->
        {#if auggieInstructions && auggieInstructions.length > 0}
          <AuggieInstructionsPanel
            instructions={auggieInstructions}
            command={auggieCommand ?? undefined}
            onRecheck={recheckAuggie}
            onDismiss={dismissAuggieInstructions}
            rechecking={actionInProgress || authInProgress}
          />
        {/if}
      {/if}
    {/if}

    <!-- Other providers -->
    {#each providerOptions.filter((p) => p.id !== 'auggie') as provider (provider.id)}
      {@const isActive = $activeProviderId === provider.id}
      {@const isEnabled = isProviderEnabled(provider.id)}
      {@const isReady = isProviderReadyForUse(provider.id)}
      {@const canManageEnablement = canManageProviderEnablement(provider.id)}
      {@const inUseReason = $providerInUseReasons$[provider.id] ?? null}
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
                  cliCommand={provider.id === 'unsloth' ? 'unsloth' : provider.command}
                  configuredPath={providerPaths[provider.id]}
                  resolvedPath={resolvedPaths[provider.id]}
                  secondaryCliCommand={provider.id === 'unsloth' ? 'unsloth' : undefined}
                  secondaryResolvedPath={provider.id === 'unsloth'
                    ? secondaryResolvedPaths[provider.id]
                    : undefined}
                  isInstalled={provider.available}
                  onPathChange={(path) => handlePathChange(provider.id, path)}
                />
              </div>
            </div>
            {#if provider.id === 'pi' && provider.available && piMcpAdapterInstalled === false}
              <div class="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500">
                <Fa icon={faTriangleExclamation} class="w-3 h-3" />
                <span>{m.settings_providers_piAdapterNeeded()}</span>
                <Button
                  onclick={handleInstallPiMcpAdapter}
                  disabled={setupInProgress.pi}
                  size="xs"
                  variant="outline"
                  class="flex items-center gap-1"
                >
                  {#if setupInProgress.pi}
                    <Fa icon={faCircleNotch} class="w-3 h-3 text-ghost animate-spin" />
                    <span>{m.settings_providers_installing()}</span>
                  {:else}
                    <span>{m.settings_providers_install()}</span>
                  {/if}
                </Button>
              </div>
            {/if}
            {#if provider.hasNpxFallback && !provider.available && providerAvailability?.npx?.resolvedPath === null}
              <div class="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500">
                <Fa icon={faTriangleExclamation} class="w-3 h-3" />
                <span>
                  {m.settings_providers_requiresNodejs()}
                  <button
                    type="button"
                    class="underline hover:no-underline"
                    onclick={() => shell.open('https://nodejs.org')}
                  >{m.settings_providers_installFromNodejs()}</button>
                </span>
              </div>
            {:else if provider.hasNpxFallback && !provider.available && providerAvailability?.npx?.resolvedPath !== null && providerAvailability?.npx?.versionOk === false}
              <div class="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500">
                <Fa icon={faTriangleExclamation} class="w-3 h-3" />
                <span>{m.settings_providers_npmTooOld()}</span>
              </div>
            {/if}
            <!-- Provider status warning (e.g. claude-code installed but npx missing) -->
            {#if provider.warning}
              <div class="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500">
                <Fa icon={faTriangleExclamation} class="w-3 h-3" />
                <span>
                  {provider.warning}{#if provider.warning === CLAUDE_CODE_NPX_MISSING_WARNING}
                    — <button
                      type="button"
                      class="underline hover:no-underline"
                      onclick={() => void shell.open('https://nodejs.org')}
                    ><!-- i18n-ignore (URL) -->nodejs.org</button>
                  {/if}
                </span>
              </div>
            {/if}
          </div>

          <div class="flex items-center gap-4 text-xs flex-wrap justify-end">
            {#if provider.available}
              <!-- Auth status -->
              {#if provider.authenticated === true}
                <span class="text-xs text-subtle flex items-center gap-1">
                  <Fa icon={faCheck} class="w-2.5 h-2.5 text-green-500" />
                  {m.settings_providers_loggedInStatus()}
                </span>
              {:else if provider.authenticated === false && provider.loginDocsUrl}
                <button
                  type="button"
                  class="text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400 cursor-pointer transition-colors"
                  onclick={() => openDocs(provider.loginDocsUrl!)}
                >
                  {m.settings_providers_logIn()}
                </button>
              {/if}

              {#if canManageEnablement && !isActive && isEnabled}
                <button
                  type="button"
                  class="font-medium transition-colors {inUseReason
                    ? 'text-muted-foreground/50 cursor-not-allowed'
                    : 'text-muted-foreground hover:text-foreground cursor-pointer'}"
                  disabled={!!inUseReason}
                  title={inUseReason ?? undefined}
                  onclick={() => handleToggleProvider(provider.id, false)}
                >
                  {m.settings_providers_disable()}
                </button>
              {:else if canManageEnablement && !isActive && !isEnabled && isReady}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={() => handleToggleProvider(provider.id, true)}
                >
                  {m.settings_providers_enable()}
                </button>
              {/if}

              {#if isActive}
                <span class="text-xs text-subtle flex items-center gap-1">
                  {m.settings_providers_default()}
                </span>
              {:else if isReady}
                <button
                  type="button"
                  class="text-primary hover:text-primary/80 cursor-pointer transition-colors font-medium"
                  onclick={() => handleSelectProvider(provider.id)}
                  disabled={selectingProviderId !== null}
                >
                  {selectingProviderId === provider.id
                    ? m.settings_providers_switching()
                    : m.settings_providers_setAsDefault()}
                </button>
              {/if}
            {:else}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                onclick={() => openDocs(provider.docsUrl)}
              >
                {m.settings_providers_install()}
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
        ><!-- i18n-ignore (brand name) --><title>OpenAI icon</title><path
          fill-rule="evenodd"
          clip-rule="evenodd"
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
    {:else if providerId === 'droid'}
      <svg
        class="size-5"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M12 2a1.5 1.5 0 0 1 .75 2.8V7h3.75A3.5 3.5 0 0 1 20 10.5v6a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 16.5v-6A3.5 3.5 0 0 1 7.5 7h3.75V4.8A1.5 1.5 0 0 1 12 2ZM8.75 11.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Zm6.5 0a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z"
        />
      </svg>
    {:else if providerId === 'grok'}
      <GrokLogo class="size-5" size={20} />
    {:else if providerId === 'unsloth'}
      <!-- Unsloth's brand mark is the sloth emoji (per their brand guidelines) -->
      <span class="size-5 inline-flex items-center justify-center leading-none text-lg">🦥</span>
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
    {:else if providerId === 'pi'}
      <svg class="size-5" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
        <rect width="800" height="800" rx="120" fill="#09090b" />
        <path
          fill="#fff"
          fill-rule="evenodd"
          d="M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z"
        />
        <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z" />
      </svg>
    {:else}
      <!-- Fallback for unknown providers -->
      <Fa icon={faTerminal} class="size-5" />
    {/if}
  </span>
{/snippet}

{#snippet skeleton(providerid: string)}
  <div class="flex items-start justify-between gap-4">
    <div class="space-y-1">
      <div class="flex items-center gap-2 h-7">
        {@render providerIcon(providerid)}
        <span class="text-sm text-foreground"
          >{selectProviderDisplayName.select(appStore.state, providerid)}</span
        >
        <div class="h-3 w-16 bg-muted/50 rounded animate-pulse"></div>
      </div>
    </div>
    <div class="h-4 w-20 bg-muted/50 rounded animate-pulse"></div>
  </div>
{/snippet}
