<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { onMount } from 'svelte';
  import { Label } from '$lib/components/ui/label';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { invoke } from '$lib/electron-bridge';
  import { open } from '$lib/electron-bridge';
  import Fa from 'svelte-fa';
  import {
    faDesktop,
    faServer,
    faKey,
    faCircleCheck,
    faCircleXmark,
    faCircleNotch,
    faFolderOpen,
    faHistory,
    faLock,
  } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    environmentType?: 'local' | 'remote';
    sshConfig?: {
      host: string;
      port: number;
      user: string;
      password: string;
      keyPath: string;
      useAgent: boolean;
      workspacePath: string;
      transport?: 'ssh' | 'websocket';
      wsUrl?: string;
    };
  }

  let {
    environmentType = $bindable('local'),
    sshConfig = $bindable({
      host: '',
      port: 22,
      user: '',
      password: '',
      keyPath: '',
      useAgent: true,
      workspacePath: '/home/user/workspace',
      transport: undefined,
      wsUrl: undefined,
    }),
  } = $props();

  let testing = $state(false);
  let testResult: { success: boolean; message: string } | null = $state(null);
  let savedConfigs: any[] = $state([]);
  let showSavedConfigs = $state(false);

  onMount(() => {
    // Load saved SSH configs from localStorage
    const saved = localStorage.getItem('sshConfigs');
    if (saved) {
      try {
        savedConfigs = JSON.parse(saved);
      } catch (e) {
        logger.error('Failed to load saved SSH configs:', e);
      }
    }

    // Set default values for test environment if empty
    if (!sshConfig.host) {
      sshConfig.host = 'localhost';
      sshConfig.port = 2222;
      sshConfig.user = 'testuser';
      sshConfig.password = 'testpass'; // pragma: allowlist secret
      sshConfig.workspacePath = '/home/testuser/workspace';
    }
  });

  function saveCurrentConfig() {
    const configToSave = {
      ...sshConfig,
      password: '', // Don't save passwords for security
      savedAt: new Date().toISOString(),
      name: `${sshConfig.user}@${sshConfig.host}:${sshConfig.port}`,
    };

    // Remove duplicates and add new config
    savedConfigs = [
      configToSave,
      ...savedConfigs.filter(
        (c) => c.host !== sshConfig.host || c.port !== sshConfig.port || c.user !== sshConfig.user,
      ),
    ].slice(0, 5); // Keep only last 5

    localStorage.setItem('sshConfigs', JSON.stringify(savedConfigs));
  }

  function loadSavedConfig(config: any) {
    sshConfig = {
      ...config,
      password: '', // User must re-enter password
    };
    showSavedConfigs = false;
  }

  async function selectKeyFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Select SSH Key',
      filters: [
        {
          name: 'SSH Keys',
          extensions: ['pem', 'key', 'pub'],
        },
      ],
    });

    if (selected) {
      sshConfig.keyPath = selected as string;
    }
  }

  async function testConnection() {
    logger.info('Testing SSH connection with:', sshConfig);
    if (!sshConfig.host || !sshConfig.user) {
      testResult = {
        success: false,
        message: 'Please fill in host and user fields',
      };
      return;
    }

    testing = true;
    testResult = null;

    try {
      logger.info('Invoking test_ssh_connection with:', {
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.user,
        password: sshConfig.password ? '***' : null,
        privateKeyPath: sshConfig.keyPath || null,
        workspacePath: sshConfig.workspacePath,
      });

      // Build config object matching SSHConnectionConfig interface
      const config: any = {
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.user,
      };

      // Add authentication
      if (sshConfig.password) {
        config.password = sshConfig.password;
      } else if (sshConfig.keyPath) {
        config.privateKeyPath = sshConfig.keyPath;
      } else {
        config.useAgent = true;
      }

      const response: any = await invoke('test_ssh_connection', {
        config: config,
      });

      if (response.success) {
        testResult = {
          success: true,
          message: 'Connection successful!',
        };
        // Save this config for future use
        saveCurrentConfig();
      } else {
        testResult = {
          success: false,
          message: response.error || 'Connection failed',
        };
      }
    } catch (error) {
      testResult = {
        success: false,
        message: `Error: ${error}`,
      };
    } finally {
      testing = false;
    }
  }

  // Auto-detect SSH config from common patterns
  function autoDetectSSH() {
    // Check if host looks like a dev deployment
    if (sshConfig.host.includes('dev-') && sshConfig.host.includes('.ssh')) {
      sshConfig.workspacePath = '/workspace';
    }

    // Set default key path if not set
    if (!sshConfig.keyPath && sshConfig.useAgent) {
      // SSH agent will handle it
      sshConfig.keyPath = '';
    }
  }

  $effect(() => {
    if (sshConfig.host) {
      autoDetectSSH();
    }
  });
</script>

