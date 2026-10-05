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
    };
    for (const [path, value] of Object.entries(defaults))
      appStore.dispatch(settingsFormDraftChanged(identity, path, value));
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
