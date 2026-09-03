<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * OnboardingPage - Extracted from +page.svelte
   *
   * Contains all onboarding-specific state, handlers, effects, and template
   * for the workspace creation flow (/workspace/new).
   */

  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$shared/generated/ipc-client';
  import { appClient } from '$lib/client';
  import {
    clearNewWorkspaceDraft,
    createNewWorkspaceDraftSaver,
    LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
    restoreNewWorkspaceDraft,
  } from '$lib/components/workspace/initializer/new-workspace-draft';
  import {
    enhancePrompt,
    EnhancePromptUnavailableError,
    isEnhancePromptAvailable,
  } from '$lib/client/live/live-prompt-enhancement';
  import {
    selectEffectiveDefaultProviderId,
    selectProviderCatalogEntries,
  } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { goto } from '$app/navigation';
  import { v4 as uuidv4 } from 'uuid';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';

  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import {
    selectOnboardingStep,
    selectOnboardingState,
    selectOnboardingFullFlowRequested,
  } from '$store/renderer/slices/onboarding/onboarding-selectors';
  import {
    goToStep,
    setProjectConfig,
    setOnboardingWorkspaceId,
    resetOnboarding,
    setOnboardingFullFlowRequested,
  } from '$store/renderer/slices/onboarding/onboarding-slice';
  import { STEP_ORDER as ONBOARDING_STEP_ORDER } from '$store/renderer/slices/onboarding/onboarding-types';
  import {
    beginWorkspaceCreateProgress,
    clearWorkspaceCreateProgress,
  } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
  import { cancelGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { selectGitHubAuthIsAuthenticating } from '$store/renderer/slices/github-auth/github-auth-selectors';

  import ProjectPickerMessage from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import type { IssueSelectionData } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { parseGitHubUrl } from '$lib/utils/workspace-validation';

  import PullConflictDialog, {
    type PullErrorType,
  } from '$lib/components/modals/PullConflictDialog.svelte';

  import AgentGrid from '$features/onboarding/messages/AgentGrid.svelte';

  import OnboardingPromptStep from '$features/onboarding/steps/OnboardingPromptStep.svelte';
  import OnboardingGitHubStep from '$features/onboarding/steps/OnboardingGitHubStep.svelte';
  import OnboardingRequirementsStep from '$features/onboarding/steps/OnboardingRequirementsStep.svelte';
  import {
    selectAllRequirementsMet,
    selectHostRequirementsHasCheckedOnce,
  } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import {
    selectProviderStatusMap,
    selectHasCheckedOnce as selectProvidersCheckedOnce,
  } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import {
    checkSingleProviderRequested,
    ensureProvidersChecked,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { hasReadyProvider } from '$store/renderer/slices/setup-prompt/setup-prompt-utils';
  import { selectHasCompletedProviderSetup } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { hasAvailableWorkspace } from '$features/workspace/utils/empty-window-destination';
  import {
    determineOnboardingInitialStep,
    resolveFastPathSettlement,
  } from '$features/onboarding/utils/determine-onboarding-initial-step';

  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { shell } from '$lib/electron-bridge';
  import { runProviderTestPrompt } from '$features/providers/provider-test-prompt.client';
  import {
    mapTestPromptFailure,
    providerSupportsTestPrompt,
    type TestPromptFailureGuidance,
  } from '$features/onboarding/utils/onboarding-test-prompt';
  import type { ProjectSelection } from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { shouldPullSourceRepositoryBeforeCreate } from '$lib/components/workspace/initializer/workspace-create-pull-policy';
  import { buildContextLinks } from '$lib/components/workspace/initializer/context-links';

  import { createAgentTypeId } from '$shared/types/agent.types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { resolveOnboardingModel } from '$features/onboarding/utils/resolve-onboarding-model';
  import { commitOnboardingDefaultModel } from '$features/onboarding/utils/commit-onboarding-default-model';
  import { shouldTreatAsNewRepo } from '$features/onboarding/utils/treat-as-new-repo';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import {
    parseContextMentions,
    parseFileMentions,
    parseRuntimeMentions,
    extractLinearIssue,
    extractSentryIssue,
    type ContextReference,
  } from '$features/onboarding/utils/parse-context-references';
  import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { hasBlockingAttachments, type ContextItem } from '$lib/components/chat/input/context-api';
  import {
    hasStagedFileItems,
    redeemStagedAttachments,
    sendHeldFirstMessage,
  } from '$lib/components/workspace/initializer/staged-attachments';
  import {
    SETUP_SCRIPT_TEMPLATES,
    getTemplateContent,
    chooseDefaultSetupScript,
    createRepoConfigProbeScheduler,
    resolveSetupScriptParam,
    REPO_CONFIG_SCRIPT_NAME,
    type SetupScriptNameSource,
  } from '$features/setup-scripts';
  import {
    getLastUsedSetupScript,
    recordLastUsedSetupScript,
  } from '$features/setup-scripts/last-used';
  import { setHasCompletedProviderSetup } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    cancelWorkspaceInitializerOnboardingFormStateDebounce,
    debounceWorkspaceInitializerOnboardingFormState,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import {
    selectWorkspaceInitializerHydrated,
    selectWorkspaceInitializerOnboardingFormState,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { selectModel } from '$store/renderer/slices/model/model-slice';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import { hydrateWorkspaceNavigation } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { bootstrapNewWorkspaceLayout } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { createLogger } from '$lib/utils/client-logger';
  import { cn } from '$lib/utils';

  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { getRandomSuggestions } from '$features/onboarding/utils/prompt-suggestions';
  import {
    findEmbeddedPRBranch,
    hasGitHubPRMention,
    findPRNeedingBranchFetch,
  } from '$features/onboarding/utils/detect-pr-branch';
  import { store as appStore } from '$store/renderer/store';
  const logger = createLogger('onboarding-page');

  const WORKSPACE_PREFILL_KEY = 'workspace-prefill';

  // ============================================================================
  // Props
  // ============================================================================

  interface Props {
    /** Whether this is an onboarding page (workspaceId === 'new') */
    isOnboarding: boolean;
    /** Whether the onboarding is fading out (crossfade transition) */
    fadingOut: boolean;
    /** Callback when hold-active state changes (for crossfade in parent) */
    onHoldActiveChange: (active: boolean) => void;
    /** Callback when fading-out state changes (for crossfade in parent) */
    onFadingOutChange: (fadingOut: boolean) => void;
  }

  let { isOnboarding, fadingOut, onHoldActiveChange, onFadingOutChange }: Props = $props();

  // ============================================================================
  // Onboarding State
  // ============================================================================

  const onboardingStep$ = selectOnboardingStep();
  const onboardingState$ = selectOnboardingState();
  const workspaceInitializerHydrated$ = selectWorkspaceInitializerHydrated();
  const allRequirementsMet$ = selectAllRequirementsMet();
  const requirementsCheckedOnce$ = selectHostRequirementsHasCheckedOnce();
  const providerStatusMap$ = selectProviderStatusMap();
  const providersCheckedOnce$ = selectProvidersCheckedOnce();
  const workspaceItems$ = selectWorkspaceItems();
  const providerCatalogEntries$ = selectProviderCatalogEntries();

  let projectSelection = $state<ProjectSelection | null>(null);
  let projectName = $derived.by(() => {
    if (!projectSelection) return '';
    if (projectSelection.type === 'new') {
      return projectSelection.projectName;
    }
    if (projectSelection.type === 'github') {
      return projectSelection.githubUrl?.split('/').pop() || '';
    }
    if (projectSelection.type === 'local') {
      return projectSelection.repoPath.split('/').pop() || '';
    }
    return '';
  });

  // Detected GitHub owner/repo from local repo's git remote
  let detectedGitHubOwner = $state<string | null>(null);
  let detectedGitHubRepo = $state<string | null>(null);

  // Generation counter guarding the remote-URL probe against out-of-order
  // async responses after rapid repo switches
  let remoteUrlProbeGeneration = 0;

  // Key of the last-probed selection. The effect re-runs on every
  // projectSelection reassignment (including branch-only changes); when the
  // repo path/type are unchanged, keep the detected owner/repo and skip the
  // clear + re-probe so the suffix doesn't flicker (reviewer note on #447)
  let lastRemoteUrlProbeKey: string | null = null;

  // Fetch remote URL when a local repo is selected
  $effect(() => {
    const path = projectSelection?.repoPath;
    const type = projectSelection?.type;
    const probeKey = `${type ?? ''}\u0000${path ?? ''}`;
    if (probeKey === lastRemoteUrlProbeKey) {
      return;
    }
    lastRemoteUrlProbeKey = probeKey;
    const generation = ++remoteUrlProbeGeneration;

    // Clear synchronously so a repo switch never briefly shows the previous
    // repo's detected owner/repo
    detectedGitHubOwner = null;
    detectedGitHubRepo = null;

    if (type !== 'local' || !path || (!path.startsWith('/') && !path.startsWith('~'))) {
      return;
    }

    (async () => {
      try {
        const response =
          typeof window !== 'undefined' && window.electronAPI
            ? await invoke<any>('git-tracking:get-remote-url', {
                repoPath: path,
              })
            : undefined;
        // Drop stale responses: the repo changed while this probe was in flight
        if (generation !== remoteUrlProbeGeneration) {
          return;
        }
        if (response?.success && response.data?.owner && response.data?.repo) {
          detectedGitHubOwner = response.data.owner;
          detectedGitHubRepo = response.data.repo;
        }
      } catch {
        // Ignore probe failures — the detected owner/repo is already cleared
      }
    })();
  });

  // Derived GitHub owner/repo for IssueSuggestions
  const onboardingGithubRepoInfo = $derived.by(() => {
    if (projectSelection?.githubUrl) {
      return parseGitHubUrl(projectSelection.githubUrl);
    }
    if (detectedGitHubOwner && detectedGitHubRepo) {
      return { owner: detectedGitHubOwner, repo: detectedGitHubRepo };
    }
    return null;
  });

  // Auto-restore last used setup script when the repo changes, and re-probe
  // the repo config when the GitHub branch changes (monorepo#835). The
  // scheduler keys runs on repo identity + ref: repo switches restore and
  // probe at once, branch-only changes re-probe debounced.
  const setupScriptProbeScheduler = createRepoConfigProbeScheduler();
  $effect(() => {
    const path = projectSelection?.repoPath ?? null;
    const type = projectSelection?.type;
    // Only read githubUrl/branch for GitHub selections so the effect doesn't
    // track them (and re-run) while a local repo is selected.
    const identity = {
      path,
      type,
      githubUrl: type === 'github' ? projectSelection?.githubUrl : null,
      branch: type === 'github' ? projectSelection?.branch : null,
    };

    setupScriptProbeScheduler.onSelectionChange({
      identity,
      onRepoChange: ({ preservedRestoredState }) => {
        // Repo changed — invalidate any cached repo-config script
        repoConfigScript = null;
        repoConfigScriptRepo = null;

        // On initial mount, don't override if there's already a setup script
        // set (e.g., from restored form state). On repo switches, always
        // restore.
        if (!preservedRestoredState) {
          // Restore last used script for this repo (or clear if no saved script exists)
          if (path) {
            restoreLastUsedSetupScript(path);
          } else {
            setupScript = '';
            setupScriptName = 'Custom';
            setupScriptNameSource = 'custom';
            isCustomSetupScript = false;
          }
        }
      },
      getCurrentIdentity: () => ({
        path: projectSelection?.repoPath ?? null,
        type: projectSelection?.type,
        githubUrl: projectSelection?.githubUrl,
        branch: projectSelection?.branch,
      }),
      getSetupScript: () => setupScript,
      isSetupScriptModalOpen: () => showSetupScript,
      isCustomSetupScript: () => isCustomSetupScript,
      setLoading: (loading) => (isRepoConfigLoading = loading),
      onProbeResult: (script) => {
        repoConfigScript = script;
        repoConfigScriptRepo = path;
      },
      applyScript: (script) => {
        setupScript = script;
        setupScriptName = REPO_CONFIG_SCRIPT_NAME;
        setupScriptNameSource = 'repo-config';
        isCustomSetupScript = false;
      },
    });
  });

  // Set when the initial prompt was seeded from the legacy sessionStorage key
  // (not a WORKSPACE_PREFILL_KEY prefill): the shared daemon draft may be
  // NEWER than that stale value, so the restore below lets the daemon draft
  // win over an untouched legacy seed.
  let legacySeededPrompt = '';

  function getInitialOnboardingPrompt(): string {
    try {
      const prefill = sessionStorage.getItem(WORKSPACE_PREFILL_KEY);
      if (prefill) {
        const data = JSON.parse(prefill) as { prompt?: unknown };
        if (typeof data.prompt === 'string') return data.prompt;
      }
    } catch {
      // Ignore malformed prefill data; ProjectPickerMessage clears it after parsing.
    }
    // Legacy sessionStorage draft: captured synchronously here, before the
    // onMount resetOnboarding dispatch lets the workspace-initializer saga
    // remove the key. A captured value migrates to the daemon draft via the
    // debounced save below.
    legacySeededPrompt = sessionStorage.getItem(LEGACY_ONBOARDING_PROMPT_SESSION_KEY) || '';
    return legacySeededPrompt;
  }

  const initialOnboardingPrompt = getInitialOnboardingPrompt();
  let onboardingInputValue = $state(initialOnboardingPrompt);
  let promptStepRef: OnboardingPromptStep | null = $state(null);
  let isOnboardingEnhancing = $state(false);
  // Non-image files staged path-only in the prompt step; placed into the
  // workspace at create (`file.placeAttachment`, PROTOCOL §5.9) and
  // referenced from the first message via attachment-reference blocks.
  let onboardingStagedItems = $state<ContextItem[]>([]);
  // Image attachments as context items (`imageData`/`imageMimeType`),
  // rendered as a thumbnail row in the prompt step — never inline in the
  // editor; sent as attachment-reference blocks on the first message.
  let onboardingImageItems = $state<ContextItem[]>([]);
  // Set when the workspace was created but staged-attachment placement (or
  // the held first-message send) failed: submit resumes this flow instead of
  // creating a second workspace. The created workspace is never rolled back.
  let onboardingPendingSend = $state<{
    workspaceId: string;
    agentId?: string;
    prompt: string;
    contextReferences: ContextReference[];
  } | null>(null);

  // §5.31 gate — enhance is auggie-only; the daemon derives the effective
  // provider from settings, so the FE mirror gates on the same derivation.
  const effectiveProviderId$ = selectEffectiveDefaultProviderId();
  const enhancePromptAvailable = $derived(isEnhancePromptAvailable($effectiveProviderId$));

  /** Get the RichTextarea from the prompt step sub-component. */
  function getOnboardingRichTextarea(): RichTextarea | null {
    return promptStepRef?.getRichTextarea() ?? null;
  }

  // Analytics funnel tracking
  let hasFiredOnboardingClick = $state(false);
  let hasFiredOnboardingType = $state(false);

  // Onboarding prompt drafts live in the daemon (drafts.* under the reserved
  // sentinel keys, PROTOCOL §5.16) so text + image attachments survive app
  // restarts. Until the restore settles, saves are limited to text the user
  // actually typed (see scheduleOnboardingDraftSave) and empty saves are
  // skipped, so an initial empty/seeded save cannot clobber a not-yet-read
  // daemon draft; if the restore failed, empty saves stay skipped so a draft
  // that was never read can't be cleared. All drafts.* failures are non-fatal.
  let onboardingDraftRestored = $state(false);
  let onboardingDraftRestoreFailed = false;
  // Set after a successful create: the draft is cleared and must not be
  // re-saved by a late flush or effect re-run.
  let onboardingDraftCleared = false;
  const onboardingDraftSaver = createNewWorkspaceDraftSaver(appClient.drafts, {
    skipEmptySave: () => !onboardingDraftRestored || onboardingDraftRestoreFailed,
  });
  (async () => {
    try {
      const restore = await restoreNewWorkspaceDraft(appClient.drafts, {
        legacyKey: LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
      });
      onboardingDraftRestoreFailed = restore.status === 'error';
      if (restore.status === 'restored') {
        // Never clobber a WORKSPACE_PREFILL_KEY prefill or text the user
        // typed while the restore was pending. An UNTOUCHED legacy
        // sessionStorage seed is the exception: the shared daemon draft is
        // authoritative and supersedes that stale value.
        const inputUntouched =
          !onboardingInputValue ||
          (!!legacySeededPrompt && onboardingInputValue === legacySeededPrompt);
        if (restore.text && inputUntouched) {
          onboardingInputValue = restore.text;
          // If the prompt step is already mounted, its editor initialized from
          // the empty value — push the restored text in; otherwise the editor
          // picks up the bound value on mount.
          void getOnboardingRichTextarea()?.setContent(restore.text);
        }
        // Same no-clobber guard for images: when the text restore is skipped
        // (prefill / user typing), stale draft images must not sneak in.
        if (inputUntouched && restore.contextItems.length > 0) {
          // Image items (imageData/imageMimeType — including pre-migration
          // drafts saved from the old inline-editor format, which serialized
          // through the same context-item shape) rehydrate straight into the
          // thumbnail row's context-item list.
          const restoredImages = restore.contextItems.filter(
            (item) => item.imageData && item.imageMimeType,
          );
          if (restoredImages.length > 0 && onboardingImageItems.length === 0) {
            onboardingImageItems = restoredImages;
          }
          // Non-image items (path-only staged files from either surface)
          // rehydrate into the staged list so they survive the round trip —
          // they are placed at create-time redemption, and a failed pill
          // stays blocking/retryable rather than silently dropped.
          const restoredStaged = restore.contextItems.filter((item) => !item.imageData);
          if (restoredStaged.length > 0 && onboardingStagedItems.length === 0) {
            onboardingStagedItems = restoredStaged;
          }
        }
      }
    } finally {
      onboardingDraftRestored = true;
    }
  })();

  /** Debounced daemon draft save: prompt text + image context items +
   * staged non-image attachments (path-only; placed at create-time
   * redemption). */
  function scheduleOnboardingDraftSave() {
    if (!isOnboarding || onboardingDraftCleared) return;
    // Pre-settle, only text the user actually typed is scheduled: it must be
    // flushable if they navigate away, and it is newer than any daemon draft.
    // The untouched initial value (prefill / legacy seed / empty) stays
    // unscheduled so it cannot clobber a newer shared daemon draft.
    if (!onboardingDraftRestored && onboardingInputValue === initialOnboardingPrompt) return;
    onboardingDraftSaver.schedule(onboardingInputValue, [
      ...onboardingImageItems,
      ...onboardingStagedItems,
    ]);
  }

  // Text changes flow through the bound value; attachment-only changes don't
  // touch it, so image + staged context items are tracked here too — adding/
  // removing an attachment must persist without a keystroke.
  $effect(() => {
    void onboardingInputValue;
    void onboardingDraftRestored;
    void onboardingImageItems;
    void onboardingStagedItems;
    scheduleOnboardingDraftSave();
  });

  // A reload or window close inside the debounce window would drop the newest
  // keystrokes — flush the pending save on unload and destroy.
  const flushOnboardingDraftSave = () => {
    if (!onboardingDraftCleared) onboardingDraftSaver.flush();
  };
  onMount(() => {
    window.addEventListener('beforeunload', flushOnboardingDraftSave);
    return () => window.removeEventListener('beforeunload', flushOnboardingDraftSave);
  });

  // Save onboarding form state through Redux whenever it changes. Debouncing and
  // reset/unmount cancellation are owned by the workspace-initializer saga.
  let visibleSuggestions = $state(getRandomSuggestions(3));
  let focusedSuggestionIndex = $state(-1);

  function shuffleSuggestions() {
    visibleSuggestions = getRandomSuggestions(3, visibleSuggestions);
    focusedSuggestionIndex = -1;
  }

  let isOnboardingCreating = $state(false);
  let onboardingCreationError = $state<string | null>(null);
  // Daemon-authored machine-readable code from the clone failure taxonomy
  // (`error.data.code`, PROTOCOL §9.1, monorepo#826); accompanies
  // `onboardingCreationError` so the error block classifies without prose
  // matching.
  let onboardingCreationErrorCode = $state<string | null>(null);

  // Live setup step statuses for WorkspaceSetupCard during creation
  type SetupStepStatus = 'pending' | 'active' | 'done';
  let setupRepoStatus = $state<SetupStepStatus>('pending');
  let setupBranchStatus = $state<SetupStepStatus>('pending');
  let setupAgentStatus = $state<SetupStepStatus>('pending');
  let setupWorktreePath = $state<string | undefined>(undefined);
  let setupWorkspaceId = $state<string | undefined>(undefined);
  let setupScriptStatus = $state<SetupStepStatus | undefined>(undefined);
  // progressId of the in-flight create — drives the live clone progress on
  // the setup card's repo step; null until the first create is submitted.
  // Kept across settlement so the visible card isn't remounted mid-flow; a
  // retry create mints a fresh id, which rekeys the card and rebinds its
  // init-bound selector cleanly.
  let onboardingCreateProgressId = $state<string | null>(null);

  // Setup script state — session-local: the default is restored per repo
  // from the repo config / localStorage last-used, never from persisted
  // form state.
  let setupScript = $state('');
  let showSetupScript = $state(false);
  let setupScriptName = $state('Custom');
  let setupScriptNameSource = $state<SetupScriptNameSource>('custom');
  let isCustomSetupScript = $state(false);

  // User-picked model (bare id) + its provider for the initial Coordinator
  // agent (step 3 picker). undefined + false means the auto-resolved default
  // applies (behavior identical to before the picker existed).
  let onboardingSelectedModel = $state<string | undefined>(undefined);
  let onboardingSelectedProvider = $state<string | undefined>(undefined);
  let onboardingModelWasOverridden = $state(false);

  // One-time restore of a persisted mid-onboarding model pick once the
  // workspace-initializer state has hydrated. A legacy pre-triple compound id
  // is split at this boundary; new persisted picks are bare and paired with
  // the persisted selectedProvider.
  let onboardingModelRestoreApplied = false;
  $effect(() => {
    if (!isOnboarding || !$workspaceInitializerHydrated$ || onboardingModelRestoreApplied) return;
    onboardingModelRestoreApplied = true;
    const persisted = selectWorkspaceInitializerOnboardingFormState.select(appStore.state);
    if (persisted?.modelWasOverridden && persisted.selectedModel) {
      const { providerId, modelId } = splitLegacyCompoundId(persisted.selectedModel);
      onboardingSelectedModel = modelId;
      onboardingSelectedProvider = persisted.selectedProvider ?? providerId ?? undefined;
      onboardingModelWasOverridden = true;
    }
  });

  /** User picked a model in the prompt-step picker: it also becomes the
   * global default (the model-selection persistence middleware owns writing
   * it to the daemon settings catalog and any provider switch). The picker
   * reports the resolved triple legs so no model-string parsing happens here. */
  function handleOnboardingModelChange(
    model: string,
    pick?: { providerId: string; modelId: string },
  ) {
    onboardingSelectedModel = pick?.modelId ?? model;
    onboardingSelectedProvider = pick?.providerId;
    onboardingModelWasOverridden = true;
    appStore.dispatch(selectModel(pick?.modelId ?? model, pick?.providerId));
  }

  // Repo-committed setup script from <repo>/.intent/config.json (local repos
  // read the file over IPC; GitHub repos use `github.repoConfig.get`).
  // Cached alongside the repo it was fetched for so stale results are never applied.
  let repoConfigScript = $state<string | null>(null);
  let repoConfigScriptRepo = $state<string | null>(null);
  // True while the repo-config probe is in flight (spinner on the setup-script control).
  let isRepoConfigLoading = $state(false);

  // Hide the setup-script disclosure while the probe is in flight and while
  // the unedited repo-config script is the active default — the committed
  // .intent/config.json applies silently (mirrors the submit-time
  // isUneditedRepoConfigScript check). Any user customization shows the row.
  const hideSetupScriptControl = $derived(
    isRepoConfigLoading ||
      (repoConfigScript !== null &&
        repoConfigScriptRepo === projectSelection?.repoPath &&
        setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
        !isCustomSetupScript &&
        setupScript.trim() === repoConfigScript.trim()),
  );

  // Helper to restore the default setup script for a repo.
  // Priority: repo-committed `.intent/config.json` setupScript > last used for
  // this repo > generic "Copy config files only" template.
  function restoreLastUsedSetupScript(repo: string) {
    // GitHub selections key last-used by path + source URL: the path is only
    // the clone destination, which two different repos can share.
    const ghUrl = projectSelection?.type === 'github' ? projectSelection?.githubUrl : undefined;
    const lastUsed = repo ? getLastUsedSetupScript(repo, ghUrl) : undefined;
    const genericTemplate = SETUP_SCRIPT_TEMPLATES.find((t) => t.id === 'generic');
    const choice = chooseDefaultSetupScript({
      repoConfigScript: repo && repo === repoConfigScriptRepo ? repoConfigScript : null,
      lastUsed,
      genericTemplate: genericTemplate
        ? { name: genericTemplate.name, content: getTemplateContent(genericTemplate) }
        : undefined,
    });
    setupScript = choice.content;
    setupScriptName = choice.name;
    setupScriptNameSource = choice.source;
    isCustomSetupScript = false;
  }

  $effect(() => {
    const selection = projectSelection;
    const skipIso = onboardingSkipIsolation;
    const step = $onboardingStep$;
    const pickedModel = onboardingSelectedModel;
    const pickedProvider = onboardingSelectedProvider;
    const modelOverridden = onboardingModelWasOverridden;

    if (!isOnboarding || !$workspaceInitializerHydrated$) return;
    if (!(selection || skipIso || (step !== 'requirements' && step !== 'welcome'))) return;
    appStore.dispatch(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: selection
          ? {
              type: selection.type,
              repoPath: selection.repoPath,
              branch: selection.branch,
              scope: selection.scope,
              githubUrl: selection.githubUrl,
              projectName: selection.projectName,
              isValid: selection.isValid,
            }
          : null,
        skipIsolation: skipIso,
        selectedModel: pickedModel,
        modelWasOverridden: modelOverridden,
        selectedProvider: pickedProvider,
        step,
      }),
    );
  });

  let hasConnectedProvider = $state(false);
  let agentGridRef: AgentGrid | null = $state(null);
  let onboardingSkipIsolation = $state(false);

  // "Send a test prompt" opt-out: one live end-to-end prompt against the
  // selected provider before advancing (host.providerTestPrompt, §5.14).
  // Checked by default; hidden when the provider's catalog row does not
  // support the test (supportsTestPrompt false/absent — e.g. unsloth).
  let onboardingSendTestPrompt = $state(true);
  let onboardingTestPromptRunning = $state(false);
  let onboardingTestPromptFailure = $state<TestPromptFailureGuidance | null>(null);
  let onboardingGridSelectedProviderId = $state<string | undefined>(undefined);
  const onboardingSelectedCatalogEntry = $derived(
    $providerCatalogEntries$.find((entry) => entry.id === onboardingGridSelectedProviderId),
  );
  const onboardingTestPromptSupported = $derived(
    providerSupportsTestPrompt(onboardingSelectedCatalogEntry),
  );

  /** Advance from the welcome step, first committing the grid's resolved
   *  provider selection so a no-click advance still enables/activates the
   *  visually-selected provider (D1(B): commit only on explicit advance).
   *  With the test-prompt box checked (and the provider supporting it), one
   *  live test prompt runs first: success advances, a structured failure
   *  keeps the user on the step with actionable guidance. */
  async function advanceFromWelcomeStep() {
    if (onboardingTestPromptRunning) return;
    const committed = agentGridRef?.commitSelection();
    const providerId = committed ?? onboardingGridSelectedProviderId;
    if (onboardingSendTestPrompt && onboardingTestPromptSupported && providerId) {
      onboardingTestPromptFailure = null;
      onboardingTestPromptRunning = true;
      try {
        // No explicit model: the daemon applies its resolved default for the
        // provider (the welcome step precedes any model pick).
        const result = await runProviderTestPrompt({ providerId });
        // Provider switched mid-test: the result belongs to the previous
        // selection — drop it (neither advance nor show stale guidance).
        if (providerId !== onboardingGridSelectedProviderId) return;
        if (!result.ok) {
          const entry = selectProviderCatalogEntries
            .select(appStore.state)
            .find((e) => e.id === providerId);
          const guidance = mapTestPromptFailure(result, entry, providerId);
          onboardingTestPromptFailure = guidance;
          if (guidance.isAuthRequired) {
            // Re-sync the card's auth badge with the demoted daemon verdict.
            appStore.dispatch(checkSingleProviderRequested(providerId));
          }
          return;
        }
      } catch (err) {
        if (providerId !== onboardingGridSelectedProviderId) return;
        // Transport/wire error (daemon unreachable, divergent payload). The
        // raw message can be a multi-line ZodError dump — log the full detail
        // and surface only the first line.
        logger.error('Onboarding test prompt failed', { providerId, error: err });
        const rawMessage = err instanceof Error ? err.message : String(err);
        onboardingTestPromptFailure = {
          message: m.onboarding_testPrompt_generic_error({
            message: rawMessage.split('\n', 1)[0],
          }),
          showClaudeDesktopNote: false,
          isAuthRequired: false,
        };
        return;
      } finally {
        onboardingTestPromptRunning = false;
      }
    }
    appStore.dispatch(goToStep('github'));
  }

  // Pull conflict state
  let onboardingBranchBehind = $state(0);
  let onboardingShouldPullBeforeCreate = $state(true);
  let onboardingPullError = $state<string | null>(null);
  let onboardingShowPullConflictDialog = $state(false);

  // Track the selected PR's source branch and number
  let selectedPRBranch = $state<string>('');
  let selectedPRNumber = $state<number | null>(null);
  let lastFetchedPRIdentifier: string | null = null;
  let onboardingContentChangeTimer: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    appStore.dispatch(cancelWorkspaceInitializerOnboardingFormStateDebounce());
    flushOnboardingDraftSave();
    if (onboardingContentChangeTimer) clearTimeout(onboardingContentChangeTimer);
    setupScriptProbeScheduler.dispose();
  });

  // ============================================================================
  // Onboarding Derived State
  // ============================================================================

  const onboardingStepIndex = $derived(ONBOARDING_STEP_ORDER.indexOf($onboardingStep$));
  const isRequirementsStep = $derived($onboardingStep$ === 'requirements');
  const isWelcomeStep = $derived($onboardingStep$ === 'welcome');
  const isGitHubStep = $derived($onboardingStep$ === 'github');
  const isProjectStep = $derived($onboardingStep$ === 'project');
  const isConfiguringStep = $derived(
    $onboardingStep$ === 'configuring' || $onboardingStep$ === 'ready',
  );
  const showStartWorking = $derived(
    onboardingStepIndex >= ONBOARDING_STEP_ORDER.indexOf('configuring'),
  );
  const onboardingVisibleStep = $derived(
    isConfiguringStep ? 4 : isProjectStep ? 3 : isGitHubStep ? 2 : 1,
  );
  // The 'requirements' gate is not counted in the visible step indicator, and
  // 'configuring' and 'ready' share one visible step, so the count is the
  // visible order minus the terminal 'ready' entry. Back navigation maps
  // visible step N-1 to the visible order so it never lands on the gate.
  const VISIBLE_STEP_ORDER = ONBOARDING_STEP_ORDER.filter((step) => step !== 'requirements');
  const ONBOARDING_TOTAL_STEPS = VISIBLE_STEP_ORDER.length - 1;

  // ============================================================================
  // Mount: Reset onboarding state
  // ============================================================================

  onMount(() => {
    // Always start onboarding from the beginning. Related persisted initializer
    // state and session handoffs are cleared by the workspace-initializer saga.
    // (resetOnboarding preserves a pending fullFlowRequested — see the slice.)
    if (isOnboarding) {
      appStore.dispatch(resetOnboarding());
      // Kick the bulk provider check so the initial-step decision (and the
      // fast-path settlement below) has real availability data to settle on
      // even when the welcome step's AgentGrid never mounts.
      appStore.dispatch(ensureProvidersChecked());
    }
  });

  // True while 'project' was entered on the persisted local flag alone; the
  // settlement effect below corrects back to 'welcome' if the provider check
  // settles with no ready provider and no workspaces.
  let onboardingFastPathPending = $state(false);

  // Requirements gate: advance only once the check group has settled with
  // every requirement met; otherwise stay blocked on the requirements step
  // (OnboardingRequirementsStep renders the setup guidance and re-checks on
  // focus/visibility until the tools appear). Once green, jump to the step
  // the provider-setup state warrants: 'project' when setup is already done
  // (ready provider / existing workspaces / persisted local flag), 'welcome'
  // for the full flow otherwise. An explicit full-flow request (Command
  // Palette "Show onboarding") always gets the full flow and is consumed here.
  $effect(() => {
    if (
      isOnboarding &&
      $onboardingStep$ === 'requirements' &&
      $requirementsCheckedOnce$ &&
      $allRequirementsMet$
    ) {
      const fullFlowRequested = selectOnboardingFullFlowRequested.select(appStore.state);
      const decision = determineOnboardingInitialStep({
        fullFlowRequested,
        hasReadyProvider: hasReadyProvider($providerStatusMap$),
        hasCompletedProviderSetup: selectHasCompletedProviderSetup.select(appStore.state),
        hasWorkspaces: hasAvailableWorkspace($workspaceItems$),
        providersCheckedOnce: $providersCheckedOnce$,
      });
      if (fullFlowRequested) {
        appStore.dispatch(setOnboardingFullFlowRequested(false));
      }
      onboardingFastPathPending = decision.viaLocalFastPath;
      appStore.dispatch(goToStep(decision.step));
    }
  });

  // Local fast-path settlement: the persisted flag skipped ahead while the
  // bulk provider check was still pending; once it settles with no ready
  // provider (and no workspaces exist), route back into provider setup.
  $effect(() => {
    if (!isOnboarding || !onboardingFastPathPending) return;
    const settlement = resolveFastPathSettlement({
      hasReadyProvider: hasReadyProvider($providerStatusMap$),
      providersCheckedOnce: $providersCheckedOnce$,
      hasWorkspaces: hasAvailableWorkspace($workspaceItems$),
    });
    if (settlement === 'pending') return;
    onboardingFastPathPending = false;
    if (settlement === 'correct' && $onboardingStep$ === 'project') {
      appStore.dispatch(goToStep('welcome'));
    }
  });

  // ============================================================================
  // Handlers
  // ============================================================================

  function handleOnboardingFocus() {
    if (!hasFiredOnboardingClick) {
      hasFiredOnboardingClick = true;
    }
  }

  function handleOnboardingKeydown() {
    if (!hasFiredOnboardingType) {
      hasFiredOnboardingType = true;
    }
    // Suggestion navigation is handled via capture-phase listener (handleSuggestionKeydownCapture)
    // so it fires before ProseMirror can insert a newline on Enter.
  }

  function handleOnboardingProjectChange(selection: ProjectSelection) {
    // Only clear the creation error when the project identity changes
    // (different type / repo path / github URL). Branch auto-population on
    // BranchSelector remount after a failed clone should NOT silently
    // dismiss the error the user needs to read.
    const previous = projectSelection;
    const projectIdentityChanged =
      !previous ||
      previous.type !== selection.type ||
      previous.repoPath !== selection.repoPath ||
      previous.githubUrl !== selection.githubUrl ||
      previous.projectName !== selection.projectName;

    // Guard: skip the update entirely when nothing meaningful changed.
    // This prevents effect_update_depth_exceeded caused by BranchSelector
    // auto-selecting the same branch on mount and triggering a cascade of
    // effects through the new projectSelection object reference.
    const selectionChanged =
      projectIdentityChanged ||
      previous?.branch !== selection.branch ||
      previous?.scope !== selection.scope ||
      previous?.isValid !== selection.isValid ||
      previous?.initGit !== selection.initGit;

    if (!selectionChanged) return;

    projectSelection = selection;
    if (projectIdentityChanged) {
      onboardingCreationError = null;
      onboardingCreationErrorCode = null;
    }
    appStore.dispatch(
      setProjectConfig({
        localPath: selection.repoPath || null,
        branch: selection.branch || null,
        repoUrl: selection.githubUrl || null,
        repoName: selection.projectName || null,
      }),
    );
  }

  function handleOnboardingPromptSelect(prompt: string) {
    getOnboardingRichTextarea()?.setContent(prompt);
    onboardingInputValue = prompt;
  }

  function handleOnboardingIssueSelect(text: string, metadata?: IssueSelectionData) {
    void text;
    if (!metadata) return;

    const metadataJson = metadata.metadata ? JSON.stringify(metadata.metadata) : undefined;

    const richTextarea = getOnboardingRichTextarea();
    if (richTextarea) {
      if (metadata.type === 'linear') {
        richTextarea.insertContextMention({
          itemType: 'linear-issue',
          provider: 'linear',
          title: metadata.title,
          url: metadata.url ?? `https://linear.app/issue/${metadata.identifier}`,
          identifier: metadata.identifier,
          description: metadata.description,
          metadata: metadataJson,
        });
      } else if (metadata.type === 'sentry') {
        richTextarea.insertContextMention({
          itemType: 'sentry-issue',
          provider: 'sentry',
          title: metadata.title,
          url: metadata.url ?? '',
          identifier: metadata.identifier,
          description: metadata.description,
          metadata: metadataJson,
        });
      } else if (metadata.type === 'github') {
        richTextarea.insertContextMention({
          itemType: 'github-issue',
          provider: 'github',
          title: metadata.title,
          url: metadata.url ?? '',
          identifier: metadata.identifier,
          description: metadata.description,
          metadata: metadataJson,
        });
      }
    }
  }

  function handleOnboardingBranchSet(branch: string) {
    if (projectSelection) {
      handleOnboardingProjectChange({
        ...projectSelection,
        branch,
      });
    }
  }

  // Handle content changes - check for PRs and fetch branch info if needed
  function handleOnboardingContentChange() {
    // Editor-only changes (e.g. mention nodes) can settle before the bound
    // text value — keep the daemon draft in sync from this signal too.
    scheduleOnboardingDraftSave();
    if (onboardingContentChangeTimer) clearTimeout(onboardingContentChangeTimer);
    onboardingContentChangeTimer = setTimeout(handleOnboardingContentChangeImmediate, 300);
  }

  function handleOnboardingContentChangeImmediate() {
    const contextMentions = getOnboardingRichTextarea()?.getContextMentions() ?? [];

    // Check for PR with branch info already embedded
    const embedded = findEmbeddedPRBranch(contextMentions);
    if (embedded) {
      if (embedded.branch !== selectedPRBranch) selectedPRBranch = embedded.branch;
      selectedPRNumber = embedded.prNumber;
      lastFetchedPRIdentifier = null;
      return;
    }

    // No GitHub PR mentions at all — clear state
    if (!hasGitHubPRMention(contextMentions)) {
      if (selectedPRBranch) selectedPRBranch = '';
      selectedPRNumber = null;
      lastFetchedPRIdentifier = null;
      return;
    }

    // PR mention without branch — fetch from API. First ignore the
    // de-dupe guard so we can distinguish "same PR we already fetched" from
    // "no fetchable PR mention remains" without clearing a valid fetched
    // branch on every prompt edit.
    const prToFetch = findPRNeedingBranchFetch(contextMentions, null);
    if (!prToFetch) {
      if (selectedPRBranch) selectedPRBranch = '';
      selectedPRNumber = null;
      return;
    }

    if (prToFetch.identifier === lastFetchedPRIdentifier) {
      return;
    }

    // Clear any previously embedded branch before attempting an async fetch so
    // removing or replacing a PR mention cannot create the workspace from a
    // stale PR source branch.
    if (selectedPRBranch) selectedPRBranch = '';
    selectedPRNumber = null;

    if (typeof window !== 'undefined' && window.electronAPI) {
      lastFetchedPRIdentifier = prToFetch.identifier;
      (async () => {
        try {
          const response = await invoke<any>('git-tracking:get-pull-request', {
            owner: prToFetch.owner,
            repo: prToFetch.repo,
            number: prToFetch.number,
          });
          if (response?.success && response.data?.sourceBranch) {
            selectedPRBranch = response.data.sourceBranch;
            selectedPRNumber = prToFetch.number;
          }
        } catch (err) {
          logger.warn('Failed to fetch PR branch info', {
            identifier: prToFetch.identifier,
            error: err,
          });
        }
      })();
    }
  }

  async function handleOnboardingEnhancePrompt() {
    if (!enhancePromptAvailable) return;
    if (!onboardingInputValue.trim() || isOnboardingEnhancing) return;
    isOnboardingEnhancing = true;
    try {
      // Daemon-side enhancement (agent.enhancePrompt, PROTOCOL §5.31)
      const result = await enhancePrompt(onboardingInputValue);
      onboardingInputValue = result.enhanced;
      await getOnboardingRichTextarea()?.setContent(result.enhanced);
      toast.success(m.onboarding_page_promptEnhanced_label());
    } catch (error) {
      logger.error('Failed to enhance prompt', error);
      toast.error(
        error instanceof EnhancePromptUnavailableError
          ? m.onboarding_page_enhanceUnavailable_error()
          : error instanceof Error && error.message
            ? m.onboarding_page_enhanceFailedWithMessage_error({ message: error.message })
            : m.onboarding_page_enhanceFailed_error(),
      );
    } finally {
      isOnboardingEnhancing = false;
    }
  }

  /** Global ⌘Enter handler for onboarding steps */
  function handleOnboardingCmdEnter(e: KeyboardEvent) {
    if (!isOnboarding) return;
    if (!(e.metaKey || e.ctrlKey)) return;

    if (e.key === 'e' || e.key === 'E') {
      if (showStartWorking && onboardingInputValue.trim()) {
        e.preventDefault();
        handleOnboardingEnhancePrompt();
      }
      return;
    }

    if (e.key !== 'Enter') return;

    const active = document.activeElement;
    if (active?.closest('.xterm')) return;

    if (isWelcomeStep && hasConnectedProvider) {
      e.preventDefault();
      advanceFromWelcomeStep();
    } else if (isGitHubStep) {
      // Continue when connected, skip otherwise — both advance to project.
      // Skipping abandons a still-pending device flow, so cancel it rather
      // than leaving it polling in the background (and resurfacing in
      // Settings).
      e.preventDefault();
      if (selectGitHubAuthIsAuthenticating.select(appStore.state)) {
        appStore.dispatch(cancelGitHubAuth());
      }
      appStore.dispatch(goToStep('project'));
    } else if (isProjectStep && projectSelection?.isValid) {
      e.preventDefault();
      appStore.dispatch(goToStep('configuring'));
    }
  }

  /**
   * Resume a create whose staged-attachment placement or first-message send
   * failed: the workspace already exists, so re-place the remaining staged
   * items and deliver the held message instead of creating again.
   */
  async function resumeOnboardingPendingSend() {
    const pending = onboardingPendingSend;
    if (!pending) return;
    isOnboardingCreating = true;
    onboardingCreationError = null;
    try {
      const redemption = await redeemStagedAttachments(pending.workspaceId, onboardingStagedItems);
      onboardingStagedItems = redemption.items;
      if (redemption.failedCount > 0) {
        onboardingCreationError = m.onboarding_page_attachmentPlacementFailed_error();
        return;
      }
      // `sendHeldFirstMessage` rebuilds the wire params as plain JSON: this
      // pending state is a Svelte $state deep-reactive Proxy tree, which
      // Electron's structured clone rejects — passing it through verbatim
      // made the held send fail before reaching the daemon (monorepo#2576).
      const snapshot = $state.snapshot(pending);
      // Rebuild imageBlocks from the CURRENT thumbnail row, not the pending
      // snapshot: the thumbnails stay editable while the failed send is
      // resumable, so a removed image must not ride the retry.
      const imageBlocks = $state
        .snapshot(onboardingImageItems)
        .filter((item) => item.imageData && item.imageMimeType)
        .map((item) => ({
          type: 'image' as const,
          data: item.imageData as string,
          mimeType: item.imageMimeType as string,
        }));
      const sendResult = await sendHeldFirstMessage(
        {
          workspaceId: snapshot.workspaceId,
          agentId: snapshot.agentId,
          content: snapshot.prompt,
          imageBlocks,
          contextReferences: snapshot.contextReferences,
        },
        redemption.fileBlocks,
      );
      if (!sendResult.sent) {
        // Framed like the compact initializer: the workspace already exists,
        // Create resumes this flow — with the daemon's detail when available.
        throw new Error(
          sendResult.errorDetail
            ? m.onboarding_page_firstMessageSendFailedDetail_error({
                detail: sendResult.errorDetail,
              })
            : m.onboarding_page_firstMessageSendFailed_error(),
        );
      }
      onboardingPendingSend = null;
      onboardingStagedItems = [];
      onboardingImageItems = [];
      // The held first message is sent — cancel any armed debounced save
      // (its timer would fire drafts.set AFTER drafts.clear and resurrect
      // the draft), then clear the persisted daemon draft and stop saving so
      // a late flush can't resurrect it either.
      onboardingDraftCleared = true;
      onboardingDraftSaver.cancel();
      clearNewWorkspaceDraft(appClient.drafts);
      await goto(`/workspace/${pending.workspaceId}`);
    } catch (err) {
      onboardingCreationError =
        err instanceof Error ? err.message : m.onboarding_page_createFailed_error();
    } finally {
      isOnboardingCreating = false;
    }
  }

  async function handleOnboardingSubmit() {
    const prompt = onboardingInputValue.trim();
    if (!prompt || isOnboardingCreating || !projectSelection?.isValid) return;
    // Failed staged-attachment pills block create (retry or remove first —
    // unless a created workspace is waiting on its held first message, in
    // which case submit IS the retry).
    if (onboardingPendingSend) {
      await resumeOnboardingPendingSend();
      return;
    }

    // Existing repositories cannot be created until BranchSelector resolves
    // (or the user manually enters) a branch. Snapshot the effective branch
    // before the prompt step unmounts so workspace.create never receives ''.
    const treatAsNewRepo = shouldTreatAsNewRepo(projectSelection);
    const currentBranch = projectSelection.branch;
    const effectiveBranch =
      selectedPRBranch && currentBranch !== selectedPRBranch && !treatAsNewRepo
        ? selectedPRBranch
        : currentBranch;
    if (!treatAsNewRepo && !effectiveBranch.trim()) {
      toast.error(m.onboarding_page_branchRequired_toast());
      return;
    }

    if (hasBlockingAttachments(onboardingStagedItems)) {
      // The error banner's Retry also lands here — surface why nothing
      // happened instead of a silent no-op (pills must be retried/removed).
      toast.error(m.onboarding_page_blockingAttachments_toast());
      return;
    }

    // Snapshot the picker's effective default selection AND all
    // editor-derived state BEFORE flipping isOnboardingCreating: the flag
    // swaps the form for the setup card, destroying the prompt step (and
    // nulling promptStepRef) by the time any awaited call below settles —
    // reads after that point return empty and silently drop mentions
    // (intent-hq/intent#4050).
    const defaultModelPreview = onboardingModelWasOverridden
      ? undefined
      : promptStepRef?.getEffectiveDefaultModel();
    const richTextareaMentions = getOnboardingRichTextarea()?.getMentions() ?? [];
    const contextMentions = getOnboardingRichTextarea()?.getContextMentions() ?? [];
    // Images live in the context-item list (bound to the prompt step's
    // thumbnail row), not the editor — snapshot to plain JSON so the $state
    // Proxy tree never reaches Electron's structured clone (monorepo#2576).
    const imageBlocks: Array<{ type: 'image'; data: string; mimeType: string }> = $state
      .snapshot(onboardingImageItems)
      .filter((item) => item.imageData && item.imageMimeType)
      .map((item) => ({
        type: 'image' as const,
        data: item.imageData as string,
        mimeType: item.imageMimeType as string,
      }));

    isOnboardingCreating = true;
    onboardingCreationError = null;
    onboardingCreationErrorCode = null;
    setupRepoStatus = 'active';
    setupBranchStatus = 'active';
    setupAgentStatus = 'pending';
    setupScriptStatus = setupScript.trim() ? 'pending' : undefined;

    // FE-minted correlation id for this create's provisioning progress: the
    // daemon echoes it on git:clone:progress/done frames (PROTOCOL §5.1), and
    // the bridge folds them into the workspaceCreateProgress slice. Registered
    // BEFORE the request so mid-flight frames always find their entry; cleared
    // in the finally below once the create settles.
    const createProgressId = uuidv4();
    appStore.dispatch(beginWorkspaceCreateProgress(createProgressId));
    onboardingCreateProgressId = createProgressId;

    try {
      const reduxState = appStore.state;
      const {
        provider,
        model: effectiveModel,
        behaviorPrompt,
        specialistId,
      } = await resolveOnboardingModel(
        reduxState,
        onboardingModelWasOverridden && onboardingSelectedModel
          ? { model: onboardingSelectedModel, provider: onboardingSelectedProvider }
          : undefined,
      );

      // The prompt-step picker is the authoritative source of the initial
      // default provider + default model (monorepo#3044): commit the resolved
      // provider and the picker's displayed default at create-submit time.
      // An explicit pick already persisted at pick time via selectModel;
      // resolution failures throw above, so an aborted create commits nothing.
      if (!onboardingModelWasOverridden) {
        commitOnboardingDefaultModel({
          provider,
          // The preview was resolved under the picker's provider context —
          // only trust it when that matches the create's resolved provider.
          effectiveDefaultModel:
            defaultModelPreview?.provider === provider ? defaultModelPreview.model : undefined,
          activeProviderId: selectActiveProviderId.select(reduxState) ?? '',
          dispatch: appStore.dispatch,
        });
      }
      const agentType = createAgentTypeId('workspace');

      // Parse context from the editor state snapshotted above
      const contextMentionRefs = parseContextMentions(contextMentions);
      const fileMentionRefs = parseFileMentions(richTextareaMentions);
      const runtimeMentionRefs = await parseRuntimeMentions(richTextareaMentions, logger);
      // Staged folder pills (dropped folders, local daemon only) ride as
      // path context references on the initial message — never placed via
      // file.placeAttachment (the daemon rejects directories). Same shape a
      // folder @-mention produces in chat (type 'file' + absolute path).
      const folderRefs = $state
        .snapshot(onboardingStagedItems)
        .filter((item) => item.type === 'folder' && item.path)
        .map((item) => ({ type: 'file', path: item.path, title: item.label }));
      const contextReferences = [
        ...contextMentionRefs,
        ...fileMentionRefs,
        ...runtimeMentionRefs,
        ...folderRefs,
      ];
      const linearIssue = extractLinearIssue(contextReferences);
      const sentryIssue = extractSentryIssue(contextReferences);

      // Pull only for direct mode. Isolated creation must not mutate the source checkout.
      if (
        shouldPullSourceRepositoryBeforeCreate({
          branchBehind: onboardingBranchBehind,
          isLocalRepository: projectSelection.type === 'local',
          isNewRepository: treatAsNewRepo,
          skipIsolation: onboardingSkipIsolation,
          pullEnabled: onboardingShouldPullBeforeCreate,
        })
      ) {
        logger.info('Auto-pulling latest changes before workspace creation (onboarding)', {
          branch: projectSelection.branch,
          behind: onboardingBranchBehind,
        });
        try {
          // Daemon-backed pull (`git.pull`, PROTOCOL §5.6) via the appClient
          // seam — replaces the dead legacy `git:pullBranch` IPC. The seam
          // folds the daemon's structured `{ ok: false, error }` failure into
          // `{ success: false, error }` and never throws.
          const pullResult =
            typeof window !== 'undefined' && window.electronAPI
              ? await appClient.git.pull(projectSelection.repoPath, projectSelection.branch)
              : undefined;
          if (!pullResult?.success) {
            onboardingPullError = pullResult?.error || m.onboarding_page_pullFailed_error();
            onboardingShowPullConflictDialog = true;
            isOnboardingCreating = false;
            return;
          }
          onboardingBranchBehind = 0;
          logger.info('Successfully pulled latest changes before workspace creation (onboarding)', {
            branch: projectSelection.branch,
          });
        } catch (err) {
          onboardingPullError =
            err instanceof Error ? err.message : m.onboarding_page_pullFailed_error();
          onboardingShowPullConflictDialog = true;
          isOnboardingCreating = false;
          return;
        }
      }

      // Await any in-flight repo-config probe (bounded, sub-second) so the
      // setup-script decision below sees the committed `.intent/config.json`
      // instead of racing the probe (monorepo#1862).
      await setupScriptProbeScheduler.settled();

      // The shown script is what runs: send it as-is, EXCEPT the unedited
      // repo-config script — the daemon persists an explicit setupScript into
      // the worktree's tracked .intent/config.json (PROTOCOL §5.1) and the
      // committed file already holds it (it still executes when omitted).
      const setupScriptParam = resolveSetupScriptParam({
        setupScript,
        setupScriptName,
        repoPath: projectSelection.repoPath,
        repoConfigScript,
        repoConfigScriptRepo,
      });

      // Picked repo (GitHub selection): the daemon hydrates the checkout
      // from its repo cache — send githubUrl + branch ONLY, no
      // clonePath/repositoryPath (repoPath holds the owner/repo shorthand,
      // not a local path). Mirrors CompactWorkspaceInitializer's flow.
      const isGithubPick = projectSelection.type === 'github' && !!projectSelection.githubUrl;

      // Staged non-image files cannot ride the daemon-owned initial prompt:
      // placement needs the workspace to exist. With staged files, hold the
      // prompt out of initialAgent and send it after placement (create →
      // placeAttachment → agent.sendMessage with the attachment references).
      // Images follow the same held path (monorepo#3338): they too are
      // placed post-create and travel as attachment-reference blocks, so no
      // inline base64 rides the workspace.create frame.
      const hasStagedFiles = hasStagedFileItems(onboardingStagedItems) || imageBlocks.length > 0;

      const requestContextLinks = buildContextLinks(contextMentions);

      const result = await workspaceClient.create({
        title: '',
        repositoryPath: isGithubPick ? undefined : projectSelection.repoPath,
        githubUrl: projectSelection.githubUrl,
        baseRef: treatAsNewRepo ? 'main' : effectiveBranch,
        isNewRepo: treatAsNewRepo,
        skipIsolation: onboardingSkipIsolation || undefined,
        scope: projectSelection.scope || undefined,
        setupScript: setupScriptParam,
        contextLinks: requestContextLinks,
        linearIssue,
        sentryIssue,
        initialAgent: {
          name: 'Coordinator',
          model: effectiveModel,
          prompt: hasStagedFiles ? undefined : prompt,
          agentType,
          specialist: specialistId,
          behaviorPrompt,
          provider,
          contextReferences:
            !hasStagedFiles && contextReferences.length > 0 ? contextReferences : undefined,
          imageBlocks: !hasStagedFiles && imageBlocks.length > 0 ? imageBlocks : undefined,
          metadata: {
            source: 'onboarding',
            isInitialAgent: true,
            specialist: specialistId,
          },
        },
        progressId: createProgressId, // Echoed on git:clone:progress/done frames (PROTOCOL §5.1)
      });

      if (!result.ok) {
        // Keep the daemon's machine-readable code (clone failure taxonomy,
        // PROTOCOL §9.1) alongside the human message so the error block can
        // classify without prose matching.
        onboardingCreationErrorCode = result.errorCode ?? null;
        throw new Error(result.error || m.onboarding_page_createFailed_error());
      }

      const workspace = result.data.workspace;
      // The daemon assigns the initial agent's id and returns it on the
      // create result; the FE no longer pre-mints one.
      const agentId = result.data.initialAgent?.id;

      // Install the panel layout before attachment delivery so both the normal
      // path and a later attachment retry open the daemon-created initial
      // agent. Legacy navigation stays empty so drawer migration cannot
      // replace the canonical panel seed.
      try {
        getPanelLayoutManager(workspace.id).clearLayout();
      } catch {
        /* ignore */
      }
      try {
        const { workspaceStorageManager: wsm } =
          await import('$store/renderer/slices/workspace/utils/workspace-storage-manager');
        wsm.clearState(workspace.id);
      } catch {
        /* ignore */
      }
      appStore.dispatch(setWorkspaceEntity(workspace));
      if (agentId) {
        appStore.dispatch(setInitialAgentId(workspace.id, agentId));
      }
      appStore.dispatch(
        bootstrapNewWorkspaceLayout(
          workspace.id,
          agentId ?? null,
          'Coordinator',
          specialistId === 'spec-writer',
          undefined,
          // Daemon-persisted links are canonical; fall back to the request's
          // links when an older daemon does not echo them (PROTOCOL §5.1).
          workspace.contextLinks ?? requestContextLinks,
        ),
      );
      appStore.dispatch(
        hydrateWorkspaceNavigation(workspace.id, {
          version: 2,
          workspace: { id: workspace.id },
          mainPanel: { type: 'empty' },
          drawer: { open: false, type: null, itemId: null },
          navigation: { history: [], currentIndex: -1 },
          ui: { hasInitialized: false },
        }),
      );
      appStore.dispatch(openWorkspaceTab(workspace.id));

      // Place staged attachments now that the workspace exists and deliver
      // the held-back first message with the attachment-reference blocks.
      // On failure the failed pills stay visible (retry or remove) and
      // `onboardingPendingSend` makes the Create button resume this flow —
      // the created workspace is never rolled back or duplicated.
      if (hasStagedFiles) {
        onboardingPendingSend = {
          workspaceId: workspace.id,
          agentId,
          prompt,
          contextReferences,
        };
        const redemption = await redeemStagedAttachments(workspace.id, onboardingStagedItems);
        onboardingStagedItems = redemption.items;
        if (redemption.failedCount > 0) {
          onboardingCreationErrorCode = null;
          throw new Error(m.onboarding_page_attachmentPlacementFailed_error());
        }
        // `sendHeldFirstMessage` rebuilds the wire params as plain JSON so
        // reactive Proxies from $state never reach Electron's structured
        // clone (monorepo#2576); on failure `onboardingPendingSend` stays
        // set so submit resumes this flow.
        const sendResult = await sendHeldFirstMessage(
          {
            workspaceId: workspace.id,
            agentId,
            content: prompt,
            imageBlocks,
            contextReferences,
          },
          redemption.fileBlocks,
        );
        if (!sendResult.sent) {
          onboardingCreationErrorCode = null;
          // Framed like the compact initializer: the workspace already
          // exists, submit resumes — with the daemon's detail when available.
          throw new Error(
            sendResult.errorDetail
              ? m.onboarding_page_firstMessageSendFailedDetail_error({
                  detail: sendResult.errorDetail,
                })
              : m.onboarding_page_firstMessageSendFailed_error(),
          );
        }
        onboardingPendingSend = null;
        onboardingStagedItems = [];
        onboardingImageItems = [];
      }
      logger.info('Workspace created with paths', {
        id: workspace.id,
        path: workspace.path,
        repositoryPath: workspace.repositoryPath,
        worktreePath: workspace.worktreePath,
        initialAgentId: agentId,
      });

      // Daemon-backed (`workspace.update`, PROTOCOL §5.1) via workspaceClient —
      // the legacy `workspace:update` IPC channel is unbridged in this build.
      if (selectedPRNumber && workspace.id) {
        void workspaceClient
          .update({ id: workspace.id, prNumber: selectedPRNumber })
          .then((updateResult) => {
            if (!updateResult.ok) {
              logger.warn('Failed to store PR number on workspace', { error: updateResult.error });
            }
          });
      }

      // Record the script as this repo's last-used default (localStorage).
      // Skip the unedited repo-config script — the committed .intent/config.json
      // is its source of truth, and recording a copy would shadow future
      // repo-config changes as the last-used default.
      const isUneditedRepoConfigScript =
        setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
        repoConfigScriptRepo === projectSelection.repoPath &&
        setupScript.trim() === (repoConfigScript ?? '').trim();
      if (setupScript.trim() && projectSelection.repoPath && !isUneditedRepoConfigScript) {
        recordLastUsedSetupScript(
          projectSelection.repoPath,
          {
            name: setupScriptName || m.onboarding_page_customScript_label(),
            content: setupScript,
            nameSource: setupScriptName ? setupScriptNameSource : 'named',
          },
          projectSelection.type === 'github' ? projectSelection.githubUrl : undefined,
        );
      }

      setupRepoStatus = 'done';
      setupBranchStatus = 'done';
      if (setupScriptStatus) setupScriptStatus = 'active';
      setupAgentStatus = setupScriptStatus ? 'pending' : 'active';
      setupWorktreePath = workspace.worktreePath || workspace.repositoryPath;
      setupWorkspaceId = workspace.id;
      logger.info('Workspace paths for setup card', {
        worktreePath: workspace.worktreePath,
        repositoryPath: workspace.repositoryPath,
        setupWorktreePath,
      });

      if (setupScriptStatus) {
        await new Promise((r) => setTimeout(r, 300));
        setupScriptStatus = 'done';
      }
      setupAgentStatus = 'active';
      await new Promise((r) => setTimeout(r, 300));
      setupAgentStatus = 'done';

      // The prompt was submitted — cancel any armed debounced save (its
      // timer would fire drafts.set AFTER drafts.clear and resurrect the
      // draft), then immediately clear the persisted daemon draft
      // (drafts.clear under the sentinel keys, PROTOCOL §5.16) and stop
      // saving so a late flush can't resurrect it either.
      onboardingDraftCleared = true;
      onboardingDraftSaver.cancel();
      clearNewWorkspaceDraft(appClient.drafts);

      // Use the onboarding reset action as the cleanup signal; initializer
      // persistence/session cleanup is handled by the workspace-initializer saga.
      appStore.dispatch(resetOnboarding());

      // Mark provider setup as complete so the app shell won't redirect back here.
      appStore.dispatch(setHasCompletedProviderSetup(true));

      appStore.dispatch(setOnboardingWorkspaceId(workspace.id));
      appStore.dispatch(goToStep('ready'));

      logger.info('Workspace created, transitioning in-place', { workspaceId: workspace.id });

      onHoldActiveChange(true);
      onFadingOutChange(false);

      await goto(`/workspace/${workspace.id}`, { replaceState: true });
    } catch (err) {
      logger.error('Workspace creation failed', err as Error);
      onboardingCreationError =
        err instanceof Error ? err.message : m.onboarding_page_unexpected_error();
      isOnboardingCreating = false;
    } finally {
      // The create settled (success or failure) — drop the transient progress
      // entry so the slice never accumulates stale ids. The local
      // onboardingCreateProgressId is kept: the card stays mounted on success
      // and its selector just reads null; a retry mints a fresh id.
      appStore.dispatch(clearWorkspaceCreateProgress(createProgressId));
    }
  }
