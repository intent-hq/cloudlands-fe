<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { appClient } from '$lib/client';
  import { refreshAutoCommitSettings } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { store as appStore } from '$store/renderer/store';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { validateBranchPrefix, sanitizeBranchPrefix } from '$lib/utils/workspace-validation';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Checkbox } from '$lib/components/patterns/settings/custom-controls';
  import PathSettingField from './PathSettingField.svelte';
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

  function handleShellChange(value: string) {
    defaultShell = value;
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

  const schema = $derived.by(() =>
    defineSettings({
      sections: [
        {
          id: 'git',
          title: m.settings_section_git(),
          entries: [
            {
              kind: 'custom',
              id: 'ssh-key-path',
              label: m.settings_gitWorkspace_sshKeyPath_label(),
              description: m.settings_gitWorkspace_sshKeyPath_description_before(),
              error: () => settingsError || undefined,
            },
            {
              kind: 'input',
              id: 'branch-prefix',
              label: m.settings_gitWorkspace_branchPrefix_label(),
              description: m.settings_gitWorkspace_branchPrefix_description_before(),
              placeholder: m.settings_gitWorkspace_branchPrefix_placeholder(),
              get: () => `${branchPrefix}`,
              set: (value: string) => {
                branchPrefix = value;
              },
              onBlur: handleBranchPrefixChange,
              error: () => branchPrefixError || undefined,
            },
            {
              kind: 'switch',
              id: 'auto-commit',
              label: m.settings_gitWorkspace_autoCommit_label(),
              get: () => Boolean(autoCommit),
              set: (value: boolean) => {
                autoCommit = value;
                void handleSave();
              },
            },
            {
              kind: 'switch',
              id: 'git-credentials',
              label: m.settings_gitWorkspace_gitCredentials_label(),
              description: m.settings_gitWorkspace_gitCredentials_description(),
              when: () => Boolean(gitCredentialSettingSupported),
              get: () => Boolean(exposeGitCredential),
              set: (value: boolean) => {
                exposeGitCredential = value;
                void handleSave();
              },
            },
          ],
        },
        {
          id: 'shell',
          title: m.settings_section_shell(),
          entries: [
            {
              kind: 'select',
              id: 'default-shell',
              label: m.settings_gitWorkspace_defaultShell_label(),
              options: shellOptions,
              get: () => `${defaultShell}`,
              set: handleShellChange,
            },
            {
              kind: 'custom',
              id: 'cli-optimization',
              label: m.settings_section_cliOptimization(),
              layout: 'full-width',
              when: () => Boolean(shellAdditions),
            },
          ],
        },
        {
          id: 'workspace',
          title: m.settings_section_workspace(),
          entries: [
            {
              kind: 'custom',
              id: 'worktrees-location',
              label: m.settings_gitWorkspace_worktreesLocation_label(),
            },
            {
              kind: 'custom',
              id: 'cow-isolation',
              label: m.settings_gitWorkspace_cowIsolation_label(),
              description: m.settings_gitWorkspace_cowIsolation_description(),
              experimental: true,
              when: () => Boolean(showCowToggle),
            },
          ],
        },
      ],
    }),
  );
</script>

{#snippet sshKeyControl()}
  <PathSettingField
    mode="file"
    bind:value={sshKeyPath}
    placeholder={SSH_KEY_PLACEHOLDER}
    defaultPath={'~/.ssh'}
    ariaLabel={m.settings_gitWorkspace_sshKeyPath_label()}
    pickerTitle={m.settings_gitWorkspace_sshKeyPath_label()}
    onchange={handleSave}
  />
{/snippet}

{#snippet sshKeyDescription()}
  {m.settings_gitWorkspace_sshKeyPath_description_before()}
  <!-- i18n-ignore (file path) -->
  <code class="bg-muted px-1 rounded">~/.ssh/id_ed25519</code>)
{/snippet}

{#snippet branchPrefixDescription()}
  {m.settings_gitWorkspace_branchPrefix_description_before()}
  <!-- i18n-ignore (branch prefix example) -->
  <code class="bg-muted px-1 rounded">feature/</code>)
{/snippet}

{#snippet worktreesControl()}
  <PathSettingField
    bind:value={worktreesLocation}
    placeholder={WORKTREES_PLACEHOLDER}
    ariaLabel={m.settings_gitWorkspace_worktreesLocation_label()}
    pickerTitle={m.settings_gitWorkspace_worktreesLocation_label()}
    confirm={{
      title: m.settings_gitWorkspace_worktreesLocation_confirm_title(),
      message: m.settings_gitWorkspace_worktreesLocation_confirm_message(),
    }}
    onchange={handleSave}
  />
{/snippet}

{#snippet cowControl({ labelId, descriptionId }: SettingsControlContext)}
  <Checkbox
    checked={cowIsolation}
    onCheckedChange={(value) => {
      cowIsolation = value;
      void handleSave();
    }}
    ariaLabelledby={labelId}
    ariaDescribedby={descriptionId}
  />
{/snippet}

{#snippet shellAdditionsControl()}
  {@render shellAdditions?.()}
{/snippet}

<div data-settings-git-workspace>
  <SettingsForm
    {schema}
    custom={defineSettingsCustomControls({
      'ssh-key-path': sshKeyControl,
      'worktrees-location': worktreesControl,
      'cow-isolation': cowControl,
      'cli-optimization': shellAdditionsControl,
    })}
    descriptions={{
      'ssh-key-path': sshKeyDescription,
      'branch-prefix': branchPrefixDescription,
    }}
  />
</div>
