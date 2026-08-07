<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faPlus,
  faRotateLeft,
  faTrash,
  faPencil,
} from '@fortawesome/free-solid-svg-icons';

  import {
    selectModelEffortLevels,
    selectSelectedModel,
  } from '$store/renderer/slices/model/model-selectors';


  import {
  selectSpecialists,
  selectIsBuiltIn,
  selectIsFileBased,
  selectExplicitModel,
  selectEffectiveBehaviorPrompt,
  selectGetFileSpecialist,
  selectHasOverrides,
  selectSpecialistFilePath,
  selectSpecialistSourceLabel,
  selectSpecialistsFolderPath,
  selectEffectiveCodingAgent,
  selectExplicitReasoningEffort,
  selectFileSpecialists,
  selectBundledSpecialists,
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
  import EffortSelect from './EffortSelect.svelte';
  import SpecialistModelOptions from './SpecialistModelOptions.svelte';
  import {
    hasExplicitModelPin,
    buildResetToInheritPayloads,
  } from './utils/reset-specialists-to-inherit';
  import { isRedundantBuiltInOverride } from './utils/builtin-override-redundancy';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import { parseCompoundModelId as parseCompoundModelIdWithDefault } from '$shared/utils/compound-model-id';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import {
    generateUniqueSpecialistId,
    type SpecialistModelOption,
  } from '$shared/specialist-file-types';
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
  const defaultProviderId$ = selectEffectiveDefaultProviderId();

  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    return parseCompoundModelIdWithDefault(compoundModelId, $defaultProviderId$);
  }

  // Show the reset-all button when any specialist pins an explicit
  // frontmatter model instead of inheriting.
  const anySpecialistHasExplicitModel = $derived(hasExplicitModelPin($fileSpecialists$));

  function getCurrentWorkspacePath(): string | undefined {
    const workspace = selectActiveWorkspace.select(appStore.state);
    return workspace?.path ?? workspace?.worktreePath ?? workspace?.repositoryPath;
  }

  // New specialist form state. Model defaults to inherit (undefined) — a
  // created specialist file has no `model:` key unless the user picks one.
  let newName = $state('');
  let newDescription = $state('');
  let newCodingAgent = $state<string | undefined>(undefined);
  let newModel = $state<string | undefined>(undefined);
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
      newCodingAgent = undefined;
      newModel = undefined;
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

  /**
   * A built-in specialist is "modified" only when its user override file
   * actually differs from the bundled defaults — a lingering identical file
   * never shows "Modified" (diff-based, monorepo#1450).
   */
  const hasOverrides = $derived.by(() => {
    void $fileSpecialists$; // track file specialist changes for reactivity
    if (!currentSpecialist) return false;
    return selectHasOverrides.select(appStore.state, currentSpecialist.id);
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
  let specialistModelValue = $state<string | undefined>(undefined);
  let specialistEffortValue = $state<string | undefined>(undefined);

  // Model the effort level applies to: the explicit pin when present, else
  // the daemon-resolved preview of what an inheriting specialist would run.
  const specialistEffortModel = $derived(
    specialistModelValue ?? currentSpecialist?.resolvedModel,
  );

  // Saved model options from the resolved specialist view (file override →
  // bundled). Reactive to file specialist changes so the rows resync after
  // each post-save refetch.
  const savedModelOptions = $derived.by(() => {
    void $fileSpecialists$; // track file specialist changes
    return currentSpecialist?.modelOptions;
  });

  // Effective behavior prompt (override → bundled). Reactive to file
  // specialist changes so the prompt textarea resyncs after each post-save
  // refetch (mirrors savedModelOptions).
  const effectiveBehaviorPrompt = $derived.by(() => {
    void $fileSpecialists$; // track file specialist changes
    return currentSpecialist
      ? selectEffectiveBehaviorPrompt.select(appStore.state, currentSpecialist.id)
      : '';
  });

  // Sync specialist model value when specialist changes or file specialists
  // change. The picker's selected value is the EXPLICIT frontmatter model
  // only — undefined when inheriting (the daemon resolvedModel preview is
  // shown via the picker's default-option plumbing instead).
  $effect(() => {
    if (currentSpecialist) {
      void $fileSpecialists$; // track file specialist changes
      _specialistCodingAgentValue = selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id);
      specialistModelValue = selectExplicitModel.select(appStore.state, currentSpecialist.id);
      specialistEffortValue = selectExplicitReasoningEffort.select(
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

  /**
   * Drop an effort level the given model does not advertise, so switching to
   * a model without that level resets the dropdown to Default instead of
   * persisting an unsupported level (PROTOCOL §5.11 `reasoningEffort`).
   */
  function effortForModel(
    compoundModelId: string | undefined,
    effort: string | undefined,
  ): string | undefined {
    if (!effort) return undefined;
    const levels = selectModelEffortLevels.select(appStore.state, compoundModelId);
    return levels?.includes(effort) ? effort : undefined;
  }

  function handleSpecialistModelChange(compoundModelId: string) {
    if (!currentSpecialist) return;

    // Empty string = the inherit ("use global default") option was picked:
    // clear the explicit pin so the saved file has no `model:` key. On a
    // built-in with no override file this is a no-op (nothing to clear —
    // creating a file would only pin other fields).
    if (!compoundModelId) {
      specialistModelValue = undefined;
      // The effort level now applies to the inherited (daemon-resolved)
      // model — drop it when that model lacks the level.
      const nextEffort = effortForModel(
        currentSpecialist.resolvedModel,
        specialistEffortValue,
      );
      specialistEffortValue = nextEffort;
      if (!isFileBased) return;
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
      );
      if (!fileSpec || !fileSpec.model) return;
      // If clearing the pin leaves the override identical to the bundled
      // defaults, delete the file instead of rewriting it — a redundant file
      // would keep the built-in reading as "Modified" (monorepo#1450).
      const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
      if (
        isRedundantBuiltInOverride(
          { ...fileSpec, reasoningEffort: nextEffort },
          bundledSpecialists,
          { ignoreModelPin: true },
        )
      ) {
        appStore.dispatch(
          deleteFileSpecialistAction({ id: fileSpec.id, scope: fileSpec.source }),
        );
        return;
      }
      const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
      appStore.dispatch(
        saveFileSpecialist({
          id: fileSpec.id,
          name: fileSpec.name,
          description: fileSpec.description,
          codingAgent: fileSpec.codingAgent,
          model: undefined,
          roleReminder: fileSpec.roleReminder,
          modelOptions: fileSpec.modelOptions,
          reasoningEffort: nextEffort,
          behaviorPrompt: fileSpec.behaviorPrompt,
          scope: fileSpec.source,
          workspacePath,
        }),
      );
      return;
    }

    const { providerId: newProvider } = parseCompoundModelId(compoundModelId);
    _specialistCodingAgentValue = newProvider;
    specialistModelValue = compoundModelId;
    // Reset the effort to Default when the newly picked model does not
    // advertise the current level.
    const nextEffort = effortForModel(compoundModelId, specialistEffortValue);
    specialistEffortValue = nextEffort;

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
            roleReminder: fileSpec.roleReminder,
            modelOptions: fileSpec.modelOptions,
            reasoningEffort: nextEffort,
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
          roleReminder: currentSpecialist.roleReminder,
          modelOptions: currentSpecialist.modelOptions,
          reasoningEffort: nextEffort,
          behaviorPrompt: effectivePrompt || currentSpecialist.defaultBehaviorPrompt,
          scope: 'user',
        }),
      );
    }
  }

  /**
   * Persist the specialist's reasoning-effort level. Default (undefined)
   * omits the key on the wire so the model default is inherited; on a
   * built-in with no override file, picking Default is a no-op and picking a
   * level exports a user file (mirroring the model-pin export path). Clearing
   * the level on a user override that then matches the bundled defaults
   * deletes the file (monorepo#1450).
   */
  function handleSpecialistEffortChange(effort: string | undefined) {
    if (!currentSpecialist) return;
    specialistEffortValue = effort;

    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
      if (!fileSpec) return;
      const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
      if (!effort && !fileSpec.model && !fileSpec.codingAgent) {
        const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
        if (
          isRedundantBuiltInOverride(
            { ...fileSpec, reasoningEffort: undefined },
            bundledSpecialists,
          )
        ) {
          appStore.dispatch(
            deleteFileSpecialistAction({ id: fileSpec.id, scope: fileSpec.source, workspacePath }),
          );
          return;
        }
      }
      appStore.dispatch(
        saveFileSpecialist({
          id: fileSpec.id,
          name: fileSpec.name,
          description: fileSpec.description,
          codingAgent: fileSpec.codingAgent,
          model: fileSpec.model || undefined,
          roleReminder: fileSpec.roleReminder,
          modelOptions: fileSpec.modelOptions,
          reasoningEffort: effort,
          behaviorPrompt: fileSpec.behaviorPrompt,
          scope: fileSpec.source,
          workspacePath,
        }),
      );
      return;
    }

    if (!effort) return;
    const effectivePrompt = selectEffectiveBehaviorPrompt.select(
      appStore.state,
      currentSpecialist.id,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id),
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: effort,
        behaviorPrompt: effectivePrompt || currentSpecialist.defaultBehaviorPrompt,
        scope: 'user',
      }),
    );
  }

  function handleCreateModelChange(compoundModelId: string) {
    // Empty string = the inherit ("use global default") option was picked.
    if (!compoundModelId) {
      newCodingAgent = undefined;
      newModel = undefined;
      return;
    }
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
            roleReminder: fileSpec.roleReminder,
            modelOptions: fileSpec.modelOptions,
            reasoningEffort: fileSpec.reasoningEffort,
            behaviorPrompt: prompt,
            scope: fileSpec.source,
            workspacePath,
          }),
        );
      }
    } else {
      // Built-in or legacy — export to user file with the change applied.
      // Only an explicit frontmatter model is kept: baking the daemon's
      // resolved preview into the file would turn a floating default into a
      // pin (model resolution is daemon-owned, PROTOCOL §5.11).
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
          model: currentSpecialist.defaultModel,
          roleReminder: currentSpecialist.roleReminder,
          modelOptions: currentSpecialist.modelOptions,
          reasoningEffort: currentSpecialist.reasoningEffort,
          behaviorPrompt: prompt,
          scope: 'user',
        }),
      );
    }
  }

  /**
   * Persist the committed model-option rows. Empty list ⇒ the key is omitted
   * on save (inherit is maintained — coordinator constraint; the mutation
   * service drops empty lists before the wire call). A built-in with no
   * override file gets one only when a non-empty list is committed, mirroring
   * the model-pin export path; clearing the last option on a user override
   * that then matches the bundled defaults deletes the file (monorepo#1450).
   */
  function handleModelOptionsCommit(options: SpecialistModelOption[]) {
    if (!currentSpecialist) return;
    const next = options.length > 0 ? options : undefined;

    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(appStore.state, currentSpecialist.id);
      if (!fileSpec) return;
      const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
      if (!next && !fileSpec.model && !fileSpec.codingAgent) {
        const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
        if (
          isRedundantBuiltInOverride({ ...fileSpec, modelOptions: undefined }, bundledSpecialists)
        ) {
          appStore.dispatch(
            deleteFileSpecialistAction({ id: fileSpec.id, scope: fileSpec.source, workspacePath }),
          );
          return;
        }
      }
      appStore.dispatch(
        saveFileSpecialist({
          id: fileSpec.id,
          name: fileSpec.name,
          description: fileSpec.description,
          codingAgent: fileSpec.codingAgent,
          model: fileSpec.model || undefined,
          roleReminder: fileSpec.roleReminder,
          modelOptions: next,
          reasoningEffort: fileSpec.reasoningEffort,
          behaviorPrompt: fileSpec.behaviorPrompt,
          scope: fileSpec.source,
          workspacePath,
        }),
      );
      return;
    }

    // Built-in with no override file: nothing to clear, and a non-empty list
    // exports to a user file with the options applied. As on the other
    // export paths (name/description saves), `defaultModel` is the bundled
    // definition's explicit frontmatter model (usually undefined) — never
    // the daemon's resolved preview, which must not be baked into the file.
    if (!next) return;
    const effectivePrompt = selectEffectiveBehaviorPrompt.select(
      appStore.state,
      currentSpecialist.id,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(appStore.state, currentSpecialist.id),
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: next,
        reasoningEffort: currentSpecialist.reasoningEffort,
        behaviorPrompt: effectivePrompt || currentSpecialist.defaultBehaviorPrompt,
        scope: 'user',
      }),
    );
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
        // Explicit frontmatter model only — never bake the daemon's resolved
        // preview into the file (it would pin a floating default).
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: currentSpecialist.reasoningEffort,
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
        // Explicit frontmatter model only — never bake the daemon's resolved
        // preview into the file (it would pin a floating default).
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: currentSpecialist.reasoningEffort,
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
    newCodingAgent = undefined;
    newModel = undefined;
    newPrompt = m.settings_aiBehavior_newPromptTemplate();
    onDiscard?.();
  }

  /**
   * Clear the explicit model pin from every file specialist that
   * has one so they all inherit the global default. Built-ins without an
   * override file already inherit — no file is created for them. Built-in
   * overrides that become identical to the bundled defaults once the pin
   * is cleared are deleted instead of rewritten (monorepo#1450).
   */
  function resetAllSpecialistsToInherit() {
    const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
    const { saves, deletes } = buildResetToInheritPayloads(
      $fileSpecialists$,
      bundledSpecialists,
      getCurrentWorkspacePath,
    );
    for (const payload of saves) {
      appStore.dispatch(saveFileSpecialist(payload));
    }
    for (const ref of deletes) {
      appStore.dispatch(deleteFileSpecialistAction(ref));
    }
  }

  /** Check if a built-in specialist has been customized (its user override differs from defaults) */
  function hasFileOverride(): boolean {
    if (!currentSpecialist) return false;
    return selectHasOverrides.select(appStore.state, currentSpecialist.id);
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
        {#if anySpecialistHasExplicitModel}
          <button
            type="button"
            onclick={resetAllSpecialistsToInherit}
            class="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer whitespace-nowrap"
          >
            {m.settings_aiBehavior_resetAllSpecialists()}
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
          showDefaultOption={true}
          defaultModelId={currentSpecialist.resolvedModel}
          defaultModelLabel={m.chat_modelPicker_providerDefault_label()}
          defaultOptionLabel={m.settings_aiBehavior_inheritModel_label()}
          defaultOptionDescription={m.settings_aiBehavior_inheritModel_description()}
          formatDefaultModelLabel={(model) =>
            m.settings_aiBehavior_inheritModelPreview_label({ model })}
          size="sm"
          variant="default"
        />
        <EffortSelect
          model={specialistEffortModel}
          value={specialistEffortValue}
          onChange={handleSpecialistEffortChange}
          testId="specialist-effort"
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

      <!-- Delegation model options (PROTOCOL §5.11 modelOptions). Keyed on
           the specialist id so draft rows never leak across specialist
           switches (remounting resets the component's local rows). -->
      <div class="mt-4">
        {#key currentSpecialist.id}
          <SpecialistModelOptions
            savedOptions={savedModelOptions}
            onCommit={handleModelOptionsCommit}
          />
        {/key}
      </div>
    </div>

    <!-- System Prompt (1fr) -->
    <div class="min-h-0 h-full">
      <AutoSaveTextarea
        value={effectiveBehaviorPrompt}
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
          showDefaultOption={true}
          defaultModelId={$selectedModel}
          defaultOptionLabel={m.settings_aiBehavior_inheritModel_label()}
          defaultOptionDescription={m.settings_aiBehavior_inheritModel_description()}
          formatDefaultModelLabel={(model) =>
            m.settings_aiBehavior_inheritModelPreview_label({ model })}
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
