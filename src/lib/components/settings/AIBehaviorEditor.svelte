<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SettingsDisclosure } from '$lib/components/patterns/settings';
  import { Button, Input, Textarea } from '$lib/components/patterns/settings/custom-controls';
  import Fa from 'svelte-fa';
  import { faPlus, faRotateLeft, faTrash, faPencil } from '@fortawesome/free-solid-svg-icons';

  import {
    selectProviderModelEffortLevels,
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
    selectSpecialistCreation,
    selectEffectiveCodingAgent,
    selectExplicitReasoningEffort,
    selectFileSpecialists,
    selectBundledSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import {
    deleteFileSpecialist as deleteFileSpecialistAction,
    saveFileSpecialist,
    updateSpecialistDraft,
    discardSpecialistDraft,
    createSpecialistFromDraft,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import AgentRulesEditor from './AgentRulesEditor.svelte';
  import AutoSaveTextarea from './AutoSaveTextarea.svelte';
  import type { AIBehaviorView } from './AIBehaviorSidebar.svelte';
  import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
  import SpecialistModelOptions from './SpecialistModelOptions.svelte';
  import { isRedundantBuiltInOverride } from './utils/builtin-override-redundancy';
  import { m } from '$shared/paraglide/messages.js';
  import { formatNumber } from '$lib/i18n/format';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { selectEffectiveDefaultProviderId } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import type { SpecialistModelOption } from '$shared/specialist-file-types';
  import type { SpecialistDraft } from '$store/renderer/slices/specialists/specialist-creation-types';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  interface Props {
    activeView: AIBehaviorView;
    /** Explicit owner for settings opened outside a workspace route. */
    workspaceId?: WorkspaceId | null;
    onSpecialistCreated?: (id: string) => void;
    onSpecialistDeleted?: () => void;
    onDiscard?: () => void;
  }

  let { activeView, workspaceId, onSpecialistCreated, onSpecialistDeleted, onDiscard }: Props =
    $props();

  const fileSpecialists$ = selectFileSpecialists();
  const selectedModel = selectSelectedModel();
  const defaultProviderId$ = selectEffectiveDefaultProviderId();
  const routeWorkspaceContext = getWorkspaceRouteContext();
  const routeWorkspaceId = $derived(
    workspaceId !== undefined ? workspaceId : routeWorkspaceContext?.workspaceId,
  );
  const specialists = $derived(selectSpecialists(routeWorkspaceId ?? undefined));

  function parseCompoundModelId(compoundModelId: string): {
    providerId: string;
    modelId: string;
  } {
    const { providerId, modelId } = splitLegacyCompoundId(compoundModelId);
    return { providerId: providerId ?? $defaultProviderId$, modelId };
  }

  function getCurrentWorkspacePath(): string | undefined {
    if (!routeWorkspaceId) return undefined;
    const workspace = selectWorkspaceById.select(appStore.state, routeWorkspaceId);
    return workspace?.path ?? workspace?.worktreePath ?? workspace?.repositoryPath;
  }

  const draftContext = $derived(routeWorkspaceId ? `workspace:${routeWorkspaceId}` : 'user');
  const creation$ = $derived(selectSpecialistCreation(draftContext));
  const newName = $derived($creation$.draft.name);
  const newDescription = $derived($creation$.draft.description);
  const newModel = $derived($creation$.draft.model);
  const newEffort = $derived($creation$.draft.reasoningEffort);
  const newPrompt = $derived(
    $creation$.draft.behaviorPrompt ?? m.settings_aiBehavior_newPromptTemplate(),
  );
  const creating = $derived($creation$.status === 'saving' || $creation$.status === 'refreshing');
  const refreshFailed = $derived($creation$.status === 'refresh-failed');
  const draftLocked = $derived(creating || refreshFailed);
  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  function updateDraft(patch: Partial<SpecialistDraft>) {
    appStore.dispatch(updateSpecialistDraft(draftContext, patch));
  }

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

  const currentSpecialist = $derived(
    activeView.type === 'specialist' ? $specialists.find((s) => s.id === activeView.id) : null,
  );

  const isImported = $derived(currentSpecialist?.importedFrom === 'claude-code');

  const isBuiltIn = $derived(
    currentSpecialist
      ? selectIsBuiltIn.select(appStore.state, currentSpecialist.id, routeWorkspaceId ?? undefined)
      : false,
  );

  const isFileBased = $derived(
    currentSpecialist
      ? selectIsFileBased.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        )
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
    return selectHasOverrides.select(
      appStore.state,
      currentSpecialist.id,
      routeWorkspaceId ?? undefined,
    );
  });

  const specialistFilePath = $derived(
    currentSpecialist
      ? selectSpecialistFilePath.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        )
      : undefined,
  );

  const sourceLabel = $derived(
    currentSpecialist
      ? selectSpecialistSourceLabel.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        )
      : null,
  );

  let _specialistCodingAgentValue = $state('');
  let specialistModelValue = $state<string | undefined>(undefined);
  let specialistEffortValue = $state<string | undefined>(undefined);

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
      ? selectEffectiveBehaviorPrompt.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        )
      : '';
  });

  // Sync the EXPLICIT frontmatter model from the specialist's owning scope
  // only — undefined when inheriting (the daemon resolvedModel preview is
  // shown via the picker's default-option plumbing instead). The stored
  // model is a BARE id (PROTOCOL §5.11); the picker boundary still speaks
  // compound ids, so the effective codingAgent is recombined for display.
  $effect(() => {
    if (currentSpecialist) {
      void $fileSpecialists$; // track file specialist changes
      // User/bundled saves update the global list before the route projection.
      const specialistWorkspaceId =
        currentSpecialist.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
      const codingAgent = selectEffectiveCodingAgent.select(
        appStore.state,
        currentSpecialist.id,
        specialistWorkspaceId,
      );
      _specialistCodingAgentValue = codingAgent;
      const explicitModel = selectExplicitModel.select(
        appStore.state,
        currentSpecialist.id,
        specialistWorkspaceId,
      );
      specialistModelValue =
        explicitModel && codingAgent && !explicitModel.includes(':')
          ? `${codingAgent}:${explicitModel}`
          : explicitModel;
      specialistEffortValue = selectExplicitReasoningEffort.select(
        appStore.state,
        currentSpecialist.id,
        specialistWorkspaceId,
      );
    }
  });

  /**
   * Drop an effort level the given model does not advertise, so switching to
   * a model without that level resets the dropdown to Default instead of
   * persisting an unsupported level (PROTOCOL §5.11 `reasoningEffort`). The
   * lookup is provider-scoped: a cross-provider pick consults the resolved
   * provider's cached catalog, not the active one.
   */
  function effortForModel(
    providerId: string | undefined,
    modelId: string | undefined,
    effort: string | undefined,
  ): string | undefined {
    if (!effort) return undefined;
    const levels = selectProviderModelEffortLevels.select(
      appStore.state,
      providerId,
      modelId,
      currentSpecialist?.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined,
    );
    return levels?.includes(effort) ? effort : undefined;
  }

  function handleSpecialistModelChange(
    compoundModelId: string,
    pick?: { providerId: string; modelId: string },
  ) {
    if (!currentSpecialist || isImported) return;

    // Empty string = the inherit ("use global default") option was picked:
    // clear the explicit pin so the saved file has no `model:` key. On a
    // built-in with no override file this is a no-op (nothing to clear —
    // creating a file would only pin other fields).
    if (!compoundModelId) {
      specialistModelValue = undefined;
      // The effort level now applies to the inherited (daemon-resolved)
      // model — drop it when that model lacks the level.
      const nextEffort = effortForModel(
        currentSpecialist.resolvedProvider,
        currentSpecialist.resolvedModel,
        specialistEffortValue,
      );
      specialistEffortValue = nextEffort;
      if (!isFileBased) return;
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
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
          deleteFileSpecialistAction({
            id: fileSpec.id,
            scope: fileSpec.source,
            workspaceId:
              fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined,
            workspacePath: fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined,
          }),
        );
        return;
      }
      const workspaceId =
        fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
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
          workspaceId,
        }),
      );
      return;
    }

    // Writes emit the bare model id only (PROTOCOL §5.11) — the provider
    // rides the `codingAgent:` key, never a compound `model:` id. Prefer the
    // resolved triple legs the picker emits (catalog-group attribution for
    // bare cross-provider picks); fall back to splitting a legacy compound id
    // (old persisted values).
    const resolved = pick ?? parseCompoundModelId(compoundModelId);
    const newProvider = resolved.providerId || $defaultProviderId$;
    const bareModelId = resolved.modelId;
    _specialistCodingAgentValue = newProvider;
    specialistModelValue = compoundModelId;
    // Reset the effort to Default when the newly picked model does not
    // advertise the current level.
    const nextEffort = effortForModel(newProvider || undefined, bareModelId, specialistEffortValue);
    specialistEffortValue = nextEffort;

    if (isFileBased) {
      // Already a file specialist (user or project) — update in place
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
      );
      if (fileSpec) {
        const workspaceId =
          fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
        const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
        appStore.dispatch(
          saveFileSpecialist({
            id: fileSpec.id,
            name: fileSpec.name,
            description: fileSpec.description,
            codingAgent: newProvider,
            model: bareModelId,
            roleReminder: fileSpec.roleReminder,
            modelOptions: fileSpec.modelOptions,
            reasoningEffort: nextEffort,
            behaviorPrompt: fileSpec.behaviorPrompt,
            scope: fileSpec.source,
            workspacePath,
            workspaceId,
          }),
        );
      }
    } else {
      // Built-in or legacy — export to user file with the change applied
      const effectivePrompt = selectEffectiveBehaviorPrompt.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
      );
      appStore.dispatch(
        saveFileSpecialist({
          id: currentSpecialist.id,
          name: currentSpecialist.name,
          description: currentSpecialist.description,
          codingAgent: newProvider,
          model: bareModelId,
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
    if (!currentSpecialist || isImported) return;
    specialistEffortValue = effort;

    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
      );
      if (!fileSpec) return;
      const workspaceId =
        fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
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
            deleteFileSpecialistAction({
              id: fileSpec.id,
              scope: fileSpec.source,
              workspacePath,
              workspaceId,
            }),
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
          workspaceId,
        }),
      );
      return;
    }

    if (!effort) return;
    const effectivePrompt = selectEffectiveBehaviorPrompt.select(
      appStore.state,
      currentSpecialist.id,
      routeWorkspaceId ?? undefined,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: effort,
        behaviorPrompt: effectivePrompt || currentSpecialist.defaultBehaviorPrompt,
        scope: 'user',
      }),
    );
  }

  function handleCreateModelChange(
    compoundModelId: string,
    pick?: { providerId: string; modelId: string },
  ) {
    // Empty string = the inherit ("use global default") option was picked.
    if (!compoundModelId) {
      updateDraft({
        codingAgent: undefined,
        model: undefined,
        reasoningEffort: effortForModel(
          $defaultProviderId$ || undefined,
          $selectedModel,
          newEffort,
        ),
      });
      return;
    }
    // Prefer the resolved triple legs the picker emits (catalog-group
    // attribution for bare cross-provider picks); fall back to splitting a
    // legacy compound id (old persisted values).
    const resolved = pick ?? parseCompoundModelId(compoundModelId);
    const provider = resolved.providerId || $defaultProviderId$;
    updateDraft({
      codingAgent: provider,
      model: compoundModelId,
      reasoningEffort: effortForModel(provider || undefined, resolved.modelId, newEffort),
    });
  }

  function handlePromptSave(prompt: string) {
    if (!currentSpecialist || isImported) return;
    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
      );
      if (fileSpec) {
        const workspaceId =
          fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
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
            workspaceId,
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
        routeWorkspaceId ?? undefined,
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
    if (!currentSpecialist || isImported) return;
    const next = options.length > 0 ? options : undefined;

    if (isFileBased) {
      const fileSpec = selectGetFileSpecialist.select(
        appStore.state,
        currentSpecialist.id,
        routeWorkspaceId ?? undefined,
      );
      if (!fileSpec) return;
      const workspaceId =
        fileSpec.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined;
      const workspacePath = fileSpec.source === 'project' ? getCurrentWorkspacePath() : undefined;
      if (!next && !fileSpec.model && !fileSpec.codingAgent) {
        const bundledSpecialists = selectBundledSpecialists.select(appStore.state);
        if (
          isRedundantBuiltInOverride({ ...fileSpec, modelOptions: undefined }, bundledSpecialists)
        ) {
          appStore.dispatch(
            deleteFileSpecialistAction({
              id: fileSpec.id,
              scope: fileSpec.source,
              workspacePath,
              workspaceId,
            }),
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
          workspaceId,
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
      routeWorkspaceId ?? undefined,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
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
    if (!currentSpecialist || isImported) return;
    const trimmed = newNameValue.trim();
    if (!trimmed || trimmed === currentSpecialist.name) return;

    const fileSpec = selectGetFileSpecialist.select(
      appStore.state,
      currentSpecialist.id,
      routeWorkspaceId ?? undefined,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: trimmed,
        description: currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
        // Explicit frontmatter model only — never bake the daemon's resolved
        // preview into the file (it would pin a floating default).
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: currentSpecialist.reasoningEffort,
        behaviorPrompt: selectEffectiveBehaviorPrompt.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
        workspaceId: fileSpec?.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined,
      }),
    );
  }

  function handleDescriptionSave(newDescValue: string) {
    if (!currentSpecialist || isImported) return;
    const trimmed = newDescValue.trim();
    if (trimmed === currentSpecialist.description) return;

    const fileSpec = selectGetFileSpecialist.select(
      appStore.state,
      currentSpecialist.id,
      routeWorkspaceId ?? undefined,
    );
    appStore.dispatch(
      saveFileSpecialist({
        id: currentSpecialist.id,
        name: currentSpecialist.name,
        description: trimmed || currentSpecialist.description,
        codingAgent: selectEffectiveCodingAgent.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
        // Explicit frontmatter model only — never bake the daemon's resolved
        // preview into the file (it would pin a floating default).
        model: currentSpecialist.defaultModel,
        roleReminder: currentSpecialist.roleReminder,
        modelOptions: currentSpecialist.modelOptions,
        reasoningEffort: currentSpecialist.reasoningEffort,
        behaviorPrompt: selectEffectiveBehaviorPrompt.select(
          appStore.state,
          currentSpecialist.id,
          routeWorkspaceId ?? undefined,
        ),
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
        workspaceId: fileSpec?.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined,
      }),
    );
  }

  function resetToDefault() {
    if (!currentSpecialist || isImported) return;
    // Delete the user override file so the specialist reverts to bundled defaults
    appStore.dispatch(
      deleteFileSpecialistAction({
        id: currentSpecialist.id,
        scope: 'user',
      }),
    );
  }

  function deleteSpecialist() {
    if (!currentSpecialist || isImported) return;
    // Capture values before deletion since currentSpecialist is a $derived
    // that will become null once the specialist is removed from the store
    const specialistId = currentSpecialist.id;
    const fileSpec = selectGetFileSpecialist.select(
      appStore.state,
      specialistId,
      routeWorkspaceId ?? undefined,
    );
    appStore.dispatch(
      deleteFileSpecialistAction({
        id: specialistId,
        scope: fileSpec?.source ?? 'user',
        workspacePath: fileSpec?.source === 'project' ? getCurrentWorkspacePath() : undefined,
        workspaceId: fileSpec?.source === 'project' ? (routeWorkspaceId ?? undefined) : undefined,
      }),
    );
    onSpecialistDeleted?.();
  }

  async function createSpecialist() {
    const current = selectSpecialistCreation.select(appStore.state, draftContext);
    if (
      current.status === 'saving' ||
      current.status === 'refreshing' ||
      !current.draft.name.trim() ||
      (current.draft.behaviorPrompt?.length ?? 0) > MAX_PROMPT_LENGTH
    )
      return;
    const submittedView = activeView;
    const submittedContext = draftContext;
    const action = createSpecialistFromDraft(draftContext, routeWorkspaceId ?? undefined);
    appStore.dispatch(action);
    try {
      const id = await action.promise;
      if (mounted && activeView === submittedView && draftContext === submittedContext) {
        onSpecialistCreated?.(id);
      }
    } catch {
      // Errors are retained by the saga.
    }
  }

  function discardNewSpecialist() {
    if (creating) return;
    appStore.dispatch(discardSpecialistDraft(draftContext));
    onDiscard?.();
  }
</script>

<div
  class="editor-container full-height-editor-container flex-1 xl:flex xl:h-full xl:min-h-0 xl:flex-col {activeView.type ===
  'specialist'
    ? 'specialist-editor-container'
    : ''}"
>
  <!-- System Prompt View -->
  {#if activeView.type === 'system-prompt'}
    <div
      data-testid="all-agents-editor-layout"
      class="flex min-w-0 flex-col gap-4 xl:h-full xl:min-h-0 xl:flex-1"
    >
      <p class="type-body text-muted-foreground">
        {m.settings_agentRules_description()}
      </p>
      <div
        data-testid="all-agents-prompt-column"
        class="min-h-0 min-w-0 w-full xl:flex xl:flex-1 xl:flex-col"
      >
        <AgentRulesEditor class="xl:min-h-0 xl:flex-1" />
      </div>
    </div>

    <!-- Specialist Editor View -->
  {:else if activeView.type === 'specialist' && currentSpecialist}
    <div
      data-testid="specialist-editor-layout"
      class="grid min-w-0 grid-cols-1 gap-8 xl:h-full xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-stretch"
    >
      <!-- Keep the prompt first so narrow layouts and keyboard order prioritize editing. -->
      <div
        data-testid="specialist-prompt-column"
        class="min-h-0 min-w-0 h-full xl:flex xl:flex-col"
      >
        <div
          data-testid="specialist-prompt-header"
          class="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2"
        >
          {#if !isImported && !isBuiltIn && !hasOverrides}
            <Input
              type="text"
              value={currentSpecialist.name}
              onblur={(e) => handleNameSave(e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              aria-label={m.settings_aiBehavior_name_label()}
              placeholder={m.settings_aiBehavior_specialistName_placeholder()}
              class="min-w-0 flex-1 type-title font-medium text-foreground bg-transparent border-none outline-none px-0 py-0 focus:ring-0 focus:outline-none placeholder:text-muted-foreground"
            />
          {:else}
            <h2 class="type-title font-medium text-foreground">{currentSpecialist.name}</h2>
            {#if !isImported && isBuiltIn && hasOverrides}
              <span
                class="type-caption px-1.5 py-0.5 rounded bg-primary/15 text-primary-ink font-medium inline-flex items-center gap-1"
              >
                <Fa icon={faPencil} class="w-2.5 h-2.5" />
                {m.settings_aiBehavior_modifiedBadge()}
              </span>
            {/if}
          {/if}
          {#if !isImported && isBuiltIn && hasOverrides}
            <Button
              variant="plain"
              size="sm"
              type="button"
              onclick={resetToDefault}
              class="h-auto type-caption text-muted-foreground hover:text-foreground gap-1"
            >
              <Fa icon={faRotateLeft} class="w-3 h-3" />
              {m.settings_aiBehavior_reset()}
            </Button>
          {/if}
          {#if specialistFilePath}
            <div class="ml-auto shrink-0">
              <OpenComboButton
                filePath={specialistFilePath}
                isDirectory={false}
                workspaceId={routeWorkspaceId ?? undefined}
              />
            </div>
          {/if}
        </div>
        {#if isImported}
          <Textarea
            value={effectiveBehaviorPrompt}
            readonly
            aria-label={m.settings_aiBehavior_systemPrompt_placeholder()}
            rows={12}
            class="xl:min-h-0 xl:flex-1"
          />
        {:else}
          <AutoSaveTextarea
            value={effectiveBehaviorPrompt}
            originalValue={currentSpecialist.defaultBehaviorPrompt}
            placeholder={m.settings_aiBehavior_systemPrompt_placeholder()}
            minRows={12}
            maxLength={50000}
            onSave={handlePromptSave}
            class="xl:min-h-0 xl:flex-1"
          />
        {/if}
      </div>

      <div data-testid="specialist-details-column" class="flex min-w-0 flex-col gap-6 xl:pt-8">
        <!-- Specialist identity and source context. -->
        <div class="min-w-0">
          {#if !isImported && !isBuiltIn && !hasOverrides}
            <Input
              type="text"
              value={currentSpecialist.description}
              onblur={(e) => handleDescriptionSave(e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder={m.settings_aiBehavior_specialistDescription_placeholder()}
              class="type-body mt-1 w-full border-none bg-transparent px-0 py-0 text-muted-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
            />
          {:else}
            <p class="type-body mt-1 text-muted-foreground">{currentSpecialist.description}</p>
          {/if}

          {#if isImported}
            <p class="type-body mt-2 font-medium text-foreground">
              {m.settings_aiBehavior_importedClaude_title()}
            </p>
            <p class="type-body mt-2 text-muted-foreground">
              {m.settings_aiBehavior_importedClaude_readOnly()}
            </p>
            {#if currentSpecialist.missingSkills?.length}
              <p
                data-testid="specialist-missing-skills"
                role="status"
                class="type-body mt-2 text-danger"
              >
                {m.settings_aiBehavior_importMissingSkills({
                  skills: currentSpecialist.missingSkills.join(', '),
                })}
              </p>
            {/if}
            {#if currentSpecialist.unsupportedFields?.length}
              <p data-testid="specialist-import-warning" class="type-body mt-2 text-danger">
                {m.settings_aiBehavior_importedClaude_unsupported({
                  fields: currentSpecialist.unsupportedFields.join(', '),
                })}
              </p>
            {/if}
          {:else if !isBuiltIn}
            <p class="type-body mt-2 text-muted-foreground">
              {#if sourceLabel === 'Project'}
                {m.settings_aiBehavior_projectInfo_before()}
                <code class="bg-muted px-1 py-0.5 rounded break-all"
                  >{specialistFilePath?.replace(/^\/Users\/[^/]+/, '~') ?? ''}</code
                >.
              {:else}
                {m.settings_aiBehavior_personalInfo_before()}
                <code class="bg-muted px-1 py-0.5 rounded break-all"
                  >{specialistFilePath?.replace(/^\/Users\/[^/]+/, '~') ?? ''}</code
                >.
                {m.settings_aiBehavior_personalInfo_middle()}
                <!-- i18n-ignore (file path) -->
                <code class="bg-muted px-1 py-0.5 rounded">&lt;repo&gt;/.intent/specialists/</code>
                {m.settings_aiBehavior_personalInfo_after()}
              {/if}
            </p>
          {/if}
          {#if !isImported}
            <p class="type-body mt-2 text-muted-foreground">
              {m.settings_aiBehavior_usageHint()}
            </p>
          {/if}
        </div>

        <!-- Preserve the specialist model, reasoning, and delegation controls. -->
        <div class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <span class="type-body shrink-0 font-medium text-foreground">
              {m.settings_aiBehavior_model_label()}
            </span>
            {#if isImported}
              <span class="type-body text-muted-foreground"
                >{currentSpecialist.defaultModel ||
                  m.settings_aiBehavior_inheritModel_label()}</span
              >
            {:else}
              <ModelPicker
                workspaceId={currentSpecialist.source === 'project'
                  ? (routeWorkspaceId ?? undefined)
                  : undefined}
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
                showReasoning
                reasoningEffort={specialistEffortValue ?? null}
                onReasoningChange={(effort) => handleSpecialistEffortChange(effort ?? undefined)}
              />
            {/if}
          </div>

          <!-- Delegation model options (PROTOCOL §5.11 modelOptions). Keyed on
               the specialist id so draft rows never leak across specialist
               switches (remounting resets the component's local rows). -->
          {#if !isImported}
            <SettingsDisclosure
              label={m.settings_aiBehavior_advanced_label()}
              class="mt-4"
              flush
              muted
            >
              {#key currentSpecialist.id}
                <SpecialistModelOptions
                  workspaceId={currentSpecialist.source === 'project'
                    ? (routeWorkspaceId ?? undefined)
                    : undefined}
                  savedOptions={savedModelOptions}
                  onCommit={handleModelOptionsCommit}
                />
              {/key}
            </SettingsDisclosure>
          {/if}
        </div>

        {#if !isImported && !isBuiltIn}
          <div class="pt-4 border-border">
            <Button
              variant="ghost"
              type="button"
              onclick={deleteSpecialist}
              class="type-body text-muted-foreground hover:text-danger transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Fa icon={faTrash} class="w-3 h-3" />
              {m.settings_aiBehavior_deleteSpecialist()}
            </Button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Create Specialist View -->
  {:else if activeView.type === 'create-specialist'}
    <div
      data-testid="create-specialist-editor-layout"
      class="grid min-w-0 grid-cols-1 gap-8 xl:h-full xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:items-stretch"
    >
      <!-- Keep the prompt first so narrow layouts and keyboard order prioritize editing. -->
      <div
        data-testid="create-specialist-prompt-column"
        class="min-h-0 min-w-0 h-full xl:flex xl:flex-col"
      >
        <h2 class="mb-2 shrink-0 type-title font-medium text-foreground">
          {m.settings_aiBehavior_createSpecialist_title()}
        </h2>
        <div class="flex min-h-0 flex-1 flex-col gap-1.5">
          <Textarea
            id="create-specialist-prompt"
            bind:value={() => newPrompt, (value) => updateDraft({ behaviorPrompt: value })}
            disabled={draftLocked}
            placeholder={m.settings_aiBehavior_newPrompt_placeholder()}
            class="min-h-72 w-full grow resize-none rounded-lg border border-border bg-background p-3 type-body
              xl:min-h-0
              {newPromptIsOverLimit ? 'border-danger' : ''}"
          ></Textarea>
          {#if newPromptIsApproachingLimit || newPromptIsOverLimit}
            <div
              class="flex shrink-0 items-center justify-end type-caption {newPromptIsOverLimit
                ? 'text-danger'
                : 'text-warning-ink'}"
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
      </div>

      <div
        data-testid="create-specialist-details-column"
        class="flex min-w-0 flex-col gap-4 xl:pt-8"
      >
        <div>
          <label
            for="create-specialist-name"
            class="type-body font-medium text-foreground block mb-1.5"
          >
            {m.settings_aiBehavior_name_label()}
          </label>
          <Input
            id="create-specialist-name"
            noFocusStyle
            type="text"
            bind:value={() => newName, (value) => updateDraft({ name: value })}
            disabled={draftLocked}
            placeholder={m.settings_aiBehavior_name_placeholder()}
          />
        </div>

        <div>
          <label
            for="create-specialist-description"
            class="type-body font-medium text-foreground block mb-1.5"
          >
            {m.settings_aiBehavior_description_label()}
          </label>
          <Input
            id="create-specialist-description"
            noFocusStyle
            type="text"
            bind:value={() => newDescription, (value) => updateDraft({ description: value })}
            disabled={draftLocked}
            placeholder={m.settings_aiBehavior_description_placeholder()}
          />
        </div>

        <fieldset disabled={draftLocked} class="flex items-center gap-3">
          <span class="type-body shrink-0 font-medium text-foreground">
            {m.settings_aiBehavior_model_label()}
          </span>
          <ModelPicker
            selectedModel={newModel}
            providerId={$creation$.draft.codingAgent}
            onModelChange={handleCreateModelChange}
            showDefaultOption={true}
            defaultModelId={$selectedModel}
            defaultOptionLabel={m.settings_aiBehavior_inheritModel_label()}
            defaultOptionDescription={m.settings_aiBehavior_inheritModel_description()}
            formatDefaultModelLabel={(model) =>
              m.settings_aiBehavior_inheritModelPreview_label({ model })}
            variant="default"
            size="sm"
            showReasoning
            reasoningEffort={newEffort ?? null}
            onReasoningChange={(effort) => {
              updateDraft({ reasoningEffort: effort ?? undefined });
            }}
          />
        </fieldset>

        {#if $creation$.error}
          <p role="alert" class="type-body text-danger">{$creation$.error}</p>
        {/if}
        <div class="pt-4 border-border">
          <div class="flex justify-end gap-2">
            <Button variant="ghost" onclick={discardNewSpecialist} disabled={creating}>
              {m.settings_aiBehavior_discard()}
            </Button>
            <Button
              variant="default"
              onclick={createSpecialist}
              loading={creating}
              disabled={!newName.trim() || newPromptIsOverLimit}
            >
              {#if !creating && !refreshFailed}
                <Fa icon={faPlus} class="w-3.5 h-3.5 mr-1.5" />
              {/if}
              {refreshFailed
                ? m.ui_errorToast_retry_label()
                : m.settings_aiBehavior_createSpecialist_title()}
            </Button>
          </div>
        </div>
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

  @media (min-width: 1280px) {
    .editor-container.full-height-editor-container {
      display: flex;
      flex-direction: column;
      grid-template-rows: none;
      flex: 1 1 0%;
      height: 100%;
      min-height: 0;
    }
  }
</style>
