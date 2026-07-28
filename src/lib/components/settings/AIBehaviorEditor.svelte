<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faPlus,
  faRotateLeft,
  faTrash,
  faPencil,
} from '@fortawesome/free-solid-svg-icons';

  import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';


  import {
  selectSpecialists,
  selectIsBuiltIn,
  selectIsFileBased,
  selectEffectiveModel,
  selectEffectiveBehaviorPrompt,
  selectGetFileSpecialist,
  selectSpecialistFilePath,
  selectSpecialistSourceLabel,
  selectSpecialistsFolderPath,
  selectEffectiveCodingAgent,
  selectFileSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
  import {
  deleteFileSpecialist as deleteFileSpecialistAction,
  saveFileSpecialist,
} from '$store/renderer/slices/specialists/specialists-slice';
  import { selectActiveWorkspace } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { setActiveProvider } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { reloadModelsForProvider } from '$store/renderer/slices/model/model-slice';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import AgentRulesEditor from './AgentRulesEditor.svelte';
  import AutoSaveTextarea from './AutoSaveTextarea.svelte';
  import type { AIBehaviorView } from './AIBehaviorSidebar.svelte';

  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import { parseCompoundModelId } from '$shared/config/provider-config';
  import { generateUniqueSpecialistId } from '$shared/specialist-file-types';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    activeView: AIBehaviorView;
    onSpecialistCreated?: (id: string) => void;
    onSpecialistDeleted?: () => void;
    onDiscard?: () => void;
  }

  let { activeView, onSpecialistCreated, onSpecialistDeleted, onDiscard }: Props = $props();

  const specialists = selectSpecialists();
  const fileSpecialists$ = selectFileSpecialists();
  const selectedModel = selectSelectedModel();
  const activeProviderId$ = selectActiveProviderId();

  // Check if all specialists already use the currently selected default model
  const allSpecialistsUseSelectedModel = $derived.by(() => {
    void $fileSpecialists$; // track file specialist changes for reactivity
    const specs = $specialists;
    return (
      specs.length > 0 &&
      specs.every(
        (s) => selectEffectiveModel.select(appStore.state, s.id) === $selectedModel,
      )
    );
  });

  // Get the default model for new specialists - use the user's current selection
  function getDefaultModel(): string {
    return $selectedModel;
  }

  function getCurrentWorkspacePath(): string | undefined {
    const workspace = selectActiveWorkspace.select(appStore.state);
    return workspace?.path ?? workspace?.worktreePath ?? workspace?.repositoryPath;
  }

  // New specialist form state
  let newName = $state('');
  let newDescription = $state('');
  let newCodingAgent = $state($activeProviderId$);
  let newModel = $state(getDefaultModel());
  let newPrompt = $state(m.settings_aiBehavior_newPromptTemplate());

  // Character limits
  const MAX_PROMPT_LENGTH = 50000;
  const WARNING_THRESHOLD = 40000;

  const newPromptCharCount = $derived(newPrompt.length);
  const newPromptIsOverLimit = $derived(newPromptCharCount > MAX_PROMPT_LENGTH);
  const newPromptIsApproachingLimit = $derived(
    newPromptCharCount > WARNING_THRESHOLD && !newPromptIsOverLimit,
  );
  const newPromptPercentage = $derived(
    Math.min(100, Math.round((newPromptCharCount / MAX_PROMPT_LENGTH) * 100)),
  );

  // Reset form when switching to create view
  $effect(() => {
    if (activeView.type === 'create-specialist') {
      newName = '';
      newDescription = '';
      newCodingAgent = $activeProviderId$;
      newModel = getDefaultModel();
      newPrompt = m.settings_aiBehavior_newPromptTemplate();
    }
  });

  // Get current specialist if viewing one
  const currentSpecialist = $derived(
    activeView.type === 'specialist' ? $specialists.find((s) => s.id === activeView.id) : null,
  );

  const isBuiltIn = $derived(
    currentSpecialist
      ? selectIsBuiltIn.select(appStore.state, currentSpecialist.id)
      : false,
  );

  const isFileBased = $derived(
    currentSpecialist
      ? selectIsFileBased.select(appStore.state, currentSpecialist.id)
      : false,
  );

  /** A built-in specialist is "modified" if there's a user file that overrides it */
  const hasOverrides = $derived.by(() => {
    void $fileSpecialists$; // track file specialist changes for reactivity
    if (!currentSpecialist) return false;
    const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
    return !!fileSpec && fileSpec.source === 'user' && isBuiltIn;
  });

  const specialistFilePath = $derived(
    currentSpecialist
      ? selectSpecialistFilePath.select(appStore.state, currentSpecialist.id)
      : undefined,
  );

  const sourceLabel = $derived(
    currentSpecialist
      ? selectSpecialistSourceLabel.select(appStore.state, currentSpecialist.id)
      : null,
  );

  const specialistsFolderPath = selectSpecialistsFolderPath();

  // Local state for specialist model/coding agent selection
  let _specialistCodingAgentValue = $state('');
  let specialistModelValue = $state('');

  // Sync specialist model value when specialist changes or file specialists change
  $effect(() => {
    if (currentSpecialist) {
      void $fileSpecialists$; // track file specialist changes
      _specialistCodingAgentValue = selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id);
      specialistModelValue = selectEffectiveModel.select(
        appStore.state,
        currentSpecialist.id,
      );
    }
  });

  function handleGlobalModelChange(compoundModelId: string) {
    if (!compoundModelId) return;
    const { providerId } = parseCompoundModelId(compoundModelId);
    if (providerId && providerId !== $activeProviderId$) {
      appStore.dispatch(setActiveProvider(providerId));
      appStore.dispatch(reloadModelsForProvider());
    }
  }

  function handleSpecialistModelChange(compoundModelId: string) {
    if (!currentSpecialist || !compoundModelId) return;

    const { providerId: newProvider } = parseCompoundModelId(compoundModelId);
    _specialistCodingAgentValue = newProvider;
    specialistModelValue = compoundModelId;

    if (isFileBased) {
      // Already a file specialist (user or project) — update in place
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
      );
      if (fileSpec) {
        const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
        appStore.dispatch(
          saveFileSpecialist({
            id: fileSpec.id,
            name: fileSpec.name,
            description: fileSpec.description,
            codingAgent: newProvider,
            model: compoundModelId,
            modelTier: undefined,
            roleReminder: fileSpec.roleReminder,
            behaviorPrompt: fileSpec.behaviorPrompt,
            scope: fileSpec.source,
            workspacePath,
          }),
        );
      }
    } else {
      // Built-in or legacy — export to user file with the change applied
      const effectivePrompt = selectEffectiveBehaviorPrompt.select(
        appStore.state,
        currentSpecialist.id,
      );
      appStore.dispatch(
        saveFileSpecialist({
          id: currentSpecialist.id,
          name: currentSpecialist.name,
          description: currentSpecialist.description,
          codingAgent: newProvider,
          model: compoundModelId,
          modelTier: undefined,
          roleReminder: currentSpecialist.roleReminder,
          behaviorPrompt: effectivePrompt || currentSpecialist.defaultBehaviorPrompt,
          scope: 'user',
        }),
      );
    }
  }

  function handleCreateModelChange(compoundModelId: string) {
    if (!compoundModelId) return;
    const { providerId } = parseCompoundModelId(compoundModelId);
    newCodingAgent = providerId;
    newModel = compoundModelId;
  }

  function handlePromptSave(prompt: string) {
    if (!currentSpecialist) return;
    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
      );
      if (fileSpec) {
        const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
        appStore.dispatch(
          saveFileSpecialist({
            id: fileSpec.id,
            name: fileSpec.name,
            description: fileSpec.description,
            codingAgent: fileSpec.codingAgent,
            model: fileSpec.model,
            modelTier: fileSpec.modelTier,
            roleReminder: fileSpec.roleReminder,
            behaviorPrompt: prompt,
            scope: fileSpec.source,
            workspacePath,
          }),
        );
      }
    } else {
      // Built-in or legacy — export to user file with the change applied
      const effectiveModel = selectEffectiveModel.select(
        appStore.state,
        currentSpecialist.id,
      );
      const effectiveCodingAgent = selectEffectiveCodingAgent.select(
        appStore.state,
        currentSpecialist.id,
      );
      appStore.dispatch(
        saveFileSpecialist({
          id: currentSpecialist.id,
          name: currentSpecialist.name,
          description: currentSpecialist.description,
          codingAgent: effectiveCodingAgent,
          model: effectiveModel,
          modelTier: currentSpecialist.defaultModelTier,
          roleReminder: currentSpecialist.roleReminder,
          behaviorPrompt: prompt,
          scope: 'user',
        }),
      );
    }
  }

  function handleNameSave(newNameValue: string) {
    if (!currentSpecialist) return;
    const trimmed = newNameValue.trim();
    if (!trimmed || trimmed === currentSpecialist.name) return;

    const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: trimmed,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id),
        model: selectEffectiveModel.select(appStore.state, currentSpecialist.id),
        modelTier: currentSpecialist.defaultModelTier,
        roleReminder: currentSpecialist.roleReminder,
        behaviorPrompt: selectEffectiveBehaviorPrompt.select(appStore.state, currentSpecialist.id),
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
      }),
    );
  }

  function handleDescriptionSave(newDescValue: string) {
    if (!currentSpecialist) return;
    const trimmed = newDescValue.trim();
    if (trimmed === currentSpecialist.description) return;

    const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: trimmed || currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id),
        model: selectEffectiveModel.select(appStore.state, currentSpecialist.id),
        modelTier: currentSpecialist.defaultModelTier,
        roleReminder: currentSpecialist.roleReminder,
        behaviorPrompt: selectEffectiveBehaviorPrompt.select(appStore.state, currentSpecialist.id),
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
      }),
    );
  }

  function resetToDefault() {
    if (!currentSpecialist) return;
    // Delete the user override file so the specialist reverts to bundled defaults
    appStore.dispatch(
      deleteFileSpecialistAction({
        id: currentSpecialist.id,
        scope: 'user',
      }),
    );
  }

  function deleteSpecialist() {
    if (!currentSpecialist) return;
    // Capture values before deletion since currentSpecialist is a $derived
    // that will become null once the specialist is removed from the store
    const specialistId = currentSpecialist.id;
    const fileSpec = selectGetFileSpecialist.select(appStore.state, specialistId);
    appStore.dispatch(
      deleteFileSpecialistAction({
        id: specialistId,
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
      }),
    );
    onSpecialistDeleted?.();
  }

  function createSpecialist() {
    if (!newName.trim() || newPromptIsOverLimit) return;
    const createdId = generateUniqueSpecialistId(
      newName.trim(),
      selectSpecialists.select(appStore.state).map((specialist) => specialist.id),
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: createdId,
        name: newName.trim(),
        description: newDescription.trim() || m.settings_aiBehavior_customSpecialistFallback(),
        codingAgent: newCodingAgent,
        model: newModel,
        behaviorPrompt: newPrompt,
        scope: 'user',
      }),
    );
    // Show success toast with file path
    const folderPath = $specialistsFolderPath;
    const expectedPath = folderPath ? `${folderPath}/${createdId}.md` : `~/.intent/specialists/${createdId}.md`;
    toast.success(m.settings_aiBehavior_createdToast({ name: newName.trim() }), {
      description: expectedPath.replace(/^\/Users\/[^/]+/, '~'),
    });

    onSpecialistCreated?.(createdId);
  }

  function discardNewSpecialist() {
    newName = '';
    newDescription = '';
    newCodingAgent = $activeProviderId$;
    newModel = getDefaultModel();
    newPrompt = m.settings_aiBehavior_newPromptTemplate();
    onDiscard?.();
  }

  /** Check if a built-in specialist has been customized (has a user file override) */
  function hasFileOverride(): boolean {
    if (!currentSpecialist) return false;
    const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
    return !!fileSpec && fileSpec.source === 'user';
  }
