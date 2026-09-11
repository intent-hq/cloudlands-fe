<script lang="ts">
  import {
    Button,
    Header,
    Input,
    IntentMarkLoader,
    Skeleton,
    Textarea,
  } from '$lib/components/patterns/settings/custom-controls';
  import { logger } from '../../../shared/logger';
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
  import { ListView } from '$lib/components/patterns/collection';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
  } from '$lib/components/patterns/settings';
  import { crispOut, springIn } from '$lib/motion';
  import { faCheck, faCopy, faPlus, faRotateRight } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { notify, withToastCountdown } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { handleLink } from '$features/navigation/link-handler';
  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
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
    restartServer,
    authenticateServer,
    saveAdvancedJson,
  } from '$store/renderer/slices/mcp-settings/mcp-settings-slice';

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;
  const servers$ = selectMcpServersWithStatus();
  const loading$ = selectMcpLoading();
  const error$ = selectMcpError();
  const enabled$ = selectMcpEnabled();
  const lastImportedCount$ = selectMcpLastImportedCount();
  const advancedSaveStatus$ = selectMcpAdvancedSaveStatus();
  const advancedSaveError$ = selectMcpAdvancedSaveError();

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
  // i18n-ignore (configuration example)
  const mcpJsonPlaceholder = '{"mcpServers": {}}';

  const diagnosticCommand = 'auggie mcp list';

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
      const {
        name,
        status: _status,
        tools: _tools,
        toolCount: _toolCount,
        errorMessage: _err,
        disabled,
        ...config
      } = server;
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
      notify.success(m.settings_mcpServers_diagnosticCopied());
    } catch (copyError) {
      logger.error('Failed to copy MCP diagnostic command:', copyError);
      notify.error(m.settings_mcpServers_diagnosticCopyError());
    }
  }

  function handleToggleServer(name: string) {
    appStore.dispatch(toggleServer(name));
  }

  function handleRestartServer(name: string) {
    appStore.dispatch(restartServer(name));
    notify.info(m.settings_mcpServers_restartingToast({ name }), {
      description: m.settings_mcpServers_restartingDescription(),
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
    notify.warning(
      m.settings_mcpServers_deletedToast({ name }),
      withToastCountdown(
        {
          action: {
            label: m.settings_mcpServers_undo(),
            onClick: () => {
              appStore.dispatch(addServer(serverConfig));
              loadSettingsFile();
            },
          },
          duration: 5000,
        },
        { pauseOnHover: false },
      ),
    );
  }

  function handleReauthenticate(name: string) {
    appStore.dispatch(authenticateServer(name));
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
      installError = e instanceof Error ? e.message : m.settings_mcpServers_installFailed();
    } finally {
      installingServer = null;
    }
  }

  function handleSubmitInputs() {
    if (!activeConfig) return;

    for (const input of activeConfig.userInput || []) {
      const key = input.envVarName || input.correspondingArg || input.label;
      if (!userInputValues[key] && !input.defaultValue) {
        installError = m.settings_mcpServers_inputRequired({ label: input.label });
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

  const enabledSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'mcp-servers',
          title: m.settings_mcpServers_title(),
          entries: [
            {
              kind: 'switch',
              id: 'mcp-servers-enabled',
              label: m.settings_mcpServers_title(),
              get: () => $enabled$,
              set: handleToggleEnabled,
            },
          ],
        },
      ],
    }),
  );

  const configuredSchema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'mcp-configured',
          title: m.settings_mcpServers_sectionTitle(),
          entries: [
            {
              kind: 'custom',
              id: 'mcp-configured-servers',
              label: m.settings_mcpServers_sectionTitle(),
              description:
                $servers$.length === 1
                  ? m.settings_mcpServers_serverCount_one()
                  : m.settings_mcpServers_serverCount_many({
                      count: formatInteger($servers$.length),
                    }),
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet mcpDescription()}
  <span class="block">{m.settings_mcpServers_description()}</span>
  <span class="block">{m.settings_mcpServers_newAgentsOnlyNote()}</span>
{/snippet}

{#snippet configuredServersControl()}
  {#if showAddPanel}
    <Button variant="link" size="sm" onclick={() => (showAddPanel = false)}>
      {m.settings_mcpServers_cancel()}
    </Button>
  {:else}
    <Button variant="secondary" size="sm" onclick={() => (showAddPanel = true)}>
      <Fa icon={faPlus} class="mr-1.5" size="xs" />
      {m.settings_mcpServers_addNew()}
    </Button>
  {/if}
{/snippet}

<section class="bg-card rounded-xl divide-y divide-border overflow-hidden">
  <!-- Enable User MCP Servers Toggle -->
  <div class="px-6">
    <SettingsForm
      schema={enabledSchema}
      embedded
      descriptions={{ 'mcp-servers-enabled': mcpDescription }}
    />
  </div>

  {#if $enabled$}
    <div
      in:springIn={{ tier: 'moderate', y: -4 }}
      out:crispOut={{ tier: 'moderate' }}
      class="px-6 py-5 space-y-6"
    >
      <!-- Combined MCP Servers Section -->
      <section>
        <!-- Header with Add button -->
        <SettingsForm
          schema={configuredSchema}
          embedded
          custom={defineSettingsCustomControls({
            'mcp-configured-servers': configuredServersControl,
          })}
        />

        <!-- Expandable Add Panel -->
        {#if showAddPanel}
          <div
            in:springIn={{ tier: 'moderate', y: -4 }}
            out:crispOut={{ tier: 'moderate' }}
            class="border-b border-border"
          >
            <div class="py-4">
              <Header size={2} title={m.settings_mcpServers_addPanelTitle()} class="mb-3" />
              <!-- Mode Toggle -->
              <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit mb-4">
                <Button
                  variant="ghost"
                  type="button"
                  class="px-3 py-1.5 type-body rounded-md transition-colors cursor-pointer {addMode ===
                  'form'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (addMode = 'form')}
                >
                  {m.settings_mcpServers_modeConfigure()}
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  class="px-3 py-1.5 type-body rounded-md transition-colors cursor-pointer {addMode ===
                  'import'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => (addMode = 'import')}
                >
                  {m.settings_mcpServers_modeImportJson()}
                </Button>
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
          <div
            in:springIn={{ tier: 'moderate', y: -4 }}
            out:crispOut={{ tier: 'moderate' }}
            class="border-b border-border bg-muted/20"
          >
            <div class="py-4">
              <h3 class="type-body font-medium mb-4">
                {m.settings_mcpServers_editServerTitle({ name: editingServer.name })}
              </h3>
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
        <div class="py-4">
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
            <div class="pt-4">
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
            <div class="mb-4 rounded-lg border border-danger/30 bg-danger-background/5 p-4">
              <div class="space-y-1">
                <p class="type-body font-medium text-foreground">
                  {m.settings_mcpServers_loadError()}
                </p>
                <p class="type-body text-danger">{$error$}</p>
              </div>

              <div class="mt-3 rounded-md border border-border bg-background/70 p-3">
                <p class="type-body text-muted-foreground">
                  {m.settings_mcpServers_diagnosticCommand()}
                </p>
                <code class="mt-1 block break-all type-caption text-foreground"
                  >{diagnosticCommand}</code
                >
              </div>

              <div class="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onclick={handleRetryLoadServers}>
                  <Fa icon={faRotateRight} size="xs" />
                  <span class="ml-2">{m.settings_mcpServers_retry()}</span>
                </Button>

                <Button variant="outline" size="sm" onclick={handleCopyDiagnosticCommand}>
                  <Fa icon={faCopy} size="xs" />
                  <span class="ml-2">{m.settings_mcpServers_copyCommand()}</span>
                </Button>
              </div>

              <p class="mt-3 type-body text-muted-foreground">
                {m.settings_mcpServers_diagnosticHint()}
              </p>
            </div>
          {:else if $servers$.length === 0}
            <div class="type-caption text-subtle mb-4">
              <p>{m.settings_mcpServers_emptyTitle()}</p>
              <p class="mt-1">
                {m.settings_mcpServers_emptyDescription()}
                <Button
                  variant="ghost"
                  type="button"
                  class="text-primary-ink hover:underline cursor-pointer"
                  onclick={(e) => {
                    handleLink('https://docs.augmentcode.com/setup-augment/mcp', {
                      workspaceId,
                      event: e,
                    });
                  }}>{m.settings_mcpServers_learnHow()}</Button
                >
              </p>
            </div>
          {:else}
            <ListView
              items={$servers$}
              getKey={(server) => server.name}
              getText={(server) => server.name}
              ariaLabel={m.settings_mcpServers_sectionTitle()}
              class="mb-6"
            >
              {#snippet row({ item: server })}
                <McpServerCard
                  {server}
                  onToggle={handleToggleServer}
                  onEdit={handleEditServer}
                  onDelete={handleDeleteServer}
                  onReauthenticate={handleReauthenticate}
                  onRestart={handleRestartServer}
                />
              {/snippet}
            </ListView>
          {/if}

          <!-- Easy MCP Installation (below configured servers) -->
          <div class="pt-4">
            <div class="flex items-center gap-2 mb-3">
              <span class="type-body font-medium text-foreground"
                >{m.settings_mcpServers_quickInstall()}</span
              >
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
                        <span class="font-medium type-body">{option.label}</span>
                      </div>

                      {#each option.userInput || [] as input}
                        {@const inputKey =
                          input.envVarName || input.correspondingArg || input.label}
                        <div class="mb-2">
                          <span class="block type-caption text-subtle mb-1">
                            {input.label}
                          </span>
                          <Input
                            bind:value={userInputValues[inputKey]}
                            placeholder={input.placeholder}
                            class="h-8 type-body"
                          />
                          {#if input.description}
                            <p class="type-body text-subtle mt-0.5">{input.description}</p>
                          {/if}
                        </div>
                      {/each}

                      {#if installError}
                        <p class="type-body text-danger mb-2">{installError}</p>
                      {/if}

                      <div class="flex gap-2 mt-3">
                        <Button size="sm" variant="ghost" onclick={cancelInputs}>
                          {m.settings_mcpServers_cancel()}
                        </Button>
                        <Button size="sm" onclick={handleSubmitInputs} disabled={installing}>
                          {installing
                            ? m.settings_mcpServers_installing()
                            : m.settings_mcpServers_install()}
                        </Button>
                      </div>
                    </div>
                  {:else}
                    <!-- Preset option button -->
                    <div
                      class="w-full flex items-center gap-3 py-2.5 px-1 rounded-md transition-colors"
                    >
                      <Button
                        variant="ghost"
                        type="button"
                        class="flex-1 flex items-center gap-3 min-w-0 cursor-pointer"
                        onclick={() => startInstall(option)}
                        disabled={(installed && !needsAuth) || installing}
                      >
                        <McpIcon iconName={option.iconName} label={option.label} size={20} />

                        <div class="flex-1 min-w-0 text-left">
                          <div class="flex items-center gap-2">
                            <span class="type-body font-medium truncate">{option.label}</span>
                            {#if needsAuth}
                              <span class="type-caption text-warning-ink font-medium">
                                {m.settings_mcp_status_needsAuth()}
                              </span>
                            {:else if installed}
                              <span class="type-caption text-green-600 font-medium">
                                {m.settings_mcpServers_installed()}
                              </span>
                            {/if}
                          </div>
                          <p class="type-body text-subtle truncate">{option.description}</p>
                        </div>
                      </Button>

                      <div class="shrink-0 flex items-center gap-2">
                        {#if installing}
                          <IntentMarkLoader size={16} class="text-muted-foreground" />
                        {:else if needsAuth}
                          <Button
                            variant="ghost"
                            type="button"
                            class="px-3 py-1 type-body font-medium rounded-md border border-warning/30 text-warning-ink hover:bg-warning/10 transition-colors cursor-pointer"
                            onclick={() => handleReauthenticate(normalizeServerName(option.label))}
                          >
                            {m.settings_mcp_authenticateButton()}
                          </Button>
                        {:else if installed}
                          <Fa icon={faCheck} size="sm" class="text-green-500" />
                        {:else}
                          <Button
                            variant="ghost"
                            type="button"
                            class="p-1 rounded-md hover:bg-muted transition-colors cursor-pointer"
                            onclick={() => startInstall(option)}
                          >
                            <Fa icon={faPlus} size="sm" class="text-subtle" />
                          </Button>
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
      <section>
        <Button
          variant="ghost"
          type="button"
          class="w-full flex items-center justify-between py-4 hover:bg-muted/30 transition-colors cursor-pointer"
          onclick={handleToggleAdvanced}
        >
          <div class="text-left">
            <p class="type-body font-medium text-foreground">
              {m.settings_mcpServers_advancedTitle()}
            </p>
            <p class="type-body text-subtle">
              {m.settings_mcpServers_advancedDescription_before()}
              <!-- i18n-ignore (config key) -->
              <code class="bg-muted px-1 py-0.5 rounded type-caption">mcp.servers</code>
              {m.settings_mcpServers_advancedDescription_after()}
            </p>
          </div>
          <span
            class="text-subtle type-caption transition-transform {showAdvanced ? 'rotate-90' : ''}"
            >▶</span
          >
        </Button>

        {#if showAdvanced}
          <div
            in:springIn={{ tier: 'moderate', y: -4 }}
            out:crispOut={{ tier: 'moderate' }}
            class="pb-4 space-y-3 border-t border-border pt-4"
          >
            <Textarea
              class="w-full h-64 px-3 py-2 bg-background border border-border rounded-md type-body font-mono text-foreground resize-y focus:outline-none focus:border-primary-ink focus:ring-2 focus:ring-primary-ink/10"
              placeholder={mcpJsonPlaceholder}
              aria-label={m.settings_mcpServers_jsonEditorAriaLabel()}
              bind:value={userMcpSettingsContent}
            ></Textarea>

            <div class="flex items-center justify-between gap-4">
              <div class="flex items-center gap-2">
                {#if $advancedSaveStatus$ === 'saved'}
                  <span class="type-caption text-green-500"
                    >{m.settings_mcpServers_savedIndicator()}</span
                  >
                {:else if $advancedSaveStatus$ === 'error'}
                  <span class="type-caption text-danger"
                    >✗ {$advancedSaveError$ || m.settings_mcpServers_saveFailed()}</span
                  >
                {:else if $advancedSaveStatus$ === 'saving'}
                  <span class="type-caption text-subtle">{m.settings_mcpServers_saving()}</span>
                {/if}
              </div>
              <div class="flex items-center gap-3">
                <a
                  href="https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json"
                  class="type-caption text-primary-ink hover:underline"
                  onclick={(e) => {
                    e.preventDefault();
                    handleLink(
                      'https://docs.augmentcode.com/cli/integrations#configure-mcp-via-settings-json',
                      { workspaceId, event: e },
                    );
                  }}
                >
                  {m.settings_mcpServers_documentation()}
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  onclick={handleSaveAdvanced}
                  disabled={$advancedSaveStatus$ === 'saving'}
                >
                  {m.settings_mcpServers_saveSettings()}
                </Button>
              </div>
            </div>
          </div>
        {/if}
      </section>
    </div>
  {/if}
</section>

<!-- Import success toast -->
{#if showImportSuccess}
  <div
    class="fixed bottom-4 right-4 px-4 py-3 bg-green-600 text-white type-body rounded-lg shadow-lg z-50"
    in:springIn={{ tier: 'fast', y: 4 }}
    out:crispOut={{ tier: 'fast' }}
  >
    {importedCount === 1
      ? m.settings_mcpServers_importSuccess_one()
      : m.settings_mcpServers_importSuccess_many({ count: formatInteger(importedCount) })}
  </div>
{/if}
