<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { onMount } from 'svelte';
  import { mcpSettingsStore } from './mcp/mcp-settings.store.svelte';
  import type { McpServerConfig, McpServerWithStatus, McpServerFormState } from './mcp/types';
  import { serverToFormState } from './mcp/types';
  import { mcpOptions, isServerInstalled, type McpInstallOption } from './mcp/mcp-options';
  import McpServerCard from './mcp/McpServerCard.svelte';
  import McpServerForm from './mcp/McpServerForm.svelte';
  import McpJsonImport from './mcp/McpJsonImport.svelte';
  import McpIcon from './mcp/McpIcon.svelte';
  import Switch from '$lib/components/ui/switch/switch.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { slide } from 'svelte/transition';
  import { faPlus, faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { toast } from '$lib/components/ui/toast';
  import Header from '../ui/Header.svelte';
  import { handleLink } from '$features/navigation/link-handler';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';

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

  // Advanced editor state
  let userMcpSettingsContent = $state('');
  let userMcpSettingsPath = $state('');
  let userMcpSaveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let userMcpSaveError = $state('');
  let showAdvanced = $state(false);

  // Reactive getters from store
  const servers = $derived(mcpSettingsStore.serversWithStatus);
  const loading = $derived(mcpSettingsStore.loading);
  const error = $derived(mcpSettingsStore.error);
  const enabled = $derived(mcpSettingsStore.enabled);

  onMount(async () => {
    await mcpSettingsStore.loadServers();
    await loadSettingsFile();
  });

  async function loadSettingsFile() {
    if (!window.electronAPI) return;
    try {
      const contentResult = await window.electronAPI.invoke(
        'user-mcp:get-settings-file',
        undefined,
      );
      if (contentResult?.success && contentResult.data?.content) {
        userMcpSettingsContent = contentResult.data.content;
      } else if (contentResult?.data?.content === null) {
        userMcpSettingsContent = JSON.stringify({ mcpServers: {} }, null, 2);
      }

      const pathResult = await window.electronAPI.invoke('user-mcp:get-settings-path', undefined);
      if (pathResult?.success) {
        userMcpSettingsPath = pathResult.data;
      }
    } catch (err) {
      logger.error('Failed to load settings file:', err);
    }
  }

  async function handleToggleEnabled() {
    await mcpSettingsStore.setEnabled(!enabled);
  }

  async function handleToggleServer(name: string) {
    await mcpSettingsStore.toggleServer(name);
  }

  async function handleAddServer(config: McpServerConfig) {
    const authInfo = await mcpSettingsStore.addServer(config);
    showAddPanel = false;
    await loadSettingsFile();

    // Show a warning toast if the server requires auth we don't have
    if (authInfo?.requiresAuth && !authInfo?.hasAuth) {
      toast.warning(`${authInfo.providerDisplayName || 'Service'} requires authentication`, {
        description:
          authInfo.authHint || 'Please configure authentication in Settings > Integrations',
        duration: 8000,
        action: {
          label: 'Configure',
          onClick: () => {
            // Navigate to the integrations section using hash navigation
            window.location.hash = 'integrations';
          },
        },
      });
    }
  }

  async function handleEditServer(server: McpServerWithStatus) {
    editingServer = server;
  }

  async function handleUpdateServer(config: McpServerConfig) {
    if (!editingServer) return;
    await mcpSettingsStore.updateServer(editingServer.name, config);
    editingServer = null;
    await loadSettingsFile();
  }

  async function handleDeleteServer(name: string) {
    // Get the server config before deleting (for undo)
    const serverConfig = mcpSettingsStore.servers.find((s) => s.name === name);
    if (!serverConfig) return;

    // Delete immediately
    await mcpSettingsStore.removeServer(name);
    await loadSettingsFile();

    // Show toast with undo action
    toast.warning(`Deleted "${name}"`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          await mcpSettingsStore.addServer(serverConfig);
          await loadSettingsFile();
        },
      },
      duration: 5000,
    });
  }

  async function handleReauthenticate(name: string) {
    logger.info('Reauthenticate requested for:', name);

    // Find the server by name
    const server = servers.find((s) => s.name === name);
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
        const result = await window.electronAPI?.invoke('user-mcp:initiate-oauth', {
          name: server.name,
          url: server.url,
        });

        if (result?.success) {
          toast.success('Authentication successful', {
            description: 'You can now use this MCP server.',
            duration: 5000,
          });
          // Re-test the connection to update status
          await mcpSettingsStore.testServerConnection(server.name, server.url, server.headers);
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
    return isServerInstalled(option.label, servers);
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

      const config: McpServerConfig = {
        name: serverName,
        type: 'stdio',
        command: option.command,
        args: args.length > 0 ? args : undefined,
        env: Object.keys(env).length > 0 ? env : undefined,
      };

      await mcpSettingsStore.addServer(config);
      activeConfig = null;
      userInputValues = {};
      await loadSettingsFile();
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
    const count = await mcpSettingsStore.importFromJson(json);
    importedCount = count;
    showAddPanel = false;
    showImportSuccess = true;
    setTimeout(() => (showImportSuccess = false), 3000);
    await loadSettingsFile();
  }

  async function handleSaveAdvanced() {
    if (!window.electronAPI) return;
    try {
      JSON.parse(userMcpSettingsContent);
    } catch {
      userMcpSaveStatus = 'error';
      userMcpSaveError = 'Invalid JSON format';
      return;
    }

    userMcpSaveStatus = 'saving';
    userMcpSaveError = '';

    try {
      const result = await window.electronAPI.invoke('user-mcp:write-settings-file', {
        content: userMcpSettingsContent,
      });
      if (result?.success) {
        userMcpSaveStatus = 'saved';
        await mcpSettingsStore.loadServers();
        setTimeout(() => (userMcpSaveStatus = 'idle'), 2000);
      } else {
        userMcpSaveStatus = 'error';
        userMcpSaveError = result?.error || 'Failed to save';
      }
    } catch (err) {
      userMcpSaveStatus = 'error';
      userMcpSaveError = err instanceof Error ? err.message : 'Unknown error';
    }
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
            onclick={(e) => { handleLink('https://docs.augmentcode.com/windsurf/mcp', { workspaceId: workspaceStore.current?.id, event: e }); }}
          >Learn more ↗</button>
        </p>
      </div>
      <Switch checked={enabled} onCheckedChange={handleToggleEnabled} size="md" />
    </div>
    {#if !isAuggieProvider}
      <p class="text-xs text-subtle mt-2">
        MCP servers are used by Auggie agents. Switch to Auggie as your provider to use custom MCP servers.
      </p>
    {/if}
  </section>

  {#if enabled}
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
              {servers.length} server{servers.length !== 1 ? 's' : ''} configured
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
                <McpServerForm onSubmit={handleAddServer} onCancel={handleCancelAdd} existingServerNames={servers.map(s => s.name)} />
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
          {#if loading}
            <!-- Skeleton loaders for configured servers -->
            <div class="space-y-3 mb-6">
              {#each [1, 2] as _}
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
                {#each [1, 2, 3, 4, 5, 6] as _}
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
          {:else if error}
            <p class="text-sm text-destructive-foreground py-4">{error}</p>
          {:else if servers.length === 0}
            <div class="text-xs text-subtle mb-4">
              <p>No custom MCP servers configured yet.</p>
              <p class="mt-1">Add servers to give Auggie agents access to external tools and data.
                <button
                  type="button"
                  class="text-primary hover:underline cursor-pointer"
                  onclick={(e) => { handleLink('https://docs.augmentcode.com/windsurf/mcp', { workspaceId: workspaceStore.current?.id, event: e }); }}
                >Learn how ↗</button>
              </p>
            </div>
          {:else}
            <div class="mb-6">
              {#each servers as server (server.name)}
                <McpServerCard
                  {server}
                  onToggle={handleToggleServer}
                  onEdit={handleEditServer}
                  onDelete={handleDeleteServer}
                  onReauthenticate={handleReauthenticate}
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
                    <button
                      type="button"
                      class="w-full flex items-center gap-3 py-2.5 px-1 rounded-md
                             transition-colors cursor-pointer
                             {installed ? 'opacity-50' : ''}"
                      onclick={() => startInstall(option)}
                      disabled={installed || installing}
                    >
                      <McpIcon iconName={option.iconName} label={option.label} size={20} />

                      <div class="flex-1 min-w-0 text-left">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium truncate">{option.label}</span>
                          {#if installed}
                            <span class="text-ui text-green-600 font-medium"> Installed </span>
                          {/if}
                        </div>
                        <p class="text-xs text-subtle truncate">{option.description}</p>
                      </div>

                      <div class="shrink-0 text-subtle">
                        {#if installing}
                          <div
                            class="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"
                          ></div>
                        {:else if installed}
                          <Fa icon={faCheck} size="sm" class="text-green-500" />
                        {:else}
                          <Fa icon={faPlus} size="sm" />
                        {/if}
                      </div>
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>

      <!-- Advanced: Settings JSON Editor -->
      <section class="bg-card rounded-xl overflow-hidden">
        <button
          type="button"
          class="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
          onclick={() => (showAdvanced = !showAdvanced)}
        >
          <div class="text-left">
            <p class="text-sm font-medium text-foreground">Advanced: Edit Settings File</p>
            <p class="text-xs text-subtle">
              Directly edit <code class="bg-muted px-1 py-0.5 rounded text-xs"
                >{userMcpSettingsPath || '~/.augment/settings.json'}</code
              >
            </p>
          </div>
          <span
            class="text-subtle text-xs transition-transform {showAdvanced
              ? 'rotate-90'
              : ''}">▶</span
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
                {#if userMcpSaveStatus === 'saved'}
                  <span class="text-xs text-green-500">✓ Saved</span>
                {:else if userMcpSaveStatus === 'error'}
                  <span class="text-xs text-destructive-foreground">✗ {userMcpSaveError}</span>
                {:else if userMcpSaveStatus === 'saving'}
                  <span class="text-xs text-subtle">Saving...</span>
                {/if}
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json"
                  class="text-xs text-primary hover:underline"
                  onclick={(e) => { e.preventDefault(); handleLink('https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json', { workspaceId: workspaceStore.current?.id, event: e }); }}
                >
                  Documentation ↗
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={handleSaveAdvanced}
                  disabled={userMcpSaveStatus === 'saving'}
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
