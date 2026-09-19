<script lang="ts">
  import { logger } from '../../../shared/logger';
  import { refreshAutoCommitSettings } from '$store/renderer/slices/workspace-settings/workspace-settings-slice';
  import { store as appStore } from '$store/renderer/store';
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { validateBranchPrefix, sanitizeBranchPrefix } from '$lib/utils/workspace-validation';
  import PathSettingField from './PathSettingField.svelte';
  import {
    SettingsForm,
    defineSettings,
    defineSettingsCustomControls,
    type SettingsControlContext,
  } from '$lib/components/patterns/settings';
  import { Checkbox } from '$lib/components/patterns/settings/custom-controls';
  // eslint-disable-next-line intent/settings-use-schema -- shared inline recipe used inside schema description snippets
  import { InlineCode } from '$lib/components/ui/inline-code';
  import type { Snippet } from 'svelte';
  import {
    getSystemCapabilitiesRequested,
    listSettingsRequested,
    updateSettingsRequested,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsListOperation,
    selectSettingsUpdateOperation,
    selectSystemCapabilitiesOperation,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';

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
  const LIST_KEY = 'git-workspace:list';
  const CAPABILITIES_KEY = 'git-workspace:capabilities';
  const UPDATE_KEY = 'git-workspace:update';
  const listOperation$ = selectSettingsListOperation(LIST_KEY);
  const capabilitiesOperation$ = selectSystemCapabilitiesOperation(CAPABILITIES_KEY);
  const updateOperation$ = selectSettingsUpdateOperation(UPDATE_KEY);
  let seenListVersion = selectSettingsListOperation.select(appStore.state, LIST_KEY).version;
  let seenCapabilitiesVersion = selectSystemCapabilitiesOperation.select(
    appStore.state,
    CAPABILITIES_KEY,
  ).version;
  let seenUpdateVersion = selectSettingsUpdateOperation.select(appStore.state, UPDATE_KEY).version;
  let pendingValues: Record<string, unknown> | null = null;

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

  onMount(() => {
    appStore.dispatch(getSystemCapabilitiesRequested(CAPABILITIES_KEY));
    appStore.dispatch(listSettingsRequested(LIST_KEY));
  });

  $effect(() => {
    const operation = $capabilitiesOperation$;
    if (operation.version <= seenCapabilitiesVersion || operation.status === 'loading') return;
    seenCapabilitiesVersion = operation.version;
    cowSupported = operation.status === 'success' && operation.data?.cowSupported === true;
  });

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

  $effect(() => {
    const operation = $listOperation$;
    if (operation.version <= seenListVersion || operation.status === 'loading') return;
    seenListVersion = operation.version;
    const settings = operation.status === 'success' ? operation.data : null;
    if (!settings || settings.length === 0) {
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
  });

  $effect(() => {
    const operation = $updateOperation$;
    if (operation.version <= seenUpdateVersion || operation.status === 'loading') return;
    seenUpdateVersion = operation.version;
    if (operation.status === 'success' && pendingValues) {
      settingsError = '';
      loadedValues = pendingValues;
      pendingValues = null;
      appStore.dispatch(refreshAutoCommitSettings());
    } else if (operation.status === 'error') {
      pendingValues = null;
      settingsError = m.settings_gitWorkspace_saveError();
      logger.error('Failed to save settings:', operation.error);
    }
  });

  function handleSave() {
    const values = currentValues();
    const changes = Object.entries(values)
      .filter(([path, value]) => value !== loadedValues[path])
      .map(([path, value]) => ({ path, value }));
    if (changes.length === 0) return;
    pendingValues = values;
    appStore.dispatch(updateSettingsRequested(changes, UPDATE_KEY));
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
                handleSave();
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
                handleSave();
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
              class: 'py-0 first:pt-0 last:pb-0',
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
  <InlineCode>~/.ssh/id_ed25519</InlineCode>)
{/snippet}

{#snippet branchPrefixDescription()}
  {m.settings_gitWorkspace_branchPrefix_description_before()}
  <!-- i18n-ignore (branch prefix example) -->
  <InlineCode>feature/</InlineCode>)
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
      handleSave();
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
    compact={false}
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
