<script lang="ts">
 
  import { page } from '$app/stores';
  import { Button } from '$lib/components/ui/button';
  import { toast } from '$lib/components/ui/toast';
  import { invoke, shell } from '$lib/electron-bridge';
  import { retryLoadModels } from '$store/renderer/slices/model/model-slice';
  import AuggieInstructionsPanel from '$lib/components/AuggieInstructionsPanel.svelte';

  import { createLogger } from '$lib/utils/client-logger';
  import { AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from '$shared/ipc/channels';
  import { selectProviderCatalogEntry } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
  import {
  faCircleCheck,
  faCircleNotch,
  faDownload,
  faPaste,
  faExternalLinkAlt,
} from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('AuggieSetupGate');

  /** Auggie install/auth state, from the generic per-provider check. */
  type AuggieStatus = {
    installed: boolean;
    authenticated: boolean;
  };

  const STATUS_REFRESH_INTERVAL_MS = 15000;

  let status: AuggieStatus | null = $state(null);
  let loading = $state(true);
  let actionInProgress = $state(false);
  let statusPollHandle: ReturnType<typeof setInterval> | null = null;

  // Provider availability state (checks all providers: auggie, claude-code, codex)
  let providerAvailability: ProviderAvailabilityResult | null = $state(null);
  let providerCheckError: string | null = $state(null);

  // Instructions returned by AUGGIE_CHANNELS.INSTALL / AUTHENTICATE. The daemon
  // returns manual steps + a copyable command; the FE no longer drives the
  // install/OAuth flow itself.
  let auggieInstructions = $state<string[] | null>(null);
  let auggieCommand = $state<string | null>(null);

  // Skip gating on sandbox/test routes
  const isSandboxPage = $derived(
    $page.url.pathname === '/sandbox' ||
      $page.url.pathname.startsWith('/sandbox/') ||
      $page.url.pathname === '/test' ||
      $page.url.pathname.startsWith('/test/'),
  );

  // Check if any provider is available (allows bypassing Auggie-specific setup)
  const hasAnyProvider = $derived.by(() => {
    return providerAvailability?.hasAnyProvider ?? false;
  });

  /**
   * Check provider availability from all ACP providers via host.checkAuggie /
   * host.findBinary (routed through PROVIDERS_CHANNELS.GET_AVAILABILITY).
   */
  async function checkProviderAvailability(): Promise<void> {
    try {
      const result = await invoke<{
        success: boolean;
        data?: ProviderAvailabilityResult;
        error?: string;
      }>(PROVIDERS_CHANNELS.GET_AVAILABILITY);
      if (!result.success) {
        throw new Error(result.error || m.lib_auggieSetup_providerCheckFailed_error());
      }
      providerAvailability = result.data ?? null;
      providerCheckError = null;
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to check provider availability', { error: err });
      providerCheckError = message;
    }
  }

  /** Fetch auggie install/auth state from the generic per-provider check. */
  async function checkStatus() {
    try {
      const result = await invoke<{
        success: boolean;
        data?: { available: boolean; authenticated?: boolean };
        error?: string;
      }>(PROVIDERS_CHANNELS.CHECK_SINGLE, { providerId: 'auggie' });
      status = {
        installed: result.data?.available ?? false,
        authenticated: result.data?.authenticated === true,
      };
      if (status.installed && status.authenticated) {
        appStore.dispatch(retryLoadModels());
      }
    } catch (err) {
      logger.error('Failed to check Auggie status', { error: err });
    }
  }

  onMount(() => {
    void checkProviderAvailability().then(() => {
      if (!hasAnyProvider) {
        void checkStatus().finally(() => {
          loading = false;
        });
      } else {
        loading = false;
      }
    });

    if (!isSandboxPage) {
      statusPollHandle = setInterval(() => {
        if (shouldBlock) void checkStatus();
      }, STATUS_REFRESH_INTERVAL_MS);
      return () => {
        if (statusPollHandle) {
          clearInterval(statusPollHandle);
          statusPollHandle = null;
        }
      };
    }
    return undefined;
  });

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
    try {
      actionInProgress = true;
      const result = await invoke<InstructionResponse>(AUGGIE_CHANNELS.INSTALL);
      applyInstructionResponse(result);
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to fetch install instructions', { error: err });
      auggieInstructions = [message];
      auggieCommand = null;
    } finally {
      actionInProgress = false;
    }
  }

  /** Ask the daemon whether auggie is authenticated; otherwise render login instructions. */
  async function startAuthentication() {
    try {
      actionInProgress = true;
      const result = await invoke<InstructionResponse>(AUGGIE_CHANNELS.AUTHENTICATE, {
        action: 'start',
      });
      if (result.success && result.data?.authenticated) {
        auggieInstructions = null;
        auggieCommand = null;
        await checkStatus();
        return;
      }
      applyInstructionResponse(result);
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Failed to fetch login instructions', { error: err });
      auggieInstructions = [message];
      auggieCommand = null;
    } finally {
      actionInProgress = false;
    }
  }

  /** Re-run detection after the user completes the manual step. */
  async function recheckAuggie() {
    actionInProgress = true;
    try {
      await checkStatus();
      if (status?.installed && status?.authenticated) {
        auggieInstructions = null;
        auggieCommand = null;
        toast.success(m.lib_auggieSetup_readyToGo_message());
        return;
      }
      const channel = status?.installed ? AUGGIE_CHANNELS.AUTHENTICATE : AUGGIE_CHANNELS.INSTALL;
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

  // Provider setup is now non-blocking on the homepage — the gate is retained
  // for the multi-provider setup UI it hosts, but not rendered by default.
  const shouldBlock = $derived.by(() => false);

  // Get available provider options for the setup screen
  // Filter out providers hidden by env var gate
  function catalogRow(providerId: string): { displayName: string; command: string } {
    const entry = selectProviderCatalogEntry.select(appStore.state, providerId);
    return {
      displayName: entry?.displayName ?? providerId,
      command: entry?.command ?? providerId,
    };
  }

  const providerOptions = $derived.by(() => {
    const hidden = providerAvailability?.hiddenProviders ?? [];
    return [
      {
        id: 'auggie',
        name: catalogRow('auggie').displayName,
        command: catalogRow('auggie').command,
        installCommand: 'npm install -g @augmentcode/auggie',
        description: m.lib_auggieSetup_auggie_description(),
        available: providerAvailability?.providers.auggie.available ?? false,
        requiresAuth: true,
        docsUrl: 'https://docs.augmentcode.com/cli/overview',
      },
      {
        id: 'claude-code',
        name: catalogRow('claude-code').displayName,
        command: catalogRow('claude-code').command,
        installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
        description: m.lib_auggieSetup_claudeCode_description(),
        available: providerAvailability?.providers.claudeCode.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://github.com/anthropics/claude-code',
      },
      {
        id: 'codex',
        name: catalogRow('codex').displayName,
        command: catalogRow('codex').command,
        installCommand: 'npm i -g @openai/codex',
        description: m.lib_auggieSetup_codex_description(),
        available: providerAvailability?.providers.codex.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://github.com/openai/codex',
      },
      {
        id: 'cortex',
        name: catalogRow('cortex').displayName,
        command: catalogRow('cortex').command,
        installCommand: 'pip install snowflake-cli',
        description: m.lib_auggieSetup_cortex_description(),
        available: providerAvailability?.providers.cortex?.available ?? false,
        requiresAuth: false,
        docsUrl: 'https://docs.snowflake.com/en/developer-guide/cortex',
      },
    ].filter((p) => !hidden.includes(p.id));
  });

  function openProviderDocs(url: string) {
    shell.open(url);
  }

  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(m.lib_auggieSetup_copied_message());
    } catch {
      toast.error(m.lib_auggieSetup_copyFailed_error());
    }
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
        {m.lib_auggieSetup_tagline_message()}
      </p>
    </section>

    <!-- Loading State -->
    {#if loading}
      <section class="providers-section">
        <div class="loading-spinner">
          <Fa icon={faCircleNotch} size="2x" class="animate-spin text-subtle" />
        </div>
        <p class="text-subtle text-center">{m.lib_auggieSetup_checkingProviders_label()}</p>
      </section>

      <!-- Error State -->
    {:else if providerCheckError}
      <section class="providers-section">
        <h2>{m.lib_auggieSetup_somethingWentWrong_title()}</h2>
        <p class="text-subtle">{m.lib_auggieSetup_checkFailed_description()}</p>
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
          {m.lib_auggieSetup_tryAgain_label()}
        </Button>
      </section>

      <!-- No Providers Available - Show Setup Options -->
    {:else}
      <section class="providers-section">
        <h2>{m.lib_auggieSetup_installProvider_title()}</h2>
        <p class="text-subtle mb-4">
          {m.lib_auggieSetup_installProvider_description()}
        </p>

        <div class="provider-cards">
          {#each providerOptions as provider (provider.id)}
            <div class="provider-card" class:recommended={provider.id === 'auggie'}>
              <div class="provider-header">
                <h3>{provider.name}</h3>
                {#if provider.id === 'auggie'}
                  <span class="recommended-badge">{m.lib_auggieSetup_recommended_badge()}</span>
                {/if}
                {#if provider.available}
                  <span class="available-badge">
                    <Fa icon={faCircleCheck} class="inline" size="sm" /> {m.lib_auggieSetup_available_badge()}
                  </span>
                {/if}
              </div>
              <p class="provider-description">{provider.description}</p>

              <div class="provider-actions">
                {#if provider.id === 'auggie'}
                  <Button onclick={installAuggie} disabled={actionInProgress} size="sm">
                    {#if actionInProgress}
                      <Fa icon={faCircleNotch} class="animate-spin mr-2" />
                      {m.lib_auggieSetup_loading_label()}
                    {:else}
                      <Fa icon={faDownload} class="mr-2" /> {m.lib_auggieSetup_install_label()}
                    {/if}
                  </Button>
                {:else}
                  {#if provider.installCommand}
                    {@const installCommand = provider.installCommand}
                    <button
                      class="install-command-button"
                      onclick={() => copyCommand(installCommand)}
                      title={m.lib_auggieSetup_clickToCopy_tooltip()}
                    >
                      <code>{installCommand}</code>
                      <Fa icon={faPaste} class="copy-icon" size="sm" />
                    </button>
                  {/if}
                {/if}
                <button class="docs-link" onclick={() => openProviderDocs(provider.docsUrl)}>
                  <Fa icon={faExternalLinkAlt} size="sm" class="mr-1" />
                  {m.lib_auggieSetup_docs_label()}
                </button>
              </div>

              {#if provider.requiresAuth && provider.id === 'auggie'}
                <p class="auth-note">{m.lib_auggieSetup_authNote_message()}</p>
              {/if}

              <!-- Instructions panel driven by AUGGIE_CHANNELS.INSTALL / AUTHENTICATE -->
              {#if provider.id === 'auggie' && auggieInstructions && auggieInstructions.length > 0}
                <AuggieInstructionsPanel
                  instructions={auggieInstructions}
                  command={auggieCommand ?? undefined}
                  onRecheck={recheckAuggie}
                  onDismiss={dismissAuggieInstructions}
                  rechecking={actionInProgress}
                />
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
                  void checkStatus();
                }
                loading = false;
              });
            }}
          >
            <Fa icon={faCircleNotch} class="mr-2" /> {m.lib_auggieSetup_checkAgain_label()}
          </Button>
        </div>
      </section>

      <!-- Auggie login section (rendered when installed but not authenticated) -->
      {#if status?.installed && !status?.authenticated}
        <section class="authenticate">
          <h2>{m.lib_auggieSetup_authenticate_title()}</h2>
          <div class="actions">
            <Button onclick={() => startAuthentication()} disabled={actionInProgress}>
              {#if actionInProgress}
                <Fa icon={faCircleNotch} class="animate-spin mr-2" /> {m.lib_auggieSetup_loading_label()}
              {:else}
                <Fa icon={faCircleCheck} class="mr-2" /> {m.lib_auggieSetup_loginWithAugment_label()}
              {/if}
            </Button>
          </div>
          {#if auggieInstructions && auggieInstructions.length > 0}
            <AuggieInstructionsPanel
              instructions={auggieInstructions}
              command={auggieCommand ?? undefined}
              onRecheck={recheckAuggie}
              onDismiss={dismissAuggieInstructions}
              rechecking={actionInProgress}
            />
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

  .actions {
    display: flex;
    flex-direction: row;
    gap: 1rem;
    align-items: center;
    margin: 0.5rem 0 0;
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

  .install-command-button :global(.copy-icon) {
    opacity: 0;
    transition: opacity 0.2s;
  }

  .install-command-button:hover :global(.copy-icon) {
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
