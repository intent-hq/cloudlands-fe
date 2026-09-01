<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { appClient } from '$lib/client';
  import { refreshAutoCommitSettings } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { store as appStore } from '$store/renderer/store';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { validateBranchPrefix, sanitizeBranchPrefix } from '$lib/utils/workspace-validation';
  import PathSettingField from './PathSettingField.svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Select } from '$lib/components/ui/select';
  import { Toggle } from '$lib/components/ui/toggle';
  import type { Snippet } from 'svelte';

  let { shellAdditions }: { shellAdditions?: Snippet } = $props();

  // i18n-ignore (file path)
  const WORKTREES_PLACEHOLDER = '~/intent/workspaces';
  // i18n-ignore (file path)
  const SSH_KEY_PLACEHOLDER = '~/.ssh/id_ed25519';

  // Settings state
  let worktreesLocation = $state('');
  let sshKeyPath = $state('');
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
    autoCommit: 'git.autoCommit',
    cowIsolation: 'workspace.cowIsolation',
    branchPrefix: 'workspace.branchPrefix',
    exposeGitCredential: 'sourceControl.github.exposeGitCredentialToChildren',
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

  // Unknown/custom values (e.g. hand-edited settings) fall back to the raw value.
  const selectedShellLabel = $derived(
    shellOptions.find((option) => option.value === defaultShell)?.label ?? defaultShell,
  );

  function handleShellChange(value: string) {
    defaultShell = value;
    handleSave();
  }

  function handleAutoCommitToggle() {
    autoCommit = !autoCommit;
    handleSave();
  }

  function handleGitCredentialToggle() {
    exposeGitCredential = !exposeGitCredential;
    handleSave();
  }

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
      settingsError = m.settings_gitWorkspace_loadError();
      return;
    }
    settingsError = '';
    const byPath = new Map(settings.map((entry) => [entry.path, entry.value]));
    worktreesLocation = stringValue(byPath.get(SETTING_PATHS.worktreesLocation));
    sshKeyPath = stringValue(byPath.get(SETTING_PATHS.sshKeyPath));
    defaultShell = stringValue(byPath.get(SETTING_PATHS.defaultShell)) || 'auto';
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
    autoCommit = true;
    cowIsolation = false;
    exposeGitCredential = true;
    defaultShell = 'auto';
    branchPrefix = '';
    branchPrefixError = '';
    handleSave();
  }
</script>

