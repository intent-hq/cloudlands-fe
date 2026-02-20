<script lang="ts">
  import { invoke } from '$lib/electron-bridge';
  import Terminal from '$lib/components/terminal/Terminal.svelte';
  import Fa from 'svelte-fa';
  import { faCheckCircle, faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
  import type { Workspace } from '$shared/types';
  import { createLogger } from '$lib/utils/client-logger';
  import { modelStore } from '$lib/stores/model.store.svelte';

  const logger = createLogger('AugieSetupWizard');

  interface Props {
    workspace: Workspace;
    onComplete?: () => void;
  }

  let { workspace, onComplete }: Props = $props();

  let terminalRef: any = $state(null);
  let augieInstalled: boolean | null = $state(null);
  let hasRefreshedModels = false; // Track if we've already refreshed models after install
  let checkingPM = $state(true);
  let pmStatus = $state<Record<string, boolean>>({
    npm: false,
    yarn: false,
    pnpm: false,
  });

  const installMethods = [
    {
      id: 'npm',
      name: 'npm',
      command: 'npm install -g @augmentcode/auggie',
      icon: '📦',
      requiresNpm: false,
    },
    {
      id: 'yarn',
      name: 'yarn',
      command: 'yarn global add @augmentcode/auggie',
      installCommand: 'npm install -g yarn',
      icon: '🧶',
      requiresNpm: true,
    },
    {
      id: 'pnpm',
      name: 'pnpm',
      command: 'pnpm add -g @augmentcode/auggie',
      installCommand: 'npm install -g pnpm',
      icon: '⚡',
      requiresNpm: true,
    },
  ];

  // Check if a package manager is installed
  async function checkPackageManager(pm: string) {
    const isRemote = workspace.environmentConfig?.type === 'remote';
    const sshConfig = isRemote
      ? JSON.parse(JSON.stringify(workspace.environmentConfig?.ssh))
      : undefined;

    try {
      let result;
      if (isRemote && sshConfig) {
        result = await invoke<any>('execute_command_remote', {
          connectionId: `check-${pm}-${workspace.id}`,
          command: `${pm} --version`,
          cwd: workspace.worktreePath || workspace.repositoryPath,
          sshConfig: sshConfig,
        });
      } else {
        result = await invoke<any>('execute_command', {
          command: `${pm} --version`,
          cwd: workspace.worktreePath || workspace.repositoryPath,
        });
      }
      logger.debug(`[AugieSetupWizard] ${pm} check result:`, result);
      pmStatus[pm] = result.exitCode === 0;
      logger.debug(`[AugieSetupWizard] ${pm} installed:`, { pm, installed: pmStatus[pm] });
    } catch (err) {
      logger.error(`[AugieSetupWizard] ${pm} check error:`, err as Error);
      pmStatus[pm] = false;
    }
  }

  // Check all package managers
  async function checkAllPackageManagers() {
    checkingPM = true;
    await checkPackageManager('npm');
    await checkPackageManager('yarn');
    await checkPackageManager('pnpm');
    checkingPM = false;
  }

  // Check package managers on mount
  $effect(() => {
    if (terminalRef) {
      checkAllPackageManagers();
    }
  });

  // Install NPM
  async function handleInstallNpm() {
    logger.info('[AugieSetupWizard] Installing npm');
    if (terminalRef && terminalRef.runCommand) {
      // Use platform-appropriate package manager
      let installCmd = 'npm install -g npm'; // Default fallback

      if (typeof process !== 'undefined' && process.platform) {
        // This won't work in browser, but try anyway
        if (process.platform === 'darwin') {
          installCmd = 'brew install npm';
        } else if (process.platform === 'linux') {
          installCmd = 'sudo apt-get update && sudo apt-get install -y npm';
        } else if (process.platform === 'win32') {
          installCmd = 'choco install nodejs';
        }
      }

      await terminalRef.runCommand(installCmd);
      // Re-check npm after installation
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await checkPackageManager('npm');
    }
  }

  async function handleInstallClick(method: string) {
    const selected = installMethods.find((m) => m.id === method);
    if (!selected) return;

    logger.info('[AugieSetupWizard] Running command:', { command: selected.command });

    // If this method requires a package manager that's not installed, install it first
    if (selected.requiresNpm && method !== 'npm' && !pmStatus[method] && selected.installCommand) {
      logger.info(`[AugieSetupWizard] ${method} not found, installing ${method} first`);
      if (terminalRef && terminalRef.runCommand) {
        await terminalRef.runCommand(selected.installCommand);
        // After package manager is installed, re-check and install Auggie
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await checkPackageManager(method);
        await terminalRef.runCommand(selected.command);

        // Wait for installation to complete, then re-check
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await recheckAugieInstallation();
      }
    } else {
      // Call the runCommand function which sets the command and executes it
      if (terminalRef && terminalRef.runCommand) {
        await terminalRef.runCommand(selected.command);

        // Wait for installation to complete, then re-check
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await recheckAugieInstallation();
      } else {
        logger.error('[AugieSetupWizard] terminalPanel or runCommand not available');
      }
    }
  }

  // Re-check if Auggie is installed after installation attempt
  async function recheckAugieInstallation() {
    logger.info('[AugieSetupWizard] Re-checking Auggie installation...');
    if (terminalRef && terminalRef.checkAugieInstallation) {
      await terminalRef.checkAugieInstallation();

      // Poll for status updates
      const maxAttempts = 5;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = terminalRef.getAugieInstalled();
        logger.debug(`[AugieSetupWizard] Auggie status check ${i + 1}/${maxAttempts}:`, { status });

        if (status === true) {
          augieInstalled = true;
          logger.info('[AugieSetupWizard] Auggie is now installed!');
          break;
        }
      }
    }
  }

  // Track the augieInstalled status from the terminal panel
  $effect(() => {
    if (terminalRef && terminalRef.getAugieInstalled) {
      // Poll for status updates
      const interval = setInterval(() => {
        const status = terminalRef.getAugieInstalled();
        if (status !== augieInstalled) {
          augieInstalled = status;
        }
      }, 500);

      return () => clearInterval(interval);
    }
  });

  // Refresh model list when auggie is successfully installed
  // This ensures the model picker shows fresh models from the newly installed CLI
  $effect(() => {
    if (augieInstalled === true && !hasRefreshedModels) {
      hasRefreshedModels = true;
      logger.info('[AugieSetupWizard] Auggie installed, refreshing model list...');
      void modelStore.retryLoadModels();
    }
  });
