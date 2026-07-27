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
  import { m } from '$shared/paraglide/messages.js';
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
  let defaultShell = $state('auto');
  let branchPrefix = $state('');
  let branchPrefixError = $state('');
  let settingsError = $state('');

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
  } as const;

  // Last-loaded/saved value per daemon path so saves only send changed
  // settings — `workspace.sshKeyPath` is sensitive and reads back redacted
  // (§5.12), so its placeholder must never be written back unchanged.
  let loadedValues: Record<string, unknown> = {};

  // Available shells (filtered by platform); shell names are product names — not translated
  const isWindows = navigator.platform.startsWith('Win');
  const shellOptions = [
    { value: 'auto', label: m.settings_gitWorkspace_shell_autoDetect() },
    ...(isWindows
      ? [
          { value: 'powershell.exe', label: 'PowerShell' },
          { value: 'cmd.exe', label: m.settings_gitWorkspace_shell_commandPrompt() },
          { value: 'bash.exe', label: 'Git Bash' }, // i18n-ignore (product name)
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
    };
  }

  async function loadSettings() {
    const settings = await appClient.settings.list();
    if (settings.length === 0) {
      settingsError = m.settings_gitWorkspace_loadError();
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
      settingsError = m.settings_gitWorkspace_saveError();
      logger.error('Failed to save settings:', error);
    }
  }

  /**
   * Handle branch prefix input change with validation
   */
  function handleBranchPrefixChange() {
    const validation = validateBranchPrefix(branchPrefix);
    if (!validation.valid) {
      branchPrefixError = validation.error || m.settings_gitWorkspace_branchPrefix_invalid();
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
        {m.settings_gitWorkspace_worktreesLocation_label()}
      </label>
      <div class="flex gap-2 flex-1 max-w-md">
        <input
          id="worktreesLocation"
          type="text"
          bind:value={worktreesLocation}
          onblur={handleSave}
          class="flex-1 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          placeholder={'~/intent/workspaces' /* i18n-ignore (file path) */}
        />
      </div>
    </div>
  </section>

  <!-- SSH Key Path -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <div class="shrink-0">
        <label for="sshKeyPath" class="text-sm font-medium text-foreground">
          {m.settings_gitWorkspace_sshKeyPath_label()}
        </label>
        <p class="text-xs text-subtle">
          {m.settings_gitWorkspace_sshKeyPath_description()}
          <!-- i18n-ignore (file path) -->
          <code class="bg-muted px-1 rounded">~/.ssh/id_ed25519</code>)
        </p>
      </div>
      <div class="flex gap-2 flex-1 max-w-md">
        <input
          id="sshKeyPath"
          type="text"
          bind:value={sshKeyPath}
          onblur={handleSave}
          class="flex-1 px-3 py-1.5 bg-background border border-border rounded-md text-sm text-foreground transition-all focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          placeholder={'~/.ssh/id_ed25519' /* i18n-ignore (file path) */}
        />
      </div>
    </div>
  </section>

  <!-- Default Shell -->
  <section class="px-6 py-2">
    <div class="flex items-center justify-between gap-4">
      <label for="defaultShell" class="text-sm font-medium text-foreground shrink-0">
        {m.settings_gitWorkspace_defaultShell_label()}
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
          {m.settings_gitWorkspace_branchPrefix_label()}
        </label>
        <p class="text-xs text-subtle">
          {m.settings_gitWorkspace_branchPrefix_description()}
          <!-- i18n-ignore (branch prefix example) -->
          <code class="bg-muted px-1 rounded">feature/</code>)
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
          placeholder={m.settings_gitWorkspace_branchPrefix_placeholder()}
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
        {m.settings_gitWorkspace_autoFetch_label()}
      </label>
      <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          bind:checked={autoCommit}
          onchange={handleSave}
          class="cursor-pointer"
        />
        {m.settings_gitWorkspace_autoCommit_label()}
      </label>
      {#if showCowToggle}
        <label class="flex items-center gap-2 text-sm text-foreground cursor-pointer group">
          <input
            type="checkbox"
            bind:checked={cowIsolation}
            onchange={handleSave}
            class="cursor-pointer"
          />
          <span>{m.settings_gitWorkspace_cowIsolation_label()}</span>
          <span
            class="text-subtle hover:text-foreground transition-colors"
            title={m.settings_gitWorkspace_cowIsolation_tooltip()}
          >
            <Fa icon={faInfoCircle} size="sm" />
          </span>
        </label>
      {/if}
    </div>
  </section>
</div>
