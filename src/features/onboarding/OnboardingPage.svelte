<script lang="ts">
  /* eslint-disable max-lines */
  /**
   * OnboardingPage - Extracted from +page.svelte
   *
   * Contains all onboarding-specific state, handlers, effects, and template
   * for the workspace creation flow (/workspace/new).
   */

  import { fly } from '$lib/motion';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$shared/generated/ipc-client';
  import { selectHostRole } from '$store/renderer/slices/principal/principal-selectors';
  import {
    buildNewWorkspaceDraftPayload,
    LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
  } from '$lib/components/workspace/initializer/new-workspace-draft';
  import { deserializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
  import { registerWorkspaceInitializationPreparation } from '$lib/components/workspace/initializer/workspace-initialization-preparation';
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
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';

  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import {
    selectOnboardingStep,
    selectOnboardingState,
  } from '$store/renderer/slices/onboarding/onboarding-selectors';
  import {
    goToStep,
    setProjectConfig,
    resetOnboarding,
    setOnboardingFullFlowRequested,
  } from '$store/renderer/slices/onboarding/onboarding-slice';
  import { STEP_ORDER as ONBOARDING_STEP_ORDER } from '$store/renderer/slices/onboarding/onboarding-types';
  import { cancelGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { selectGitHubAuthIsAuthenticating } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { cancelGitLabAuth } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import {
    selectGitLabAuthIsAuthenticating,
    selectGitLabAuthIsConfigured,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  import ProjectPickerMessage from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import type { IssueSelectionData } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { parseGitHubUrl } from '$lib/utils/workspace-validation';

  import PullConflictDialog, {
    type PullErrorType,
  } from '$lib/components/modals/PullConflictDialog.svelte';

  import AgentGrid from '$features/onboarding/messages/AgentGrid.svelte';
  import ClaudeLoginButton from '$features/onboarding/messages/ClaudeLoginButton.svelte';

  import OnboardingPromptStep from '$features/onboarding/steps/OnboardingPromptStep.svelte';
  import OnboardingForgeStep from '$features/onboarding/steps/OnboardingForgeStep.svelte';
  import OnboardingRequirementsStep from '$features/onboarding/steps/OnboardingRequirementsStep.svelte';
  import {
    selectAllRequirementsMet,
    selectHostRequirementsHasCheckedOnce,
  } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import {
    checkSingleProviderRequested,
    ensureProvidersChecked,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { determineOnboardingInitialStep } from '$features/onboarding/utils/determine-onboarding-initial-step';

  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { shell } from '$lib/electron-bridge';
  import { runProviderTestPrompt } from '$features/providers/provider-test-prompt.client';
  import {
    mapTestPromptFailure,
    shouldRunOnboardingTestPrompt,
    type TestPromptFailureGuidance,
  } from '$features/onboarding/utils/onboarding-test-prompt';
  import type { ProjectSelection } from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import { shouldTreatAsNewRepo } from '$features/onboarding/utils/treat-as-new-repo';
  import { parseRuntimeMentions } from '$features/onboarding/utils/parse-context-references';
  import { hasBlockingAttachments, type ContextItem } from '$lib/components/chat/input/context-api';
  import {
    SETUP_SCRIPT_TEMPLATES,
    getTemplateContent,
    chooseDefaultSetupScript,
    createRepoConfigProbeScheduler,
    REPO_CONFIG_SCRIPT_NAME,
    type SetupScriptNameSource,
  } from '$features/setup-scripts';
  import { getLastUsedSetupScript } from '$features/setup-scripts/last-used';
  import {
    cancelWorkspaceInitializerOnboardingFormStateDebounce,
    clearWorkspaceInitializationOutcome,
    clearWorkspaceInitializationResume,
    debounceWorkspaceInitializerOnboardingFormState,
    workspaceInitializerDraftFlushRequested,
    workspaceInitializerDraftOwnerReleased,
    workspaceInitializerDraftRestoreRequested,
    workspaceInitializerDraftSaveScheduled,
    workspaceInitializationResumeRequested,
    workspaceInitializationSubmitted,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import {
    DEFAULT_NEW_WORKSPACE_SPECIALIST_ID,
    getSpecialistById,
  } from '$lib/constants/specialists';
  import {
    selectWorkspaceInitializerHydrated,
    selectWorkspaceInitializerDraftAuthority,
    selectWorkspaceInitializationOutcomeForConsumer,
    selectWorkspaceInitializationResume,
    selectWorkspaceInitializerOnboardingFormState,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { selectModel } from '$store/renderer/slices/model/model-slice';
  import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
  import {
    selectPrincipalActionContext,
    selectPrincipalDraftProvenance,
    selectWorkspaceCreationVisible,
  } from '$store/renderer/slices/principal/principal-selectors';
  import type {
    OnboardingWorkspaceInitializationSubmission,
    WorkspaceInitializationJson,
    WorkspaceInitializationOutcome,
    WorkspaceInitializationStagedItem,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
  import { createLogger } from '$lib/utils/client-logger';
  import { cn } from '$lib/utils';

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
  const hostRole$ = selectHostRole();
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
  const initializationConsumerId = crypto.randomUUID();
  const initializationOutcome$ =
    selectWorkspaceInitializationOutcomeForConsumer(initializationConsumerId);
  // Retained by the initialization saga when the workspace was created but
  // staged-attachment placement (or the held first-message send) failed:
  // submit resumes this flow instead of creating a second workspace.
  const initializationResume$ = selectWorkspaceInitializationResume(initializationConsumerId);
  let onboardingInitializationGeneration = 0;
  let activeInitializationSeq: number | null = null;
  let onboardingMounted = true;
  let activeInitialization = $state.raw<{
    seq: number;
    resourceId: string;
    generation: number;
    current: () => boolean;
  } | null>(null);
  let consumedInitializationSeq: number | null = null;

  function releaseInitialization(seq: number) {
    appStore.dispatch(clearWorkspaceInitializationOutcome(initializationConsumerId, seq));
    if (activeInitializationSeq === seq) activeInitializationSeq = null;
    if (activeInitialization?.seq === seq) activeInitialization = null;
  }

  $effect(() => {
    const outcome = $initializationOutcome$;
    const active = activeInitialization;
    if (
      !active ||
      !outcome ||
      outcome.seq !== active.seq ||
      outcome.resourceId !== active.resourceId ||
      outcome.status !== 'pending' ||
      !outcome.prepared ||
      !active.current()
    )
      return;
    setupSpecialistId = outcome.prepared.specialistId ?? undefined;
    setupSpecialistName = outcome.prepared.specialistName;
  });

  $effect(() => {
    const outcome = $initializationOutcome$;
    const active = activeInitialization;
    if (
      !active ||
      !outcome ||
      outcome.status === 'pending' ||
      outcome.seq !== active.seq ||
      outcome.resourceId !== active.resourceId ||
      consumedInitializationSeq === outcome.seq
    )
      return;
    consumedInitializationSeq = outcome.seq;
    void consumeOnboardingInitialization(active, outcome);
  });

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
  // Set after a successful create: the draft is cleared and must not be
  // re-saved by a late flush or effect re-run.
  let onboardingDraftCleared = false;
  const onboardingDraftOwnerId = 'onboarding-workspace-initializer';
  const onboardingDraftAuthority$ =
    selectWorkspaceInitializerDraftAuthority(onboardingDraftOwnerId);
  const onboardingDraftAdmission$ = selectPrincipalActionContext();
  const onboardingDraftProvenance$ = selectPrincipalDraftProvenance();
  let onboardingDraftRestoreRequestId = $state(crypto.randomUUID());
  let onboardingDraftOwnerAdmission: string | null | undefined = undefined;
  let onboardingDraftProvenance: string | undefined;
  let onboardingDraftRestoreApplied = false;
  $effect(() => {
    const admission = $onboardingDraftAdmission$;
    const provenance = $onboardingDraftProvenance$;
    if (onboardingDraftOwnerAdmission === admission) return;
    const priorRequestId = onboardingDraftRestoreRequestId;
    const hadOwner =
      onboardingDraftOwnerAdmission !== undefined && onboardingDraftOwnerAdmission !== null;
    onboardingDraftOwnerAdmission = admission;
    onboardingDraftRestored = false;
    onboardingDraftRestoreApplied = false;
    if (hadOwner)
      appStore.dispatch(
        workspaceInitializerDraftOwnerReleased(onboardingDraftOwnerId, priorRequestId),
      );
    if (admission === null) return;
    const provenanceReplaced =
      onboardingDraftProvenance !== undefined && provenance !== onboardingDraftProvenance;
    if (provenanceReplaced) {
      onboardingInputValue = '';
      onboardingImageItems = [];
      onboardingStagedItems = [];
      getOnboardingRichTextarea()?.clear();
    }
    if (provenance !== null) onboardingDraftProvenance = provenance;
    onboardingDraftRestoreRequestId = crypto.randomUUID();
    appStore.dispatch(
      workspaceInitializerDraftRestoreRequested(
        onboardingDraftOwnerId,
        onboardingDraftRestoreRequestId,
        LEGACY_ONBOARDING_PROMPT_SESSION_KEY,
        admission,
        provenanceReplaced,
        provenance ?? undefined,
      ),
    );
  });
  $effect(() => {
    const restore = $onboardingDraftAuthority$.restore;
    if (
      !restore ||
      restore.requestId !== onboardingDraftRestoreRequestId ||
      restore.status === 'pending' ||
      onboardingDraftRestoreApplied
    )
      return;
    onboardingDraftRestoreApplied = true;
    if (restore.status === 'restored') {
      const restoredItems = deserializeDraftAttachments(restore.attachments);
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
      if (inputUntouched && restoredItems.length > 0) {
        // Image items (imageData/imageMimeType — including pre-migration
        // drafts saved from the old inline-editor format, which serialized
        // through the same context-item shape) rehydrate straight into the
        // thumbnail row's context-item list.
        const restoredImages = restoredItems.filter((item) => item.imageData && item.imageMimeType);
        if (restoredImages.length > 0 && onboardingImageItems.length === 0) {
          onboardingImageItems = restoredImages;
        }
        // Non-image items (path-only staged files from either surface)
        // rehydrate into the staged list so they survive the round trip —
        // they are placed at create-time redemption, and a failed pill
        // stays blocking/retryable rather than silently dropped.
        const restoredStaged = restoredItems.filter((item) => !item.imageData);
        if (restoredStaged.length > 0 && onboardingStagedItems.length === 0) {
          onboardingStagedItems = restoredStaged;
        }
      }
    }
    onboardingDraftRestored = restore.status !== 'error';
  });

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
    const payload = buildNewWorkspaceDraftPayload(onboardingInputValue, [
      ...onboardingImageItems,
      ...onboardingStagedItems,
    ]);
    if (payload)
      appStore.dispatch(
        workspaceInitializerDraftSaveScheduled(
          onboardingDraftOwnerId,
          payload,
          onboardingDraftRestoreRequestId,
          selectPrincipalActionContext.select(appStore.state) ?? undefined,
        ),
      );
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
    if (!onboardingDraftCleared)
      appStore.dispatch(
        workspaceInitializerDraftFlushRequested(
          onboardingDraftOwnerId,
          onboardingDraftRestoreRequestId,
          selectPrincipalActionContext.select(appStore.state) ?? undefined,
        ),
      );
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
  // Initial agent shown on the setup card: the Developer specialist's id and
  // localized name, refreshed from the resolved config at create time (both
  // undefined when the resolved list lacks the Developer → General).
  let setupSpecialistId = $state<string | undefined>(DEFAULT_NEW_WORKSPACE_SPECIALIST_ID);
  let setupSpecialistName = $state<string | undefined>(
    getSpecialistById(DEFAULT_NEW_WORKSPACE_SPECIALIST_ID)?.name ??
      DEFAULT_NEW_WORKSPACE_SPECIALIST_ID,
  );

  // Setup script state — session-local: the default is restored per repo
  // from the repo config / localStorage last-used, never from persisted
  // form state.
  let setupScript = $state('');
  let showSetupScript = $state(false);
  let setupScriptName = $state('Custom');
  let setupScriptNameSource = $state<SetupScriptNameSource>('custom');
  let isCustomSetupScript = $state(false);

  // User-picked model (bare id) + its provider for the initial Developer
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
        setupScriptNameSource === 'repo-config' &&
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

  let onboardingTestPromptRunning = $state(false);
  let onboardingTestPromptFailure = $state<TestPromptFailureGuidance | null>(null);
  let onboardingGridSelectedProviderId = $state<string | undefined>(undefined);
  const onboardingSelectedCatalogEntry = $derived(
    $providerCatalogEntries$.find((entry) => entry.id === onboardingGridSelectedProviderId),
  );
  const shouldTestOnboardingProvider = $derived(
    shouldRunOnboardingTestPrompt(onboardingSelectedCatalogEntry),
  );

  /** Advance from the welcome step, first committing the grid's resolved
   *  provider selection so a no-click advance still enables/activates the
   *  visually-selected provider (D1(B): commit only on explicit advance).
   *  For allowlisted providers that support it, one live test prompt runs first:
   *  success advances, a structured failure
   *  keeps the user on the step with actionable guidance. */
  async function advanceFromWelcomeStep() {
    if (onboardingTestPromptRunning) return;
    const committed = agentGridRef?.commitSelection();
    const providerId = committed ?? onboardingGridSelectedProviderId;
    if (!providerId) return;
    if (shouldTestOnboardingProvider) {
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
          showClaudeLoginButton: false,
          isAuthRequired: false,
        };
        return;
      } finally {
        onboardingTestPromptRunning = false;
      }
    }
    appStore.dispatch(goToStep('forge'));
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
  let releaseOnboardingPreparation: (() => void) | null = null;

  onDestroy(() => {
    onboardingMounted = false;
    onboardingInitializationGeneration++;
    appStore.dispatch(cancelWorkspaceInitializerOnboardingFormStateDebounce());
    flushOnboardingDraftSave();
    appStore.dispatch(
      workspaceInitializerDraftOwnerReleased(
        onboardingDraftOwnerId,
        onboardingDraftRestoreRequestId,
      ),
    );
    if (activeInitializationSeq !== null) releaseInitialization(activeInitializationSeq);
    releaseOnboardingPreparation?.();
    releaseOnboardingPreparation = null;
    appStore.dispatch(clearWorkspaceInitializationResume(initializationConsumerId));
    if (onboardingContentChangeTimer) clearTimeout(onboardingContentChangeTimer);
    setupScriptProbeScheduler.dispose();
  });

  // ============================================================================
  // Onboarding Derived State
  // ============================================================================

  const onboardingStepIndex = $derived(ONBOARDING_STEP_ORDER.indexOf($onboardingStep$));
  const isRequirementsStep = $derived($onboardingStep$ === 'requirements');
  const isWelcomeStep = $derived($onboardingStep$ === 'welcome');
  const isForgeStep = $derived($onboardingStep$ === 'forge');
  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const gitlabConfigured$ = selectGitLabAuthIsConfigured();
  const isProjectStep = $derived($onboardingStep$ === 'project');
  const isConfiguringStep = $derived(
    $onboardingStep$ === 'configuring' || $onboardingStep$ === 'ready',
  );
  const showStartWorking = $derived(
    onboardingStepIndex >= ONBOARDING_STEP_ORDER.indexOf('configuring'),
  );
  // The 'requirements' gate is not counted in the visible step indicator, and
  // 'configuring' and 'ready' share one visible step, so the count is the
  // visible order minus the terminal 'ready' entry. Back navigation maps
  // visible step N-1 to the visible order so it never lands on the gate.
  const VISIBLE_STEP_ORDER = $derived(
    ONBOARDING_STEP_ORDER.filter(
      (step) =>
        step !== 'requirements' &&
        ($hostRole$ !== 'member' || (step !== 'welcome' && step !== 'forge')),
    ),
  );
  const ONBOARDING_TOTAL_STEPS = $derived(VISIBLE_STEP_ORDER.length - 1);
  const onboardingVisibleStep = $derived(
    isConfiguringStep
      ? ONBOARDING_TOTAL_STEPS
      : Math.max(1, VISIBLE_STEP_ORDER.indexOf($onboardingStep$) + 1),
  );

  // ============================================================================
  // Mount: Reset onboarding state
  // ============================================================================

  onMount(() => {
    // Always start onboarding from the beginning. Related persisted initializer
    // state and session handoffs are cleared by the workspace-initializer saga.
    // (resetOnboarding preserves a pending fullFlowRequested — see the slice.)
    if (isOnboarding) {
      appStore.dispatch(
        resetOnboarding(selectPrincipalActionContext.select(appStore.state) ?? undefined),
      );
      appStore.dispatch(ensureProvidersChecked());
    }
  });

  $effect(() => {
    if (!isOnboarding || $onboardingStep$ !== 'requirements') return;
    const step = determineOnboardingInitialStep({
      hostRole: $hostRole$,
      requirementsCheckedOnce: $requirementsCheckedOnce$,
      allRequirementsMet: $allRequirementsMet$,
    });
    if (step === 'requirements') return;
    appStore.dispatch(setOnboardingFullFlowRequested(false));
    appStore.dispatch(goToStep(step));
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
      notify.success(m.onboarding_page_promptEnhanced_label());
    } catch (error) {
      logger.error('Failed to enhance prompt', error);
      notify.error(
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
    } else if (isForgeStep) {
      // Continue when connected, skip otherwise — both advance to project.
      // Skipping abandons a still-pending device flow (GitHub or GitLab), so
      // cancel it rather than leaving it polling in the background (and
      // resurfacing in Settings).
      e.preventDefault();
      if (selectGitHubAuthIsAuthenticating.select(appStore.state)) {
        appStore.dispatch(cancelGitHubAuth());
      }
      if (selectGitLabAuthIsAuthenticating.select(appStore.state)) {
        appStore.dispatch(cancelGitLabAuth());
      }
      appStore.dispatch(goToStep('project'));
    } else if (isProjectStep && projectSelection?.isValid) {
      e.preventDefault();
      appStore.dispatch(goToStep('configuring'));
    }
  }

  function applyInitializationFailure(outcome: WorkspaceInitializationOutcome | undefined) {
    if (outcome?.pullCompleted) onboardingBranchBehind = 0;
    const stagedItems = outcome?.stagedItems as ContextItem[] | undefined;
    if (stagedItems) {
      onboardingImageItems = stagedItems.filter((item) => item.imageData && item.imageMimeType);
      onboardingStagedItems = stagedItems.filter((item) => !(item.imageData && item.imageMimeType));
    }
    onboardingCreationErrorCode = outcome?.errorCode ?? null;
    if (outcome?.stage === 'pull') {
      onboardingPullError = outcome.error || m.onboarding_page_pullFailed_error();
      onboardingShowPullConflictDialog = true;
    }
    onboardingCreationError =
      outcome?.stage === 'attachments'
        ? m.onboarding_page_attachmentPlacementFailed_error()
        : outcome?.stage === 'first-message'
          ? outcome.error && outcome.error !== 'first-message-send-failed'
            ? m.onboarding_page_firstMessageSendFailedDetail_error({ detail: outcome.error })
            : m.onboarding_page_firstMessageSendFailed_error()
          : outcome?.error || m.onboarding_page_unexpected_error();
  }

  function trackWorkspaceInitialization(
    action: ReturnType<
      typeof workspaceInitializationSubmitted | typeof workspaceInitializationResumeRequested
    >,
    resourceId: string,
    generation: number,
    current: () => boolean,
  ) {
    onboardingCreateProgressId = action.payload.progressId;
    activeInitializationSeq = action.seq;
    activeInitialization = { seq: action.seq, resourceId, generation, current };
    appStore.dispatch(action);
    void action.promise.catch(() => {
      // Correlated selector outcomes own UI settlement, including reset removal.
    });
  }

  async function consumeOnboardingInitialization(
    active: NonNullable<typeof activeInitialization>,
    outcome: WorkspaceInitializationOutcome,
  ) {
    try {
      if (!active.current()) return;
      if (outcome.status === 'cancelled') return;
      if (outcome.status !== 'success' || !outcome.workspaceId) {
        applyInitializationFailure(outcome);
        return;
      }
      // Domain completion already cleared the draft; suppress teardown saves
      // throughout the local setup-card timing and navigation delay.
      onboardingDraftCleared = true;
      onboardingStagedItems = [];
      onboardingImageItems = [];
      setupRepoStatus = 'done';
      setupBranchStatus = 'done';
      if (setupScriptStatus) setupScriptStatus = 'active';
      setupAgentStatus = setupScriptStatus ? 'pending' : 'active';
      setupWorktreePath = outcome.workspacePath;
      setupWorkspaceId = outcome.workspaceId;
      if (setupScriptStatus) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!active.current()) return;
        setupScriptStatus = 'done';
      }
      setupAgentStatus = 'active';
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!active.current()) return;
      setupAgentStatus = 'done';
      if (!active.current()) return;
      onHoldActiveChange(true);
      onFadingOutChange(false);
      if (!active.current()) return;
      await goto(`/workspace/${outcome.workspaceId}`, { replaceState: true });
    } finally {
      releaseInitialization(active.seq);
      if (onboardingMounted && active.generation === onboardingInitializationGeneration) {
        isOnboardingCreating = false;
      }
    }
  }

  async function handleOnboardingSubmit() {
    const prompt = onboardingInputValue.trim();
    if (!prompt || isOnboardingCreating || !projectSelection?.isValid) return;
    const admission = selectPrincipalActionContext.select(appStore.state);
    if (admission === null || !selectWorkspaceCreationVisible.select(appStore.state)) return;
    const generation = ++onboardingInitializationGeneration;
    const resourceId = `onboarding:${admission}:${generation}`;
    const dispatch = appStore.dispatch;
    const projectSnapshot = JSON.stringify(projectSelection);
    const current = () =>
      onboardingMounted &&
      generation === onboardingInitializationGeneration &&
      appStore.dispatch === dispatch &&
      admission === selectPrincipalActionContext.select(appStore.state) &&
      selectWorkspaceCreationVisible.select(appStore.state) &&
      projectSnapshot === JSON.stringify(projectSelection);
    const consumer = { id: initializationConsumerId, resourceId };
    if ($initializationResume$) {
      isOnboardingCreating = true;
      onboardingCreationError = null;
      trackWorkspaceInitialization(
        workspaceInitializationResumeRequested(
          {
            entrypoint: 'onboarding',
            admission,
            stagedItems: $state.snapshot([
              ...onboardingStagedItems,
              ...onboardingImageItems,
            ]) as WorkspaceInitializationStagedItem[],
          },
          consumer,
        ),
        resourceId,
        generation,
        current,
      );
      return;
    }

    if (hasBlockingAttachments(onboardingStagedItems)) {
      notify.error(m.onboarding_page_blockingAttachments_toast());
      return;
    }

    const treatAsNewRepo = shouldTreatAsNewRepo(projectSelection);
    const effectiveBranch =
      selectedPRBranch && projectSelection.branch !== selectedPRBranch && !treatAsNewRepo
        ? selectedPRBranch
        : projectSelection.branch;
    if (!treatAsNewRepo && !effectiveBranch.trim()) {
      notify.error(m.onboarding_page_branchRequired_toast());
      return;
    }

    const defaultModelPreview = onboardingModelWasOverridden
      ? undefined
      : promptStepRef?.getEffectiveDefaultModel();
    const richTextareaMentions = getOnboardingRichTextarea()?.getMentions() ?? [];
    const contextMentions = getOnboardingRichTextarea()?.getContextMentions() ?? [];
    const fileMentionsSnapshot = $state.snapshot(
      richTextareaMentions,
    ) as OnboardingWorkspaceInitializationSubmission['fileMentions'];
    const contextMentionsSnapshot = $state.snapshot(
      contextMentions,
    ) as OnboardingWorkspaceInitializationSubmission['contextMentions'];
    isOnboardingCreating = true;
    onboardingCreationError = null;
    onboardingCreationErrorCode = null;
    setupRepoStatus = 'active';
    setupBranchStatus = 'active';
    setupAgentStatus = 'pending';
    setupScriptStatus = setupScript.trim() ? 'pending' : undefined;

    let handedOff = false;
    try {
      releaseOnboardingPreparation?.();
      const preparationId = crypto.randomUUID();
      const releasePreparation = registerWorkspaceInitializationPreparation(
        preparationId,
        async () => {
          const runtimeReferences = await parseRuntimeMentions(fileMentionsSnapshot, logger);
          if (!current()) return null;
          await setupScriptProbeScheduler.settled();
          if (!current()) return null;
          return {
            runtimeReferences: runtimeReferences as unknown as WorkspaceInitializationJson[],
            setupScript,
            setupScriptName,
            setupScriptNameSource,
            repoConfigScript: repoConfigScript ?? null,
            repoConfigScriptRepo: repoConfigScriptRepo ?? null,
          };
        },
      );
      releaseOnboardingPreparation = releasePreparation;
      const submission: OnboardingWorkspaceInitializationSubmission = {
        entrypoint: 'onboarding',
        admission,
        preparationId,
        prompt,
        contextMentions: contextMentionsSnapshot,
        fileMentions: fileMentionsSnapshot,
        runtimeReferences: [],
        stagedItems: $state.snapshot([
          ...onboardingStagedItems,
          ...onboardingImageItems,
        ]) as WorkspaceInitializationStagedItem[],
        setupScript,
        setupScriptName,
        setupScriptNameSource,
        repoConfigScript: repoConfigScript ?? null,
        repoConfigScriptRepo: repoConfigScriptRepo ?? null,
        branchBehind: onboardingBranchBehind,
        pullEnabled: onboardingShouldPullBeforeCreate,
        skipIsolation: onboardingSkipIsolation,
        selectedPrNumber: selectedPRNumber ?? null,
        draft: {
          ownerId: onboardingDraftOwnerId,
          restoreRequestId: onboardingDraftRestoreRequestId,
          clear: true,
        },
        project: {
          type: projectSelection.type,
          repoPath: projectSelection.repoPath,
          githubUrl: projectSelection.githubUrl,
          branch: projectSelection.branch,
          scope: projectSelection.scope,
        },
        treatAsNewRepo,
        effectiveBranch,
        selectedModel: onboardingSelectedModel,
        selectedProvider: onboardingSelectedProvider,
        modelWasOverridden: onboardingModelWasOverridden,
        defaultModelPreview: defaultModelPreview ?? undefined,
      };
      if (!current()) return;
      handedOff = true;
      const initialization = workspaceInitializationSubmitted(submission, consumer);
      trackWorkspaceInitialization(initialization, resourceId, generation, current);
      const releaseSettledPreparation = () => {
        releasePreparation();
        if (releaseOnboardingPreparation === releasePreparation)
          releaseOnboardingPreparation = null;
      };
      void initialization.promise.then(releaseSettledPreparation, releaseSettledPreparation);
    } catch (err) {
      if (!current()) return;
      logger.error('Workspace initialization preparation failed', err as Error);
      onboardingCreationError =
        err instanceof Error ? err.message : m.onboarding_page_unexpected_error();
    } finally {
      if (!handedOff) {
        releaseOnboardingPreparation?.();
        releaseOnboardingPreparation = null;
      }
      if (!handedOff && onboardingMounted && generation === onboardingInitializationGeneration)
        isOnboardingCreating = false;
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
          in:fly={{ tier: 'slow', distance: 20 }}
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
                specialistId={setupSpecialistId}
                specialistName={setupSpecialistName}
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
                          <Button
                            variant="ghost"
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
                          </Button>
                        {/if}
                      </div>
                    </div>

                    <div class="flex flex-col">
                      {#if isRequirementsStep}
                        <div in:fly={{ tier: 'slow', distance: 10 }} style="order: 1">
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
                        <div in:fly={{ tier: 'slow', distance: 10 }} style="order: 1">
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
                      {:else if isForgeStep}
                        <div in:fly={{ tier: 'slow', distance: 10 }} style="order: 2">
                          <div class="space-y-3">
                            <h2 class="text-5xl font-semibold tracking-tight leading-tight">
                              {$gitlabEnabled$ || $gitlabConfigured$
                                ? m.onboarding_page_connectForge_title()
                                : m.onboarding_forgeStep_connectGithub_label()}
                            </h2>
                            <p class="text-lg text-muted-foreground">
                              {m.onboarding_page_connectForge_before()}
                              <br />
                              {m.onboarding_page_connectForge_after()}
                            </p>
                          </div>
                        </div>
                      {:else if isProjectStep}
                        <div in:fly={{ tier: 'slow', distance: 10 }} style="order: 3">
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
                        <div in:fly={{ tier: 'slow', distance: 10 }} style="order: 4">
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
                    <div class="py-8 space-y-6" in:fly={{ tier: 'slow', distance: 15 }}>
                      {#if isRequirementsStep}
                        <div class="max-w-5xl mx-auto" data-testid="onboarding-requirements-step">
                          {#if $hostRole$ === 'owner'}
                            <OnboardingRequirementsStep />
                          {/if}
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
                          <Button
                            class="group/button"
                            size="xl"
                            variant={!hasConnectedProvider ? 'outline' : 'primary'}
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
                              class="mt-2 max-w-xl rounded-md border border-danger/40 bg-danger-background/5 p-3 text-sm"
                            >
                              <p>{onboardingTestPromptFailure.message}</p>
                              {#if onboardingTestPromptFailure.showClaudeLoginButton}
                                <div class="mt-2">
                                  <ClaudeLoginButton />
                                </div>
                              {:else if onboardingTestPromptFailure.loginCommandHint}
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
                              {#if onboardingTestPromptFailure.loginDocsUrl}
                                {@const docsUrl = onboardingTestPromptFailure.loginDocsUrl}
                                <Button
                                  type="button"
                                  variant="link"
                                  size="xs"
                                  class="mt-2 h-auto px-0 text-xs underline hover:no-underline"
                                  onclick={() => shell.open(docsUrl)}
                                >
                                  {m.chat_modelPicker_setupDocs_label()}
                                </Button>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      {:else if isForgeStep}
                        <div class="max-w-5xl mx-auto">
                          <OnboardingForgeStep
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
                              variant={!projectSelection?.isValid ? 'outline' : 'primary'}
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
