<script module lang="ts">
  // Module-level flag to ensure 'Started Setup' fires only once per app session.
  // This is in <script module> so it persists as a true singleton across remounts.
  let hasTrackedStartedSetup = false;
</script>

<script lang="ts">
  /**
   * ProviderStatusPanel
   *
   * Shows provider availability status inline on the homepage for first-time users.
   * Non-blocking - users can create workspaces even without providers (with warning).
   */
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { invoke, shell } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';
  import { track } from '$lib/services/analytics';
  import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
  import { ACP_PROVIDERS } from '$shared/config/provider-config';
  import { MINIMUM_AUGGIE_VERSION } from '$shared/constants/auggie';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import type { ProviderAvailabilityResult } from '$features/providers/main/provider-availability.service';
  import {
    faCircleCheck,
    faCircleNotch,
    faDownload,
    faPaste,
    faArrowUpRightFromSquare,
    faArrowUp,
    faTerminal,
    faArrowRight,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { fly, slide } from 'svelte/transition';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { toast } from 'svelte-sonner';

  // Props for the panel
  interface Props {
    /** Callback when user is ready to continue (at least one provider available) */
    onContinue?: (providerId: string) => void | Promise<void>;
  }

  let { onContinue }: Props = $props();

  // Loading state for "Start using" buttons
  let startingProviderId = $state<string | null>(null);

  async function handleStartUsing(providerId: string) {
    startingProviderId = providerId;
    try {
      try {
        track('Completed Setup', { provider_id: providerId });
      } catch {}

      await onContinue?.(providerId);

      // Track provider selection during onboarding
      track('Selected Provider', {
        provider_id: providerId,
        previous_provider_id: null, // First time selection during onboarding
      });
    } finally {
      startingProviderId = null;
    }
  }

  const logger = createLogger('ProviderStatusPanel');

  const INSTALL_COMMAND = 'npm install -g @augmentcode/auggie';

  // Provider availability state
  let providerAvailability: ProviderAvailabilityResult | null = $state(null);
  let loading = $state(true);
  let checkError: string | null = $state(null);

  // Auggie-specific state (for auth flow)
  type AuggieStatus = {
    installed: boolean;
    authenticated: boolean;
    version?: string;
    versionOk: boolean;
    minimumVersion: string;
  };
  let auggieStatus: AuggieStatus | null = $state(null);
  let actionInProgress = $state(false);
  let hasLoadedOnce = $state(false); // Track if we've done initial load

  // Install error handling
  type InstallErrorType = 'permission' | 'missing_npm' | 'unknown';
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

  let hasMounted = $state(false);
  $effect(() => {
    hasMounted = true;
  });

  // Derived: is the version outdated (installed but below minimum)
  const needsUpdate = $derived.by(() => {
    return !!auggieStatus && auggieStatus.installed && !auggieStatus.versionOk;
  });

  // Derived: true during the very first load before any data arrives
  const isInitialLoad = $derived(loading && !hasLoadedOnce);

  // Provider metadata for display-specific properties
  const PROVIDER_METADATA: Record<
    string,
    { installCommand: string; description: string; docsUrl: string; requiresAuth: boolean }
  > = {
    auggie: {
      installCommand: 'npm install -g @augmentcode/auggie',
      description: "Augment's official CLI agent",
      docsUrl: 'https://docs.augmentcode.com/cli/overview',
      requiresAuth: true,
    },
    'claude-code': {
      installCommand: '',
      description: "Anthropic's Claude Code",
      docsUrl: 'https://code.claude.com/docs/en/quickstart',
      requiresAuth: false,
    },
    codex: {
      installCommand: 'npm install -g @openai/codex',
      description: "OpenAI's Codex",
      docsUrl: 'https://developers.openai.com/codex/cli/',
      requiresAuth: false,
    },
    opencode: {
      installCommand: 'brew install sst/tap/opencode',
      description: 'OpenCode CLI agent',
      docsUrl: 'https://opencode.ai/docs',
      requiresAuth: false,
    },
  };

  // Helper to get provider availability from result (handles different key formats)
  function getProviderAvailable(providerId: string): boolean {
    if (!providerAvailability) return false;
    // Map provider IDs to keys used in ProviderAvailabilityResult
    const keyMap: Record<string, keyof typeof providerAvailability.providers> = {
      auggie: 'auggie',
      'claude-code': 'claudeCode',
      codex: 'codex',
      opencode: 'opencode',
    };
    const key = keyMap[providerId];
    if (key && providerAvailability.providers[key]) {
      return providerAvailability.providers[key].available;
    }
    return false;
  }

  // Provider options for display - dynamically generated from ACP_PROVIDERS
  // Filter out providers that are hidden (env var gated and not enabled)
  const providerOptions = $derived.by(() =>
    Object.values(ACP_PROVIDERS)
      .filter((provider) => !providerAvailability?.hiddenProviders?.includes(provider.id))
      .map((provider) => {
        const metadata = PROVIDER_METADATA[provider.id] ?? {
          installCommand: '',
          description: provider.displayName,
          docsUrl: '',
          requiresAuth: false,
        };
        return {
          id: provider.id,
          name: provider.displayName,
          command: provider.command,
          installCommand: metadata.installCommand,
          description: metadata.description,
          available: getProviderAvailable(provider.id),
          requiresAuth: metadata.requiresAuth,
          docsUrl: metadata.docsUrl,
          canBeDisabled: provider.canBeDisabled ?? true,
        };
      }),
  );

  // Track if we're waiting to check provider availability on focus (after user clicks install for non-Auggie provider)
  let pendingFocusCheck = $state(false);

  onMount(() => {
    if (!hasTrackedStartedSetup) {
      hasTrackedStartedSetup = true;
      try {
        track('Started Setup', {});
      } catch {}
    }

    checkProviderAvailability();

    // Focus/visibility listener to check provider availability when app returns to focus
    // This is used after user clicks "Install" for non-Auggie providers and returns from external docs/install
    const handleFocus = () => {
      if (waitingForBrowserAuth) {
        checkAuthPollOnce();
      }
      if (pendingFocusCheck) {
        pendingFocusCheck = false;
        checkProviderAvailability(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && waitingForBrowserAuth) {
        checkAuthPollOnce();
      }
      if (document.visibilityState === 'visible' && pendingFocusCheck) {
        pendingFocusCheck = false;
        checkProviderAvailability(true);
      }
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

  async function checkProviderAvailability(refreshModels = false) {
    loading = true;
    checkError = null;
    try {
      // Check all providers in parallel - auggie status check is more thorough
      const [providerResult, auggieResult] = await Promise.all([
        invoke<{
          success: boolean;
          data?: ProviderAvailabilityResult;
          error?: string;
        }>(PROVIDERS_CHANNELS.GET_AVAILABILITY),
        invoke<{ success: boolean; data?: AuggieStatus; error?: string }>(AUGGIE_CHANNELS.STATUS),
      ]);

      if (!providerResult.success) {
        checkError = providerResult.error || 'Failed to check providers';
        return;
      }
      providerAvailability = providerResult.data || null;

      // Use the detailed auggie status (runs auggie --version) which is more reliable
      if (auggieResult.success && auggieResult.data) {
        auggieStatus = auggieResult.data;
        // Override the lightweight provider check with the actual status
        if (providerAvailability && auggieStatus.installed) {
          providerAvailability.providers.auggie.available = true;
          providerAvailability.hasAnyProvider = true;
        }
      }

      // Refresh model list if requested (e.g., after manual refresh button click)
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

  async function checkAuggieStatus() {
    try {
      const result = await invoke<{ success: boolean; data?: AuggieStatus; error?: string }>(
        AUGGIE_CHANNELS.STATUS,
      );
      if (result.success && result.data) {
        auggieStatus = result.data;
      }
    } catch (err) {
      logger.warn('Failed to check Auggie status', { error: err });
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
        try {
          track('Installed CLI', { auggie_version: auggieStatus?.version });
        } catch {}
        await checkProviderAvailability();
        // Refresh model list now that auggie is installed
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

  async function updateAuggie() {
    // Update uses the same install command
    await installAuggie();
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
          try {
            track('Completed Authentication', { method: 'browser_poll' });
          } catch {}
          toast.success('Logged in successfully');
          await checkProviderAvailability();
          await modelStore.retryLoadModels();
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
      track('Started Authentication', {});
    } catch {}
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
        try {
          track('Completed Authentication', { method: 'auto' });
        } catch {}
        toast.success('Logged in successfully');
        await checkProviderAvailability();
        await modelStore.retryLoadModels();
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
    } catch (err) {
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
        try {
          track('Completed Authentication', { method: 'manual_paste' });
        } catch {}
        toast.success('Logged in successfully');
        showAuthInput = false;
        authInput = '';
        authUrl = null;
        await checkProviderAvailability();
        // Refresh model list now that auggie is authenticated
        await modelStore.retryLoadModels();
      } else {
        // Try checking status anyway - auth might have succeeded
        await checkAuggieStatus();
        if (auggieStatus?.authenticated) {
          try {
            track('Completed Authentication', { method: 'manual_paste' });
          } catch {}
          toast.success('Logged in successfully');
          showAuthInput = false;
          authInput = '';
          authUrl = null;
          // Refresh model list now that auggie is authenticated
          await modelStore.retryLoadModels();
        } else {
          authError = result.error || 'Authentication failed';
        }
      }
    } catch (err) {
      authError = 'Authentication failed';
    } finally {
      authInProgress = false;
    }
  }

  function copyCommand(cmd: string) {
    navigator.clipboard.writeText(cmd);
    toast.success('Copied to clipboard');
  }

  async function openDocs(url: string, enableFocusCheck = false) {
    if (enableFocusCheck) {
      pendingFocusCheck = true;
    }
    const wsId = workspaceStore.current?.id;
    if (wsId) {
      await handleLink(url, { workspaceId: wsId as WorkspaceId });
    }
  }
</script>

<div class="w-full max-w-[500px]">
  <div class="relative mb-9">
    <img
      src="/icons/Icon-iOS-Default-68x68@2x.png"
      alt="Intent Logo"
      class="size-20 absolute left-0 top-1.25 -translate-x-[calc(100%+2rem)]"
    />
    <div>
      <h1 class="text-2xl font-semibold mb-2">Choose your agent</h1>
      <p class="text-muted-foreground/80">
        Intent is powered by your own CLI agent.<br />
        Choose one to get started, you can always switch in settings.
      </p>
    </div>
  </div>

  <div class="flex flex-col gap-6 border-t border-border pt-8 min-h-[24rem]">
    {#if checkError && hasLoadedOnce}
      <div class="flex flex-col items-center gap-3 py-4">
        <p class="text-sm text-destructive-foreground">{checkError}</p>
        <Button size="sm" variant="outline" onclick={() => checkProviderAvailability(true)}>
          Try Again
        </Button>
      </div>
    {:else if hasMounted}
      <!-- if hasMounted is needed for initial transition animation -->
      <!-- Auggie (primary provider) -->
      <div class="" in:fly|global={{ y: 30, duration: 300 }}>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-base font-medium">Augment Auggie</h2>
          <div class="flex items-center gap-5">
            {#if isInitialLoad}
              <Skeleton class="h-8 w-24 rounded-md" />
            {:else if !auggieStatus?.installed}
              <Button
                onclick={(e) => {
                  e.stopPropagation();
                  installAuggie();
                }}
                disabled={actionInProgress}
              >
                {#if actionInProgress}
                  <Fa icon={faCircleNotch} class="animate-spin" size="xs" />
                {:else}
                  <Fa icon={faDownload} size="xs" />
                {/if}
                Install
              </Button>
            {:else if needsUpdate}
              <Button
                onclick={(e) => {
                  e.stopPropagation();
                  updateAuggie();
                }}
                disabled={actionInProgress}
              >
                {#if actionInProgress}
                  <Fa icon={faCircleNotch} class="animate-spin" size="xs" />
                {:else}
                  <Fa icon={faArrowUp} size="xs" />
                {/if}
                Update
              </Button>
              <span class="text-xs text-amber-500 whitespace-nowrap">
                v{auggieStatus?.version} (needs {MINIMUM_AUGGIE_VERSION}+)
              </span>
            {:else if !auggieStatus?.authenticated}
              <Button
                onclick={(e) => {
                  e.stopPropagation();
                  startAuth();
                }}
                disabled={authInProgress || waitingForBrowserAuth}
              >
                {#if authInProgress || waitingForBrowserAuth}
                  <Fa icon={faCircleNotch} class="animate-spin" size="xs" />
                {:else}
                  <Fa icon={faArrowUpRightFromSquare} size="xs" />
                {/if}
                {waitingForBrowserAuth ? 'Waiting...' : 'Login'}
              </Button>
            {:else}
              <span class="flex items-center gap-1 text-primary text-sm">
                <Fa icon={faCircleCheck} size="sm" />
                Installed
              </span>
              <Button
                onclick={() => handleStartUsing('auggie')}
                size="sm"
                class="px-4"
                disabled={startingProviderId !== null}
              >
                {#if startingProviderId === 'auggie'}
                  <Fa icon={faCircleNotch} class="animate-spin" size="sm" />
                {/if}
                Start using
              </Button>
            {/if}
          </div>
        </div>
        <ul class="flex flex-col gap-1.5 text-muted-foreground/80 text-sm">
          <li class="flex items-center gap-3">
            <Fa icon={faArrowRight} size={12} class="opacity-50" />
            <span>Real-time codebase understanding with Context Engine</span>
          </li>
          <li class="flex items-center gap-3">
            <Fa icon={faArrowRight} size={12} class="opacity-50" />
            <span>Github, Linear, and Sentry workflow integration</span>
          </li>
          <li class="flex items-center gap-3">
            <Fa icon={faArrowRight} size={12} class="opacity-50" />
            <span>Multiple AI model provider selection & use</span>
          </li>
        </ul>
      </div>

      <!-- Manual install fallback (shown when auto-install fails) -->
      {#if showManualInstall && installError}
        <div
          class="flex flex-col gap-2 p-3 bg-destructive/5 border border-destructive/20 rounded-lg"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          <p class="text-xs text-destructive-foreground">{installError}</p>
          {#if installErrorType === 'permission'}
            <p class="text-xs text-muted-foreground">
              Try running with sudo or fix npm permissions.
            </p>
          {:else if installErrorType === 'missing_npm'}
            <p class="text-xs text-muted-foreground">
              Install <a href="https://nodejs.org" class="underline text-primary"
                onclick={(e) => { e.preventDefault(); const wsId = workspaceStore.current?.id; if (wsId) handleLink('https://nodejs.org', { workspaceId: wsId as WorkspaceId, event: e }); }}
                >Node.js</a
              > first.
            </p>
          {/if}
          <button
            class="flex items-center gap-1.5 px-2 py-1 bg-muted border border-border rounded text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors w-fit cursor-pointer"
            onclick={() => copyCommand(INSTALL_COMMAND)}
          >
            <code class="font-mono">{INSTALL_COMMAND}</code>
            <Fa icon={faPaste} size="xs" />
          </button>
        </div>
      {/if}

      <!-- Waiting for browser auth (localhost OAuth flow) -->
      {#if waitingForBrowserAuth}
        <div
          class="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          <p class="text-xs text-muted-foreground">Waiting for browser authentication...</p>
          {#if authUrl}
            <button
              class="text-xs text-muted-foreground hover:text-foreground text-left bg-transparent border-none p-0 cursor-pointer transition-colors"
              onclick={() => authUrl && shell.open(authUrl)}
            >
              Browser didn't open? <span class="underline">Click here</span>
            </button>
          {/if}
          <div class="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onclick={() => checkAuthPollOnce()}
              disabled={authPollCheckInFlight}
            >
              {#if authPollCheckInFlight}
                <Fa icon={faCircleNotch} class="animate-spin" size="xs" />
              {/if}
              Check now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onclick={() => {
                stopAuthPolling();
                waitingForBrowserAuth = false;
                showAuthInput = true;
              }}
            >
              Paste code manually instead
            </Button>
          </div>
        </div>
      {/if}

      <!-- Auth input (for Auggie) -->
      {#if showAuthInput}
        <div
          class="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg"
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
              class="text-xs text-muted-foreground hover:text-foreground text-left bg-transparent border-none p-0 cursor-pointer transition-colors"
              onclick={() => authUrl && shell.open(authUrl)}
            >
              Browser didn't open? <span class="underline">Click here</span>
            </button>
          {/if}
          <div class="flex gap-2">
            <Button size="sm" onclick={completeAuth} disabled={authInProgress || !authInput.trim()}>
              {#if authInProgress}
                <Fa icon={faCircleNotch} class="animate-spin" size="xs" />
              {/if}
              Complete Login
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onclick={() => {
                showAuthInput = false;
                authInput = '';
                authError = null;
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      {/if}

      <!-- Separator and secondary providers -->
      <div class="flex flex-col pt-5">
        <p
          class="text-muted-foreground/80 text-sm mb-5"
          in:fly|global={{ y: 30, duration: 400, delay: 440 }}
        >
          You can also use Intent with fewer features powered by:
        </p>

        <!-- Other providers -->
        {#each providerOptions.filter((p) => p.id !== 'auggie') as provider, index (provider.id)}
          <div
            class="flex justify-between items-center py-2"
            in:fly|global={{ y: 30, duration: 400, delay: index * 90 + 440 }}
          >
            <span class="text-[0.91rem] font-medium">{provider.name}</span>
            <div class="flex items-center gap-4">
              {#if isInitialLoad}
                <Skeleton class="h-8 w-20 rounded-md" />
              {:else if provider.available}
                <span class="flex items-center gap-1 text-primary text-sm">
                  <Fa icon={faCircleCheck} size="sm" />
                  Installed
                </span>
                <Button
                  class="bg-white hover:bg-gray-100 text-black font-normal px-4"
                  size="sm"
                  onclick={() => handleStartUsing(provider.id)}
                  disabled={startingProviderId !== null}
                >
                  {#if startingProviderId === provider.id}
                    <Fa icon={faCircleNotch} class="animate-spin text-black" size="sm" />
                  {/if}
                  Start using
                </Button>
              {:else}
                <Button
                  variant="outline"
                  class="bg-muted/50 hover:bg-muted text-muted-foreground"
                  onclick={(e) => {
                    e.stopPropagation();
                    openDocs(provider.docsUrl, true);
                  }}
                >
                  <Fa icon={faDownload} size="xs" />
                  Install
                </Button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
