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
    enhancePrompt,
    EnhancePromptUnavailableError,
    isEnhancePromptAvailable,
  } from '$lib/client/live/live-prompt-enhancement';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { v4 as uuidv4 } from 'uuid';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';

  import WorkspaceSetupCard from '$features/onboarding/messages/WorkspaceSetupCard.svelte';
  import {
    selectOnboardingStep,
    selectOnboardingState,
  } from '$store/renderer/slices/onboarding/onboarding-selectors';
  import {
    goToStep,
    setProjectConfig,
    setOnboardingWorkspaceId,
    resetOnboarding,
  } from '$store/renderer/slices/onboarding/onboarding-slice';
  import { STEP_ORDER as ONBOARDING_STEP_ORDER } from '$store/renderer/slices/onboarding/onboarding-types';
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

  import { Button } from '$lib/components/ui/button';
  import type { ProjectSelection } from '$features/onboarding/messages/ProjectPickerMessage.svelte';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

  import { createAgentTypeId } from '$shared/types/agent.types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { resolveOnboardingModel } from '$features/onboarding/utils/resolve-onboarding-model';
  import {
    parseContextMentions,
    parseFileMentions,
    parseRuntimeMentions,
    parseInlineImages,
    extractLinearIssue,
    extractSentryIssue,
  } from '$features/onboarding/utils/parse-context-references';
  import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectLastUsedScriptForRepo } from '$store/renderer/slices/setup-scripts/setup-scripts-selectors';
  import {
    SETUP_SCRIPT_TEMPLATES,
    getTemplateContent,
    chooseDefaultSetupScript,
    createRepoConfigProbeScheduler,
    REPO_CONFIG_SCRIPT_NAME,
  } from '$features/setup-scripts';
  import { saveScript } from '$store/renderer/slices/setup-scripts/setup-scripts-slice';
  import { setHasCompletedProviderSetup } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    cancelWorkspaceInitializerOnboardingFormStateDebounce,
    debounceWorkspaceInitializerOnboardingFormState,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { selectWorkspaceInitializerHydrated } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { hydrateWorkspaceNavigation } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
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
        isCustomSetupScript = false;
      },
    });
  });

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
    return sessionStorage.getItem('onboarding-prompt') || '';
  }

  let onboardingInputValue = $state(getInitialOnboardingPrompt());
  let promptStepRef: OnboardingPromptStep | null = $state(null);
  let isOnboardingEnhancing = $state(false);

  // §5.31 gate — enhance is auggie-only; unset active provider defaults to auggie
  const activeProviderId$ = selectActiveProviderId();
  const enhancePromptAvailable = $derived(isEnhancePromptAvailable($activeProviderId$));

  /** Get the RichTextarea from the prompt step sub-component. */
  function getOnboardingRichTextarea(): RichTextarea | null {
    return promptStepRef?.getRichTextarea() ?? null;
  }

  // Analytics funnel tracking
  let hasFiredOnboardingClick = $state(false);
  let hasFiredOnboardingType = $state(false);

  // Persist onboarding prompt to sessionStorage with debounce
  let onboardingPromptSaveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const prompt = onboardingInputValue;
    if (!isOnboarding) return;
    if (onboardingPromptSaveTimer) clearTimeout(onboardingPromptSaveTimer);
    onboardingPromptSaveTimer = setTimeout(() => {
      if (prompt) {
        sessionStorage.setItem('onboarding-prompt', prompt);
      } else {
        sessionStorage.removeItem('onboarding-prompt');
      }
    }, 300);

    return () => {
      if (onboardingPromptSaveTimer) {
        clearTimeout(onboardingPromptSaveTimer);
        onboardingPromptSaveTimer = null;
      }
    };
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
  let setupScriptStatus = $state<SetupStepStatus | undefined>(undefined);

  // Setup script state
  let setupScript = $state('');
  let showSetupScript = $state(false);
  let setupScriptName = $state('Custom');
  let isCustomSetupScript = $state(false);

  // Repo-committed setup script from <repo>/.intent/config.json (local repos
  // read the file over IPC; GitHub repos use `github.repoConfig.get`).
  // Cached alongside the repo it was fetched for so stale results are never applied.
  let repoConfigScript = $state<string | null>(null);
  let repoConfigScriptRepo = $state<string | null>(null);
  // True while the repo-config probe is in flight (spinner on the setup-script control).
  let isRepoConfigLoading = $state(false);

  // Helper to restore the default setup script for a repo.
  // Priority: repo-committed `.intent/config.json` setupScript > last used for
  // this repo > generic "Copy config files only" template.
  function restoreLastUsedSetupScript(repo: string) {
    const lastUsed = repo ? selectLastUsedScriptForRepo.select(appStore.state, repo) : undefined;
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
    isCustomSetupScript = false;
  }

  $effect(() => {
    const selection = projectSelection;
    const skipIso = onboardingSkipIsolation;
    const step = $onboardingStep$;
    const script = setupScript;
    const scriptName = setupScriptName;
    const customScript = isCustomSetupScript;

    if (!isOnboarding || !$workspaceInitializerHydrated$) return;
    if (!(selection || skipIso || script || (step !== 'requirements' && step !== 'welcome')))
      return;
    appStore.dispatch(
      debounceWorkspaceInitializerOnboardingFormState({
        projectSelection: selection
          ? {
              type: selection.type,
              repoPath: selection.repoPath,
              branch: selection.branch,
              scope: selection.scope,
              githubUrl: selection.githubUrl,
              clonePath: selection.clonePath,
              projectName: selection.projectName,
              isValid: selection.isValid,
            }
          : null,
        skipIsolation: skipIso,
        setupScript: script,
        setupScriptName: scriptName,
        isCustomSetupScript: customScript,
        step,
      }),
    );
  });

  let hasConnectedProvider = $state(false);
  let onboardingSkipIsolation = $state(false);

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
    if (onboardingPromptSaveTimer) clearTimeout(onboardingPromptSaveTimer);
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
    if (isOnboarding) {
      appStore.dispatch(resetOnboarding());
    }
  });

  // Requirements gate: auto-advance to 'welcome' only once the check group
  // has settled with every requirement met; otherwise stay blocked on the
  // requirements step (OnboardingRequirementsStep renders the setup guidance
  // and re-checks on focus/visibility until the tools appear).
  $effect(() => {
    if (
      isOnboarding &&
      $onboardingStep$ === 'requirements' &&
      $requirementsCheckedOnce$ &&
      $allRequirementsMet$
    ) {
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
      previous?.isValid !== selection.isValid;

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
      appStore.dispatch(goToStep('github'));
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

  async function handleOnboardingSubmit() {
    const prompt = onboardingInputValue.trim();
    if (!prompt || isOnboardingCreating || !projectSelection?.isValid) return;

    isOnboardingCreating = true;
    onboardingCreationError = null;
    onboardingCreationErrorCode = null;
    setupRepoStatus = 'active';
    setupBranchStatus = 'active';
    setupAgentStatus = 'pending';
    setupScriptStatus = setupScript.trim() ? 'pending' : undefined;

    try {
      const reduxState = appStore.state;
      const {
        provider,
        model: effectiveModel,
        behaviorPrompt,
        specialistId,
      } = await resolveOnboardingModel(reduxState);
      const agentType = createAgentTypeId('workspace');

      // Parse context from the rich textarea
      const richTextareaMentions = getOnboardingRichTextarea()?.getMentions() ?? [];
      const contextMentionRefs = parseContextMentions(
        getOnboardingRichTextarea()?.getContextMentions() ?? [],
      );
      const fileMentionRefs = parseFileMentions(richTextareaMentions);
      const runtimeMentionRefs = await parseRuntimeMentions(richTextareaMentions, logger);
      const contextReferences = [...contextMentionRefs, ...fileMentionRefs, ...runtimeMentionRefs];
      const imageBlocks = parseInlineImages(getOnboardingRichTextarea()?.getInlineImages() ?? []);
      const linearIssue = extractLinearIssue(contextReferences);
      const sentryIssue = extractSentryIssue(contextReferences);

      // Auto-pull latest changes if branch is behind remote
      if (
        onboardingBranchBehind > 0 &&
        projectSelection.type === 'local' &&
        onboardingShouldPullBeforeCreate
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
          onboardingPullError = err instanceof Error ? err.message : m.onboarding_page_pullFailed_error();
          onboardingShowPullConflictDialog = true;
          isOnboardingCreating = false;
          return;
        }
      }

      const isNewRepo = projectSelection.type === 'new';
      const currentBranch = projectSelection.branch;
      const effectiveBranch =
        selectedPRBranch && currentBranch !== selectedPRBranch && !isNewRepo
          ? selectedPRBranch
          : currentBranch;

      const result = await workspaceClient.create({
        title: '',
        repositoryPath: projectSelection.repoPath,
        githubUrl: projectSelection.githubUrl,
        clonePath: projectSelection.clonePath,
        baseRef: effectiveBranch,
        isNewRepo,
        skipIsolation: onboardingSkipIsolation || undefined,
        scope: projectSelection.scope || undefined,
        setupScript: setupScript.trim() || undefined,
        linearIssue,
        sentryIssue,
        initialAgent: {
          name: 'Coordinator',
          model: effectiveModel,
          prompt,
          agentType,
          specialist: specialistId,
          behaviorPrompt,
          provider,
          contextReferences: contextReferences.length > 0 ? contextReferences : undefined,
          imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
          metadata: {
            source: 'onboarding',
            isInitialAgent: true,
            specialist: specialistId,
          },
        },
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

      // Clear stale layout/storage
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

      // Save the setup script to the store for future reuse.
      // Skip the unedited repo-config script — the committed .intent/config.json
      // is its source of truth, and saving a copy would both duplicate it in the
      // saved list and shadow future repo-config changes as the last-used default.
      const isUneditedRepoConfigScript =
        setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
        repoConfigScriptRepo === projectSelection.repoPath &&
        setupScript.trim() === (repoConfigScript ?? '').trim();
      if (setupScript.trim() && projectSelection.repoPath && !isUneditedRepoConfigScript) {
        const now = new Date().toISOString();
        const scriptToSave = {
          id: uuidv4(),
          name: setupScriptName || m.onboarding_page_customScript_label(),
          content: setupScript.trim(),
          repoPath: projectSelection.repoPath,
          projectType: 'generic' as string,
          lastUsedAt: now,
          usageCount: 1,
          createdAt: now,
        };
        appStore.dispatch(saveScript(scriptToSave));
        logger.info('Saved setup script to store', {
          name: setupScriptName,
          repoPath: projectSelection.repoPath,
        });
      }

      // Initial-agent delivery (message + sends) is owned by the daemon; the
      // FE only records which agent is the initial one so the UI can highlight
      // and focus it. The id is daemon-assigned (from the create result); when
      // it is somehow absent, skip the highlight/focus rather than invent one.
      if (agentId) {
        appStore.dispatch(setInitialAgentId(workspace.id, agentId));
      }

      // Same intent as CompactWorkspaceInitializer: land on the initial-agent
      // conversation as the only tab, full-width. The spec note remains
      // reachable from the sidebar; the main panel stays empty here so the
      // middleware doesn't need to special-case an agent-only screen.
      appStore.dispatch(
        hydrateWorkspaceNavigation(workspace.id, {
          version: 2,
          workspace: { id: workspace.id, status: 'loading' },
          mainPanel: { type: 'empty' },
          drawer: agentId
            ? { open: true, type: 'agent' as const, itemId: agentId }
            : { open: false, type: null, itemId: null },
          navigation: { history: [], currentIndex: -1 },
          ui: { hasInitialized: false },
        }),
      );

      setupRepoStatus = 'done';
      setupBranchStatus = 'done';
      if (setupScriptStatus) setupScriptStatus = 'active';
      setupAgentStatus = setupScriptStatus ? 'pending' : 'active';
      setupWorktreePath = workspace.worktreePath || workspace.repositoryPath;
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

      // Use the onboarding reset action as the cleanup signal; initializer
      // persistence/session cleanup is handled by the workspace-initializer saga.
      appStore.dispatch(resetOnboarding());

      // Mark provider setup as complete so the home page won't redirect back here
      appStore.dispatch(setHasCompletedProviderSetup(true));

      appStore.dispatch(setOnboardingWorkspaceId(workspace.id));
      appStore.dispatch(goToStep('ready'));

      logger.info('Workspace created, transitioning in-place', { workspaceId: workspace.id });

      onHoldActiveChange(true);
      onFadingOutChange(false);

      await goto(`/workspace/${workspace.id}`, { replaceState: true });
    } catch (err) {
      logger.error('Workspace creation failed', err as Error);
      onboardingCreationError = err instanceof Error ? err.message : m.onboarding_page_unexpected_error();
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
          in:fly={{ y: 20, duration: 400, easing: cubicOut }}
        >
          <div class="w-full max-w-lg">
            <WorkspaceSetupCard
              repoName={projectSelection?.projectName ||
                projectSelection?.repoPath?.split('/').pop() ||
                m.onboarding_page_yourProject_label()}
              repoUrl={projectSelection?.githubUrl}
              repoPath={projectSelection?.repoPath}
              worktreePath={setupWorktreePath}
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
            />
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
                              onAvailabilityChange={(hasAny) => {
                                hasConnectedProvider = hasAny;
                              }}
                            />
                          </div>
                        </div>
                        <div class="max-w-5xl mx-auto flex flex-col items-start gap-2 mt-9">
                          <Button
                            class="group/button"
                            size="xl"
                            variant={!hasConnectedProvider ? 'outline' : 'default'}
                            disabled={!hasConnectedProvider}
                            onclick={() => appStore.dispatch(goToStep('github'))}
                          >
                            {m.onboarding_page_letsGo_label()}
                            {#if hasConnectedProvider}
                              <span class="ml-1 opacity-50">⌘↵</span>
                            {/if}
                          </Button>
                          {#if !hasConnectedProvider}
                            <p class="text-xs text-muted-foreground">
                              {m.onboarding_page_connectAgent_description()}
                            </p>
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
                          bind:isCustomSetupScript
                          repoConfigScript={repoConfigScriptRepo === projectSelection?.repoPath
                            ? repoConfigScript
                            : null}
                          {isRepoConfigLoading}
                          {visibleSuggestions}
                          bind:focusedSuggestionIndex
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
