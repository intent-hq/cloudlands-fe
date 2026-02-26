<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Label from '$lib/components/ui/label/label.svelte';
  import Fa from 'svelte-fa';
  import {
    faXmark,
    faServer,
    faCheck,
    faTimes,
    faSpinner,
    faExclamationTriangle,
    faKey,
  } from '@fortawesome/free-solid-svg-icons';
  import { fade, scale } from 'svelte/transition';
  import { flyConfig, scaleConfig } from '$lib/utils/animations';
  import { createLogger } from '$lib/utils/client-logger';
  import { portal } from '$lib/actions/portal';
  import { invoke } from '$lib/electron-bridge';
  import { onMount } from 'svelte';

  interface Props {
    isOpen: boolean;
    onclose: () => void;
    onsave: (setup: RemoteSetup) => void;
  }

  interface RemoteSetup {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    keyPath?: string;
    useAgent?: boolean;
    workspacePath: string;
    transport?: 'ssh' | 'websocket';
    wsUrl?: string;
    branch?: string;
  }

  // SSH Config host from parsing ~/.ssh/config
  interface SSHConfigHost {
    name: string;
    hostname: string;
    user?: string;
    port?: number;
    identityFile?: string;
  }

  // SSH key info from discovery
  interface SSHKeyInfo {
    path: string;
    name: string;
    fingerprint?: string;
  }

  // SSH Agent identity
  interface SSHAgentIdentity {
    fingerprint: string;
    comment: string;
    type: string;
  }

  // Test connection result
  interface TestConnectionResult {
    success: boolean;
    checks: {
      ssh: { passed: boolean; error?: string };
      shell: { passed: boolean; error?: string };
      git: { passed: boolean; version?: string; error?: string };
      repo: { passed: boolean; error?: string };
      branch?: { passed: boolean; error?: string };
      node: { passed: boolean; version?: string; error?: string };
      auggie: { passed: boolean; path?: string; error?: string };
    };
    warnings: {
      gitVersion?: string;
      nodeVersion?: string;
      diskSpace?: string;
    };
  }

  type TestStatus = 'untested' | 'testing' | 'passed' | 'failed' | 'stale';
  type AuthMode = 'agent' | 'keyfile' | 'password';

  let { isOpen, onclose, onsave }: Props = $props();

  const logger = createLogger('AddRemoteSetupModal');

  // Form state
  let name = $state('');
  let transport = $state<'ssh' | 'websocket'>('ssh');
  let host = $state('');
  let port = $state(22);
  let wsUrl = $state('');
  let username = $state('');
  let password = $state('');
  let keyPath = $state('');
  let selectedKeyOption = $state('');
  let manualKeyEntry = $state(false);
  let authMode = $state<AuthMode>('agent');
  let workspacePath = $state('');
  let branch = $state('main');
  let error = $state('');

  // SSH config and discovery state
  let sshConfigHosts = $state<SSHConfigHost[]>([]);
  let sshKeys = $state<SSHKeyInfo[]>([]);
  let agentStatus = $state<{
    available: boolean;
    identities: SSHAgentIdentity[];
    error?: string;
  }>({ available: false, identities: [] });
  let selectedConfigHost = $state<string>('');
  let isLoadingConfig = $state(false);

  // Test connection state
  let testStatus = $state<TestStatus>('untested');
  let testResult = $state<TestConnectionResult | null>(null);
  let testErrorMessage = $state('');

  // Track which fields have been edited since last test
  let fieldsEditedSinceTest = $state<Set<string>>(new Set());

  // Validation state - now requires test to pass
  const isFormValid = $derived(
    name.trim() !== '' &&
      (transport === 'ssh'
        ? host.trim() !== '' && port > 0 && port <= 65535
        : wsUrl.trim() !== '') &&
      username.trim() !== '' &&
      workspacePath.trim() !== '',
  );

  const canSave = $derived(isFormValid && testStatus === 'passed');

  // Load SSH config and keys when modal opens
  $effect(() => {
    if (isOpen) {
      loadSSHConfig();
    }
  });

  async function loadSSHConfig() {
    isLoadingConfig = true;
    try {
      // Load SSH config hosts
      const configResult = await invoke<{
        success: boolean;
        hosts: SSHConfigHost[];
        error?: string;
      }>('ssh:get-config-hosts');
      if (configResult.success) {
        sshConfigHosts = configResult.hosts;
      }

      // Load SSH keys
      const keysResult = await invoke<{
        success: boolean;
        keys: SSHKeyInfo[];
        error?: string;
      }>('ssh:list-keys');
      if (keysResult.success) {
        sshKeys = keysResult.keys;
      }

      // Load SSH agent status
      const agentResult = await invoke<{
        success: boolean;
        available: boolean;
        identities: SSHAgentIdentity[];
        error?: string;
      }>('ssh:get-agent-status');
      if (agentResult.success) {
        agentStatus = {
          available: agentResult.available,
          identities: agentResult.identities,
          error: agentResult.error,
        };
        // Default to agent if available, otherwise keyfile
        if (agentResult.available && agentResult.identities.length > 0) {
          authMode = 'agent';
        } else if (sshKeys.length > 0) {
          authMode = 'keyfile';
          keyPath = sshKeys[0].path;
          selectedKeyOption = sshKeys[0].path;
        }
      }
    } catch (err) {
      logger.warn('Failed to load SSH config', { error: err });
    } finally {
      isLoadingConfig = false;
    }
  }

  function handleConfigHostSelect(hostName: string) {
    selectedConfigHost = hostName;

    if (hostName === '') {
      // Manual configuration
      return;
    }

    const configHost = sshConfigHosts.find((h) => h.name === hostName);
    if (configHost) {
      name = configHost.name;
      host = configHost.hostname;
      port = configHost.port || 22;
      if (configHost.user) {
        username = configHost.user;
      }
      if (configHost.identityFile) {
        keyPath = configHost.identityFile;
        authMode = 'keyfile';
        // Check if this key is in the discovered sshKeys list
        if (sshKeys.some((k) => k.path === configHost.identityFile)) {
          selectedKeyOption = configHost.identityFile;
          manualKeyEntry = false;
        } else {
          // Key not in list — show manual input with the path pre-filled
          selectedKeyOption = '';
          manualKeyEntry = true;
        }
      }
      // Invalidate test if we had one
      markFieldEdited('host');
    }
  }

  function markFieldEdited(field: string) {
    if (testStatus === 'passed') {
      fieldsEditedSinceTest.add(field);
      testStatus = 'stale';
    }
  }

  async function runTestConnection() {
    if (!isFormValid) {
      testErrorMessage = 'Please fill in all required fields first';
      return;
    }

    testStatus = 'testing';
    testResult = null;
    testErrorMessage = '';
    fieldsEditedSinceTest.clear();

    try {
      const result = await invoke<TestConnectionResult>('ssh:test-connection', {
        host,
        port,
        username,
        password: authMode === 'password' ? password : undefined,
        privateKeyPath: authMode === 'keyfile' ? keyPath : undefined,
        useAgent: authMode === 'agent',
        transport,
        wsUrl: transport === 'websocket' ? wsUrl : undefined,
        repositoryPath: workspacePath,
        branch: branch.trim() || undefined,
      });

      testResult = result;
      testStatus = result.success ? 'passed' : 'failed';

      if (!result.success) {
        // Find the first failed check to show as main error
        const failedCheck = Object.entries(result.checks).find(([, v]) => !v.passed && v.error);
        if (failedCheck) {
          testErrorMessage = failedCheck[1].error || 'Connection test failed';
        }
      }
    } catch (err) {
      testStatus = 'failed';
      testErrorMessage = err instanceof Error ? err.message : 'Connection test failed';
    }
  }

  function handleSave() {
    if (!canSave) {
      if (testStatus !== 'passed') {
        error = 'Please run Test Connection first';
      } else {
        error = 'Please fill in all required fields';
      }
      return;
    }

    const newSetup: RemoteSetup = {
      id: crypto.randomUUID(),
      name: name.trim(),
      host: transport === 'ssh' ? host.trim() : '',
      port: transport === 'ssh' ? port : 0,
      username: username.trim(),
      password: authMode === 'password' ? password.trim() : undefined,
      keyPath: authMode === 'keyfile' ? keyPath.trim() : undefined,
      useAgent: authMode === 'agent',
      workspacePath: workspacePath.trim(),
      transport,
      wsUrl: transport === 'websocket' ? wsUrl.trim() : undefined,
      branch: branch.trim() || undefined,
    };

    logger.info('Saving new remote setup', { name: newSetup.name, transport: newSetup.transport });
    onsave(newSetup);
    resetForm();
    onclose();
  }

  function resetForm() {
    name = '';
    transport = 'ssh';
    host = '';
    port = 22;
    wsUrl = '';
    username = '';
    password = '';
    keyPath = '';
    selectedKeyOption = '';
    manualKeyEntry = false;
    authMode = agentStatus.available && agentStatus.identities.length > 0 ? 'agent' : 'keyfile';
    workspacePath = '';
    branch = 'main';
    error = '';
    selectedConfigHost = '';
    testStatus = 'untested';
    testResult = null;
    testErrorMessage = '';
    fieldsEditedSinceTest.clear();
  }

  function handleClose() {
    resetForm();
    onclose();
  }

  function getCheckIcon(passed: boolean) {
    return passed ? faCheck : faTimes;
  }

  function getCheckColor(passed: boolean) {
    return passed ? 'text-green-500' : 'text-red-500';
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[9999] flex items-center justify-center" use:portal={'body'}>
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 bg-black/50 cursor-default"
      onclick={handleClose}
      aria-label="Close modal"
      transition:fade={{ duration: 150 }}
    ></button>

    <!-- Modal -->
    <div
      class="relative bg-sidebar border border-border shadow-xs w-full max-w-lg max-h-[90vh] overflow-y-auto px-12 py-8"
      transition:scale={scaleConfig()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold flex items-center gap-2">
          <Fa icon={faServer} class="text-muted-foreground" />
          Add Remote Setup
        </h2>
        <Button onclick={handleClose} variant="ghost" size="icon">
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="space-y-4">
        <!-- SSH Config Host Selector -->
        {#if transport === 'ssh'}
          <div>
            <Label for="configHost">Import from SSH Config</Label>
            {#if isLoadingConfig}
              <div class="mt-1 text-sm text-muted-foreground">Loading SSH config...</div>
            {:else if sshConfigHosts.length > 0}
              <select
                id="configHost"
                class="mt-1 w-full h-9 px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                bind:value={selectedConfigHost}
                onchange={(e) => handleConfigHostSelect(e.currentTarget.value)}
              >
                <option value="">Manual configuration</option>
                {#each sshConfigHosts as configHost}
                  <option value={configHost.name}>
                    {configHost.name} ({configHost.hostname})
                  </option>
                {/each}
              </select>
            {:else}
              <div class="mt-1 text-xs text-muted-foreground">
                No hosts found in ~/.ssh/config. Enter details manually below.
              </div>
            {/if}
          </div>
        {/if}

        <div>
          <Label for="name">Setup Name *</Label>
          <Input
            id="name"
            bind:value={name}
            placeholder="e.g., Dev Server"
            class="mt-1"
            oninput={() => markFieldEdited('name')}
          />
        </div>

        <!-- Connection Details -->
        <div class="space-y-3">
          <h3 class="text-sm font-medium">Connection Details</h3>

          <!-- Transport type selector -->
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport === 'ssh'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
              onclick={() => {
                if (transport !== 'ssh') {
                  // Reset all fields when switching to SSH
                  name = '';
                  host = '';
                  port = 22;
                  authMode = agentStatus.available && agentStatus.identities.length > 0 ? 'agent' : 'keyfile';
                  keyPath = '';
                  selectedKeyOption = '';
                  manualKeyEntry = false;
                  password = '';
                  selectedConfigHost = '';
                  workspacePath = '';
                  // Reset test state since connection params changed
                  testStatus = 'untested';
                  testResult = null;
                  testErrorMessage = '';
                  fieldsEditedSinceTest.clear();
                  transport = 'ssh';
                }
              }}
            >
              SSH
            </button>
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm rounded-md border transition-colors {transport === 'websocket'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:bg-muted'}"
              onclick={() => {
                if (transport !== 'websocket') {
                  // Reset all fields when switching to WebSocket
                  name = '';
                  wsUrl = '';
                  username = '';
                  workspacePath = '';
                  // Clear SSH auth fields since WebSocket doesn't use them
                  authMode = 'agent';
                  keyPath = '';
                  selectedKeyOption = '';
                  manualKeyEntry = false;
                  password = '';
                  // Reset test state since connection params changed
                  testStatus = 'untested';
                  testResult = null;
                  testErrorMessage = '';
                  fieldsEditedSinceTest.clear();
                  transport = 'websocket';
                }
              }}
            >
              WebSocket
            </button>
          </div>

          {#if transport === 'ssh'}
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label for="host">Host *</Label>
                <Input
                  id="host"
                  bind:value={host}
                  placeholder="dev.example.com"
                  class="mt-1"
                  oninput={() => markFieldEdited('host')}
                />
              </div>
              <div>
                <Label for="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  bind:value={port}
                  placeholder="22"
                  class="mt-1"
                  oninput={() => markFieldEdited('port')}
                />
              </div>
            </div>
          {:else}
            <div>
              <Label for="wsUrl">WebSocket URL *</Label>
              <Input
                id="wsUrl"
                bind:value={wsUrl}
                placeholder="wss://dev.example.com/ws"
                class="mt-1"
                oninput={() => markFieldEdited('wsUrl')}
              />
            </div>
          {/if}

          <div>
            <Label for="username">Username *</Label>
            <Input
              id="username"
              bind:value={username}
              placeholder="john"
              class="mt-1"
              oninput={() => markFieldEdited('username')}
            />
          </div>
        </div>

        <!-- Authentication (SSH only) -->
        {#if transport === 'ssh'}
          <div class="space-y-3">
            <h3 class="text-sm font-medium">Authentication</h3>

            <!-- Auth mode radio buttons -->
            <div class="space-y-2">
              <!-- SSH Agent option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'agent'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="agent"
                  checked={authMode === 'agent'}
                  onchange={() => {
                    authMode = 'agent';
                    markFieldEdited('authMode');
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <Fa icon={faKey} class="text-muted-foreground text-xs" />
                    <span class="text-sm font-medium">SSH Agent</span>
                    {#if agentStatus.available}
                      <span class="text-xs text-green-600 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded">
                        {agentStatus.identities.length} {agentStatus.identities.length === 1 ? 'key' : 'keys'} loaded
                      </span>
                    {:else}
                      <span class="text-xs text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 px-1.5 py-0.5 rounded">
                        Not available
                      </span>
                    {/if}
                  </div>
                  {#if authMode === 'agent' && agentStatus.identities.length > 0}
                    <div class="mt-1 text-xs text-muted-foreground space-y-0.5">
                      {#each agentStatus.identities.slice(0, 3) as identity}
                        <div class="truncate">
                          {identity.comment || identity.fingerprint.slice(0, 20)}... ({identity.type})
                        </div>
                      {/each}
                      {#if agentStatus.identities.length > 3}
                        <div>+{agentStatus.identities.length - 3} more</div>
                      {/if}
                    </div>
                  {/if}
                </div>
              </label>

              <!-- Key file option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'keyfile'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="keyfile"
                  checked={authMode === 'keyfile'}
                  onchange={() => {
                    authMode = 'keyfile';
                    markFieldEdited('authMode');
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <span class="text-sm font-medium">Key File</span>
                  {#if authMode === 'keyfile'}
                    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <!-- stopPropagation prevents clicks on interactive elements from bubbling
                         to the parent <label>, which would steal focus to the radio button -->
                    <div class="mt-1" onclick={(e) => e.stopPropagation()}>

                      {#if sshKeys.length > 0}
                        <select
                          class="w-full h-8 px-2 text-sm rounded border border-input bg-background"
                          bind:value={selectedKeyOption}
                          onchange={() => {
                            markFieldEdited('keyPath');
                            if (selectedKeyOption === '') {
                              manualKeyEntry = true;
                              keyPath = '';
                            } else {
                              manualKeyEntry = false;
                              keyPath = selectedKeyOption;
                            }
                          }}
                        >
                          {#each sshKeys as key}
                            <option value={key.path}>
                              {key.name}
                              {#if key.fingerprint}({key.fingerprint.slice(0, 16)}...){/if}
                            </option>
                          {/each}
                          <option value="">Enter path manually...</option>
                        </select>
                      {/if}
                      {#if sshKeys.length === 0 || manualKeyEntry || selectedKeyOption === ''}
                        <Input
                          bind:value={keyPath}
                          placeholder="~/.ssh/id_rsa"
                          class="mt-1 h-8"
                          oninput={() => markFieldEdited('keyPath')}
                        />
                      {/if}
                    </div>
                  {/if}
                </div>
              </label>

              <!-- Password option -->
              <label
                class="flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors {authMode === 'password'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'}"
              >
                <input
                  type="radio"
                  name="authMode"
                  value="password"
                  checked={authMode === 'password'}
                  onchange={() => {
                    authMode = 'password';
                    markFieldEdited('authMode');
                  }}
                  class="mt-1"
                />
                <div class="flex-1">
                  <span class="text-sm font-medium">Password</span>
                  {#if authMode === 'password'}
                    <div class="mt-1">
                      <Input
                        type="password"
                        bind:value={password}
                        placeholder="••••••••"
                        class="h-8"
                        oninput={() => markFieldEdited('password')}
                      />
                    </div>
                  {/if}
                </div>
              </label>
            </div>
          </div>
        {:else}
          <!-- WebSocket info - no SSH auth needed -->
          <div class="text-sm text-muted-foreground bg-muted/50 px-3 py-2 rounded-md">
            <p>
              WebSocket connections use the authentication configured on the remote server.
              No SSH credentials are required.
            </p>
          </div>
        {/if}

        <!-- Repository Path -->
        <div>
          <Label for="workspacePath">Repository Path *</Label>
          <Input
            id="workspacePath"
            bind:value={workspacePath}
            placeholder="/home/user/myrepo"
            class="mt-1"
            oninput={() => markFieldEdited('workspacePath')}
          />
          <p class="text-xs text-muted-foreground mt-1">
            Path to the git repository on the remote server
          </p>
        </div>

        <!-- Branch Name -->
        <div>
          <Label for="branch">Branch Name</Label>
          <Input
            id="branch"
            bind:value={branch}
            placeholder="main"
            class="mt-1"
            oninput={() => markFieldEdited('branch')}
          />
          <p class="text-xs text-muted-foreground mt-1">
            Branch to check out on the remote server (defaults to main)
          </p>
        </div>

        <!-- Test Connection Section -->
        <div class="space-y-3 pt-2 border-t border-border">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium">Connection Test</h3>
            <Button
              onclick={runTestConnection}
              variant="outline"
              size="sm"
              disabled={!isFormValid || testStatus === 'testing'}
            >
              {#if testStatus === 'testing'}
                <Fa icon={faSpinner} class="animate-spin mr-2" />
                Testing...
              {:else if testStatus === 'passed'}
                <Fa icon={faCheck} class="text-green-500 mr-2" />
                Re-test
              {:else if testStatus === 'failed'}
                <Fa icon={faTimes} class="text-red-500 mr-2" />
                Retry
              {:else if testStatus === 'stale'}
                <Fa icon={faExclamationTriangle} class="text-yellow-500 mr-2" />
                Re-test
              {:else}
                Test Connection
              {/if}
            </Button>
          </div>

          {#if testStatus === 'stale'}
            <div class="text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded">
              <Fa icon={faExclamationTriangle} class="inline mr-1" />
              Connection details changed. Please re-test before saving.
            </div>
          {/if}

          {#if testStatus === 'untested'}
            <div class="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded">
              Test connection to verify the remote host is ready for use.
            </div>
          {/if}

          {#if testResult}
            <div class="space-y-1.5 text-sm">
              <!-- Critical checks -->
              {#each Object.entries(testResult.checks) as [name, check]}
                <div class="flex items-center gap-2">
                  <Fa icon={getCheckIcon(check.passed)} class={getCheckColor(check.passed)} />
                  <span class="capitalize">{name}</span>
                  {#if 'version' in check && check.version}
                    <span class="text-xs text-muted-foreground">({check.version})</span>
                  {/if}
                  {#if 'path' in check && check.path}
                    <span class="text-xs text-muted-foreground truncate max-w-[150px]">({check.path})</span>
                  {/if}
                  {#if !check.passed && check.error}
                    <span class="text-xs text-destructive truncate flex-1">{check.error}</span>
                  {/if}
                </div>
              {/each}

              <!-- Warnings -->
              {#if testResult.warnings.gitVersion || testResult.warnings.nodeVersion || testResult.warnings.diskSpace}
                <div class="mt-2 pt-2 border-t border-border space-y-1">
                  <div class="text-xs font-medium text-yellow-600">Warnings:</div>
                  {#if testResult.warnings.gitVersion}
                    <div class="flex items-center gap-2 text-xs text-yellow-600">
                      <Fa icon={faExclamationTriangle} />
                      {testResult.warnings.gitVersion}
                    </div>
                  {/if}
                  {#if testResult.warnings.nodeVersion}
                    <div class="flex items-center gap-2 text-xs text-yellow-600">
                      <Fa icon={faExclamationTriangle} />
                      {testResult.warnings.nodeVersion}
                    </div>
                  {/if}
                  {#if testResult.warnings.diskSpace}
                    <div class="flex items-center gap-2 text-xs text-yellow-600">
                      <Fa icon={faExclamationTriangle} />
                      {testResult.warnings.diskSpace}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}

          {#if testErrorMessage && testStatus === 'failed' && !testResult}
            <div class="text-sm text-destructive">
              {testErrorMessage}
            </div>
          {/if}
        </div>

        {#if error}
          <div class="text-sm text-destructive">{error}</div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-2 mt-6">
        <Button onclick={handleClose} variant="outline">Cancel</Button>
        <Button onclick={handleSave} disabled={!canSave}>
          {#if testStatus !== 'passed'}
            Test Required
          {:else}
            Add Setup
          {/if}
        </Button>
      </div>
    </div>
  </div>
{/if}