</script>

<div class="editor-container flex-1">
  <!-- System Prompt View -->
  {#if activeView.type === 'system-prompt'}
    <!-- Global defaults -->
    <div class="mb-6">
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-sm font-medium text-foreground shrink-0">
          {m.settings_aiBehavior_defaultModel_label()}
        </span>
        <ModelPicker
          selectedModel={$selectedModel}
          onModelChange={handleGlobalModelChange}
          showDefaultOption={false}
          variant="default"
          size="sm"
          updateGlobalDefault
        />
        {#if !allSpecialistsUseSelectedModel}
          <button
            type="button"
            onclick={() => {
              const { providerId: newProvider } = parseCompoundModelId($selectedModel);
              // Save each specialist as a user file with the selected model
              for (const s of $specialists) {
                const fileSpec = selectGetFileSpecialist.select(appStore.state, s.id);
                const effectivePrompt = selectEffectiveBehaviorPrompt.select(appStore.state, s.id);
                appStore.dispatch(
                  saveFileSpecialist({
                    id: s.id,
                    name: s.name,
                    description: s.description,
                    codingAgent: newProvider,
                    model: $selectedModel,
                    modelTier: undefined,
                    roleReminder: s.roleReminder,
                    behaviorPrompt: effectivePrompt || s.defaultBehaviorPrompt,
                    scope: fileSpec?.source ?? 'user',
                    workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
                  }),
                );
              }
            }}
            class="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer whitespace-nowrap"
          >
            {m.settings_aiBehavior_useForAllSpecialists()}
          </button>
        {/if}
      </div>
    </div>

    <!-- Agent Instructions (1fr) -->
    <div class="min-h-0 h-full">
      <AgentRulesEditor />
    </div>

    <!-- Specialist Editor View -->
  {:else if activeView.type === 'specialist' && currentSpecialist}
    <!-- Header: Name + Open button -->
    <div class="mb-6">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          {#if !isBuiltIn && !hasOverrides}
            <input
              type="text"
              value={currentSpecialist.name}
              onblur={(e) => handleNameSave(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
              placeholder={m.settings_aiBehavior_specialistName_placeholder()}
              class="w-full text-base font-medium text-foreground bg-transparent border-none outline-none px-0 py-0 focus:ring-0 focus:outline-none placeholder:text-muted-foreground"
            />
          {:else}
            <div class="flex items-center gap-2">
              <h2 class="text-base font-medium text-foreground">{currentSpecialist.name}</h2>
              {#if isBuiltIn && hasOverrides}
                <span class="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium inline-flex items-center gap-1">
                  <Fa icon={faPencil} class="w-2.5 h-2.5" />
                  {m.settings_aiBehavior_modifiedBadge()}
                </span>
              {/if}
            </div>
          {/if}

          {#if !isBuiltIn && !hasOverrides}
            <input
              type="text"
              value={currentSpecialist.description}
              onblur={(e) => handleDescriptionSave(e.currentTarget.value)}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
              placeholder={m.settings_aiBehavior_specialistDescription_placeholder()}
              class="w-full text-sm text-muted-foreground bg-transparent border-none outline-none px-0 py-0 mt-1 focus:ring-0 focus:outline-none placeholder:text-muted-foreground"
            />
          {:else}
            <p class="text-sm text-muted-foreground mt-1">{currentSpecialist.description}</p>
          {/if}
        </div>

        {#if specialistFilePath}
          <div class="shrink-0">
            <OpenComboButton filePath={specialistFilePath} isDirectory={false} />
          </div>
        {/if}
      </div>

      <!-- Contextual info -->
      <p class="text-sm text-muted-foreground mt-2">
        {#if isBuiltIn && !hasOverrides}
          {m.settings_aiBehavior_builtInInfo_before()}
          <!-- i18n-ignore (file path) -->
          <code class="bg-muted px-1 py-0.5 rounded">~/.intent/specialists/{currentSpecialist.id}.md</code>.
        {:else if isBuiltIn && hasOverrides}
          {m.settings_aiBehavior_customizedInfo_before()}
          <code class="bg-muted px-1 py-0.5 rounded">{specialistFilePath?.replace(/^\/Users\/[^/]+/, '~') ?? ''}</code>.
          {m.settings_aiBehavior_customizedInfo_after()}
        {:else if sourceLabel === 'Project'}
          {m.settings_aiBehavior_projectInfo_before()}
          <code class="bg-muted px-1 py-0.5 rounded">{specialistFilePath?.replace(/^\/Users\/[^/]+/, '~') ?? ''}</code>.
        {:else}
          {m.settings_aiBehavior_personalInfo_before()}
          <code class="bg-muted px-1 py-0.5 rounded">{specialistFilePath?.replace(/^\/Users\/[^/]+/, '~') ?? ''}</code>.
          {m.settings_aiBehavior_personalInfo_middle()}
          <!-- i18n-ignore (file path) -->
          <code class="bg-muted px-1 py-0.5 rounded">&lt;repo&gt;/.intent/specialists/</code>
          {m.settings_aiBehavior_personalInfo_after()}
        {/if}
      </p>
      <p class="text-sm text-muted-foreground mt-2">
        {m.settings_aiBehavior_usageHint()}
      </p>
    </div>

    <!-- Model picker — inline row -->
    <div class="mb-6">
      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-foreground shrink-0">
          {m.settings_aiBehavior_model_label()}
        </span>
        <ModelPicker
          selectedModel={specialistModelValue}
          onModelChange={handleSpecialistModelChange}
          showDefaultOption={false}
          size="sm"
          variant="default"
        />
        {#if isBuiltIn && hasFileOverride()}
          <button
            type="button"
            onclick={resetToDefault}
            class="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Fa icon={faRotateLeft} class="w-3 h-3" />
            {m.settings_aiBehavior_reset()}
          </button>
        {/if}
      </div>
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full">
      <AutoSaveTextarea
        value={selectEffectiveBehaviorPrompt.select(
          appStore.state,
          currentSpecialist.id,
        )}
        originalValue={currentSpecialist.defaultBehaviorPrompt}
        label={m.settings_aiBehavior_systemPrompt_label()}
        labelClass="text-sm font-medium text-foreground"
        placeholder={m.settings_aiBehavior_systemPrompt_placeholder()}
        minRows={12}
        maxLength={50000}
        onSave={handlePromptSave}
        onReset={isBuiltIn
          ? resetToDefault
          : undefined}
      />
    </div>

    <!-- Actions -->
    <div class="pt-4 border-border">
      {#if !isBuiltIn}
        <button
          type="button"
          onclick={deleteSpecialist}
          class="text-xs text-muted-foreground hover:text-destructive-foreground transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <Fa icon={faTrash} class="w-3 h-3" />
          {m.settings_aiBehavior_deleteSpecialist()}
        </button>
      {/if}
    </div>

    <!-- Create Specialist View -->
  {:else if activeView.type === 'create-specialist'}
    <!-- Metadata -->
    <div class="mb-4">
      <h2 class="text-base font-medium text-foreground">{m.settings_aiBehavior_createSpecialist_title()}</h2>
      <p class="text-sm text-muted-foreground mt-1">
        {m.settings_aiBehavior_createSpecialist_pathNote_before()}
        <!-- i18n-ignore (file path) -->
        <code class="bg-muted px-1 py-0.5 rounded">~/.intent/specialists/</code>
      </p>
    </div>

    <!-- Fields -->
    <div class="space-y-4 mb-6">
      <div>
        <label class="text-sm font-medium text-foreground block mb-1.5">
          {m.settings_aiBehavior_name_label()}
        </label>
        <Input
          noFocusStyle
          type="text"
          bind:value={newName}
          placeholder={m.settings_aiBehavior_name_placeholder()}
        />
      </div>

      <div>
        <label class="text-sm font-medium text-foreground block mb-1.5">
          {m.settings_aiBehavior_description_label()}
        </label>
        <Input
          noFocusStyle
          type="text"
          bind:value={newDescription}
          placeholder={m.settings_aiBehavior_description_placeholder()}
        />
      </div>

      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-foreground shrink-0">
          {m.settings_aiBehavior_model_label()}
        </span>
        <ModelPicker
          selectedModel={newModel}
          onModelChange={handleCreateModelChange}
          showDefaultOption={false}
          variant="default"
          size="sm"
        />
      </div>
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full flex flex-col gap-1.5">
      <label class="text-sm font-medium text-foreground block shrink-0">
        {m.settings_aiBehavior_systemPrompt_label()}
      </label>
      <textarea
        bind:value={newPrompt}
        placeholder={m.settings_aiBehavior_newPrompt_placeholder()}
        class="w-full grow p-3 text-sm rounded-lg border border-border bg-background resize-none
          focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
          {newPromptIsOverLimit ? 'border-destructive' : ''}"
      ></textarea>
      {#if newPromptIsApproachingLimit || newPromptIsOverLimit}
        <div
          class="flex items-center justify-end text-xs shrink-0 {newPromptIsOverLimit
            ? 'text-destructive'
            : 'text-warning'}"
        >
          <span>
            {m.settings_autoSave_limitUsed({
              percent: formatNumber(newPromptPercentage / 100, {
                style: 'percent',
                maximumFractionDigits: 0,
              }),
            })}
          </span>
        </div>
      {/if}
    </div>

    <!-- Actions -->
    <div class="pt-4 border-border">
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onclick={discardNewSpecialist}>
          {m.settings_aiBehavior_discard()}
        </Button>
        <Button
          variant="default"
          onclick={createSpecialist}
          disabled={!newName.trim() || newPromptIsOverLimit}
        >
          <Fa icon={faPlus} class="w-3.5 h-3.5 mr-1.5" />
          {m.settings_aiBehavior_createSpecialist_title()}
        </Button>
      </div>
    </div>
  {/if}
</div>

<style>
  .editor-container {
    height: 100%;
    overflow-y: auto;

    display: grid;
    grid-template-rows: min-content min-content 1fr min-content;
  }

  /* Warning color fallback */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }
</style>