</script>

<svelte:window onkeydown={handleOnboardingCmdEnter} />

<div
  class={cn('h-full w-full flex flex-col absolute inset-0', {
    'onboarding-collapse-out': fadingOut,
  })}
>
  <div class="h-full w-full flex flex-col p-3">
    <div class="h-full w-full flex flex-col bg-background rounded-xl overflow-hidden">
      {#if isOnboardingCreating}
        <!-- Replace the form with the summary card while creating -->
        <div
          class="flex-1 flex flex-col items-center justify-center"
          in:fly={{ y: 20, duration: 400, easing: cubicOut }}
        >
          <div class="w-full max-w-lg">
            <!-- Key on the progressId: the card binds its progress selector at
                 init, so a retry create (fresh id) must destroy/recreate it. -->
            {#key onboardingCreateProgressId}
              <WorkspaceSetupCard
                repoName={projectSelection?.projectName ||
                  projectSelection?.repoPath?.split('/').pop() ||
                  m.onboarding_page_yourProject_label()}
                repoUrl={projectSelection?.githubUrl}
                repoPath={projectSelection?.repoPath}
                worktreePath={setupWorktreePath}
                workspaceId={setupWorkspaceId}
                branch={projectSelection?.branch}
                baseRef={projectSelection?.branch
                  ? `origin/${projectSelection.branch}`
                  : 'origin/main'}
                specialistName="Coordinator"
                {setupScriptStatus}
                repoStatus={setupRepoStatus}
                branchStatus={setupBranchStatus}
                agentStatus={setupAgentStatus}
                skipIsolation={onboardingSkipIsolation}
                progressId={onboardingCreateProgressId ?? undefined}
              />
            {/key}
          </div>
        </div>
      {:else}
        <div
          class="flex flex-col h-full w-full min-w-0 relative"
          data-onboarding-step={$onboardingState$.step}
        >
          <div
            class="flex-1 min-h-0 overflow-y-auto scroll-smooth"
            role="log"
            aria-label={m.onboarding_page_steps_ariaLabel()}
          >
            <div class="flex flex-col w-full px-6 pt-[15vh] pb-8">
              <div class="flex flex-col items-start">
                <!-- Step text/explanations -->
                <div class="w-full min-w-[min(100%,20rem)] shrink-0">
                  <div class="relative max-w-5xl mx-auto">
                    <div class="w-full absolute top-0 transform -translate-y-full pb-4">
                      <div class="flex items-center gap-3 text-xs">
                        {#if !isRequirementsStep}
                          <span class="text-muted-foreground" aria-live="polite">
                            {m.onboarding_page_stepCount_label({
                              current: onboardingVisibleStep,
                              total: ONBOARDING_TOTAL_STEPS,
                            })}
                          </span>
                        {/if}

                        {#if !isRequirementsStep && onboardingVisibleStep > 1}
                          <button
                            type="button"
                            class="flex items-center gap-1.5 text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                            onclick={() =>
                              appStore.dispatch(
                                goToStep(VISIBLE_STEP_ORDER[onboardingVisibleStep - 2]),
                              )}
                            aria-label={m.onboarding_page_goBack_ariaLabel()}
                          >
                            <Fa icon={faArrowLeft} size="xs" />
                            <span>{m.onboarding_page_back_label()}</span>
                          </button>
                        {/if}
                      </div>
                    </div>

                    <div class="flex flex-col">
                      {#if isRequirementsStep}
                        <div in:fly={{ y: 10, duration: 250, easing: cubicOut }} style="order: 1">
                          <div class="space-y-3">
                            {#if !$requirementsCheckedOnce$}
                              <h1 class="text-5xl font-semibold tracking-tight leading-tight">
                                {m.onboarding_page_checkingSetup_title()}
                              </h1>
                            {:else}
                              <h1 class="text-5xl font-semibold tracking-tight leading-tight">
                                {m.onboarding_page_machineReady_title()}
                              </h1>
                              <p class="text-lg text-muted-foreground">
                                {m.onboarding_page_machineReady_description()}
                              </p>
                            {/if}
                          </div>
                        </div>
                      {:else if isWelcomeStep}
                        <div in:fly={{ y: 10, duration: 250, easing: cubicOut }} style="order: 1">
                          <div class="space-y-3">
                            <h1 class="text-5xl font-semibold tracking-tight leading-tight">
                              {m.onboarding_page_welcome_title()}
                            </h1>
                            <p class="text-lg text-muted-foreground">
                              {m.onboarding_page_welcome_before()}
                              <br />
                              {m.onboarding_page_welcome_after()}
                            </p>
                          </div>
                        </div>
                      {:else if isGitHubStep}
                        <div in:fly={{ y: 10, duration: 250, easing: cubicOut }} style="order: 2">
                          <div class="space-y-3">
                            <h2 class="text-5xl font-semibold tracking-tight leading-tight">
                              {m.onboarding_page_connectGithub_title()}
                            </h2>
                            <p class="text-lg text-muted-foreground">
                              {m.onboarding_page_connectGithub_before()}
                              <br />
                              {m.onboarding_page_connectGithub_after()}
                            </p>
                          </div>
                        </div>
                      {:else if isProjectStep}
                        <div in:fly={{ y: 10, duration: 250, easing: cubicOut }} style="order: 3">
                          <div class="space-y-3">
                            <h2 class="text-5xl font-semibold tracking-tight leading-tight">
                              {m.onboarding_page_whatProject_title()}
                            </h2>
                            <p class="text-lg text-muted-foreground">
                              {m.onboarding_page_whatProject_description()}
                            </p>
                          </div>
                        </div>
                      {:else}
                        <div in:fly={{ y: 10, duration: 250, easing: cubicOut }} style="order: 4">
                          <div class="space-y-6">
                            <h2 class="text-5xl font-semibold tracking-tighter">
                              {m.onboarding_page_whatToBuild_title()}
                            </h2>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Interactive widgets -->
                <div class="w-full min-w-0">
                  {#key $onboardingStep$}
                    <div class="py-8 space-y-6" in:fly={{ y: 15, duration: 300, easing: cubicOut }}>
                      {#if isRequirementsStep}
                        <div class="max-w-5xl mx-auto" data-testid="onboarding-requirements-step">
                          <OnboardingRequirementsStep />
                        </div>
                      {:else if isWelcomeStep}
                        <div class="py-6 overflow-x-auto scrollbar-none -mx-6">
                          <div class="pl-[max(1.5rem,calc((100%-64rem)/2))] pr-32">
                            <AgentGrid
                              bind:this={agentGridRef}
                              onAvailabilityChange={(hasAny) => {
                                hasConnectedProvider = hasAny;
                              }}
                              onSelectionChange={(providerId) => {
                                // Guard on actual change: AgentGrid's $effect tracks
                                // this callback prop, so a parent re-render re-invokes
                                // it with an unchanged selection — which must not
                                // clear a just-assigned failure panel.
                                if (providerId !== onboardingGridSelectedProviderId) {
                                  onboardingGridSelectedProviderId = providerId;
                                  onboardingTestPromptFailure = null;
                                }
                              }}
                            />
                          </div>
                        </div>
                        <div class="max-w-5xl mx-auto flex flex-col items-start gap-2 mt-9">
                          {#if hasConnectedProvider && onboardingTestPromptSupported}
                            <div class="flex flex-col gap-1 mb-2">
                              <label
                                class="flex items-center gap-2 text-sm cursor-pointer"
                                data-testid="onboarding-test-prompt-checkbox"
                              >
                                <Checkbox
                                  bind:checked={onboardingSendTestPrompt}
                                  disabled={onboardingTestPromptRunning}
                                />
                                {m.onboarding_testPrompt_checkbox_label()}
                              </label>
                              <p class="text-xs text-muted-foreground pl-6">
                                {m.onboarding_testPrompt_finePrint_label()}
                              </p>
                            </div>
                          {/if}
                          <Button
                            class="group/button"
                            size="xl"
                            variant={!hasConnectedProvider ? 'outline' : 'default'}
                            disabled={!hasConnectedProvider}
                            loading={onboardingTestPromptRunning}
                            onclick={advanceFromWelcomeStep}
                          >
                            {#if onboardingTestPromptRunning}
                              {m.onboarding_testPrompt_running_label()}
                            {:else}
                              {m.onboarding_page_letsGo_label()}
                              {#if hasConnectedProvider}
                                <span class="ml-1 opacity-50">⌘↵</span>
                              {/if}
                            {/if}
                          </Button>
                          {#if !hasConnectedProvider}
                            <p class="text-xs text-muted-foreground">
                              {m.onboarding_page_connectAgent_description()}
                            </p>
                          {/if}
                          {#if onboardingTestPromptFailure}
                            <div
                              data-testid="onboarding-test-prompt-failure"
                              class="mt-2 max-w-xl rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
                            >
                              <p>{onboardingTestPromptFailure.message}</p>
                              {#if onboardingTestPromptFailure.loginCommandHint}
                                <div class="mt-2 text-xs">
                                  <span class="opacity-70"
                                    >{m.onboarding_testPrompt_runToLogIn_label()}</span
                                  >
                                  <div class="mt-1 flex items-center gap-1">
                                    <code
                                      class="min-w-0 flex-1 truncate rounded bg-background/60 px-1.5 py-0.5 font-mono text-foreground"
                                      >{onboardingTestPromptFailure.loginCommandHint}</code
                                    >
                                    <CopyButton
                                      text={onboardingTestPromptFailure.loginCommandHint}
                                      class="hover:bg-background/60"
                                    />
                                  </div>
                                </div>
                              {/if}
                              {#if onboardingTestPromptFailure.showClaudeDesktopNote}
                                <p class="mt-2 text-xs opacity-70">
                                  {m.onboarding_testPrompt_claudeDesktopNote_label()}
                                </p>
                              {/if}
                              {#if onboardingTestPromptFailure.loginDocsUrl}
                                {@const docsUrl = onboardingTestPromptFailure.loginDocsUrl}
                                <button
                                  type="button"
                                  class="mt-2 text-xs underline hover:no-underline"
                                  onclick={() => shell.open(docsUrl)}
                                >
                                  {m.chat_modelPicker_setupDocs_label()}
                                </button>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {:else if isGitHubStep}
                        <div class="max-w-5xl mx-auto">
                          <OnboardingGitHubStep
                            onContinue={() => appStore.dispatch(goToStep('project'))}
                            onSkip={() => appStore.dispatch(goToStep('project'))}
                          />
                        </div>
                      {:else if isProjectStep}
                        <div class="max-w-5xl mx-auto">
                          <ProjectPickerMessage
                            onProjectChange={handleOnboardingProjectChange}
                            onSelectAndAdvance={() => {
                              if (projectSelection?.isValid) {
                                appStore.dispatch(goToStep('configuring'));
                              }
                            }}
                            hideHeading={true}
                          />
                          <div class="flex flex-col items-start gap-2 mt-5">
                            <Button
                              class="group/button"
                              size="xl"
                              variant={!projectSelection?.isValid ? 'outline' : 'default'}
                              disabled={!projectSelection?.isValid}
                              onclick={() => appStore.dispatch(goToStep('configuring'))}
                            >
                              {#if projectName}
                                {m.onboarding_page_letsWorkOn_label({ name: projectName })}
                              {:else}
                                {m.onboarding_page_letsGo_label()}
                              {/if}
                              {#if projectSelection?.isValid}
                                <span class="ml-1 opacity-50">⌘↵</span>
                              {/if}
                            </Button>
                            {#if !projectSelection?.isValid}
                              <p class="text-xs text-muted-foreground">
                                {#if projectSelection?.type === 'local'}
                                  {m.onboarding_page_pickProject_label()}
                                {:else if projectSelection?.type === 'github'}
                                  {m.onboarding_page_enterGithubRepo_label()}
                                {:else}
                                  {m.onboarding_page_nameProject_label()}
                                {/if}
                              </p>
                            {/if}
                          </div>
                        </div>
                      {:else}
                        <!-- Step 3: Prompt input -->
                        <OnboardingPromptStep
                          bind:this={promptStepRef}
                          bind:onboardingInputValue
                          {isOnboardingCreating}
                          {isOnboardingEnhancing}
                          {onboardingCreationError}
                          {onboardingCreationErrorCode}
                          {projectSelection}
                          {onboardingGithubRepoInfo}
                          {selectedPRBranch}
                          bind:onboardingSkipIsolation
                          bind:setupScript
                          bind:showSetupScript
                          bind:setupScriptName
                          bind:setupScriptNameSource
                          bind:isCustomSetupScript
                          repoConfigScript={repoConfigScriptRepo === projectSelection?.repoPath
                            ? repoConfigScript
                            : null}
                          {hideSetupScriptControl}
                          {visibleSuggestions}
                          bind:focusedSuggestionIndex
                          bind:stagedContextItems={onboardingStagedItems}
                          bind:imageContextItems={onboardingImageItems}
                          selectedModel={onboardingSelectedModel}
                          modelWasOverridden={onboardingModelWasOverridden}
                          onModelChange={handleOnboardingModelChange}
                          onSubmit={handleOnboardingSubmit}
                          onEnhancePrompt={handleOnboardingEnhancePrompt}
                          {enhancePromptAvailable}
                          onContentChange={handleOnboardingContentChange}
                          onFocus={handleOnboardingFocus}
                          onKeydown={handleOnboardingKeydown}
                          onPromptSelect={handleOnboardingPromptSelect}
                          onIssueSelect={handleOnboardingIssueSelect}
                          onBranchSet={handleOnboardingBranchSet}
                          onProjectChange={handleOnboardingProjectChange}
                          onShuffleSuggestions={shuffleSuggestions}
                          onSkipIsolationChange={(val) => (onboardingSkipIsolation = val)}
                          onBranchBehindChange={(behind) => (onboardingBranchBehind = behind)}
                          onShowSetupScriptChange={(show) => (showSetupScript = show)}
                        />
                      {/if}
                    </div>
                  {/key}
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Pull Conflict Dialog (onboarding) -->
<PullConflictDialog
  bind:open={onboardingShowPullConflictDialog}
  error={onboardingPullError ?? ''}
  repoPath={projectSelection?.repoPath ?? ''}
  branchName={projectSelection?.branch ?? ''}
  onCreateWorkspace={(options) => {
    onboardingShouldPullBeforeCreate = false;
    onboardingShowPullConflictDialog = false;
    onboardingPullError = null;

    if (options?.resolveConflicts) {
      const branch = projectSelection?.branch ?? '';
      const getResolutionPrompt = (errorType?: PullErrorType): string => {
        switch (errorType) {
          case 'stash-conflict':
            return m.onboarding_page_pullResolution_stashConflict_prompt();
          case 'unstaged-changes':
            return m.onboarding_page_pullResolution_unstagedChanges_prompt({ branch });
          case 'merge-conflict':
            return m.onboarding_page_pullResolution_mergeConflict_prompt();
          default:
            return m.onboarding_page_pullResolution_default_prompt({ branch });
        }
      };

      getOnboardingRichTextarea()?.setContent(getResolutionPrompt(options.errorType));
    }

    handleOnboardingSubmit();
  }}
  onCancel={() => {
    onboardingShowPullConflictDialog = false;
    onboardingPullError = null;
  }}
/>

<style>
  :global {
    .onboarding-collapse-out {
      animation: collapseOut 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
      overflow: hidden;
      pointer-events: none;
      transform-origin: top center;
    }
  }
</style>
