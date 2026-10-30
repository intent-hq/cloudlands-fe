<script lang="ts">
  import {
    settingsFormOpened,
    settingsFormClosed,
    settingsFormLoadRequested,
    settingsFormSaveRequested,
    settingsFormDraftChanged,
  } from '$store/renderer/slices/settings-events/settings-events-slice';
  import {
    selectSettingsForm,
    selectSettingsFormEntries,
    selectSettingsFormError,
  } from '$store/renderer/slices/settings-events/settings-events-selectors';
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
  // eslint-disable-next-line intent/settings-use-schema -- shared inline recipe used inside schema description snippets
  import { InlineCode } from '$lib/components/ui/inline-code';
  import PathSettingField from './PathSettingField.svelte';
  import type { Snippet } from 'svelte';

  let { shellAdditions }: { shellAdditions?: Snippet } = $props();

  // i18n-ignore (file path)
  const WORKTREES_PLACEHOLDER = '~/intent/workspaces';
  // i18n-ignore (file path)
  const SSH_KEY_PLACEHOLDER = '~/.ssh/id_ed25519';

  const identity = { formId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
  const form$ = selectSettingsForm(identity);
  const entries$ = selectSettingsFormEntries(identity);
  const error$ = selectSettingsFormError(identity);
  const worktreesLocation = $derived(
    String(
      $form$?.drafts['workspace.worktreesLocation'] ??
        $entries$['workspace.worktreesLocation']?.value ??
        '',
    ),
  );
  const sshKeyPath = $derived(
    String(
      $form$?.drafts['workspace.sshKeyPath'] ?? $entries$['workspace.sshKeyPath']?.value ?? '',
    ),
  );
  const autoCommit = $derived(
    ($form$?.drafts['git.autoCommit'] ?? $entries$['git.autoCommit']?.value) !== false,
  );
  const cowIsolation = $derived(
    ($form$?.drafts['workspace.cowIsolation'] ?? $entries$['workspace.cowIsolation']?.value) ===
      true,
  );
  const exposeGitCredential = $derived(
    ($form$?.drafts['sourceControl.github.exposeGitCredentialToChildren'] ??
      $entries$['sourceControl.github.exposeGitCredentialToChildren']?.value) === true,
  );
  const defaultShell = $derived(
    String(
      $form$?.drafts['workspace.defaultShell'] ??
        $entries$['workspace.defaultShell']?.value ??
        'auto',
    ),
  );
  const branchPrefix = $derived(
    String(
      $form$?.drafts['workspace.branchPrefix'] ?? $entries$['workspace.branchPrefix']?.value ?? '',
    ),
  );
  let branchPrefixError = $state('');

  // Archiving (PROTOCOL §5.12). Archive is the only lifecycle action users
  // see; two automatic options sit in the Archiving section:
  // - `workspace.autoArchiveIdleAfterDays`: archive idle workspaces. `0`
  //   (the default) or absent means off; 7 is suggested when turning it on.
  //   Reset writes the daemon's advertised default (older daemons: 7).
  // - `workspace.purgeArchivedAfterDays`: purge the folders of archived
  //   workspaces (the daemon's retire). Absent/null means off; 7 is suggested
  //   when turning it on.
  // Each row shows only when the daemon reports its setting, so older daemons
  // never get it.
  const AUTO_ARCHIVE_PATH = 'workspace.autoArchiveIdleAfterDays';
  const PURGE_PATH = 'workspace.purgeArchivedAfterDays';
  const DEFAULT_ARCHIVING_DAYS = 7;
  function draftOrEntry(path: string): unknown {
    const drafts = $form$?.drafts ?? {};
    return path in drafts ? drafts[path] : $entries$[path]?.value;
  }
  const autoArchiveSupported = $derived($entries$[AUTO_ARCHIVE_PATH] !== undefined);
  const autoArchiveDays = $derived.by(() => {
    const value = draftOrEntry(AUTO_ARCHIVE_PATH);
    return typeof value === 'number' && value > 0 ? value : null;
  });
  const autoArchiveOn = $derived(autoArchiveDays !== null);
  const purgeSupported = $derived($entries$[PURGE_PATH] !== undefined);
  const purgeDays = $derived.by(() => {
    const value = draftOrEntry(PURGE_PATH);
    return typeof value === 'number' && value > 0 ? value : null;
  });
  const purgeOn = $derived(purgeDays !== null);
  // Each days field edits a local value; only a valid integer ≥ 1 becomes a
  // form draft, so a rejected value can never ride along on another save.
  let autoArchiveDaysInput = $state<number | null>(null);
  let autoArchiveDaysError = $state('');
  let purgeDaysInput = $state<number | null>(null);
  let purgeDaysError = $state('');

  function setAutoArchive(on: boolean) {
    autoArchiveDaysInput = null;
    autoArchiveDaysError = '';
    appStore.dispatch(
      settingsFormDraftChanged(identity, AUTO_ARCHIVE_PATH, on ? DEFAULT_ARCHIVING_DAYS : 0),
    );
    handleSave();
  }

  function setPurge(on: boolean) {
    purgeDaysInput = null;
    purgeDaysError = '';
    appStore.dispatch(
      settingsFormDraftChanged(identity, PURGE_PATH, on ? DEFAULT_ARCHIVING_DAYS : null),
    );
    handleSave();
  }

  /** The daemon's advertised auto-archive default; `0` (off) when it has none. */
  function autoArchiveDefault(advertised: unknown): number {
    return typeof advertised === 'number' && Number.isInteger(advertised) && advertised >= 0
      ? advertised
      : 0;
  }

  /** A whole number of days, 1 or more; `null` = invalid. */
  function validDays(days: number | null): number | null {
    return days !== null && Number.isInteger(days) && days >= 1 ? days : null;
  }

  function commitAutoArchiveDays() {
    if (autoArchiveDaysInput === null) return;
    const days = validDays(autoArchiveDaysInput);
    if (days === null) {
      autoArchiveDaysError = m.settings_gitWorkspace_archivingDays_invalid();
      return;
    }
    autoArchiveDaysError = '';
    autoArchiveDaysInput = null;
    appStore.dispatch(settingsFormDraftChanged(identity, AUTO_ARCHIVE_PATH, days));
    handleSave();
  }

  function commitPurgeDays() {
    if (purgeDaysInput === null) return;
    const days = validDays(purgeDaysInput);
    if (days === null) {
      purgeDaysError = m.settings_gitWorkspace_archivingDays_invalid();
      return;
    }
    purgeDaysError = '';
    purgeDaysInput = null;
    appStore.dispatch(settingsFormDraftChanged(identity, PURGE_PATH, days));
    handleSave();
  }
  const settingsError = $derived($error$);

  // The git-credential toggle is only shown when the daemon reports the
  // setting (older daemons don't have it); we also never write the path back
  // to a daemon that didn't report it.
  const gitCredentialSettingSupported = $derived(
    $entries$['sourceControl.github.exposeGitCredentialToChildren'] !== undefined,
  );

  // CoW toggle is visible only when the machine supports it — a direct probe
  // of the workspaces root via `system.capabilities` (PROTOCOL §5.7), with no
  // dependency on an active/hydrated workspace.
  const cowSupported = $derived($form$?.values.cowSupported === true);
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
    appStore.dispatch(settingsFormDraftChanged(identity, SETTING_PATHS.defaultShell, value));
    handleSave();
  }

  onMount(() => {
    appStore.dispatch(settingsFormOpened(identity, 'git-workspace'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, requestId: crypto.randomUUID(), resource: 'load' }),
    );
    return () => appStore.dispatch(settingsFormClosed(identity));
  });

  function handleSave() {
    const form = selectSettingsForm.select(appStore.state, identity);
    if (!form?.loaded) return;
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    const changes = Object.entries(form.drafts)
      .filter(([path, value]) => entries[path]?.value !== value)
      .map(([path, value]) => ({ path, value }));
    if (changes.length === 0) return;
    appStore.dispatch(
      settingsFormSaveRequested(
        { ...identity, requestId: crypto.randomUUID(), resource: 'git-workspace' },
        changes,
      ),
    );
  }

  /**
   * Handle branch prefix input change with validation
   */
  function handleBranchPrefixChange() {
    const form = selectSettingsForm.select(appStore.state, identity);
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    const prefix = String(
      form?.drafts[SETTING_PATHS.branchPrefix] ?? entries[SETTING_PATHS.branchPrefix]?.value ?? '',
    );
    const validation = validateBranchPrefix(prefix);
    if (!validation.valid) {
      branchPrefixError = validation.error || m.settings_gitWorkspace_branchPrefix_invalid();
    } else {
      branchPrefixError = '';
      // Sanitize and normalize the prefix
      appStore.dispatch(
        settingsFormDraftChanged(
          identity,
          SETTING_PATHS.branchPrefix,
          sanitizeBranchPrefix(prefix),
        ),
      );
      handleSave();
    }
  }

  /**
   * Reset Git & Workspace settings to defaults
   */
  export function resetToDefaults() {
    if (!selectSettingsForm.select(appStore.state, identity)?.loaded) return;
    const entries = selectSettingsFormEntries.select(appStore.state, identity);
    const defaults = {
      [SETTING_PATHS.worktreesLocation]: '',
      [SETTING_PATHS.sshKeyPath]: '',
      [SETTING_PATHS.autoCommit]: true,
      [SETTING_PATHS.cowIsolation]: false,
      [SETTING_PATHS.defaultShell]: 'auto',
      [SETTING_PATHS.branchPrefix]: '',
      ...(entries[SETTING_PATHS.exposeGitCredential]
        ? { [SETTING_PATHS.exposeGitCredential]: true }
        : {}),
      ...(entries[AUTO_ARCHIVE_PATH]
        ? { [AUTO_ARCHIVE_PATH]: autoArchiveDefault(entries[AUTO_ARCHIVE_PATH].defaultValue) }
        : {}),
      ...(entries[PURGE_PATH] ? { [PURGE_PATH]: null } : {}),
    };
    for (const [path, value] of Object.entries(defaults))
      appStore.dispatch(settingsFormDraftChanged(identity, path, value));
    branchPrefixError = '';
    autoArchiveDaysInput = null;
    autoArchiveDaysError = '';
    purgeDaysInput = null;
    purgeDaysError = '';
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
                appStore.dispatch(
                  settingsFormDraftChanged(identity, SETTING_PATHS.branchPrefix, value),
                );
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
                appStore.dispatch(
                  settingsFormDraftChanged(identity, SETTING_PATHS.autoCommit, value),
                );
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
                appStore.dispatch(
                  settingsFormDraftChanged(identity, SETTING_PATHS.exposeGitCredential, value),
                );
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
        {
          id: 'archiving',
          title: m.settings_section_archiving(),
          when: () => Boolean(autoArchiveSupported || purgeSupported),
          entries: [
            {
              kind: 'switch',
              id: 'auto-archive',
              label: m.settings_gitWorkspace_autoArchive_label(),
              description: m.settings_gitWorkspace_autoArchive_description(),
              when: () => Boolean(autoArchiveSupported),
              get: () => Boolean(autoArchiveOn),
              set: (value: boolean) => setAutoArchive(value),
            },
            {
              kind: 'number',
              id: 'auto-archive-days',
              label: m.settings_gitWorkspace_autoArchiveDays_label(),
              description: m.settings_gitWorkspace_autoArchiveDays_description(),
              min: 1,
              step: 1,
              when: () => Boolean(autoArchiveSupported && autoArchiveOn),
              get: () => autoArchiveDaysInput ?? autoArchiveDays ?? DEFAULT_ARCHIVING_DAYS,
              set: (value: number) => {
                autoArchiveDaysInput = value;
                autoArchiveDaysError = '';
              },
              onBlur: commitAutoArchiveDays,
              error: () => autoArchiveDaysError || undefined,
            },
            {
              kind: 'switch',
              id: 'purge-archived',
              label: m.settings_gitWorkspace_purge_label(),
              description: m.settings_gitWorkspace_purge_description(),
              when: () => Boolean(purgeSupported),
              get: () => Boolean(purgeOn),
              set: (value: boolean) => setPurge(value),
            },
            {
              kind: 'number',
              id: 'purge-archived-days',
              label: m.settings_gitWorkspace_purgeDays_label(),
              description: m.settings_gitWorkspace_purgeDays_description(),
              min: 1,
              step: 1,
              when: () => Boolean(purgeSupported && purgeOn),
              get: () => purgeDaysInput ?? purgeDays ?? DEFAULT_ARCHIVING_DAYS,
              set: (value: number) => {
                purgeDaysInput = value;
                purgeDaysError = '';
              },
              onBlur: commitPurgeDays,
              error: () => purgeDaysError || undefined,
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
    bind:value={
      () => sshKeyPath,
      (value) =>
        appStore.dispatch(settingsFormDraftChanged(identity, SETTING_PATHS.sshKeyPath, value))
    }
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
    bind:value={
      () => worktreesLocation,
      (value) =>
        appStore.dispatch(
          settingsFormDraftChanged(identity, SETTING_PATHS.worktreesLocation, value),
        )
    }
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
      appStore.dispatch(settingsFormDraftChanged(identity, SETTING_PATHS.cowIsolation, value));
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