<div class="space-y-6">
  <div>
    <Label class="text-base font-medium mb-3 block">Execution Environment</Label>
    <div class="space-y-3">
      <label
        class="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <input type="radio" bind:group={environmentType} value="local" id="local" class="mt-1" />
        <div class="flex-1">
          <div class="flex items-center gap-2 font-medium">
            <Fa icon={faDesktop} size="sm" />
            Local Machine
          </div>
          <p class="text-sm text-muted-foreground mt-1">Run space on this computer</p>
        </div>
      </label>

      <label
        class="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <input type="radio" bind:group={environmentType} value="remote" id="remote" class="mt-1" />
        <div class="flex-1">
          <div class="flex items-center gap-2 font-medium">
            <Fa icon={faServer} size="sm" />
            Remote Machine (SSH)
          </div>
          <p class="text-sm text-muted-foreground mt-1">
            Connect to a remote server or dev deployment
          </p>
        </div>
      </label>
    </div>
  </div>

  {#if environmentType === 'remote'}
    <Card class="bg-muted/30">
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle class="text-base flex items-center gap-2">
            <Fa icon={faKey} size="sm" />
            SSH Configuration
          </CardTitle>
          {#if savedConfigs.length > 0}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => (showSavedConfigs = !showSavedConfigs)}
              class="flex items-center gap-1"
            >
              <Fa icon={faHistory} size="sm" />
              Recent Connections
            </Button>
          {/if}
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        {#if showSavedConfigs && savedConfigs.length > 0}
          <div class="mb-4 p-2 border border-border rounded-md bg-background">
            <div class="text-xs text-muted-foreground mb-2">Recent SSH Connections:</div>
            <div class="space-y-1">
              {#each savedConfigs as config (config.name)}
                <button
                  type="button"
                  onclick={() => loadSavedConfig(config)}
                  class="w-full text-left px-2 py-1 text-sm hover:bg-accent rounded transition-colors"
                >
                  {config.name}
                  <span class="text-xs text-muted-foreground ml-2">
                    {new Date(config.savedAt).toLocaleDateString()}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-4">
          <div>
            <Label for="host">Host</Label>
            <Input id="host" bind:value={sshConfig.host} placeholder="localhost" class="mt-1" />
          </div>

          <div>
            <Label for="port">Port</Label>
            <Input
              id="port"
              type="number"
              bind:value={sshConfig.port}
              placeholder="22"
              class="mt-1"
            />
          </div>
        </div>

        <div>
          <Label for="user">Username</Label>
          <Input id="user" bind:value={sshConfig.user} placeholder="developer" class="mt-1" />
        </div>

        <div>
          <Label for="password">
            Password
            <span class="text-xs text-muted-foreground ml-1">(optional if using SSH key)</span>
          </Label>
          <Input
            id="password"
            type="password"
            bind:value={sshConfig.password}
            placeholder="••••••••"
            class="mt-1"
          />
        </div>

        <div>
          <Label for="workspace-path">Remote Space Path</Label>
          <Input
            id="workspace-path"
            bind:value={sshConfig.workspacePath}
            placeholder="/home/user/workspace"
            class="mt-1"
          />
          <p class="text-xs text-muted-foreground mt-1">
            Path on the remote machine where the space will be located
          </p>
        </div>

        <div class="space-y-3">
          <div class="flex items-center space-x-2">
            <input
              type="checkbox"
              id="use-agent"
              bind:checked={sshConfig.useAgent}
              class="rounded border-border"
            />
            <Label for="use-agent" class="text-sm font-normal cursor-pointer">
              Use SSH Agent for authentication
            </Label>
          </div>

          {#if !sshConfig.useAgent}
            <div>
              <Label for="key-path">SSH Key Path (optional)</Label>
              <div class="flex gap-2 mt-1">
                <Input
                  id="key-path"
                  bind:value={sshConfig.keyPath}
                  placeholder="~/.ssh/id_rsa"
                  class="flex-1"
                />
                <Button variant="outline" size="icon" onclick={selectKeyFile}>
                  <Fa icon={faFolderOpen} size="sm" />
                </Button>
              </div>
            </div>
          {/if}
        </div>

        <div class="pt-2">
          <Button
            variant="outline"
            onclick={testConnection}
            disabled={testing || !sshConfig.host || !sshConfig.user}
            class="w-full"
          >
            {#if testing}
              <Fa icon={faCircleNotch} size="sm" class="mr-2 animate-spin" />
              Testing Connection...
            {:else}
              Test Connection
            {/if}
          </Button>
        </div>

        {#if testResult}
          <div
            class="p-3 rounded-lg border {testResult.success
              ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
              : 'border-red-500 bg-red-50 dark:bg-red-950/20'}"
          >
            <div class="flex items-start gap-2">
              {#if testResult.success}
                <Fa icon={faCircleCheck} size="sm" class="text-green-500 mt-0.5" />
              {:else}
                <Fa icon={faCircleXmark} size="sm" class="text-red-500 mt-0.5" />
              {/if}
              <div class="text-sm">
                {testResult.message}
              </div>
            </div>
          </div>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
