<script lang="ts">
  import InitialAgentPicker from '$lib/components/workspace/initializer/InitialAgentPicker.svelte';
  import RemoteSetupSelector from '$lib/components/workspace/initializer/RemoteSetupSelector.svelte';
  import SetupScriptEditor from '$lib/components/workspace/initializer/SetupScriptEditor.svelte';
  import {
    isolationNoun,
    resolveEffectiveIsolationMode,
    type IsolationMode,
  } from '$lib/components/workspace/initializer/isolation-mode';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource, WorkspaceDraftConfig } from '$shared/types';
  import { selectWorkspaceCreationRemoteSetups } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    configWith,
    hasModifiedOptions,
    isRemoteSetup,
    sourceRepoKey,
    sourceWithIsolation,
  } from './setup-sections';

  interface Props {
    source: DraftSource;
    config: WorkspaceDraftConfig;
    disabled?: boolean;
    onEdit?: (patch: { source?: DraftSource; config?: WorkspaceDraftConfig }) => void;
  }

  let { source, config, disabled = false, onEdit }: Props = $props();
  const remoteSetups$ = selectWorkspaceCreationRemoteSetups();
  const workspaceItems$ = selectWorkspaceItems();
  const repoKey = $derived(sourceRepoKey(source));
  const remoteSetup = $derived(isRemoteSetup(config.remoteSetup) ? config.remoteSetup : null);
  const modified = $derived(hasModifiedOptions(source, config));
  let isolationMode = $state<IsolationMode>('worktree');
  // svelte-ignore state_referenced_locally - the draft config seeds picker-local binding state
  let modelWasOverridden = $state(Boolean(config.model));

  $effect(() => {
    void resolveEffectiveIsolationMode($workspaceItems$).then((mode) => (isolationMode = mode));
  });

  function updateConfig<K extends keyof WorkspaceDraftConfig>(
    key: K,
    value: WorkspaceDraftConfig[K],
  ): void {
    onEdit?.({ config: configWith(config, key, value) });
  }
</script>

<details class="group border-t border-border pt-3" data-testid="options-section">
  <summary class="flex cursor-pointer list-none items-center justify-between py-1">
    <span class="type-caption font-medium text-foreground"
      >{m.newWorkspace_setup_options_title()}</span
    >
    <span class="type-caption text-muted-foreground">
      {modified ? m.settings_aiBehavior_modifiedBadge() : m.settings_colorTheme_defaultOption()}
    </span>
  </summary>
  <div class="grid gap-4 pt-3">
    {#if source.kind === 'local'}
      <div class="flex items-center justify-between gap-3">
        <span class="type-caption text-muted-foreground"
          >{m.newWorkspace_source_isolation_label()}</span
        >
        <div class="flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            {disabled}
            class="type-caption rounded-md px-2 py-1 {source.isolation === 'worktree'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground'}"
            aria-pressed={source.isolation === 'worktree'}
            onclick={() => onEdit?.({ source: sourceWithIsolation(source, 'worktree') })}
            >{isolationNoun(isolationMode)}</button
          >
          <button
            type="button"
            {disabled}
            class="type-caption rounded-md px-2 py-1 {source.isolation === 'in-place'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground'}"
            aria-pressed={source.isolation === 'in-place'}
            onclick={() => onEdit?.({ source: sourceWithIsolation(source, 'in-place') })}
            >{m.newWorkspace_source_inPlace_label()}</button
          >
        </div>
      </div>
    {/if}

    <InitialAgentPicker
      selectedSpecialist={config.specialist}
      selectedModel={config.model}
      bind:modelWasOverridden
      selectedReasoningEffort={config.reasoningEffort}
      isTeamMode={config.isTeamMode !== false}
      selectedProvider={config.provider}
      onSpecialistChange={(value) => updateConfig('specialist', value)}
      onModelChange={(value) => updateConfig('model', value)}
      onReasoningEffortChange={(value) => updateConfig('reasoningEffort', value)}
      onTeamModeChange={(value) => updateConfig('isTeamMode', value)}
      onProviderChange={(value) => updateConfig('provider', value)}
    />

    <SetupScriptEditor
      repoPath={repoKey}
      githubUrl={source.kind === 'github' ? source.url : null}
      value={config.setupScript ?? ''}
      compact
      onchange={(value) => updateConfig('setupScript', value)}
    />

    {#if $remoteSetups$.length > 0}
      <RemoteSetupSelector
        variant="ghost"
        repoPath={repoKey}
        value={remoteSetup}
        onchange={(event) => {
          const setup = event.detail.setup;
          onEdit?.({
            config: configWith(
              configWith(config, 'remoteSetup', setup),
              'isRemote',
              Boolean(setup),
            ),
          });
        }}
      />
    {/if}
  </div>
</details>