</script>

<!-- Modal Backdrop -->
<div class="absolute inset-0 bg-background/80 backdrop-blur-sm z-40"></div>

<!-- Modal Container -->
<div class="absolute inset-0 flex items-center justify-center z-50 p-6">
  <div
    class="bg-background border border-border rounded-lg shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[85vh]"
  >
    <!-- Header -->
    <div class="px-8 py-6 border-b border-border">
      <div class="flex items-start justify-between gap-6">
        <div class="flex-1">
          <h2 class="text-xl font-semibold tracking-tight">Install Agent CLI</h2>
          <p class="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            {#if workspace.environmentConfig?.type === 'remote'}
              Install an agent CLI on your remote server to enable AI agents for this workspace.
            {:else}
              Install an agent CLI to enable AI agents for this workspace. Auggie is recommended.
            {/if}
          </p>
        </div>
        {#if augieInstalled !== null}
          <div class="flex-shrink-0 mt-0.5">
            {#if augieInstalled === true}
              <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Fa icon={faCheckCircle} size="xs" />
                <span>Installed</span>
              </div>
            {:else}
              <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Fa icon={faExclamationCircle} size="xs" />
                <span>Not installed</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 overflow-hidden flex gap-6 px-8 py-6">
      <!-- Installation Methods (Left) -->
      <div class="flex flex-col gap-3 flex-shrink-0 w-80">
        <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Choose installation method
        </div>

        <!-- Install NPM button if npm is not installed -->
        {#if !checkingPM && !pmStatus['npm']}
          <button
            onclick={handleInstallNpm}
            class="group relative flex flex-col items-start gap-2 px-4 py-3.5 rounded-md border border-border bg-background hover:border-foreground/20 transition-all duration-200 text-left"
          >
            <div class="flex items-center gap-2.5 w-full">
              <div class="flex items-center justify-center w-8 h-8 rounded-md bg-muted text-lg">
                📦
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Install npm</div>
                <div class="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                  apt-get install npm
                </div>
              </div>
            </div>
            <div class="flex items-start gap-1.5 text-xs text-muted-foreground pl-10.5">
              <Fa icon={faExclamationCircle} size="xs" class="flex-shrink-0 mt-0.5" />
              <span>Required to install agent CLI</span>
            </div>
          </button>
        {/if}

        <!-- Show package manager buttons only if npm is installed -->
        {#if !checkingPM && pmStatus['npm']}
          {#each installMethods as method (method.id)}
            {@const needsPMInstall =
              method.requiresNpm && !pmStatus[method.id] && method.installCommand}
            <button
              onclick={() => handleInstallClick(method.id)}
              class="group relative flex flex-col items-start gap-2 px-4 py-3.5 rounded-md border border-border bg-background hover:border-foreground/20 transition-all duration-200 text-left"
            >
              <div class="flex items-center gap-2.5 w-full">
                <div class="flex items-center justify-center w-8 h-8 rounded-md bg-muted text-lg">
                  {method.icon}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium">Install with {method.name}</div>
                  <div class="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                    {method.command}
                  </div>
                </div>
              </div>
              {#if needsPMInstall}
                <div class="flex items-start gap-1.5 text-xs text-muted-foreground pl-10.5">
                  <Fa icon={faExclamationCircle} size="xs" class="flex-shrink-0 mt-0.5" />
                  <span>Will install {method.name} first</span>
                </div>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- Loading state -->
        {#if checkingPM}
          <div class="flex items-center gap-2 px-4 py-3.5 text-sm text-muted-foreground">
            <div
              class="animate-spin h-4 w-4 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full"
            ></div>
            <span>Checking package managers...</span>
          </div>
        {/if}
      </div>

      <!-- Terminal Panel (Right) -->
      <div class="flex-1 overflow-hidden flex flex-col min-w-0">
        <div class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Terminal output
        </div>
        <div class="flex-1 overflow-hidden rounded-md border border-border">
          <Terminal
            bind:this={terminalRef}
            workspaceId={workspace.id}
            terminalId={`auggie-setup-${workspace.id}`}
          />
        </div>
      </div>
    </div>

    <!-- Success Overlay -->
    {#if augieInstalled === true}
      <div
        class="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center rounded-lg"
      >
        <div class="text-center px-8 py-12">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
            <Fa icon={faCheckCircle} size="2x" class="text-foreground" />
          </div>
          <h3 class="text-xl font-semibold mb-2">Installation Complete</h3>
          <p class="text-sm text-muted-foreground mb-6">
            Agent CLI is ready to use with this workspace
          </p>
          <button
            onclick={onComplete}
            class="px-4 py-2 text-sm font-medium bg-foreground text-background rounded-md hover:opacity-90 transition-opacity"
          >
            Continue
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(body) {
    overflow: hidden;
  }
</style>
