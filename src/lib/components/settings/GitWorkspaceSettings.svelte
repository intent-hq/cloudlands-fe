<script lang="ts">
  import { logger } from '../../../shared/logger';
  import Fa from 'svelte-fa';
  import {
  faFolder,
  faKey,
} from '@fortawesome/free-solid-svg-icons';
  import { refreshAutoCommitSettings } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { store as appStore } from '$store/renderer/store';
  import { onMount } from 'svelte';
  import {
  validateBranchPrefix,
  sanitizeBranchPrefix,
} from '$lib/utils/workspace-validation';

  // Settings state
  let worktreesLocation = $state('');
  let sshKeyPath = $state('');
  let autoFetch = $state(true);
  let autoCommit = $state(true);
  let defaultShell = $state('auto');
  let branchPrefix = $state('');
  let branchPrefixError = $state('');

  // Available shells (filtered by platform)
  const isWindows = navigator.platform.startsWith('Win');
  const shellOptions = [
    { value: 'auto', label: 'Auto-detect (System Default)' },
    ...(isWindows
      ? [
          { value: 'powershell.exe', label: 'PowerShell' },
          { value: 'cmd.exe', label: 'Command Prompt' },
          { value: 'bash.exe', label: 'Git Bash' },
          { value: 'wsl.exe', label: 'WSL' },
        ]
      : [
          { value: '/bin/bash', label: 'Bash' },
          { value: '/bin/zsh', label: 'Zsh' },
          { value: '/bin/sh', label: 'Sh' },
          { value: '/usr/bin/fish', label: 'Fish' },
        ]),
  ];

  onMount(async () => {
    await loadSettings();
  });

  async function loadSettings() {
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.invoke('settings:getAll', undefined);
        const settings = (result && result.data) || {};
        worktreesLocation = settings.worktreesLocation || '';
        sshKeyPath = settings.sshKeyPath || '';
        autoFetch = settings.autoFetch !== false;
        autoCommit = settings.autoCommit !== false;
        defaultShell = settings.defaultShell || 'auto';
        branchPrefix = settings.branchPrefix || '';
      } catch (error) {
        logger.error('Failed to load settings:', error);
      }
    }
  }

  async function handleSave() {
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke('settings:update', {
          settings: {
            worktreesLocation,
            sshKeyPath,
            autoFetch,
            autoCommit,
            defaultShell,
            branchPrefix,
          },
        });

        // Refresh global autoCommit so workspaces pick up the new setting
        appStore.dispatch(refreshAutoCommitSettings());
      } catch (error) {
        logger.error('Failed to save settings:', error);
      }
    }
  }

  /**
   * Handle branch prefix input change with validation
   */
  function handleBranchPrefixChange() {
    const validation = validateBranchPrefix(branchPrefix);
    if (!validation.valid) {
      branchPrefixError = validation.error || 'Invalid branch prefix';
    } else {
      branchPrefixError = '';
      // Sanitize and normalize the prefix
      branchPrefix = sanitizeBranchPrefix(branchPrefix);
      handleSave();
    }
  }

  async function selectWorktreesDirectory() {
    if (window.electronAPI) {
      const result = await window.electronAPI.invoke('dialog:open', {
        directory: true,
        title: 'Select Worktrees Directory',
      });
      if (result?.data && !result.data.canceled && result.data.filePaths?.length > 0) {
        worktreesLocation = result.data.filePaths[0];
        await handleSave();
      }
    }
  }

  async function selectSshKeyFile() {
    if (window.electronAPI) {
      const result = await window.electronAPI.invoke('dialog:open', {
        directory: false,
        title: 'Select SSH Key File',
      });
      if (result?.data && !result.data.canceled && result.data.filePaths?.length > 0) {
        let selectedPath = result.data.filePaths[0];
        // If user selected a .pub file, use the private key (strip .pub extension)
        if (selectedPath.endsWith('.pub')) {
          selectedPath = selectedPath.slice(0, -4);
        }
        sshKeyPath = selectedPath;
        await handleSave();
      }
    }
  }

  /**
   * Reset Git & Workspace settings to defaults
   */
  export function resetToDefaults() {
    worktreesLocation = '';
    sshKeyPath = '';
    autoFetch = true;
    autoCommit = true;
    defaultShell = 'auto';
    branchPrefix = '';
    branchPrefixError = '';
    handleSave();
  }
</script>

<div class="flex flex-col bg-card rounded-xl pt-1 pb-3">
  <!-- Worktrees Location -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <label for="worktreesLocation" class="text-sm font-medium text-foreground shrink-0">
        Worktrees Location
      </label>
      <div class="flex gap-2 flex-1 max-w-md">
        <input
          id="worktreesLocation"
          type="text"
          bind:value={worktreesLocation}
          onblur={handleSave}
          class="flex-1 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          placeholder="~/intent/workspaces"
        />
        <button
          onclick={selectWorktreesDirectory}
          class="px-2.5 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors text-sm"
        >
          <Fa icon={faFolder} />
        </button>
      </div>
    </div>
  </section>

  <!-- SSH Key Path -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <div class="shrink-0">
        <label for="sshKeyPath" class="text-sm font-medium text-foreground"> SSH Key Path </label>
        <p class="text-xs text-subtle">
          SSH key for git operations (e.g., <code class="bg-muted px-1 rounded"
            >~/.ssh/id_ed25519</code
          >)
        </p>
      </div>
      <div class="flex gap-2 flex-1 max-w-md">
        <input
          id="sshKeyPath"
          type="text"
          bind:value={sshKeyPath}
          onblur={handleSave}
          class="flex-1 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          placeholder="~/.ssh/id_ed25519"
        />
        <button
          onclick={selectSshKeyFile}
          class="px-2.5 py-1.5 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors text-sm"
        >
          <Fa icon={faKey} />
        </button>
      </div>
    </div>
  </section>

  <!-- Default Shell -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <label for="defaultShell" class="text-sm font-medium text-foreground shrink-0">
        Default Shell
      </label>
      <select
        id="defaultShell"
        bind:value={defaultShell}
        onchange={handleSave}
        class="w-56 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
      >
        {#each shellOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>
  </section>

  <!-- Branch Prefix -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <div class="shrink-0">
        <label for="branchPrefix" class="text-sm font-medium text-foreground">
          Branch Prefix
        </label>
        <p class="text-xs text-subtle">
          Prefix for new workspace branches (e.g., <code class="bg-muted px-1 rounded"
            >feature/</code
          >)
        </p>
      </div>
      <div class="flex flex-col items-end gap-1 flex-1 max-w-md">
        <input
          id="branchPrefix"
          type="text"
          bind:value={branchPrefix}
          onblur={handleBranchPrefixChange}
          class="w-full px-3 py-1.5 bg-background border rounded-md text-sm text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/10
            {branchPrefixError
            ? 'border-destructive focus:border-destructive'
            : 'border-border focus:border-primary'}"
          placeholder="feature/ or user/name/"
        />
        {#if branchPrefixError}
          <p class="text-xs text-destructive-foreground">{branchPrefixError}</p>
        {/if}
      </div>
    </div>
  </section>

  <!-- Auto options -->
  <section class="px-6 py-2">
    <div class="flex flex-wrap gap-x-8 gap-y-2">
      <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          bind:checked={autoFetch}
          onchange={handleSave}
          class="cursor-pointer"
        />
        Auto-fetch updates
      </label>
      <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          bind:checked={autoCommit}
          onchange={handleSave}
          class="cursor-pointer"
        />
        Auto-commit changes
      </label>
    </div>
  </section>
</div>
