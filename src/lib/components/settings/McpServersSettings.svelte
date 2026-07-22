<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { invoke } from '$shared/generated/ipc-client';
  import { onMount } from 'svelte';
  import type { McpServerConfig, McpServerWithStatus, McpServerFormState } from './mcp/types';
  import { serverToFormState } from './mcp/types';
  import {
  mcpOptions,
  isServerInstalled,
  normalizeServerName,
  type McpInstallOption,
} from './mcp/mcp-options';
  import McpServerCard from './mcp/McpServerCard.svelte';
  import McpServerForm from './mcp/McpServerForm.svelte';
  import McpJsonImport from './mcp/McpJsonImport.svelte';
  import McpIcon from './mcp/McpIcon.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { slide } from 'svelte/transition';
  import {
  faCheck,
  faCopy,
  faPlus,
  faRotateRight,
  faTerminal,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from '$lib/components/ui/toast';
  import Header from '../ui/Header.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import { store as appStore } from '$store/renderer/store';
  import {
  selectMcpServersWithStatus,
  selectMcpLoading,
  selectMcpError,
  selectMcpEnabled,
  selectMcpServers,
  selectMcpLastImportedCount,
  selectMcpAdvancedSaveStatus,
  selectMcpAdvancedSaveError,
} from '$store/renderer/slices/mcp-settings/mcp-settings-selectors';
  import {
  loadServers,
  toggleEnabled,
  toggleServer,
  addServer,
  removeServer,
  updateServer,
  importFromJson,
  testServerConnection,
  restartServer,
  saveAdvancedJson,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';

  const activeWorkspaceId = selectActiveWorkspaceId();
  const servers$ = selectMcpServersWithStatus();
  const loading$ = selectMcpLoading();
  const error$ = selectMcpError();
  const enabled$ = selectMcpEnabled();
  const lastImportedCount$ = selectMcpLastImportedCount();
  const advancedSaveStatus$ = selectMcpAdvancedSaveStatus();
  const advancedSaveError$ = selectMcpAdvancedSaveError();

  // Props
  let { isAuggieProvider = true }: { isAuggieProvider?: boolean } = $props();

  // UI state
  let showAddPanel = $state(false);
  let addMode = $state<'form' | 'import'>('form');
  let editingServer = $state<McpServerWithStatus | null>(null);
  let importedCount = $state(0);
  let showImportSuccess = $state(false);

  // Easy MCP install state
  let installingServer = $state<string | null>(null);
  let activeConfig = $state<McpInstallOption | null>(null);
  let userInputValues = $state<Record<string, string>>({});
  let installError = $state('');

  // Advanced editor state (content is seeded from the daemon-backed slice, not a raw file)
  let userMcpSettingsContent = $state('');
  let showAdvanced = $state(false);

  let isOpeningDiagnosticTerminal = $state(false);

  const diagnosticCommand = 'auggie mcp list';
  const canOpenDiagnosticTerminal = isMacPlatform();

  onMount(() => {
    appStore.dispatch(loadServers());
  });

  // React to import completion from the saga (avoids double-parsing JSON in the component)
  $effect(() => {
    const count = $lastImportedCount$;
    if (count !== null && count > 0) {
      importedCount = count;
      showImportSuccess = true;
      setTimeout(() => (showImportSuccess = false), 3000);
    }
  });

  // Rebuild the advanced editor's JSON from the daemon-backed slice state
  // (PROTOCOL §5.22 structured config — no raw settings-file IPC).
  function loadSettingsFile() {
    const servers = selectMcpServersWithStatus.select(appStore.state);
    const mcpServers: Record<string, unknown> = {};
    for (const server of servers) {
      const { name, status: _status, tools: _tools, toolCount: _toolCount, errorMessage: _err, disabled, ...config } = server;
      mcpServers[name] = disabled ? { ...config, disabled: true } : config;
    }
    userMcpSettingsContent = JSON.stringify({ mcpServers }, null, 2);
  }

  function handleToggleEnabled() {
    appStore.dispatch(toggleEnabled());
  }

  function handleRetryLoadServers() {
    appStore.dispatch(loadServers());
  }

  async function handleCopyDiagnosticCommand() {
    try {
      await navigator.clipboard.writeText(diagnosticCommand);
      toast.success('Diagnostic command copied');
    } catch (copyError) {
      logger.error('Failed to copy MCP diagnostic command:', copyError);
      toast.error('Failed to copy diagnostic command');
    }
  }

  async function handleOpenDiagnosticTerminal() {
    if (!isElectronPlatform()) {
      toast.error('Terminal integration is unavailable in browser mode');
      return;
    }

    if (!canOpenDiagnosticTerminal) {
      await handleCopyDiagnosticCommand();
      toast.info('Paste the diagnostic command into your terminal');
      return;
    }

    isOpeningDiagnosticTerminal = true;

    try {
      const result = await invoke<any>('system:execute-command', {
        command:
          'osascript -e \'tell application "Terminal" to activate\' -e \'tell application "Terminal" to do script "auggie mcp list"\'',
      });

      if (result?.success) {
        toast.success('Opened Terminal and started MCP diagnostic');
      } else {
        logger.error('Failed to open MCP diagnostic terminal:', result?.error);
        await handleCopyDiagnosticCommand();
        toast.error('Could not open Terminal automatically. Command copied instead.');
      }
    } catch (terminalError) {
      logger.error('Failed to launch MCP diagnostic terminal:', terminalError);
      await handleCopyDiagnosticCommand();
      toast.error('Could not open Terminal automatically. Command copied instead.');
    } finally {
      isOpeningDiagnosticTerminal = false;
    }
  }

  function handleToggleServer(name: string) {
    appStore.dispatch(toggleServer(name));
  }

  function handleRestartServer(name: string) {
    appStore.dispatch(restartServer(name));
    toast.info(`Restarting "${name}"`, {
      description: 'Re-checking the MCP server. New agents will pick up the restart.',
      duration: 3000,
    });
  }

  function handleAddServer(config: McpServerConfig) {
    // The management service handles auth checks and connection testing.
    // Auth-required status will be reflected in the server card via the status map.
    appStore.dispatch(addServer(config));
    showAddPanel = false;
    loadSettingsFile();
  }

  async function handleEditServer(server: McpServerWithStatus) {
    editingServer = server;
  }

  function handleUpdateServer(config: McpServerConfig) {
    if (!editingServer) return;
    appStore.dispatch(updateServer(editingServer.name, config));
    editingServer = null;
    loadSettingsFile();
  }

  function handleDeleteServer(name: string) {
    // Get the server config before deleting (for undo)
    const currentServers = selectMcpServers.select(appStore.state);
    const serverConfig = currentServers.find((s) => s.name === name);
    if (!serverConfig) return;

    // Delete immediately
    appStore.dispatch(removeServer(name));
    loadSettingsFile();

    // Show toast with undo action
    toast.warning(`Deleted "${name}"`, {
      action: {
        label: 'Undo',
        onClick: () => {
          appStore.dispatch(addServer(serverConfig));
          loadSettingsFile();
        },
      },
      duration: 5000,
    });
  }

  async function handleReauthenticate(name: string) {
    logger.info('Reauthenticate requested for:', name);

    // Find the server by name
    const currentServers = selectMcpServersWithStatus.select(appStore.state);
    const server = currentServers.find((s) => s.name === name);
    if (!server) {
      logger.warn('Server not found:', name);
      return;
    }

    // For HTTP/SSE servers, try OAuth flow first
    if ((server.type === 'http' || server.type === 'sse') && server.url) {
      toast.info('Starting authentication...', {
        description: 'Opening browser for authentication.',
        duration: 3000,
      });

      try {
        const result = isElectronPlatform()
          ? await invoke<any>('user-mcp:initiate-oauth', {
            name: server.name,
            url: server.url,
          })
          : undefined;

        if (result?.success) {
          toast.success('Authentication successful', {
            description: 'You can now use this MCP server.',
            duration: 5000,
          });
          // Re-test the connection to update status
          appStore.dispatch(testServerConnection(server.name, server.url, server.headers));
          return;
        }

        // If OAuth not supported or failed, fall back to edit mode
        if (result?.error) {
          logger.info('OAuth not available, falling back to manual auth:', result.error);
        }
      } catch (error) {
        logger.error('OAuth initiation failed:', error);
      }
    }

    // Fall back to edit mode for manual auth configuration
    editingServer = server;
    toast.info('Configure authentication', {
      description:
        'Add an Authorization header with your API token (e.g., "Bearer your-token-here").',
      duration: 5000,
    });
  }

  // Easy MCP Install functions
  function isInstalled(option: McpInstallOption): boolean {
    return isServerInstalled(option.label, $servers$);
  }

  function getInstalledServerStatus(option: McpInstallOption): string | undefined {
    const server = $servers$.find(
      (s) =>
        s.name.toLowerCase().replace(/\s+/g, '-') ===
        option.label.toLowerCase().replace(/\s+/g, '-'),
    );
    return server?.status;
  }

  function startInstall(option: McpInstallOption) {
    if (isInstalled(option)) return;

    if (option.userInput && option.userInput.length > 0) {
      activeConfig = option;
      userInputValues = {};
      option.userInput.forEach((input) => {
        if (input.defaultValue) {
          userInputValues[input.envVarName || input.correspondingArg || input.label] =
            input.defaultValue;
        }
      });
    } else {
      doInstall(option, {});
    }
  }

  async function doInstall(option: McpInstallOption, inputs: Record<string, string>) {
    installingServer = option.label;
    installError = '';

    try {
      const args: string[] = option.args ? [...option.args] : [];
      const env: Record<string, string> = {};

      if (option.userInput) {
        for (const input of option.userInput) {
          const key = input.envVarName || input.correspondingArg || input.label;
          const value = inputs[key];

          if (input.type === 'argument' && input.correspondingArg && value) {
            args.push(value);
          } else if (input.type === 'environmentVariable' && input.envVarName && value) {
            env[input.envVarName] = value;
          }
        }
      }

      // Convert label to a valid server name (replace spaces with hyphens, lowercase)
      const serverName = option.label.toLowerCase().replace(/\s+/g, '-');

      // Build config based on transport type
      const isRemote = option.type === 'http' || option.type === 'sse';
      const config: McpServerConfig = isRemote
        ? {
            name: serverName,
            type: option.type!,
            url: option.url,
            authType: option.authType,
          }
        : {
            name: serverName,
            type: 'stdio',
            command: option.command!,
            args: args.length > 0 ? args : undefined,
            env: Object.keys(env).length > 0 ? env : undefined,
          };

      appStore.dispatch(addServer(config));
      activeConfig = null;
      userInputValues = {};
      loadSettingsFile();
    } catch (e) {
      installError = e instanceof Error ? e.message : 'Installation failed';
    } finally {
      installingServer = null;
    }
  }

  function handleSubmitInputs() {
    if (!activeConfig) return;

    for (const input of activeConfig.userInput || []) {
      const key = input.envVarName || input.correspondingArg || input.label;
      if (!userInputValues[key] && !input.defaultValue) {
        installError = `${input.label} is required`;
        return;
      }
    }

    doInstall(activeConfig, userInputValues);
  }

  function cancelInputs() {
    activeConfig = null;
    userInputValues = {};
    installError = '';
  }

  async function handleImportJson(json: string) {
    appStore.dispatch(importFromJson(json));
    showAddPanel = false;
    // Success feedback is driven by the service dispatching importFromJsonCompleted,
    // observed reactively via $lastImportedCount$ below.
    loadSettingsFile();
  }

  // Replace-all save through the daemon seam; the management service parses,
  // validates, persists, and reports progress via the advanced-save selectors.
  function handleSaveAdvanced() {
    appStore.dispatch(saveAdvancedJson(userMcpSettingsContent));
  }

  function handleToggleAdvanced() {
    showAdvanced = !showAdvanced;
    if (showAdvanced) loadSettingsFile();
  }

  function handleCancelAdd() {
    showAddPanel = false;
    addMode = 'form';
  }

  function handleCancelEdit() {
    editingServer = null;
  }

  // Get form state for editing
  const editFormState = $derived<McpServerFormState | undefined>(
    editingServer ? serverToFormState(editingServer) : undefined,
  );
</script>

<div class="flex flex-col gap-6">
  <!-- Enable User MCP Servers Toggle -->
  <section class="bg-card rounded-xl px-6 py-5">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-sm font-medium text-foreground">Custom MCP Servers</p>
        <p class="text-xs text-subtle">
          Connect external tools and services to your Auggie agents via the Model Context Protocol.
          <button
            type="button"
            class="text-primary hover:underline cursor-pointer"
            onclick={(e) => {
              handleLink('https://docs.augmentcode.com/setup-augment/mcp', {
                  workspaceId: $activeWorkspaceId ?? undefined,
                event: e,
              });
            }}>Learn more ↗</button
          >
        </p>
      </div>
      <Switch checked={$enabled$} onCheckedChange={handleToggleEnabled} size="md" />
    </div>
    {#if !isAuggieProvider}
      <p class="text-xs text-subtle mt-2">
        MCP servers are used by Auggie agents. Switch to Auggie as your provider to use custom MCP
        servers.
      </p>
    {/if}
  </section>

  {#if $enabled$}
    <div transition:slide={{ duration: 200 }} class="space-y-6">
      <div class="mx-0 px-3 py-2 bg-muted/50 rounded-md border border-border/50">
        <p class="text-xs text-subtle">
          Changes take effect for new agents only. Running agents keep their current MCP setup.
        </p>
      </div>

      <!-- Combined MCP Servers Section -->
      <section class="bg-card rounded-xl overflow-hidden">
        <!-- Header with Add button -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p class="text-sm font-medium text-foreground">MCP Servers for Auggie</p>
            <p class="text-xs text-subtle">
              {$servers$.length} server{$servers$.length !== 1 ? 's' : ''} configured
            </p>
          </div>
          {#if showAddPanel}
            <Button variant="ghost" size="sm" onclick={() => (showAddPanel = false)}>Cancel</Button>
          {:else}
            <Button variant="outline" size="sm" onclick={() => (showAddPanel = true)}>
              <Fa icon={faPlus} class="mr-1.5" size="xs" />
              Add New
            </Button>
          {/if}
        </div>

        <!-- Expandable Add Panel -->
        {#if showAddPanel}
          <div transition:slide={{ duration: 200 }} class="border-b border-border">
            <div class="px-6 py-4">
              <Header size={2} title="Add new MCP server" class="mb-3" />
              <!-- Mode Toggle -->
              <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit mb-4">
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer {addMode ===
                  'form'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (addMode = 'form')}
                >
                  Configure
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer {addMode ===
                  'import'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (addMode = 'import')}
                >
                  Import JSON
                </button>
              </div>

              {#if addMode === 'form'}
                <McpServerForm
                  onSubmit={handleAddServer}
                  onCancel={handleCancelAdd}
                  existingServerNames={$servers$.map((s) => s.name)}
                />
              {:else}
                <McpJsonImport onImport={handleImportJson} onCancel={handleCancelAdd} />
              {/if}
            </div>
          </div>
        {/if}

        <!-- Edit Panel (when editing a server) -->
        {#if editingServer && editFormState}
          <div transition:slide={{ duration: 200 }} class="border-b border-border bg-muted/20">
            <div class="px-6 py-4">
              <h3 class="text-sm font-medium mb-4">Edit Server: {editingServer.name}</h3>
              <McpServerForm
                initialValues={editFormState}
                editMode={true}
                onSubmit={handleUpdateServer}
                onCancel={handleCancelEdit}
              />
            </div>
          </div>
        {/if}

        <!-- Configured Servers List -->
        <div class="px-6 py-4">
          {#if $loading$}
            <!-- Skeleton loaders for configured servers -->
            <div class="space-y-3 mb-6">
              {#each [1, 2] as { }}
                <div class="flex items-start gap-3 py-3">
                  <Skeleton class="w-2.5 h-2.5 rounded-full mt-1.5" />
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <Skeleton class="h-4 w-24" />
                      <Skeleton class="h-3 w-16" />
                    </div>
                    <Skeleton class="h-3 w-40" />
                  </div>
                  <Skeleton class="w-9 h-5 rounded-full" />
                </div>
              {/each}
            </div>
            <!-- Skeleton loaders for quick install -->
            <div class="pt-4 border-t border-border">
              <div class="flex items-center gap-2 mb-3">
                <Skeleton class="h-4 w-20" />
                <Skeleton class="h-3 w-16" />
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {#each [1, 2, 3, 4, 5, 6] as { }}
                  <div class="flex items-center gap-3 py-2.5 px-1">
                    <Skeleton class="w-7 h-7 rounded-md" />
                    <div class="flex-1 min-w-0">
                      <Skeleton class="h-4 w-20 mb-1" />
                      <Skeleton class="h-3 w-32" />
                    </div>
                    <Skeleton class="w-3 h-3" />
                  </div>
                {/each}
              </div>
            </div>
          {:else if $error$}
            <div class="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">Couldn&apos;t load MCP servers</p>
                <p class="text-sm text-destructive">{$error$}</p>
              </div>

              <div class="mt-3 rounded-md border border-border bg-background/70 p-3">
                <p class="text-xs text-muted-foreground">Diagnostic command</p>
                <code class="mt-1 block break-all text-xs text-foreground">{diagnosticCommand}</code
                >
              </div>

              <div class="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onclick={handleRetryLoadServers}>
                  <Fa icon={faRotateRight} size="xs" />
                  <span class="ml-2">Retry</span>
                </Button>

                <Button variant="outline" size="sm" onclick={handleCopyDiagnosticCommand}>
                  <Fa icon={faCopy} size="xs" />
                  <span class="ml-2">Copy command</span>
                </Button>

                {#if canOpenDiagnosticTerminal}
                  <Button
                    size="sm"
                    onclick={handleOpenDiagnosticTerminal}
                    disabled={isOpeningDiagnosticTerminal}
                  >
                    <Fa icon={faTerminal} size="xs" />
                    <span class="ml-2">
                      {isOpeningDiagnosticTerminal ? 'Opening Terminal…' : 'Open Terminal & Run'}
                    </span>
                  </Button>
                {/if}
              </div>

              <p class="mt-3 text-xs text-muted-foreground">
                Run this command to inspect the CLI output directly if MCP server loading fails.
              </p>
            </div>
          {:else if $servers$.length === 0}
            <div class="text-xs text-subtle mb-4">
              <p>No custom MCP servers configured yet.</p>
              <p class="mt-1">
                Add servers to give Auggie agents access to external tools and data.
                <button
                  type="button"
                  class="text-primary hover:underline cursor-pointer"
                  onclick={(e) => {
                    handleLink('https://docs.augmentcode.com/setup-augment/mcp', {
                      workspaceId: $activeWorkspaceId ?? undefined,
                      event: e,
                    });
                  }}>Learn how ↗</button
                >
              </p>
            </div>
          {:else}
            <div class="mb-6">
              {#each $servers$ as server (server.name)}
                <McpServerCard
                  {server}
                  onToggle={handleToggleServer}
                  onEdit={handleEditServer}
                  onDelete={handleDeleteServer}
                  onReauthenticate={handleReauthenticate}
                  onRestart={handleRestartServer}
                />
              {/each}
            </div>
          {/if}

          <!-- Easy MCP Installation (below configured servers) -->
          <div class="pt-4 border-t border-border">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-sm font-medium text-foreground">Quick Install</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              {#each mcpOptions as option (option.label)}
                {@const installed = isInstalled(option)}
                {@const installing = installingServer === option.label}
                {@const configuring = activeConfig?.label === option.label}
                {@const needsAuth =
                  installed && getInstalledServerStatus(option) === 'auth_required'}

                <div class="relative">
                  {#if configuring}
                    <!-- Configuration form for preset -->
                    <div class="py-3 px-1">
                      <div class="flex items-center gap-2 mb-3">
                        <McpIcon iconName={option.iconName} label={option.label} size={20} />
                        <span class="font-medium text-sm">{option.label}</span>
                      </div>

                      {#each option.userInput || [] as input}
                        {@const inputKey =
                          input.envVarName || input.correspondingArg || input.label}
                        <div class="mb-2">
                          <span class="block text-xs text-subtle mb-1">
                            {input.label}
                          </span>
                          <Input
                            bind:value={userInputValues[inputKey]}
                            placeholder={input.placeholder}
                            class="h-8 text-sm"
                          />
                          {#if input.description}
                            <p class="text-xs text-subtle mt-0.5">{input.description}</p>
                          {/if}
                        </div>
                      {/each}

                      {#if installError}
                        <p class="text-xs text-destructive-foreground mb-2">{installError}</p>
                      {/if}

                      <div class="flex gap-2 mt-3">
                        <Button size="sm" variant="ghost" onclick={cancelInputs}>Cancel</Button>
                        <Button size="sm" onclick={handleSubmitInputs} disabled={installing}>
                          {installing ? 'Installing...' : 'Install'}
                        </Button>
                      </div>
                    </div>
                  {:else}
                    <!-- Preset option button -->
                    <div
                      class="w-full flex items-center gap-3 py-2.5 px-1 rounded-md transition-colors"
                    >
                      <button
                        type="button"
                        class="flex-1 flex items-center gap-3 min-w-0 cursor-pointer"
                        onclick={() => startInstall(option)}
                        disabled={(installed && !needsAuth) || installing}
                      >
                        <McpIcon iconName={option.iconName} label={option.label} size={20} />

                        <div class="flex-1 min-w-0 text-left">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium truncate">{option.label}</span>
                            {#if needsAuth}
                              <span class="text-ui text-amber-700 dark:text-amber-400 font-medium">
                                Needs Auth
                              </span>
                            {:else if installed}
                              <span class="text-ui text-green-600 font-medium"> Installed </span>
                            {/if}
                          </div>
                          <p class="text-xs text-subtle truncate">{option.description}</p>
                        </div>
                      </button>

                      <div class="shrink-0 flex items-center gap-2">
                        {#if installing}
                          <div
                            class="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"
                          ></div>
                        {:else if needsAuth}
                          <button
                            type="button"
                            class="px-3 py-1 text-xs font-medium rounded-md border border-amber-500/50 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
                            onclick={() => handleReauthenticate(normalizeServerName(option.label))}
                          >
                            Authenticate
                          </button>
                        {:else if installed}
                          <Fa icon={faCheck} size="sm" class="text-green-500" />
                        {:else}
                          <button
                            type="button"
                            class="p-1 rounded-md hover:bg-muted transition-colors cursor-pointer"
                            onclick={() => startInstall(option)}
                          >
                            <Fa icon={faPlus} size="sm" class="text-subtle" />
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>

      <!-- Advanced: Settings JSON Editor (daemon `mcp.servers` structured config) -->
      <section class="bg-card rounded-xl overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
          onclick={handleToggleAdvanced}
        >
          <div class="text-left">
            <p class="text-sm font-medium text-foreground">Advanced: Edit Servers as JSON</p>
            <p class="text-xs text-subtle">
              Directly edit the daemon's <code class="bg-muted px-1 py-0.5 rounded text-xs"
                >mcp.servers</code
              > configuration
            </p>
          </div>
          <span class="text-subtle text-xs transition-transform {showAdvanced ? 'rotate-90' : ''}"
            >▶</span
          >
        </button>

        {#if showAdvanced}
          <div
            transition:slide={{ duration: 200 }}
            class="px-6 pb-4 space-y-3 border-t border-border pt-4"
          >
            <textarea
              class="w-full h-64 px-3 py-2 bg-background border border-border rounded-md text-sm font-mono text-foreground resize-y focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder={'{"mcpServers": {}}'}
              aria-label="MCP server configuration JSON"
              bind:value={userMcpSettingsContent}
            ></textarea>

            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-2">
                {#if $advancedSaveStatus$ === 'saved'}
                  <span class="text-xs text-green-500">✓ Saved</span>
                {:else if $advancedSaveStatus$ === 'error'}
                  <span class="text-xs text-destructive-foreground"
                    >✗ {$advancedSaveError$ || 'Failed to save'}</span
                  >
                {:else if $advancedSaveStatus$ === 'saving'}
                  <span class="text-xs text-subtle">Saving...</span>
                {/if}
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json"
                  class="text-xs text-primary hover:underline"
                  onclick={(e) => {
                    e.preventDefault();
                    handleLink(
                      'https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json',
                      { workspaceId: $activeWorkspaceId ?? undefined, event: e },
                    );
                  }}
                >
                  Documentation ↗
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={handleSaveAdvanced}
                  disabled={$advancedSaveStatus$ === 'saving'}
                >
                  Save Settings
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}

  <!-- Import success toast -->
  {#if showImportSuccess}
    <div
      class="fixed bottom-4 right-4 px-4 py-3 bg-green-600 text-white text-sm rounded-lg shadow-lg z-50"
      transition:slide={{ duration: 150 }}
    >
      Successfully imported {importedCount} server{importedCount !== 1 ? 's' : ''}!
    </div>
  {/if}
</div>
