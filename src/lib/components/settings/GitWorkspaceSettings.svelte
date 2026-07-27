<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { appClient } from '$lib/client';
  import Fa from 'svelte-fa';
  import {
  faInfoCircle,
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
  let autoFetch = $state(false);
  let autoCommit = $state(true);
  let cowIsolation = $state(false);
  let exposeGitCredential = $state(true);
  let defaultShell = $state('auto');
  let branchPrefix = $state('');
  let branchPrefixError = $state('');
  let settingsError = $state('');

  // The git-credential toggle is only shown when the daemon reports the
  // setting (older daemons don't have it); we also never write the path back
  // to a daemon that didn't report it.
  let gitCredentialSettingSupported = $state(false);

  // CoW toggle is visible only when the machine supports it — a direct probe
  // of the workspaces root via `system.capabilities` (PROTOCOL §5.7), with no
  // dependency on an active/hydrated workspace.
  let cowSupported = $state(false);
  const showCowToggle = $derived(cowSupported);

  // Daemon setting path per field (PROTOCOL §5.12, BE-owned workspace/git group).
  const SETTING_PATHS = {
    worktreesLocation: 'workspace.worktreesLocation',
    sshKeyPath: 'workspace.sshKeyPath',
    defaultShell: 'workspace.defaultShell',
    autoFetch: 'workspace.autoFetch',
    autoCommit: 'git.autoCommit',
    cowIsolation: 'workspace.cowIsolation',
    branchPrefix: 'workspace.branchPrefix',
    exposeGitCredential: 'sourceControl.github.exposeGitCredentialToChildren',
  } as const;

  // Last-loaded/saved value per daemon path so saves only send changed
  // settings — `workspace.sshKeyPath` is sensitive and reads back redacted
  // (§5.12), so its placeholder must never be written back unchanged.
  let loadedValues: Record<string, unknown> = {};

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
    void loadCowCapability();
    await loadSettings();
  });

  async function loadCowCapability() {
    // capabilities() always resolves ({} on failure), so unknown/error keeps
    // the toggle hidden rather than crashing the settings pane.
    const caps = await appClient.system.capabilities();
    cowSupported = caps.cowSupported === true;
  }

  function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  function currentValues(): Record<string, unknown> {
    return {
      [SETTING_PATHS.worktreesLocation]: worktreesLocation,
      [SETTING_PATHS.sshKeyPath]: sshKeyPath,
      [SETTING_PATHS.defaultShell]: defaultShell,
      [SETTING_PATHS.autoFetch]: autoFetch,
      [SETTING_PATHS.autoCommit]: autoCommit,
      [SETTING_PATHS.cowIsolation]: cowIsolation,
      [SETTING_PATHS.branchPrefix]: branchPrefix,
      ...(gitCredentialSettingSupported
        ? { [SETTING_PATHS.exposeGitCredential]: exposeGitCredential }
        : {}),
    };
  }

  async function loadSettings() {
    const settings = await appClient.settings.list();
    if (settings.length === 0) {
      settingsError = 'Failed to load settings from the backend.';
      return;
    }
    settingsError = '';
    const byPath = new Map(settings.map((entry) => [entry.path, entry.value]));
    worktreesLocation = stringValue(byPath.get(SETTING_PATHS.worktreesLocation));
    sshKeyPath = stringValue(byPath.get(SETTING_PATHS.sshKeyPath));
    defaultShell = stringValue(byPath.get(SETTING_PATHS.defaultShell)) || 'auto';
    autoFetch = byPath.get(SETTING_PATHS.autoFetch) === true;
    autoCommit = byPath.get(SETTING_PATHS.autoCommit) !== false;
    cowIsolation = byPath.get(SETTING_PATHS.cowIsolation) === true;
    branchPrefix = stringValue(byPath.get(SETTING_PATHS.branchPrefix));
    gitCredentialSettingSupported = byPath.has(SETTING_PATHS.exposeGitCredential);
    // Security-sensitive: only an explicit boolean `true` counts as enabled, so
    // malformed/unexpected values fail safe to off.
    exposeGitCredential = byPath.get(SETTING_PATHS.exposeGitCredential) === true;
    loadedValues = currentValues();
  }

  async function handleSave() {
    const values = currentValues();
    const changes = Object.entries(values)
      .filter(([path, value]) => value !== loadedValues[path])
      .map(([path, value]) => ({ path, value }));
    if (changes.length === 0) return;
    try {
      await appClient.settings.update(changes);
      settingsError = '';
      loadedValues = values;

      // Refresh global autoCommit so workspaces pick up the new setting
      appStore.dispatch(refreshAutoCommitSettings());
    } catch (error) {
      settingsError = 'Failed to save settings. Please try again.';
      logger.error('Failed to save settings:', error);
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

  /**
   * Reset Git & Workspace settings to defaults
   */
  export function resetToDefaults() {
    worktreesLocation = '';
    sshKeyPath = '';
    autoFetch = false;
    autoCommit = true;
    exposeGitCredential = true;
    defaultShell = 'auto';
    branchPrefix = '';
    branchPrefixError = '';
    handleSave();
  }
</script>

<div class="flex flex-col bg-card rounded-xl pt-1 pb-3">
  {#if settingsError}
    <section class="px-6 py-2">
      <p class="text-xs text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
        {settingsError}
      </p>
    </section>
  {/if}

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
      {#if showCowToggle}
        <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer group">
          <input
            type="checkbox"
            bind:checked={cowIsolation}
            onchange={handleSave}
            class="cursor-pointer"
          />
          <span>Use Copy-on-Write isolation</span>
          <span class="text-subtle hover:text-foreground transition-colors" title="CoW workspaces + per-agent sandboxes. New workspaces are provisioned as instant copy-on-write clones of the repository, and each delegated agent runs in its own CoW sandbox whose changes are merged back automatically when it finishes. Requires filesystem CoW support on the workspaces root (APFS on macOS, btrfs/XFS-reflink on Linux, ReFS/Dev Drive on Windows).">
            <Fa icon={faInfoCircle} size="sm" />
          </span>
        </label>
      {/if}
      {#if gitCredentialSettingSupported}
        <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer group">
          <input
            type="checkbox"
            bind:checked={exposeGitCredential}
            onchange={handleSave}
            class="cursor-pointer"
          />
          <span>Git credentials in terminals &amp; agents</span>
          <span class="text-subtle hover:text-foreground transition-colors" title="When on, git commands in workspace terminals and agent sessions can authenticate to github.com using your connected GitHub account, via a credential helper scoped to HTTPS github.com remotes. The token is never exposed as GITHUB_TOKEN, and your own git credential helpers always take precedence.">
            <Fa icon={faInfoCircle} size="sm" />
          </span>
        </label>
      {/if}
    </div>
  </section>
</div>