<div class="flex min-w-0 flex-col gap-4" data-settings-git-workspace>
  <div id="git" class="mb-12">
    <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_section_git()}
    </h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      {#if settingsError}
        <section class="px-6 py-5">
          <p
            class="text-xs text-error-foreground bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
          >
            {settingsError}
          </p>
        </section>
      {/if}
      <section class="px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div class="shrink-0">
            <label for="sshKeyPath" class="text-sm font-medium text-foreground">
              {m.settings_gitWorkspace_sshKeyPath_label()}
            </label>
            <p class="text-xs text-subtle">
              {m.settings_gitWorkspace_sshKeyPath_description_before()}
              <!-- i18n-ignore (file path) -->
              <code class="bg-muted px-1 rounded">~/.ssh/id_ed25519</code>)
            </p>
          </div>
          <PathSettingField
            mode="file"
            id="sshKeyPath"
            bind:value={sshKeyPath}
            placeholder={SSH_KEY_PLACEHOLDER}
            defaultPath={'~/.ssh'}
            pickerTitle={m.settings_gitWorkspace_sshKeyPath_label()}
            onchange={handleSave}
          />
        </div>
      </section>
      <section class="px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <div class="shrink-0">
            <label for="branchPrefix" class="text-sm font-medium text-foreground">
              {m.settings_gitWorkspace_branchPrefix_label()}
            </label>
            <p class="text-xs text-subtle">
              {m.settings_gitWorkspace_branchPrefix_description_before()}
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
              class="w-full px-3 py-1.5 bg-background border rounded-md text-sm text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/10 {branchPrefixError
                ? 'border-destructive focus:border-destructive'
                : 'border-border focus:border-primary'}"
              placeholder={m.settings_gitWorkspace_branchPrefix_placeholder()}
            />
            {#if branchPrefixError}<p class="text-xs text-error-foreground">
                {branchPrefixError}
              </p>{/if}
          </div>
        </div>
      </section>
      <section class="px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <p class="text-sm font-medium text-foreground">
            {m.settings_gitWorkspace_autoCommit_label()}
          </p>
          <Toggle
            pressed={autoCommit}
            onclick={handleAutoCommitToggle}
            variant="indicator"
            size="xs"
            class="mb-auto"
            ariaLabel={m.settings_gitWorkspace_autoCommit_label()}
          />
        </div>
      </section>
      {#if gitCredentialSettingSupported}
        <section class="px-6 py-5">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-foreground">
                {m.settings_gitWorkspace_gitCredentials_label()}
              </p>
              <p id="git-credentials-description" class="text-xs text-subtle mt-1">
                {m.settings_gitWorkspace_gitCredentials_description()}
              </p>
            </div>
            <Toggle
              pressed={exposeGitCredential}
              onclick={handleGitCredentialToggle}
              variant="indicator"
              size="xs"
              class="mb-auto"
              ariaLabel={m.settings_gitWorkspace_gitCredentials_label()}
              ariaDescribedby="git-credentials-description"
            />
          </div>
        </section>
      {/if}
    </div>
  </div>

  <div id="shell" class="mb-12">
    <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_section_shell()}
    </h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      <section class="px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <label for="defaultShell" class="text-sm font-medium text-foreground shrink-0">
            {m.settings_gitWorkspace_defaultShell_label()}
          </label>
          <div class="w-56 shrink-0">
            <Select.Root value={defaultShell} onchange={handleShellChange}>
              <Select.Trigger id="defaultShell" class="py-1.5"
                ><span class="truncate">{selectedShellLabel}</span></Select.Trigger
              >
              <Select.Content portal class="max-h-[300px] w-56">
                {#each shellOptions as option (option.value)}
                  <Select.Item value={option.value}
                    ><span class="truncate">{option.label}</span></Select.Item
                  >
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </section>
      {#if shellAdditions}<section class="px-6 py-5">{@render shellAdditions()}</section>{/if}
    </div>
  </div>

  <div id="workspace" class="mb-12">
    <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_section_workspace()}
    </h2>
    <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
      <section class="px-6 py-5">
        <div class="flex items-center justify-between gap-4">
          <label for="worktreesLocation" class="text-sm font-medium text-foreground shrink-0">
            {m.settings_gitWorkspace_worktreesLocation_label()}
          </label>
          <PathSettingField
            id="worktreesLocation"
            bind:value={worktreesLocation}
            placeholder={WORKTREES_PLACEHOLDER}
            pickerTitle={m.settings_gitWorkspace_worktreesLocation_label()}
            confirm={{
              title: m.settings_gitWorkspace_worktreesLocation_confirm_title(),
              message: m.settings_gitWorkspace_worktreesLocation_confirm_message(),
            }}
            onchange={handleSave}
          />
        </div>
      </section>
      {#if showCowToggle}
        <section class="px-6 py-5">
          <div class="flex items-center gap-2">
            <label
              for="cow-isolation"
              class="flex items-center gap-2 text-sm text-foreground cursor-pointer"
            >
              <Checkbox
                id="cow-isolation"
                checked={cowIsolation}
                onCheckedChange={(checked) => {
                  cowIsolation = checked;
                  handleSave();
                }}
                ariaDescribedby="cow-isolation-description"
              />
              <span>{m.settings_gitWorkspace_cowIsolation_label()}</span>
            </label>
            <span
              class="inline-flex items-center shrink-0 rounded-full bg-muted/20 px-1 text-ui-sm leading-4 text-subtle"
              >{m.settings_gitWorkspace_experimental_badge()}</span
            >
          </div>
          <p id="cow-isolation-description" class="text-xs text-subtle mt-0.5 ml-6">
            {m.settings_gitWorkspace_cowIsolation_description()}
          </p>
        </section>
      {/if}
    </div>
  </div>
</div>
