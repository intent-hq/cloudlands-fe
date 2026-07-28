<script lang="ts">
/* eslint-disable max-lines */
  import {
  untrack,
  onMount,
  onDestroy,
} from 'svelte';
  import {
  type InitialRepoInfo,
  getLastSelectedRepoHydrationAction,
  getInitialRepoKey,
  mapInitialRepoToFormState,
} from './initializer/initial-repo-utils';
  import { goto } from '$app/navigation';
  import {
  SETUP_SCRIPT_TEMPLATES,
  getTemplateContent,
  chooseDefaultSetupScript,
  createRepoConfigProbeScheduler,
  REPO_CONFIG_SCRIPT_NAME,
} from '$features/setup-scripts';
  import { v4 as uuidv4 } from 'uuid';
  import { saveScript } from '$store/renderer/slices/setup-scripts/setup-scripts-slice';
  import { selectLastUsedScriptForRepo } from '$store/renderer/slices/setup-scripts/setup-scripts-selectors';
  import {
  setCompactWorkspaceInitializerFormState,
  setWorkspaceInitializerBranchForRepo,
  setWorkspaceInitializerLastSubmittedAgent,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import {
  selectCompactWorkspaceInitializerFormState,
  selectWorkspaceInitializerHydrated,
  selectWorkspaceInitializerLastSelectedRepo,
  selectWorkspaceInitializerLastSubmittedAgent,
  selectWorkspaceInitializerRecentRepos,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import type {
    CompactWorkspaceInitializerFormState,
    WorkspaceInitializerRepoSelection,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
  import {
  hydrateWorkspaceNavigation,
  type WorkspaceNavigationWorkspaceState,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { debugConfig } from '$lib/config/debug';
  import type { StarterPrompt } from '$lib/data/starter-prompts';
  import {
  selectSelectedModel,
  selectAvailableModels,
} from '$store/renderer/slices/model/model-selectors';
  import { setInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';


  import {
  selectSpecialists,
  selectEffectiveBehaviorPrompt,
  selectEffectiveModel,
  selectEffectiveCodingAgent,
} from '$store/renderer/slices/specialists/specialists-selectors';
  import { createLogger } from '$lib/utils/client-logger';
  import {
  getGitErrorMessage,
  parseGitHubUrl,
  validateBranchName,
  validateInitialPrompt,
  validateRepoPath,
} from '$lib/utils/workspace-validation';
  import { createAgentTypeId } from '$shared/types/agent.types';
  import {
  faMagicWandSparkles,
  faPaperclip,
  faSpinner,
  faStop,
  faExclamationTriangle,
  faCodeBranch,
} from '@fortawesome/free-solid-svg-icons';
  import { invoke } from '$lib/electron-bridge';
  import { appClient } from '$lib/client';
  import { enhancePrompt } from '$lib/client/live/live-prompt-enhancement';
  import Fa from 'svelte-fa';
  import PullConflictDialog, { type PullErrorType } from '../modals/PullConflictDialog.svelte';

  import { toast } from 'svelte-sonner';
  import {
  fade,
  slide,
} from 'svelte/transition';
  import Button from '../ui/button/button.svelte';
  import { Checkbox } from '../ui/checkbox';
  import Tooltip from '../ui/tooltip/Tooltip.svelte';
  import InitialAgentPicker from './initializer/InitialAgentPicker.svelte';
  import IssueSuggestions, {
    preloadIssues,
    type IssueSelectionData,
  } from './initializer/IssueSuggestions.svelte';
  import RepoAndBranchPicker from './initializer/RepoAndBranchPicker.svelte';
  import SetupScriptModal from '../modals/SetupScriptModal.svelte';
  import { noteUrl } from '$shared/constants/intent-links';
  import { selectActiveProviderId } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
  import { parseCompoundModelId } from '$shared/config/provider-config';
  import {
    dropCrossProviderFallbackModel,
    resolveSubmitModel,
    resolveSubmitProvider,
  } from '$lib/utils/effective-model-resolution';
  import { store as appStore } from '$store/renderer/store';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import AttachmentPreview from '$lib/components/chat/AttachmentPreview.svelte';
  import {
  clearNewWorkspaceDraft,
  createNewWorkspaceDraftSaver,
  restoreNewWorkspaceDraft,
} from './initializer/new-workspace-draft';

  const availableModels$ = selectAvailableModels();
  const selectedModel$ = selectSelectedModel();
  const activeProviderId$ = selectActiveProviderId();
  const logger = createLogger('CompactWorkspaceInitializer');

  // Constants
  const PREFILL_KEY = 'workspace-prefill';

  function hasWorkspacePrefillData(): boolean {
    try {
      return typeof sessionStorage !== 'undefined' && !!sessionStorage.getItem(PREFILL_KEY);
    } catch {
      return false;
    }
  }

  /**
   * Supported file extensions for file attachments.
   * Includes image files and common code/text-based files.
   */
  const SUPPORTED_FILE_EXTENSIONS = [
    // Image files
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.bmp',
    // Programming languages
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.go',
    '.rs',
    '.swift',
    '.kt',
    '.scala',
    '.rb',
    '.php',
    '.html',
    '.css',
    '.scss',
    '.sass',
    '.less',
    '.svelte',
    '.vue',
    // Configuration and data files
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.xml',
    '.plist',
    '.properties',
    '.env',
    // Documentation and text files
    '.md',
    '.txt',
    '.rst',
    '.tex',
    // Shell scripts
    '.sh',
    '.bash',
    '.zsh',
    '.fish',
    // Database and query files
    '.sql',
    '.graphql',
    // Build and project files
    '.gradle',
    '.pom',
    '.bazel',
    '.bzl',
    '.dockerfile',
    '.makefile',
    // Other common text files
    '.proto',
    '.mod',
    '.hs',
    '.lua',
    '.dart',
    '.r',
    '.m',
    '.pl',
    '.ps1',
  ] as const;

  export type { InitialRepoInfo };

  interface Props {
    isExpanded: boolean;
    initialRepo?: InitialRepoInfo;
    oncreate?: () => void;
    /** Show contextual hints for first-time users */
    showFirstTimeHints?: boolean;
  }
  let {
    isExpanded = $bindable(false),
    initialRepo,
    oncreate,
    showFirstTimeHints = false,
  }: Props = $props();

  /**
   * Focus the prompt textarea (e.g., triggered by Cmd+N menu or ?create=true)
   */
  export function focus() {
    richTextarea?.focus();
  }

  /**
   * Focus the prompt textarea and select all existing content
   * (used by the modal to highlight pre-filled text)
   */
  export function focusAndSelectAll() {
    richTextarea?.focusAndSelectAll();
  }

  /**
   * Apply a starter prompt - sets the prompt text and configures a new repo
   */
  export function applyStarterPrompt(prompt: StarterPrompt) {
    // Set the repo path for a new project
    repoPath = `~/Developer/${prompt.repoName}`;
    repoType = 'local';
    isNewRepo = true;
    isValidPath = true;
    branch = 'main';

    // Set the prompt text in the rich textarea
    richTextarea?.setContent(prompt.prompt);

    // Focus the textarea
    richTextarea?.focus();
  }

  /**
   * Apply prefill data from sessionStorage (used by deep links)
   * This is called after the component is mounted to apply prefill data
   */
  export async function applyPrefill() {
    const prefillData = sessionStorage.getItem(PREFILL_KEY);
    if (prefillData) {
      try {
        const data = JSON.parse(prefillData);
        logger.debug('Applying prefill data from sessionStorage', { data });

        // Apply repo and branch settings (skip if onMount already set repoPath)
        if (data.repoPath && !repoPath) {
          repoPath = data.repoPath;
          isValidPath = true;
          // Reset scope when changing repos - scope is repo-specific
          scope = '';
        } else if (data.githubUrl && !repoPath) {
          // repoPath wasn't resolved at deep-link time (knownRepos may not have loaded yet).
          // Try resolving now via IPC to the repo registry.
          try {
            const result = await invoke<{ success: boolean; data?: Array<{ path: string; name: string; owner?: string }> }>(
              'workspace:get-recent-repositories',
              {},
            );
            if (result?.success && Array.isArray(result.data)) {
              const ghUrl = data.githubUrl.trim();
              const patterns = [
                /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/,
                /^git@github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/,
              ];
              let owner: string | null = null;
              let repo: string | null = null;
              for (const pattern of patterns) {
                const match = ghUrl.match(pattern);
                if (match) {
                  owner = match[1].toLowerCase();
                  repo = match[2].toLowerCase();
                  break;
                }
              }
              if (owner && repo) {
                const matched = result.data.find(
                  (r) => r.owner?.toLowerCase() === owner && r.name.toLowerCase() === repo,
                );
                if (matched?.path) {
                  repoPath = matched.path;
                  isValidPath = true;
                  scope = '';
                  logger.debug('Resolved githubUrl to local path via IPC', { githubUrl: data.githubUrl, repoPath });
                }
              }
            }
          } catch (e) {
            logger.warn('Failed to resolve githubUrl via repo registry IPC', { error: e });
          }
        }
        if (data.branch) branch = data.branch;

        // Apply remote environment settings
        if (data.environmentType === 'remote' && data.sshConfig) {
          remoteSetup = {
            type: 'remote',
            ssh: data.sshConfig,
          };
        }

        // Apply prompt if provided
        if (data.prompt) {
          initialPrompt = data.prompt;
        }

        // Apply specialist if provided (match by specialist ID)
        if (data.specialist) {
          const specialists = selectSpecialists.select(appStore.state);
          const matchedSpecialist = specialists.find((s) => s.id === data.specialist);
          if (matchedSpecialist) {
            selectedSpecialist = matchedSpecialist.id;
            // Switch team mode based on specialist - spec-writer uses team orchestration, everything else is single agent
            isTeamMode = data.specialist === 'spec-writer';
            logger.debug('Applied specialist from prefill', { specialistId: matchedSpecialist.id });
          } else {
            logger.warn('Specialist from prefill not found, ignoring', { specialist: data.specialist });
          }
        }

        // Apply title if provided (used by handleSubmit instead of hardcoded '')
        if (data.title) {
          prefillTitle = data.title;
        }

        // If we have previous workspace info, set up the pending mention
        if (data.previousWorkspaceId && data.previousWorkspaceTitle) {
          pendingPreviousWorkspace = {
            id: data.previousWorkspaceId,
            title: data.previousWorkspaceTitle,
          };
        }

        // Clear the prefill data so it doesn't get reapplied on next mount
        sessionStorage.removeItem(PREFILL_KEY);

        // If autoCreate is set, signal the reactive $effect to auto-submit
        // once isValid becomes true (avoids flaky setTimeout).
        if (data.autoCreate === true || data.autoCreate === 'true') {
          logger.info('autoCreate is set, will auto-submit once form is valid');
          pendingAutoCreate = true;
        } else {
          // Focus the prompt textarea so the user can immediately type what to do
          setTimeout(() => {
            richTextarea?.focus();
          }, 100);
        }
      } catch (e) {
        logger.error('Failed to parse prefill data:', e);
        // Clear malformed data to prevent repeated failures
        sessionStorage.removeItem(PREFILL_KEY);
      }
    }
  }

  const workspaceInitializerHydrated$ = selectWorkspaceInitializerHydrated();
  const compactFormState$ = selectCompactWorkspaceInitializerFormState();
  const lastSelectedRepo$ = selectWorkspaceInitializerLastSelectedRepo();
  const lastSubmittedAgent$ = selectWorkspaceInitializerLastSubmittedAgent();
  const recentRepos$ = selectWorkspaceInitializerRecentRepos();

  const savedState = $compactFormState$;
  const lastSubmittedAgent = $lastSubmittedAgent$;

  // Form state - initialize from saved state if available
  let repoPath = $state(savedState?.repoPath ?? '');
  let repoType: 'local' | 'github' | 'remote' = $state(savedState?.repoType ?? 'local');
  let githubUrl = $state(savedState?.githubUrl ?? '');
  let clonePath = $state(savedState?.clonePath ?? ''); // User-selected folder for cloning GitHub repos
  let branch = $state(savedState?.branch ?? '');
  let isNewRepo = $state(savedState?.isNewRepo ?? false);
  let isValidPath = $state(savedState?.isValidPath ?? false);
  // Scope is repo-specific - only restore if saved for the same repo
  let scope = $state(
    savedState?.scope && savedState?.repoPath === savedState?.scopeRepoPath ? savedState.scope : '',
  ); // Scope for subdirectories of git repos
  let remoteSetup: any = $state(savedState?.remoteSetup ?? null);
  // Prompt text drafts live in the daemon (drafts.*, PROTOCOL §5.16) and are
  // restored asynchronously below so they survive full app restarts
  let initialPrompt = $state('');
  // Context items for image attachments (images become attachment items, not inline nodes)
  let contextItems = $state<ContextItem[]>([]);
  // Use saved state first, then fall back to last submitted values, then defaults
  // NOTE: selectedSpecialist can be null (meaning "General / no specialist").
  // We check !== undefined instead of using ?? because null is a valid value
  // and ?? treats null as nullish, which would incorrectly fall through to 'spec-writer'.
  let selectedSpecialist = $state<string | null>(
    savedState?.selectedSpecialist !== undefined
      ? savedState.selectedSpecialist
      : lastSubmittedAgent?.selectedSpecialist !== undefined
        ? lastSubmittedAgent.selectedSpecialist
        : 'spec-writer',
  );
  // Validate saved model against current provider - stale models from a different provider
  // (e.g., 'claude-code:default' when active provider is now 'opencode') should be discarded
  // since they won't exist in the current model list and cause a flash of the wrong model.
  const restoredModel = savedState?.selectedModel ?? lastSubmittedAgent?.selectedModel;
  const currentProviderAtInit = $activeProviderId$ ?? 'auggie';
  const isModelForCurrentProvider =
    !restoredModel || parseCompoundModelId(restoredModel).providerId === currentProviderAtInit;

  let selectedModel = $state<string | undefined>(
    isModelForCurrentProvider ? restoredModel : undefined,
  );
  // Track if user explicitly overrode the model (vs using specialist default)
  let modelWasOverridden = $state<boolean>(
    isModelForCurrentProvider
      ? (savedState?.modelWasOverridden ?? lastSubmittedAgent?.modelWasOverridden ?? false)
      : false,
  );
  // Track if team mode is selected (spec-writer orchestrates)
  let isTeamMode = $state<boolean>(
    savedState?.isTeamMode ?? lastSubmittedAgent?.isTeamMode ?? true,
  );
  // Track which provider the user selected for the initial agent
  // Priority: active provider store takes precedence since it's the user's explicit choice
  let selectedProvider = $state<string>($activeProviderId$ ?? 'auggie');
  let prefillTitle = $state('');

  // Funnel tracking — fires at most once per form session, reset in clearForm()
  let hasFiredClick = $state(false);
  let hasFiredType = $state(false);

  // Setup script state
  let setupScript = $state(savedState?.setupScript ?? '');
  let showSetupScript = $state(false); // Always collapsed on mount
  let setupScriptName = $state(savedState?.setupScriptName ?? 'Custom');
  let isCustomSetupScript = $state(savedState?.isCustomSetupScript ?? false);

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
    const lastUsed = repo
      ? selectLastUsedScriptForRepo.select(appStore.state, repo)
      : undefined;
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

  /**
   * Read skipIsolation from persisted form state, falling back to the legacy
   * `skipWorktree` key so pre-rename persisted state keeps the user's choice.
   */
  function readSkipIsolation(
    formState: CompactWorkspaceInitializerFormState | null | undefined,
  ): boolean | undefined {
    return (
      formState?.skipIsolation ??
      (formState as { skipWorktree?: boolean } | null | undefined)?.skipWorktree
    );
  }

  // Skip isolation toggle (work directly in the repo folder, no isolated checkout)
  let skipIsolation = $state(readSkipIsolation(savedState) ?? false);

  // Git availability state: null = checking, true = found, false = not found
  let gitAvailable: boolean | null = $state(null);

  // Stay on home page after creation
  let stayOnHomePage = $state(savedState?.stayOnHomePage ?? false);

  // GitHub auth state - tracks if user needs to authenticate for private repos
  let githubAuthNeeded = $state<'none' | 'not-authenticated' | 'no-access'>('none');

  // Branch status - received from BranchSelector
  // We always auto-pull when behind, so we just need to track the status for the pull operation
  let branchBehind = $state(0);
  let shouldPullBeforeCreate = $state(true);
  let pullError = $state<string | null>(null);
  let showPullConflictDialog = $state(false);
  let isPulling = $state(false);
  // Track the selected PR's source branch and number (for "Use PR branch" suggestion and auto-linking)
  let selectedPRBranch = $state<string>('');
  let selectedPRNumber = $state<number | null>(null);

  let didApplyHydratedCompactState = $state(false);
  let didApplyHydratedLastSelectedRepo = $state(false);
  let hasInitialPrefillData = $state(hasWorkspacePrefillData());

  function applyAgentSettings(settings: CompactWorkspaceInitializerFormState | null | undefined) {
    if (!settings) return;
    if (settings.selectedSpecialist !== undefined) selectedSpecialist = settings.selectedSpecialist;
    const model = settings.selectedModel;
    if (model && parseCompoundModelId(model).providerId === ($activeProviderId$ ?? 'auggie')) {
      selectedModel = model;
      modelWasOverridden = settings.modelWasOverridden ?? modelWasOverridden;
    }
    if (settings.isTeamMode !== undefined) isTeamMode = settings.isTeamMode;
  }

  function applyCompactFormState(formState: CompactWorkspaceInitializerFormState) {
    repoPath = formState.repoPath ?? repoPath;
    repoType = formState.repoType ?? repoType;
    githubUrl = formState.githubUrl ?? githubUrl;
    clonePath = formState.clonePath ?? clonePath;
    branch = formState.branch ?? branch;
    isNewRepo = formState.isNewRepo ?? isNewRepo;
    isValidPath = formState.isValidPath ?? isValidPath;
    scope = formState.scope && formState.repoPath === formState.scopeRepoPath ? formState.scope : scope;
    remoteSetup = formState.remoteSetup ?? remoteSetup;
    selectedProvider = formState.selectedProvider ?? selectedProvider;
    setupScript = formState.setupScript ?? setupScript;
    setupScriptName = formState.setupScriptName ?? setupScriptName;
    isCustomSetupScript = formState.isCustomSetupScript ?? isCustomSetupScript;
    skipIsolation = readSkipIsolation(formState) ?? skipIsolation;
    stayOnHomePage = formState.stayOnHomePage ?? stayOnHomePage;
    applyAgentSettings(formState);
  }

  function applyLastSelectedRepo(data: WorkspaceInitializerRepoSelection) {
    repoPath = data.path || '';
    repoType = data.type || 'local';
    githubUrl = data.githubUrl || '';
    clonePath = data.clonePath || '';
    isNewRepo = data.isNewRepo || false;
    isValidPath = data.isValidPath ?? false;
    scope = data.scope || '';
  }

  $effect(() => {
    if (!$workspaceInitializerHydrated$ || didApplyHydratedCompactState) return;
    if ($compactFormState$ && !repoPath) {
      applyCompactFormState($compactFormState$);
    } else if ($lastSubmittedAgent$) {
      applyAgentSettings($lastSubmittedAgent$);
    }
    didApplyHydratedCompactState = true;
  });

  $effect(() => {
    const lastSelectedRepo = $lastSelectedRepo$;
    const recentRepos = $recentRepos$;
    const hydrationAction = getLastSelectedRepoHydrationAction({
      isHydrated: $workspaceInitializerHydrated$,
      alreadyHandled: didApplyHydratedLastSelectedRepo,
      hasPrefillData: hasInitialPrefillData,
      isFormPersistenceEnabled: debugConfig.get('enableFormPersistence'),
      currentRepoPath: repoPath,
      hasLastSelectedRepo: !!lastSelectedRepo,
      recentRepos,
    });

    if (hydrationAction === 'wait') return;

    didApplyHydratedLastSelectedRepo = true;
    if (hydrationAction === 'restore' && lastSelectedRepo) {
      applyLastSelectedRepo(lastSelectedRepo);
    } else if (hydrationAction === 'restore-recent' && recentRepos.length > 0) {
      // Fall back to the most recently used repository
      const mostRecentRepo = recentRepos[0];
      applyLastSelectedRepo({
        path: mostRecentRepo.path,
        type: mostRecentRepo.type,
        isValidPath: true,
      });
    }
  });

  // Restore the modal draft (prompt text + image attachments) from the daemon
  // (drafts.get under the reserved sentinel keys, PROTOCOL §5.16) so it
  // survives app restarts. Gates the save effect below until it settles so an
  // initial empty save cannot clear a not-yet-restored draft. Non-fatal.
  let draftRestored = $state(false);
  let draftRestoreFailed = false;
  (async () => {
    try {
      const restore = await restoreNewWorkspaceDraft(appClient.drafts);
      draftRestoreFailed = restore.status === 'error';
      if (restore.status === 'restored') {
        if (restore.contextItems.length > 0 && contextItems.length === 0) {
          contextItems = restore.contextItems;
        }
        if (restore.text && !initialPrompt) {
          initialPrompt = restore.text;
          setTimeout(() => {
            richTextarea?.setContent(restore.text);
          }, 50);
        }
      }
    } finally {
      draftRestored = true;
    }
  })();

  // Save the draft to the daemon (debounced) so it survives app restarts.
  // Empty text with no attachments is the documented clear (PROTOCOL §5.16).
  // Only the cheap dependency reads run per keystroke. `contextItems` is only
  // ever reassigned wholesale, so the reference read is sufficient for
  // reactivity. If the restore failed, the saver skips an empty save so it
  // can't clear a daemon draft we never got to read.
  const draftSaver = createNewWorkspaceDraftSaver(appClient.drafts, {
    skipEmptySave: () => draftRestoreFailed,
  });
  $effect(() => {
    if (!draftRestored) return;
    draftSaver.schedule(initialPrompt, contextItems);
  });

  // A reload (cmd+R) or window close inside the debounce window would drop
  // the newest keystrokes — flush the pending save on unload and destroy.
  const flushDraftSave = () => draftSaver.flush();
  onMount(() => {
    window.addEventListener('beforeunload', flushDraftSave);
    return () => window.removeEventListener('beforeunload', flushDraftSave);
  });
  onDestroy(flushDraftSave);

  // Notify context mention pills when the branch changes (for switch-to-pr-branch feature)
  $effect(() => {
    if (branch) {
      document.dispatchEvent(
        new CustomEvent('initializer-branch-updated', {
          detail: { branch },
        }),
      );
    }
  });

  // Save form state through Redux whenever it changes. Persistence is handled by the saga.
  $effect(() => {
    if (!$workspaceInitializerHydrated$) return;
    // Only save if there's meaningful state to preserve
    if (repoPath || selectedSpecialist || selectedModel || setupScript) {
      const formState = {
        repoPath,
        repoType,
        githubUrl,
        clonePath,
        branch,
        isNewRepo,
        isValidPath,
        scope,
        scopeRepoPath: scope ? repoPath : undefined, // Track which repo the scope belongs to
        remoteSetup,
        selectedSpecialist,
        selectedModel,
        modelWasOverridden,
        isTeamMode,
        selectedProvider,
        setupScript,
        showSetupScript,
        setupScriptName,
        isCustomSetupScript,
        skipIsolation,
        stayOnHomePage,
      };
      // Snapshot to strip $state proxies (e.g. remoteSetup) — Redux state must be
      // structured-cloneable for daemon persistence (src/store/renderer/AGENTS.md §2).
      appStore.dispatch(setCompactWorkspaceInitializerFormState($state.snapshot(formState)));
    }
  });

  // When the active provider changes externally (e.g. user switches in settings),
  // update the form's selected provider and clear the stale model selection.
  $effect(() => {
    const newProviderId = $activeProviderId$;
    const currentProvider = untrack(() => selectedProvider);
    if (newProviderId && newProviderId !== currentProvider) {
      selectedProvider = newProviderId;
      selectedModel = undefined;
      modelWasOverridden = false;
    }
  });

  // Track previous workspace info for inserting @ mention after mount
  let pendingPreviousWorkspace: { id: string; title: string } | null = $state(null);

  // Flag for reactive auto-submit: set by applyPrefill() when autoCreate is requested.
  // The $effect below watches this + isValid to submit once form validation settles.
  let pendingAutoCreate = $state(false);

  // Ref to RepoAndBranchPicker for focusing the input after prefill
  let repoAndBranchPicker: any = $state(null);

  // Preload Linear and Sentry issues as soon as this component mounts
  // so they're ready when the user expands the form
  onMount(() => {
    logger.debug('Preloading issues on mount');
    preloadIssues();

    // Check git availability
    (async () => {
      try {
        const result =
          typeof window !== 'undefined' && window.electronAPI
            ? await invoke<any>('system:check-git')
            : undefined;
        if (result?.success && result.data) {
          gitAvailable = result.data.available;
          if (!result.data.available) {
            logger.warn('Git is not available on this system');
          } else {
            logger.debug('Git available', { version: result.data.version });
          }
        } else {
          gitAvailable = false;
        }
      } catch (err) {
        logger.error('Failed to check git availability', err);
        gitAvailable = false;
      }
    })();

    // First check for prefill data from sessionStorage (takes priority over persisted Redux state)
    // This is set when:
    // - User clicks "Archive and start new space"
    // - Deep links with create params
    // - Other navigation patterns that need to prefill the form
    const prefillData = sessionStorage.getItem(PREFILL_KEY);
    if (prefillData) {
      try {
        const data = JSON.parse(prefillData);
        logger.debug('Applying prefill data from sessionStorage', { data });

        // Apply repo and branch settings
        if (data.repoPath) {
          repoPath = data.repoPath;
          isValidPath = true;
          // Reset scope when changing repos - scope is repo-specific
          scope = '';
        }
        if (data.branch) branch = data.branch;

        // Apply remote environment settings
        if (data.environmentType === 'remote' && data.sshConfig) {
          remoteSetup = {
            type: 'remote',
            ssh: data.sshConfig,
          };
        }

        // Apply prompt if provided
        if (data.prompt) {
          initialPrompt = data.prompt;
        }

        // Apply specialist if provided (match by specialist ID)
        if (data.specialist) {
          const specialists = selectSpecialists.select(appStore.state);
          const matchedSpecialist = specialists.find((s: { id: string }) => s.id === data.specialist);
          if (matchedSpecialist) {
            selectedSpecialist = matchedSpecialist.id;
            // Switch team mode based on specialist - spec-writer uses team orchestration, everything else is single agent
            isTeamMode = data.specialist === 'spec-writer';
            logger.debug('Applied specialist from prefill (onMount)', { specialistId: matchedSpecialist.id });
          } else {
            logger.warn('Specialist from prefill not found (onMount), ignoring', { specialist: data.specialist });
          }
        }

        // If we have previous workspace info, set up the pending mention
        // This will trigger the $effect that inserts the @ mention with the seed prompt
        if (data.previousWorkspaceId && data.previousWorkspaceTitle) {
          pendingPreviousWorkspace = {
            id: data.previousWorkspaceId,
            title: data.previousWorkspaceTitle,
          };
        }

        // Do NOT remove PREFILL_KEY here — applyPrefill() (called by +page.svelte
        // after tick()) still needs to read it for autoCreate and other fields.
        // applyPrefill() is the single owner that reads and removes the key.
      } catch (e) {
        logger.error('Failed to parse prefill data:', e);
        // Clear malformed data to prevent repeated failures
        sessionStorage.removeItem(PREFILL_KEY);
        hasInitialPrefillData = false;
      }
    }
  });

  // Reactive auto-submit: when applyPrefill() sets pendingAutoCreate, this $effect
  // fires once isValid becomes true, avoiding the flaky setTimeout approach.
  $effect(() => {
    if (pendingAutoCreate && isValid) {
      pendingAutoCreate = false;
      logger.info('Auto-submitting workspace creation form');
      handleSubmit();
    }
  });

  // Insert the @ mention for previous workspace after the RichTextarea is ready
  $effect(() => {
    if (pendingPreviousWorkspace && richTextarea) {
      const workspaceInfo = pendingPreviousWorkspace;
      // Clear immediately to prevent re-running
      pendingPreviousWorkspace = null;

      // Wait for the editor to be fully initialized, then set content and insert mention
      setTimeout(async () => {
        if (richTextarea) {
          // Clear any existing content first to ensure we start fresh
          richTextarea.clear();

          // Build the content by inserting text segments and mention inline
          // Note: We use insertText for the prefix to avoid HTML stripping trailing whitespace
          // that can happen with setContent + markdown processing
          richTextarea.insertText('I just finished ');

          // Then insert the mention at the end (insertMention adds a space after)
          // Use shared constants for URL construction
          const specUrl = noteUrl('spec', workspaceInfo.id);
          richTextarea.insertMention({
            id: 'spec',
            label: workspaceInfo.title,
            type: 'note',
            uri: specUrl,
            meta: {
              workspaceId: workspaceInfo.id,
              isExternalLink: true,
              // Also store the full URL in meta for fallback
              fullUrl: specUrl,
            },
          });

          // Insert the trailing text inline (not using setContent to avoid newlines)
          richTextarea.insertText('. Next, I want to ');
        }
      }, 200);
    }
  });

  // Detected GitHub owner/repo from local git remote
  let detectedGitHubOwner = $state<string | null>(null);
  let detectedGitHubRepo = $state<string | null>(null);

  // Track last applied initial repo to avoid re-applying (string key avoids $state proxy mismatch)
  let lastAppliedInitialRepoKey = '__uninitialized__';

  // Apply initial repo when provided and focus the prompt input
  $effect(() => {
    const repoKey = getInitialRepoKey(initialRepo);
    if (initialRepo && repoKey !== lastAppliedInitialRepoKey) {
      const repo = initialRepo;
      // Defer state writes to break the synchronous effect cascade.
      // untrack() does NOT help here — it only prevents reads from tracking,
      // but writes to $state still propagate synchronously to subscribers.
      // queueMicrotask breaks out of the synchronous effect execution context.
      queueMicrotask(() => {
        lastAppliedInitialRepoKey = repoKey;
        const formState = mapInitialRepoToFormState(repo);

        if (formState.repoPath !== undefined) repoPath = formState.repoPath;
        if (formState.isValidPath !== undefined) isValidPath = formState.isValidPath;
        if (formState.isNewRepo !== undefined) isNewRepo = formState.isNewRepo;
        if (formState.scope !== undefined) scope = formState.scope;
        if (formState.branch !== undefined) branch = formState.branch;
        if (formState.repoType !== undefined) repoType = formState.repoType;
        if (formState.githubUrl !== undefined) githubUrl = formState.githubUrl;
        if (formState.remoteSetup) remoteSetup = formState.remoteSetup;
        if (formState.pendingPreviousWorkspace) {
          pendingPreviousWorkspace = formState.pendingPreviousWorkspace;
        }
      });
    }
  });

  $effect(() => {
    if (!isExpanded) return;
    // Focus the prompt input after the form expands
    setTimeout(() => {
      richTextarea?.focus();
    }, 100);
  });

  // Listen for global enhance prompt shortcut (Cmd+/)
  $effect(() => {
    if (!isExpanded) return;
    if (typeof window === 'undefined') return;

    const handleEnhancePromptEvent = () => {
      handleEnhancePrompt();
    };

    window.addEventListener('chat:enhance-prompt', handleEnhancePromptEvent);

    return () => {
      window.removeEventListener('chat:enhance-prompt', handleEnhancePromptEvent);
    };
  });

  // Check for GitHub PRs with source branches when editor content is restored from sessionStorage
  // This ensures the "Use PR branch" suggestion appears for restored context mentions
  // Also fetches branch info for PRs that are missing it (e.g., from base64 context)
  $effect(() => {
    if (!richTextarea) return;

    // Small delay to ensure the editor has parsed the content
    setTimeout(async () => {
      const contextMentions = richTextarea?.getContextMentions() ?? [];
      logger.debug('Checking for GitHub PRs in restored content', {
        mentionCount: contextMentions.length,
        selectedPRBranch,
      });

      // Early return if there are no context mentions (no need to process)
      if (contextMentions.length === 0) return;

      // First, look for PRs that already have sourceBranch set
      const prWithBranch = contextMentions.find((mention: any) => {
        if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
        try {
          const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
          return metadata?.sourceBranch && metadata.sourceBranch.length > 0;
        } catch {
          return false;
        }
      });

      if (prWithBranch) {
        try {
          const metadata = prWithBranch.metadata ? JSON.parse(prWithBranch.metadata) : null;
          if (metadata?.sourceBranch) {
            // Always update both branch and PR number together to avoid race conditions
            // where handleContentChange sets selectedPRBranch but not selectedPRNumber
            if (!selectedPRBranch) {
              selectedPRBranch = metadata.sourceBranch;
            }
            const prNumMatch = prWithBranch.identifier?.match(/#(\d+)$/);
            selectedPRNumber = prNumMatch ? parseInt(prNumMatch[1], 10) : null;
            logger.debug('Restored selectedPRBranch from context mention', {
              branch: metadata.sourceBranch,
              prNumber: selectedPRNumber,
            });
          }
        } catch {
          // Ignore parse errors
        }
        return; // Already have a branch, no need to fetch
      }

      // If no PR with branch found, look for GitHub PRs without sourceBranch and fetch it
      const prWithoutBranch = contextMentions.find((mention: any) => {
        if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
        if (mention.provider !== 'github') return false;
        try {
          const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
          // PR without sourceBranch or with empty sourceBranch
          return !metadata?.sourceBranch || metadata.sourceBranch.length === 0;
        } catch {
          return true; // If we can't parse metadata, it likely needs fetching
        }
      });

      logger.debug('PR detection result', {
        prWithBranch: prWithBranch?.identifier ?? null,
        prWithoutBranch: prWithoutBranch?.identifier ?? null,
        selectedPRBranch,
      });

      if (
        prWithoutBranch &&
        !selectedPRBranch &&
        typeof window !== 'undefined' &&
        window.electronAPI
      ) {
        // Parse identifier: format is "owner/repo#number"
        const identifier = prWithoutBranch.identifier;
        const match = identifier?.match(/^([^/]+)\/([^#]+)#(\d+)$/);
        if (!match) {
          logger.debug('Could not parse PR identifier', { identifier });
          return;
        }

        const [, owner, repo, numberStr] = match;
        const number = parseInt(numberStr, 10);

        try {
          logger.debug('Fetching PR branch info for restored context mention', {
            owner,
            repo,
            number,
          });
          const response = await invoke<any>('git-tracking:get-pull-request', {
            owner,
            repo,
            number,
          });
          if (response?.success && response.data?.sourceBranch) {
            selectedPRBranch = response.data.sourceBranch;
            selectedPRNumber = number;
            logger.debug('Fetched and set selectedPRBranch from restored context mention', {
              branch: response.data.sourceBranch,
              prNumber: number,
            });
          }
        } catch (err) {
          logger.warn('Failed to fetch PR branch info for restored context mention', {
            identifier,
            error: err,
          });
        }
      }
    }, 200);
  });

  // Enhance prompt state
  let isEnhancing = $state(false);
  let enhanceRequestId = $state(0);
  let cancelledRequestId = $state(-1);

  // UI state
  let isCreating = $state(false);
  let creationStage = $state(0); // 0-3 for progress stages
  let error: string | null = $state(null);
  let controlsContainer: HTMLDivElement | null = $state(null);
  let richTextarea: RichTextarea | null = $state(null);

  // Image upload state
  let fileInputRef: HTMLInputElement | undefined = $state();
  let isDraggingOver = $state(false);

  // Progress messages to show during creation - makes wait feel shorter
  const CREATION_STAGES = [
    'Preparing workspace...',
    'Setting up git branch...',
    'Configuring environment...',
    'Almost ready...',
  ];

  // Cycle through creation stages while creating
  $effect(() => {
    if (!isCreating) {
      creationStage = 0;
      return;
    }

    // Advance through stages every ~1.5 seconds
    const interval = setInterval(() => {
      creationStage = Math.min(creationStage + 1, CREATION_STAGES.length - 1);
    }, 1500);

    return () => clearInterval(interval);
  });

  // Generation counter guarding the remote-URL probe against out-of-order
  // async responses after rapid repo switches
  let remoteUrlProbeGeneration = 0;

  // Fetch remote URL when local repo path changes
  $effect(() => {
    const path = repoPath;
    const type = repoType;
    const generation = ++remoteUrlProbeGeneration;

    // Clear synchronously so a repo switch never briefly shows the previous
    // repo's detected owner/repo
    detectedGitHubOwner = null;
    detectedGitHubRepo = null;

    // Only fetch for local repos with valid paths
    if (type !== 'local' || !path || (!path.startsWith('/') && !path.startsWith('~'))) {
      return;
    }

    // Fetch the remote URL for the local repo
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
          logger.debug('Detected GitHub from local repo', {
            path,
            owner: response.data.owner,
            repo: response.data.repo,
          });
        }
      } catch (err) {
        logger.debug('Failed to get remote URL for repo', { path, error: err });
      }
    })();
  });

  // Auto-restore last used setup script when the repo changes, and re-probe
  // the repo config when the GitHub branch changes (monorepo#835). This
  // ensures the setup script name/content are correct in the button bar
  // without requiring the user to open the setup script modal. The scheduler
  // keys runs on repo identity + ref: repo switches restore and probe at
  // once, branch-only changes re-probe debounced.
  const setupScriptProbeScheduler = createRepoConfigProbeScheduler();
  onDestroy(() => setupScriptProbeScheduler.dispose());
  $effect(() => {
    const path = repoPath;
    const type = repoType;
    // Only read githubUrl/branch for GitHub selections so the effect doesn't
    // track them (and re-run) while a local repo is selected.
    const identity = {
      path,
      type,
      githubUrl: type === 'github' ? githubUrl : null,
      branch: type === 'github' ? branch : null,
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
      getCurrentIdentity: () => ({ path: repoPath, type: repoType, githubUrl, branch }),
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

  // Derived validation
  // For GitHub repos, also require successful branch fetch (no auth issues)
  const isValid = $derived(
    gitAvailable === true &&
      !!repoPath &&
      isValidPath &&
      (isNewRepo || !!branch || repoType === 'remote') &&
      (repoType !== 'github' || githubAuthNeeded === 'none'),
  );

  // Derived GitHub repo info for IssueSuggestions
  const githubRepoInfo = $derived.by(() => {
    // First try the explicit GitHub URL
    if (githubUrl) {
      return parseGitHubUrl(githubUrl);
    }
    // Try detected owner/repo from local repo's remote URL
    if (detectedGitHubOwner && detectedGitHubRepo) {
      return { owner: detectedGitHubOwner, repo: detectedGitHubRepo };
    }
    // Then try the repoPath (might be owner/repo format from GitHub selection)
    if (repoPath) {
      return parseGitHubUrl(repoPath);
    }
    return null;
  });

  // Collapse handler - blurs textarea and collapses
  function collapse() {
    isExpanded = false;
    // Blur any focused element within the container
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  // Global keyboard shortcuts when expanded
  $effect(() => {
    if (!isExpanded) return;

    function handleGlobalKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        collapse();
      }
    }

    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  });

  // Listen for switch-to-pr-branch events from context mention pills
  $effect(() => {
    function handleSwitchToPRBranch(e: CustomEvent<{ branch: string; prIdentifier: string }>) {
      const newBranch = e.detail.branch;
      logger.debug('Switching to PR branch', { newBranch, prIdentifier: e.detail.prIdentifier });
      branch = newBranch;

      // Dispatch event to update context mention pills about the new branch
      document.dispatchEvent(
        new CustomEvent('initializer-branch-updated', {
          detail: { branch: newBranch },
        }),
      );
    }

    document.addEventListener('switch-to-pr-branch', handleSwitchToPRBranch as EventListener);
    return () => {
      document.removeEventListener('switch-to-pr-branch', handleSwitchToPRBranch as EventListener);
    };
  });

  function handleBlur() {
    // Use a small delay to check if focus moved to a control within the expanded area
    // This prevents the UI from collapsing when clicking on controls like RepoSelector
    setTimeout(() => {
      const activeElement = document.activeElement;
      // If focus moved to an element within the controls container, keep isFocused true
      if (controlsContainer && activeElement && controlsContainer.contains(activeElement)) {
        return; // Don't set isFocused to false
      }
      // Also check if focus is still within the main container (for portal-rendered dropdowns)
      const mainContainer = controlsContainer?.closest('.relative');
      if (mainContainer && activeElement && mainContainer.contains(activeElement)) {
        // Check if we're interacting with a Select or Popover (common UI components)
        const isSelectOrPopover = activeElement.closest(
          '[role="listbox"], [role="dialog"], [data-radix-portal]',
        );
        if (isSelectOrPopover) {
          return; // Don't set isFocused to false when interacting with dropdowns
        }
      }
    }, 100);
  }
  function handleRepoChange(
    event: CustomEvent<{
      path: string;
      type: 'local' | 'github' | 'remote';
      githubUrl?: string;
      clonePath?: string;
      isNewRepo?: boolean;
      isValidPath?: boolean;
      scope?: string;
      remoteSetup?: any;
    }>,
  ) {
    repoPath = event.detail.path;
    repoType = event.detail.type === 'remote' ? 'remote' : event.detail.type;
    isNewRepo = event.detail.isNewRepo || false;
    isValidPath = event.detail.isValidPath ?? false;
    scope = event.detail.scope || '';
    githubUrl = event.detail.githubUrl || '';
    clonePath = event.detail.clonePath || '';
    branch = isNewRepo
      ? 'main'
      : event.detail.type === 'remote'
        ? event.detail.remoteSetup?.branch || 'main'
        : '';

    // Handle remote setup from repo selector
    if (event.detail.type === 'remote' && event.detail.remoteSetup) {
      remoteSetup = event.detail.remoteSetup;
      logger.info('Remote setup selected via repo selector', { setup: remoteSetup });
    } else {
      // Clear remote setup when switching to local or github
      remoteSetup = null;
    }

    // GitHub repos require an isolated checkout - reset skipIsolation if switching to github type
    if (event.detail.type === 'github') {
      skipIsolation = false;
    }

    // Reset GitHub auth state when repo changes - will be updated by BranchSelector
    githubAuthNeeded = 'none';

    // Reset branch status state when repo changes
    branchBehind = 0;
    pullError = null;
    selectedPRBranch = '';
  }

  function handleBranchChange(event: CustomEvent<{ branch: string }>) {
    logger.debug('handleBranchChange called', { branch: event.detail.branch });
    branch = event.detail.branch;

    // Dispatch event for context mention pills to know the current branch
    document.dispatchEvent(
      new CustomEvent('initializer-branch-updated', {
        detail: { branch: event.detail.branch },
      }),
    );

    // Reset pull error when branch changes
    pullError = null;
  }

  /**
   * Handle branch status updates from BranchSelector
   * BranchSelector now manages fetching and provides accurate status
   */
  function handleBranchStatusChange(
    status: import('./initializer/BranchSelector.svelte').BranchStatus,
  ) {
    logger.debug('Branch status updated from BranchSelector', status);
    branchBehind = status.behind;
    // Note: hasUncommittedChanges and isCurrentBranch are now handled by BranchSelector's UI
  }

  // Extract repo name from GitHub URL for display

  /**
   * Build context content string from a context mention for the agent
   * This formats the issue/item details in a readable way for the LLM
   */
  function buildContextContent(
    mention: {
      itemType: string;
      identifier: string;
      title: string;
      url: string;
      description?: string;
    },
    metadata: Record<string, any>,
  ): string {
    const parts: string[] = [];

    // Add identifier and title
    parts.push(`[${mention.identifier}] ${mention.title}`);

    // Add URL
    if (mention.url) {
      parts.push(`URL: ${mention.url}`);
    }

    // Add description if present
    if (mention.description) {
      parts.push(`\nDescription:\n${mention.description}`);
    }

    // Add relevant metadata
    if (metadata.state) {
      parts.push(`Status: ${metadata.state}`);
    }
    if (metadata.teamName) {
      parts.push(`Team: ${metadata.teamName}`);
    }
    if (metadata.priority !== undefined) {
      const priorityLabels = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
      parts.push(`Priority: ${priorityLabels[metadata.priority] || metadata.priority}`);
    }
    if (metadata.assignee) {
      parts.push(`Assignee: ${metadata.assignee}`);
    }

    return parts.join('\n');
  }

  async function handleSubmit() {
    if (!isValid || isCreating) return;

    isCreating = true;
    error = null;

    try {
      // Validate
      if (!isNewRepo && repoType !== 'remote') {
        const branchValidation = validateBranchName(branch);
        if (!branchValidation.valid) throw new Error(branchValidation.error);
      }
      const promptValidation = validateInitialPrompt(initialPrompt);
      if (!promptValidation.valid) throw new Error(promptValidation.error);

      // For GitHub repos with a clone path, validate the GitHub URL instead of the local clone path
      // since the clone path won't exist until after cloning
      if (repoType === 'github' && githubUrl && clonePath) {
        const repoValidation = await validateRepoPath(githubUrl, false);
        if (!repoValidation.valid) throw new Error(repoValidation.error);
        // Note: We don't validate the parent directory here because:
        // 1. The backend will create it if it doesn't exist (using mkdir with recursive: true)
        // 2. Paths starting with ~ need to be expanded by the backend first
      } else if (repoType !== 'remote') {
        // Skip local path validation for remote repos - the path is on the remote server,
        // not the local machine. The connection test already verified the repo exists.
        const repoValidation = await validateRepoPath(repoPath, isNewRepo);
        if (!repoValidation.valid) throw new Error(repoValidation.error);
      }

      // Auto-pull latest changes if branch is behind remote
      // We always pull automatically to ensure workspace starts with latest code
      // Skip pull if user explicitly chose to create without pulling (via PullConflictDialog)
      if (branchBehind > 0 && repoType === 'local' && !isNewRepo && shouldPullBeforeCreate) {
        isPulling = true;
        logger.info('Auto-pulling latest changes before workspace creation', {
          branch,
          behind: branchBehind,
        });
        try {
          // Daemon-backed pull (`git.pull`, PROTOCOL §5.6) via the appClient
          // seam — replaces the dead legacy `git:pullBranch` IPC. The seam
          // folds the daemon's structured `{ ok: false, error }` failure into
          // `{ success: false, error }` and never throws.
          const pullResult =
            typeof window !== 'undefined' && window.electronAPI
              ? await appClient.git.pull(repoPath, branch)
              : undefined;
          if (!pullResult?.success) {
            pullError = pullResult?.error || 'Failed to pull changes';
            showPullConflictDialog = true;
            isPulling = false;
            isCreating = false;
            return; // Stop workspace creation - user will handle via dialog
          }
          // Pull succeeded - reset behind count
          branchBehind = 0;
          logger.info('Successfully pulled latest changes before workspace creation', {
            branch,
          });
        } catch (err) {
          pullError = err instanceof Error ? err.message : 'Failed to pull changes';
          showPullConflictDialog = true;
          isPulling = false;
          isCreating = false;
          return; // Stop workspace creation - user will handle via dialog
        }
        isPulling = false;
      }

      // Auto-apply PR branch: if a PR context mention set selectedPRBranch but the user
      // hasn't manually switched to it, use the PR branch as the base.
      // This ensures workspace.baseRef matches the PR's source branch for auto-discovery.
      const effectiveBranch =
        selectedPRBranch && branch !== selectedPRBranch && !isNewRepo ? selectedPRBranch : branch;
      const baseBranch = isNewRepo ? 'main' : effectiveBranch;

      // Build environment config if remote setup is selected
      const remoteSetupSnapshot = remoteSetup ? $state.snapshot(remoteSetup) : null;
      const environmentConfig = remoteSetupSnapshot
        ? {
            type: 'remote' as const,
            ssh: {
              host: remoteSetupSnapshot.host,
              port: remoteSetupSnapshot.port || 22,
              user: remoteSetupSnapshot.username,
              password: remoteSetupSnapshot.password,
              key_path: remoteSetupSnapshot.keyPath,
              use_agent: remoteSetupSnapshot.useAgent,
              transport: remoteSetupSnapshot.transport,
              ws_url: remoteSetupSnapshot.wsUrl,
            },
            workspace_path: remoteSetupSnapshot.workspacePath,
          }
        : undefined;

      // Get agent name and specialist ID from selected specialist
      let agentName = 'Agent';
      let specialistId: string | undefined;

      if (selectedSpecialist) {
        // Direct specialist selected
        const specialist = selectSpecialists
          .select(appStore.state)
          .find((s) => s.id === selectedSpecialist);
        agentName = specialist?.name ?? 'Agent';
        specialistId = selectedSpecialist;
      }

      // Extract context mentions from the editor (Linear issues, GitHub issues, etc.)
      logger.info('[CompactWorkspaceInitializer] Extracting context mentions', {
        hasRichTextarea: !!richTextarea,
      });
      const contextMentions = richTextarea?.getContextMentions() ?? [];
      logger.info('[CompactWorkspaceInitializer] Extracted context mentions', {
        mentionCount: contextMentions.length,
        mentions: contextMentions.map((m: { itemType: string; identifier: string }) => ({
          itemType: m.itemType,
          identifier: m.identifier,
        })),
      });

      // Extract file/folder/note mentions from the editor
      const fileMentions = richTextarea?.getMentions() ?? [];
      logger.info('[CompactWorkspaceInitializer] Extracted file mentions', {
        mentionCount: fileMentions.length,
        mentions: fileMentions.map((m: { type: string; label: string }) => ({
          type: m.type,
          label: m.label,
        })),
      });

      // Extract inline images from the editor (legacy fallback)
      const inlineImages = richTextarea?.getInlineImages() ?? [];
      logger.info('[CompactWorkspaceInitializer] Extracted inline images (fallback)', {
        imageCount: inlineImages.length,
      });

      // Convert context mentions to context references for the agent
      const contextReferences: any[] = remoteSetup ? [$state.snapshot(remoteSetup)] : [];
      for (const mention of contextMentions) {
        // Parse metadata back from JSON if present
        let parsedMetadata: Record<string, any> = {};
        if (mention.metadata) {
          try {
            parsedMetadata = JSON.parse(mention.metadata);
          } catch {
            // Ignore parse errors
          }
        }

        // Build a context reference that includes the issue content
        const contextRef: Record<string, any> = {
          type: mention.itemType, // 'linear-issue', 'github-issue', 'sentry-issue'
          provider: mention.provider,
          identifier: mention.identifier,
          title: mention.title,
          url: mention.url,
          // Include description and metadata as content for the agent
          content: buildContextContent(mention, parsedMetadata),
          metadata: parsedMetadata,
        };
        contextReferences.push(contextRef);
      }

      // Convert file mentions to context references
      for (const mention of fileMentions) {
        // Only process file-type mentions (not notes, which are handled differently)
        if (mention.type === 'file') {
          // Try multiple sources for the file path (meta.fullPath, meta.path, id, uri)
          let filePath = (mention.meta?.fullPath as string) || (mention.meta?.path as string) || '';

          // Fallback: extract absolute path from mention ID
          // file-provider creates IDs like "file-/absolute/path"
          // Drop handler creates IDs like "file-/absolute/path" (with Electron file.path) or "file-name-timestamp" (without)
          if (!filePath && mention.id?.startsWith('file-')) {
            const idPath = mention.id.slice(5); // Remove "file-" prefix
            // Only use if it looks like a real path (starts with / or drive letter), not "name-timestamp"
            if (idPath.startsWith('/') || /^[A-Za-z]:/.test(idPath)) {
              filePath = idPath;
            }
          }

          // Fallback: extract path from URI
          if (!filePath && mention.uri) {
            if (mention.uri.startsWith('devspace://file/')) {
              try {
                filePath = decodeURIComponent(mention.uri.slice('devspace://file/'.length));
              } catch {
                // Ignore decode errors
              }
            } else if (mention.uri.startsWith('file:')) {
              filePath = mention.uri.slice(5); // Remove "file:" prefix
            }
          }

          // Last resort: use the mention label (just the filename) so the agent can search for it
          if (!filePath) {
            filePath = mention.label || (mention.meta?.name as string) || '';
          }

          const contextRef: Record<string, any> = {
            type: 'file',
            path: filePath,
            title: mention.label,
            // The agent will read this file via its tools
          };
          contextReferences.push(contextRef);
        }
      }

      // Convert terminal mentions to context references with buffer content
      for (const mention of fileMentions) {
        if (mention.type === 'terminal') {
          try {
            const { terminalManager } = await import('$features/terminal/terminal-manager.svelte');
            const wsId = (mention.meta?.workspaceId as string) || '';
            const bufferContent = await terminalManager.getBufferContent(mention.id, wsId);
            if (bufferContent) {
              const contextRef: Record<string, any> = {
                type: 'terminal',
                content: bufferContent, // For stdinContext builder compatibility
                terminalContent: bufferContent,
                title: mention.label,
                metadata: { terminalName: mention.label, terminalId: mention.id },
              };
              contextReferences.push(contextRef);
            }
          } catch (error) {
            logger.warn('[CompactWorkspaceInitializer] Failed to read terminal buffer:', error);
          }
        }

        if (mention.type === 'script') {
          try {
            const { selectScriptOutput, selectScriptById, selectScriptRuntime } =
              await import('$store/renderer/slices/scripts/scripts-selectors');
            const { scriptOutputToLines } = await import('$lib/utils/script-output-text');
            const scriptId = mention.id;
            const state = appStore.state;
            const outputLines = scriptOutputToLines(selectScriptOutput.select(state, scriptId));
            const script = selectScriptById.select(state, scriptId);
            const runtime = selectScriptRuntime.select(state, scriptId);

            let content = `Script: ${script?.name || mention.label}\n`;
            content += `Command: ${script?.command || 'unknown'}\n`;
            content += `Status: ${runtime.status}`;
            if (runtime.exitCode !== null && runtime.exitCode !== undefined) {
              content += ` (exit code: ${runtime.exitCode})`;
            }
            content += '\n';
            if (runtime.detectedUrl) {
              content += `URL: ${runtime.detectedUrl}\n`;
            }
            if (outputLines.length > 0) {
              const lastLines = outputLines.slice(-100).join('\n');
              content += `\nOutput (last ${Math.min(outputLines.length, 100)} lines):\n${lastLines}`;
            } else {
              content += '\nNo output yet.';
            }

            const contextRef: Record<string, any> = {
              type: 'script',
              content,
              title: script?.name || mention.label,
              metadata: {
                scriptId,
                command: script?.command,
                status: runtime.status,
                exitCode: runtime.exitCode,
                detectedUrl: runtime.detectedUrl,
              },
            };
            contextReferences.push(contextRef);
          } catch (error) {
            logger.warn('[ScriptMention] Failed to resolve script context:', error);
          }
        }
      }

      // Extract imageBlocks from ALL context items with imageData/imageMimeType
      // (includes attachment items created by processImageFiles)
      // Also include inline images as fallback for legacy support
      const imageBlocks: Array<{ type: 'image'; data: string; mimeType: string }> = [];

      // First, add images from attachment context items
      for (const item of contextItems) {
        if (item.imageData && item.imageMimeType) {
          imageBlocks.push({
            type: 'image',
            data: item.imageData,
            mimeType: item.imageMimeType,
          });
        }
      }

      // Then, add inline images as fallback (for any that were manually inserted)
      for (let i = 0; i < inlineImages.length; i++) {
        const img = inlineImages[i];
        // Parse data URL to extract mime type and base64 data
        const match = img.src.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const [, mimeType, base64Data] = match;
          imageBlocks.push({
            type: 'image',
            data: base64Data,
            mimeType: mimeType,
          });
        }
      }

      logger.info('[CompactWorkspaceInitializer] Built context references and images', {
        contextMentionCount: contextMentions.length,
        fileMentionCount: fileMentions.length,
        imageCount: imageBlocks.length,
        contextReferenceCount: contextReferences.length,
        contextRefTypes: contextReferences.map((r: { type: string }) => r.type),
      });

      // Resolve behaviorPrompt EARLY so it can be passed to workspace creation IPC
      let resolvedBehaviorPrompt: string | undefined;
      if (selectedSpecialist) {
        resolvedBehaviorPrompt = selectEffectiveBehaviorPrompt.select(
          appStore.state,
          selectedSpecialist,
        );
      }

      // Resolve the model for the selected specialist + provider so the agent is created
      // with the correct compound model ID (e.g., 'codex:gpt-5.3-codex').
      // Uses the same shared effective-model resolution the InitialAgentPicker displays,
      // so the created agent gets exactly the model shown in the picker. An explicit
      // user override (modelWasOverridden) always wins.
      // Without this, model would be undefined and the backend falls back to DEFAULT_AGENT_MODEL
      // (an auggie model), which breaks provider inheritance when the coordinator delegates.
      const reduxState = appStore.state;
      let resolvedModel = resolveSubmitModel({
        modelWasOverridden,
        overriddenModel: selectedModel,
        specialistId: selectedSpecialist,
        selectedProvider,
        availableModelValues: $availableModels$.map((m) => m.value),
        globalSelectedModel: $selectedModel$,
        effectiveCodingAgent: selectedSpecialist
          ? selectEffectiveCodingAgent.select(reduxState, selectedSpecialist)
          : undefined,
        effectiveModel: selectedSpecialist
          ? selectEffectiveModel.select(reduxState, selectedSpecialist)
          : undefined,
        specialistInfo: selectedSpecialist
          ? selectSpecialists.select(reduxState).find((s) => s.id === selectedSpecialist)
          : undefined,
      });
      // No specialist selected (General/blank agent) and user didn't override the model:
      // fall back to the global store selection when models haven't loaded yet.
      if (!resolvedModel && !modelWasOverridden && !selectedSpecialist) {
        resolvedModel = $selectedModel$;
      }

      // Validate resolvedModel against available models. Tier-mapped model IDs
      // (e.g., 'opencode:anthropic/claude-opus-4-5') may not match actual model IDs
      // returned by the provider CLI, causing a visible flash in the ModelPicker.
      // Fall back to the model store's validated selected model if the resolved model
      // doesn't exist in the available list.
      // Only validate when the form's selectedProvider matches the model store's loaded
      // provider (active-provider Redux slice) — otherwise the available models are for a
      // different provider and we can't meaningfully validate.
      const storeProvider = $activeProviderId$;
      if (resolvedModel && $availableModels$.length > 0 && selectedProvider === storeProvider) {
        const availableModelValues = $availableModels$.map((m) => m.value);
        if (!availableModelValues.includes(resolvedModel)) {
          logger.warn('Tier-resolved model not in available list, using store default', {
            resolvedModel,
            fallback: $selectedModel$,
            selectedProvider,
            availableCount: availableModelValues.length,
          });
          resolvedModel = $selectedModel$;
        }
      }

      // Guard the non-overridden fallback: when the resolved model belongs to
      // a different provider than the form's selection (e.g. the selected
      // provider's models haven't loaded and the fallback came from the
      // default provider's store selection), drop the model so the daemon
      // uses the selected provider's own default instead of the fallback
      // silently flipping the submitted provider. Explicit user overrides
      // (modelWasOverridden) may legitimately cross providers and are kept.
      if (!modelWasOverridden) {
        resolvedModel = dropCrossProviderFallbackModel(resolvedModel, selectedProvider);
      }

      // Derive the submitted provider from the final resolved model so intent
      // and daemon spawn can never diverge: the daemon's resolve_provider_id
      // gives a compound model prefix precedence over the provider field, and
      // a bare model id resolves to the default provider. When no model
      // resolves, keep the form's selected provider.
      const submitProvider = resolveSubmitProvider(resolvedModel, selectedProvider);

      // No client-minted agentId: the daemon assigns the initial agent's id
      // and returns it on the create result (supersedes the fresh-id-per-
      // attempt fix — with no client id there is nothing to poison retries).
      const initialAgent = {
        name: agentName,
        model: resolvedModel,
        specialist: specialistId, // Now accepts any specialist ID (not restricted to enum)
        behaviorPrompt: resolvedBehaviorPrompt, // Pass to IPC for workspace creation
        prompt: initialPrompt.trim() || undefined,
        agentType: createAgentTypeId('workspace'),
        provider: submitProvider, // ACP provider ID (auggie, claude-code, codex)
        contextReferences: contextReferences.length > 0 ? contextReferences : undefined,
        imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
        metadata: {
          source: 'compact-initializer',
          isInitialAgent: true,
          specialist: specialistId ?? undefined,
          provider: submitProvider, // Also store in metadata for reference
          workMode: isTeamMode ? 'team' : 'single', // For analytics: which mode card was selected
          createdAt: new Date().toISOString(),
        },
      };

      // Save branch per repo for persistence - ensures branch is remembered even if user
      // didn't explicitly click a branch in the dropdown (accepting the auto-selected default)
      if (debugConfig.get('enableFormPersistence') && repoPath && baseBranch && !isNewRepo) {
        appStore.dispatch(setWorkspaceInitializerBranchForRepo(repoPath, baseBranch));
        logger.debug('Saved branch per repo', { repoPath, branch: baseBranch });
      }

      const result = await workspaceClient.create({
        title: prefillTitle || '', // Use deep-link title if provided, otherwise agent will set it
        repositoryPath: String(remoteSetupSnapshot?.workspacePath || repoPath),
        githubUrl: repoType === 'github' && githubUrl ? githubUrl : undefined, // GitHub URL to clone
        clonePath:
          repoType === 'github' && (clonePath || repoPath) ? clonePath || repoPath : undefined, // User-selected clone destination (falls back to repoPath since they're the same for GitHub repos)
        baseRef: String(baseBranch),
        setupScript: setupScript.trim() || undefined,
        environmentConfig,
        isNewRepo: Boolean(isNewRepo),
        skipIsolation: skipIsolation || undefined,
        scope: scope || undefined, // Scope for subdirectories of git repos
        initialAgent,
      });

      if (!result.ok) throw new Error(result.error || 'Failed to create workspace');

      const workspace = result.data.workspace;
      // The daemon assigns the initial agent's id and returns it on the
      // create result; the FE no longer pre-mints one.
      const initialAgentId = result.data.initialAgent?.id;

      // If a PR context mention was used, store the PR number on the workspace
      // so PR discovery can find the right PR later. Daemon-backed
      // (`workspace.update`, PROTOCOL §5.1) via workspaceClient — the legacy
      // `workspace:update` IPC channel is unbridged in this build.
      if (selectedPRNumber && workspace.id) {
        void workspaceClient
          .update({ id: workspace.id, prNumber: selectedPRNumber })
          .then((updateResult) => {
            if (!updateResult.ok) {
              logger.warn('Failed to store PR number on workspace', { error: updateResult.error });
            }
          });
      }

      // Clear any stale panel layout data for this workspace ID.
      // This is important when workspace IDs are reused (e.g., after deletion and recreation).
      // Without this, the workspace page may load stale layout data with duplicate tabs.
      try {
        const { getPanelLayoutManager } = await import('$features/layout/panel-layout-adapter');
        getPanelLayoutManager(workspace.id).clearLayout();
      } catch (error) {
        logger.debug('Could not clear panel layout', { error });
      }

      // Clear any stale workspace storage state (drawer state, main panel, etc.)
      // for this workspace ID. When workspace IDs are reused, stale drawer state
      // can cause the workspace page to open a non-existent agent from a previous
      // workspace, leading to spurious agent creation.
      try {
        const { workspaceStorageManager } =
          await import('$store/renderer/slices/workspace/utils/workspace-storage-manager');
        workspaceStorageManager.clearState(workspace.id);
      } catch (error) {
        logger.debug('Could not clear workspace storage state', { error });
      }

      // Pre-populate Redux with the workspace entity so the workspace page
      // has data on the very first render frame (before sagas/effects run).
      appStore.dispatch(setWorkspaceEntity(workspace));

      // Save the setup script to the store for future reuse.
      // Skip the unedited repo-config script — the committed .intent/config.json
      // is its source of truth, and saving a copy would both duplicate it in the
      // saved list and shadow future repo-config changes as the last-used default.
      const isUneditedRepoConfigScript =
        setupScriptName === REPO_CONFIG_SCRIPT_NAME &&
        repoConfigScriptRepo === repoPath &&
        setupScript.trim() === (repoConfigScript ?? '').trim();
      if (setupScript.trim() && !isUneditedRepoConfigScript) {
        const now = new Date().toISOString();
        const scriptToSave = {
          id: uuidv4(),
          name: setupScriptName || 'Custom Script',
          content: setupScript.trim(),
          repoPath,
          projectType: 'generic' as string,
          lastUsedAt: now,
          usageCount: 1,
          createdAt: now,
        };
        appStore.dispatch(saveScript(scriptToSave));
        logger.info('Saved setup script to store', {
          name: setupScriptName,
          repoPath,
        });
      }

      // Initial-agent delivery (message + sends) is owned by the daemon; the
      // FE only records which agent is the initial one so the UI can highlight
      // and focus it. The id is daemon-assigned (from the create result); when
      // it is somehow absent, skip the highlight/focus rather than invent one.
      if (initialAgentId) {
        appStore.dispatch(setInitialAgentId(workspace.id, initialAgentId));
      }

      // Pre-store the workspace state so the workspace page mounts on the
      // initial-agent conversation as its only tab (full-width, no spec split).
      // The spec note stays reachable manually from the sidebar; leaving the
      // main panel empty here keeps the hydration payload consistent with the
      // agent-only intent instead of asking the middleware to special-case it.
      const initialState: WorkspaceNavigationWorkspaceState = {
        version: 2,
        workspace: { id: workspace.id, status: 'loading' },
        mainPanel: { type: 'empty' },
        drawer: initialAgentId
          ? { open: true, type: 'agent' as const, itemId: initialAgentId }
          : { open: false, type: null, itemId: null },
        navigation: { history: [], currentIndex: -1 },
        ui: { hasInitialized: false },
      };
      appStore.dispatch(hydrateWorkspaceNavigation(workspace.id, initialState));

      if (stayOnHomePage) {
        // Update the workspace in the store with agentSummary so the agent shows immediately
        // This is needed because the workspace returned from create() doesn't include agentSummary
        appStore.dispatch(
          updateWorkspaceEntity(workspace.id, {
            agentSummary: {
              agentIds: initialAgentId ? [initialAgentId] : [],
            },
          }),
        );
      } else {
        await goto(`/workspace/${workspace.id}`);
      }

      // Save last submitted agent settings before clearing form.
      // This allows the form to restore these values after submission.
      appStore.dispatch(setWorkspaceInitializerLastSubmittedAgent({
        selectedSpecialist,
        selectedModel,
        modelWasOverridden,
        isTeamMode,
      }));

      clearForm({ preserveRepo: stayOnHomePage });

      // Notify parent (e.g. modal) that creation succeeded
      // Skip if in rapid fire mode — the user wants to stay in the modal to create more workspaces
      if (!stayOnHomePage) {
        oncreate?.();
      }

      // Re-focus the text input if staying on the home page
      if (stayOnHomePage) {
        // Use setTimeout to ensure the form is fully cleared before focusing
        setTimeout(() => {
          richTextarea?.focus();
        }, 100);
      }
    } catch (err) {
      error = err instanceof Error ? getGitErrorMessage(err.message) : 'Failed to create workspace';
    } finally {
      isCreating = false;
    }
  }

  function clearForm({ preserveRepo = false }: { preserveRepo?: boolean } = {}) {
    if (!preserveRepo) {
      repoPath = '';
      repoType = 'local';
      githubUrl = '';
      clonePath = '';
      branch = '';
      isNewRepo = false;
      isValidPath = false;
      scope = '';
    }
    remoteSetup = null;
    initialPrompt = '';
    contextItems = []; // Clear attachment items
    richTextarea?.clear(); // Clear the TipTap editor content
    // Immediately clear the persisted daemon draft (drafts.clear under the
    // sentinel keys, PROTOCOL §5.16) and the legacy sessionStorage key
    clearNewWorkspaceDraft(appClient.drafts);
    // Note: NOT resetting selectedSpecialist, selectedModel, modelWasOverridden, isTeamMode
    // These are preserved so the user's last agent selection persists across workspace creations
    setupScript = '';
    showSetupScript = false;
    setupScriptName = 'Custom';
    isCustomSetupScript = false;

    // When preserving repo (stayOnHomePage), restore the last used setup script
    // so the next workspace creation uses the same script
    if (preserveRepo && repoPath) {
      restoreLastUsedSetupScript(repoPath);
    }
    hasFiredClick = false;
    hasFiredType = false;
    error = null;
    // Reset branch status state
    branchBehind = 0;
    pullError = null;
    showPullConflictDialog = false;
    // Note: intentionally not resetting stayOnHomePage or shouldPullBeforeCreate - user preferences should persist

    // Immediately write the cleaned form state to Redux so that even if the
    // $effect doesn't fire before the component unmounts (e.g. navigation
    // happens right after oncreate?.()), stale repo fields won't be restored.
    const cleanedState: CompactWorkspaceInitializerFormState = {
      // Agent prefs — always preserved
      selectedSpecialist,
      selectedModel,
      modelWasOverridden,
      isTeamMode,
      selectedProvider,
      stayOnHomePage,
      skipIsolation,
      remoteSetup, // null at this point, but keeps parity with $effect's formState
      // Setup script fields — already cleared above (or restored via restoreLastUsedSetupScript)
      setupScript,
      showSetupScript,
      setupScriptName,
      isCustomSetupScript,
    };
    if (preserveRepo) {
      // Keep repo fields in persisted form state when staying on the home page
      cleanedState.repoPath = repoPath;
      cleanedState.repoType = repoType;
      cleanedState.githubUrl = githubUrl;
      cleanedState.clonePath = clonePath;
      cleanedState.branch = branch;
      cleanedState.isNewRepo = isNewRepo;
      cleanedState.isValidPath = isValidPath;
      cleanedState.scope = scope;
      cleanedState.scopeRepoPath = scope ? repoPath : undefined;
    }
    // Snapshot to strip $state proxies before dispatching into Redux (see $effect above)
    appStore.dispatch(setCompactWorkspaceInitializerFormState($state.snapshot(cleanedState)));
  }

  function handleIssueSelect(_text: string, metadata?: IssueSelectionData) {
    if (!metadata) return;

    // Serialize metadata to JSON string for TipTap node storage
    const metadataJson = metadata.metadata ? JSON.stringify(metadata.metadata) : undefined;

    // Track the selected PR's source branch and number for auto-linking
    if (metadata.type === 'github' && metadata.metadata?.sourceBranch) {
      selectedPRBranch = metadata.metadata.sourceBranch;
      // Extract PR number from identifier (format: "owner/repo#123")
      const prNumMatch = metadata.identifier?.match(/#(\d+)$/);
      selectedPRNumber = prNumMatch ? parseInt(prNumMatch[1], 10) : null;
    } else {
      selectedPRBranch = '';
      selectedPRNumber = null;
    }

    // Insert context mention pill into the editor
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

  // File input handler for image selection button
  function handleImageButtonClick() {
    fileInputRef?.click();
  }

  async function handleFileInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    await processImageFiles(Array.from(files));
    target.value = ''; // Reset for re-selection
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDraggingOver = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await processImageFiles(Array.from(files));
  }

  // Handle clipboard paste for images
  async function handlePaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images
      await processImageFiles(imageFiles);
    }
  }

  // Shared file processing logic - images become attachment items, other files as mentions
  async function processImageFiles(files: File[]) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const addedImageCount = { value: 0 };
    const insertedFileCount = { value: 0 };
    const oversizedFiles: string[] = [];

    // Helper to format file sizes - hoisted outside loop
    function formatFileSize(bytes: number): string {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(file.name);
        continue;
      }

      // Images become attachment context items (not inline nodes)
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await fileToDataUrl(file);
          // Parse data URL to extract mime type and base64 data
          const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const [, mimeType, base64Data] = match;
            const fileName = file.name || `Image ${contextItems.length + 1}`;

            const contextItem: ContextItem = {
              id: `image-${Date.now()}-${contextItems.length}`,
              type: 'file',
              label: fileName,
              description: `${mimeType} • ${formatFileSize(file.size)}`,
              path: fileName,
              file: file,
              imageData: base64Data,
              imageMimeType: mimeType,
            };

            contextItems = [...contextItems, contextItem];
            addedImageCount.value++;
          }
        } catch (err) {
          logger.error('Failed to process image', { fileName: file.name, error: err });
          toast.error(`Failed to process image: ${file.name}`);
        }
      } else {
        // Non-image files are inserted as mentions
        // Use Electron's webUtils.getPathForFile (exposed via preload) to get the full filesystem path
        // This works with contextIsolation: true, unlike the deprecated File.path property
        const fullPath = (window as any).electronAPI?.getPathForFile?.(file) || '';
        const displayName = file.name;

        richTextarea?.insertMention({
          id: fullPath ? `file-${fullPath}` : `file-${displayName}-${Date.now()}`,
          label: displayName,
          type: 'file',
          uri: fullPath ? `file:${fullPath}` : `devspace://file/${encodeURIComponent(displayName)}`,
          meta: {
            fullPath: fullPath || undefined,
            path: displayName,
            name: displayName,
            size: file.size,
            type: file.type,
          },
        });
        insertedFileCount.value++;
      }
    }

    if (addedImageCount.value > 0) {
      logger.debug(`Added ${addedImageCount.value} image(s) as attachments`);
    }

    if (insertedFileCount.value > 0) {
      logger.debug(`Attached ${insertedFileCount.value} file(s) as mentions`);
    }

    if (oversizedFiles.length > 0) {
      toast.error(`Files too large (max 10MB): ${oversizedFiles.join(', ')}`);
    }
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Remove a context item (for attachment removal)
  function removeContextItem(id: string) {
    contextItems = contextItems.filter((item) => item.id !== id);
  }

  // Track the last PR identifier we attempted to fetch branch info for
  // This prevents repeated fetch attempts for the same PR
  let lastFetchedPRIdentifier: string | null = null;

  // Debounce timer for content change handler
  let contentChangeTimer: ReturnType<typeof setTimeout> | null = null;

  // Handle content changes - check for PRs and fetch branch info if needed
  // Debounced to avoid expensive ProseMirror traversals on every keystroke
  function handleContentChange() {
    if (contentChangeTimer) clearTimeout(contentChangeTimer);
    contentChangeTimer = setTimeout(handleContentChangeImmediate, 300);
  }

  function handleContentChangeImmediate() {
    // Check for GitHub PRs with source branches in the content
    const contextMentions = richTextarea?.getContextMentions() ?? [];

    // First, look for PRs that already have sourceBranch set
    const prWithBranch = contextMentions.find((mention: any) => {
      if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
      try {
        const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
        return metadata?.sourceBranch && metadata.sourceBranch.length > 0;
      } catch {
        return false;
      }
    });

    if (prWithBranch) {
      // Found a PR with a source branch - extract and set it
      try {
        const metadata = prWithBranch.metadata ? JSON.parse(prWithBranch.metadata) : null;
        if (metadata?.sourceBranch && metadata.sourceBranch !== selectedPRBranch) {
          selectedPRBranch = metadata.sourceBranch;
        }
        // Always extract PR number so workspace creation can store it for PR discovery
        const prNumMatch = prWithBranch.identifier?.match(/#(\d+)$/);
        selectedPRNumber = prNumMatch ? parseInt(prNumMatch[1], 10) : null;
      } catch {
        // Ignore parse errors
      }
      return;
    }

    // Check if we still have any GitHub PRs in the content
    const hasAnyGitHubPR = contextMentions.some(
      (mention: any) =>
        (mention.itemType === 'github-issue' || mention.itemType === 'github-pr') &&
        mention.provider === 'github',
    );

    if (!hasAnyGitHubPR) {
      // No GitHub PRs found, clear the selection
      if (selectedPRBranch) {
        selectedPRBranch = '';
      }
      selectedPRNumber = null;
      lastFetchedPRIdentifier = null;
      return;
    }

    // Look for GitHub PRs without sourceBranch and fetch it
    const prWithoutBranch = contextMentions.find((mention: any) => {
      if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
      if (mention.provider !== 'github') return false;
      try {
        const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
        return !metadata?.sourceBranch || metadata.sourceBranch.length === 0;
      } catch {
        return true; // If we can't parse metadata, it likely needs fetching
      }
    });

    if (
      prWithoutBranch &&
      !selectedPRBranch &&
      prWithoutBranch.identifier !== lastFetchedPRIdentifier &&
      typeof window !== 'undefined' &&
      window.electronAPI
    ) {
      // Parse identifier: format is "owner/repo#number"
      const identifier = prWithoutBranch.identifier;
      const match = identifier?.match(/^([^/]+)\/([^#]+)#(\d+)$/);
      if (!match) {
        logger.debug('handleContentChange: could not parse PR identifier', { identifier });
        return;
      }

      const [, owner, repo, numberStr] = match;
      const number = parseInt(numberStr, 10);

      // Mark as fetched to prevent duplicate requests
      lastFetchedPRIdentifier = identifier;

      // Fetch asynchronously without blocking the change handler
      (async () => {
        try {
          const response = await invoke<any>('git-tracking:get-pull-request', {
            owner,
            repo,
            number,
          });
          if (response?.success && response.data?.sourceBranch) {
            selectedPRBranch = response.data.sourceBranch;
            selectedPRNumber = number;
          }
        } catch (err) {
          logger.warn('handleContentChange: failed to fetch PR branch info', {
            identifier,
            error: err,
          });
        }
      })();
    }
  }

  async function handleEnhancePrompt() {
    if (!initialPrompt.trim() || isEnhancing) return;

    isEnhancing = true;
    const currentRequestId = ++enhanceRequestId;

    try {
      // Daemon-side enhancement (agent.enhancePrompt, PROTOCOL §5.31)
      const result = await enhancePrompt(initialPrompt);

      if (currentRequestId === cancelledRequestId) return;

      initialPrompt = result.enhanced;
      await richTextarea?.setContent(result.enhanced);
      toast.success('Prompt enhanced');
    } catch (error) {
      if (currentRequestId === cancelledRequestId) return;
      logger.error('Failed to enhance prompt:', error);
      toast.error(
        error instanceof Error && error.message
          ? `Failed to enhance prompt: ${error.message}`
          : 'Failed to enhance prompt',
      );
    } finally {
      if (currentRequestId !== cancelledRequestId) {
        isEnhancing = false;
      }
    }
  }

  function handleCancelEnhance() {
    if (isEnhancing) {
      cancelledRequestId = enhanceRequestId;
      isEnhancing = false;
    }
  }
</script>

<!-- Compact Initializer -->
<div class="w-full mx-auto" bind:this={controlsContainer}>
  <!-- Hidden file input for file attachment (images inserted inline, other files as mentions) -->
  <input
    type="file"
    accept={SUPPORTED_FILE_EXTENSIONS.join(',')}
    multiple
    class="hidden"
    bind:this={fileInputRef}
    onchange={handleFileInputChange}
  />

  <!-- Bordered container: Linear issues + Text area -->
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="relative -ml-4 w-[calc(100%+32px)] border rounded-xl transition-all duration-200 border-border bg-background"
    class:drag-over={isDraggingOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onpaste={handlePaste}
    onclick={(event) => {
      if (event.isTrusted && !hasFiredClick) {
        hasFiredClick = true;
      }
    }}
    role="region"
  >
    <!-- Drag overlay -->
    {#if isDraggingOver}
      <div
        class="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 rounded-xl pointer-events-none"
      >
        <div class="flex flex-col items-center gap-2 text-primary">
          <Fa icon={faPaperclip} class="w-6 h-6" />
          <span class="text-sm font-medium">Drop files here</span>
        </div>
      </div>
    {/if}

    <!-- Text area -->
    <div class="w-full relative overflow-hidden rounded-t-xl">
      <RichTextarea
        bind:this={richTextarea}
        bind:value={initialPrompt}
        placeholder="What would you like to work on?"
        repoPath={repoType === 'local' ? repoPath : undefined}
        onfocus={() => {
          isExpanded = true;
        }}
        onkeydown={(event) => {
          if (
            event.isTrusted &&
            !hasFiredType &&
            !event.metaKey &&
            !(event.ctrlKey && !event.altKey)
          ) {
            // Allow single chars, IME (Process/Dead), and non-BMP (length > 1)
            const isTyping =
              event.key.length === 1 ||
              event.key === 'Process' ||
              event.key === 'Dead' ||
              event.key === 'Unidentified';
            if (isTyping) {
              hasFiredType = true;
            }
          }
        }}
        onblur={handleBlur}
        onsubmit={handleSubmit}
        onchange={handleContentChange}
        minHeight={147}
        maxHeight={Math.min(window?.innerHeight * 0.3 || 300, 500)}
        class="bg-transparent border-none"
      />

      {#if isEnhancing}
        <div class="enhance-shimmer-wrapper">
          <div class="enhance-shimmer"></div>
        </div>
      {/if}
    </div>

    <!-- Attachment previews (images only, Slack-style thumbnails) -->
    {#if contextItems.some((item) => item.type === 'file' && ((item.imageData && item.imageMimeType) || (item.file && item.file.type?.startsWith('image/'))))}
      <div class="px-2.5 pt-2 pb-1 flex flex-wrap gap-2">
        {#each contextItems.filter((item) => item.type === 'file' && ((item.imageData && item.imageMimeType) || (item.file && item.file.type?.startsWith('image/')))) as item (item.id)}
          <AttachmentPreview
            id={item.id}
            name={item.label}
            type={item.file?.type || item.imageMimeType || ''}
            size={item.file?.size}
            file={item.file}
            imageData={item.imageData}
            imageMimeType={item.imageMimeType}
            onRemove={removeContextItem}
            variant="thumbnail"
          />
        {/each}
      </div>
    {/if}

    <!-- Linear issue row (inside border, top-left) -->
    {#if isExpanded}
      <div
        class="linear-row flex items-center gap-2 px-2.5 pt-1 pb-2.5 overflow-x-auto relative"
        transition:slide={{ axis: 'y', duration: 200 }}
      >
        <IssueSuggestions
          onSelect={handleIssueSelect}
          repositoryOwner={githubRepoInfo?.owner}
          repositoryName={githubRepoInfo?.repo}
        />

        <!-- Enhance prompt button -->
        <div class="absolute top-2 right-9">
          <Button
            type="button"
            onclick={isEnhancing ? handleCancelEnhance : handleEnhancePrompt}
            size="icon-xs"
            variant="ghost-light"
            disabled={!initialPrompt.trim() && !isEnhancing}
            tooltip={isEnhancing ? 'Stop enhancing' : 'Enhance prompt'}
            tooltipSide="top"
          >
            {#if isEnhancing}
              <Fa icon={faStop} size="xs" class="text-destructive-foreground" />
            {:else}
              <Fa icon={faMagicWandSparkles} size="xs" />
            {/if}
          </Button>
        </div>

        <!-- File upload button -->
        <Button
          type="button"
          onclick={handleImageButtonClick}
          class="absolute top-2 right-2.5"
          size="icon-xs"
          variant="ghost-light"
          title="Add files"
        >
          <Fa icon={faPaperclip} size="xs" />
        </Button>
      </div>
    {/if}
  </div>

  <!-- First-time user hint -->
  {#if showFirstTimeHints && !isExpanded}
    <p class="mt-3 text-xs text-subtle leading-relaxed" transition:fade={{ duration: 200 }}>
      Describe a feature, bug fix, or refactor — the agent will create a branch and start coding.
    </p>
  {/if}

  <!-- Bottom: Agent picker, Setup script, Create button -->
  {#if isExpanded}
    <div class="w-full min-w-0 mt-3.5 mb-3" transition:slide={{ axis: 'y', duration: 200 }}>
      <!-- Git not installed banner -->
      {#if gitAvailable === false}
        <div
          class="mx-0 mb-3 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-md text-sm"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          <div class="flex items-start gap-3">
            <Fa icon={faExclamationTriangle} class="text-destructive-foreground mt-0.5 shrink-0" />
            <div>
              <p class="font-medium text-destructive-foreground">Git is not installed</p>
              <p class="text-subtle mt-1">
                Git is required to create workspaces. Please install Git and restart the app.
              </p>
              <button
                class="mt-2 text-primary hover:text-primary/80 underline cursor-pointer"
                onclick={() => {
                  if (typeof window !== 'undefined' && window.electronAPI) {
                    invoke('shell:openExternal', {
                      url: 'https://git-scm.com/downloads',
                    });
                  }
                }}
              >
                Download Git →
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Agent picker row -->
      <div class="w-full min-w-0 flex flex-wrap items-center gap-2 pt-1 pb-4">
        <div class="flex-1 min-w-fit flex-col">
          <!-- Repo + Branch picker row (above border) -->
          {#if isExpanded}
            <div class="repo-picker-row" transition:slide={{ axis: 'y', duration: 200 }}>
              <RepoAndBranchPicker
                bind:this={repoAndBranchPicker}
                {repoPath}
                {branch}
                {repoType}
                {githubUrl}
                {skipIsolation}
                {isNewRepo}
                {remoteSetup}
                {detectedGitHubOwner}
                {detectedGitHubRepo}
                suggestedBranch={selectedPRBranch}
                onRepoChange={handleRepoChange}
                onBranchChange={handleBranchChange}
                onSkipIsolationChange={(value) => (skipIsolation = value)}
                onGitHubAuthNeededChange={(value) => (githubAuthNeeded = value)}
                onBranchStatusChange={handleBranchStatusChange}
              />
            </div>
          {/if}
        </div>

        <!-- Create button -->
        <div class="shrink-0">
          <Button class="text-white" onclick={handleSubmit} disabled={!isValid || isCreating}>
            {#if isCreating}
              <Fa icon={faSpinner} class="animate-spin" size="sm" />
              <span class="min-w-[160px] text-left">
                {#if isPulling}
                  Pulling latest changes...
                {:else}
                  {CREATION_STAGES[creationStage]}
                {/if}
              </span>
            {:else}
              {#if isValid}
                <span class="opacity-50 ml-1" transition:slide={{ axis: 'x', duration: 200 }}>
                  {navigator.userAgent?.includes('Mac') ? '⌘' : 'Ctrl'} + ↵
                </span>
              {/if}
              <span>Create workspace</span>
            {/if}
          </Button>
        </div>
      </div>

      <!-- Error message -->
      {#if error}
        <div
          class="mt-3 mb-3 px-4.5 py-2 text-sm bg-destructive text-destructive-foreground"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          {error}
        </div>
      {/if}
      <!-- Validation hint -->
      {#if isExpanded && !isValid && !isCreating && !error}
        <div
          class="mt-2 px-4.5 text-sm text-subtle"
          transition:slide={{ axis: 'y', duration: 200 }}
        >
          {#if gitAvailable === false}
            Git is required — install it and restart to continue.
          {:else if gitAvailable === null}
            Checking dependencies...
          {:else if !repoPath}
            Select a repository to get started.
          {:else if !isValidPath}
            The selected path is not valid.
          {:else if repoType === 'github' && githubAuthNeeded !== 'none'}
            GitHub authentication is required.
          {:else if !isNewRepo && !branch && repoType !== 'remote'}
            Waiting for branch selection...
          {/if}
        </div>
      {/if}
      <!-- Use PR branch suggestion - show when a PR is selected but branch doesn't match -->
      {#if selectedPRBranch && branch !== selectedPRBranch && !isNewRepo}
        <div class="mt-2">
          <button
            class="flex items-center gap-2 mt-2 mb-1 px-1 text-sm text-primary hover:text-primary/80 cursor-pointer"
            transition:slide={{ axis: 'y', duration: 150 }}
            onclick={() => {
              branch = selectedPRBranch;
              // Dispatch branch change event to update the UI
              document.dispatchEvent(
                new CustomEvent('initializer-branch-updated', {
                  detail: { branch: selectedPRBranch },
                }),
              );
            }}
          >
            <Fa icon={faCodeBranch} size="sm" class="shrink-0" />
            <span>Use PR branch <strong>{selectedPRBranch}</strong></span>
          </button>
        </div>
      {/if}

      <div class="w-full mt-3">
        <div class="mb-6">
          <InitialAgentPicker
            bind:selectedSpecialist
            {selectedModel}
            onModelChange={(model) => {
              selectedModel = model;
            }}
            bind:modelWasOverridden
            bind:isTeamMode
            bind:selectedProvider
          />
        </div>
        <!-- Setup script + Rapid fire row -->
        <div class="border-t border-border pt-4 space-y-2">
          <div class="flex items-center justify-between flex-wrap gap-2 w-full">
            <!-- Left: setup script button -->
            <button
              type="button"
              class="flex items-center gap-1 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onclick={() => (showSetupScript = !showSetupScript)}
            >
              <span>Set up dev environment with</span>
              {#if isRepoConfigLoading}
                <Fa icon={faSpinner} class="animate-spin mx-1.5" size="sm" />
                <span class="sr-only">Detecting setup script…</span>
              {:else}
                <div class="bg-background px-2 py-0.5 font-medium">{setupScriptName}</div>
                <p class="text-sm text-subtle">script</p>
              {/if}
            </button>
            <!-- Right: rapid fire -->
            <Tooltip content="Stay on this page after creating a space" side="top" size="sm">
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <div
                class="flex whitespace-nowrap items-center gap-2 text-sm text-muted-foreground hover:text-muted-foreground transition-colors cursor-pointer select-none ml-auto"
                onclick={() => (stayOnHomePage = !stayOnHomePage)}
              >
                <Checkbox checked={stayOnHomePage} size="sm" />
                <span>Rapid fire mode</span>
              </div>
            </Tooltip>
          </div>
          <SetupScriptModal
            bind:open={showSetupScript}
            {repoPath}
            repoConfigScript={repoConfigScriptRepo === repoPath ? repoConfigScript : null}
            bind:value={setupScript}
            bind:scriptName={setupScriptName}
            bind:isCustomScript={isCustomSetupScript}
            onClose={() => (showSetupScript = false)}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- Pull Conflict Dialog -->
<PullConflictDialog
  bind:open={showPullConflictDialog}
  error={pullError ?? ''}
  {repoPath}
  branchName={branch}
  onCreateWorkspace={(options) => {
    // Proceed with workspace creation without pulling - user will resolve conflicts in workspace
    shouldPullBeforeCreate = false;
    showPullConflictDialog = false;
    pullError = null;

    // If resolveConflicts flag is set, configure agent for conflict resolution
    if (options?.resolveConflicts) {
      // Override to use implementor specialist in single agent mode with appropriate prompt
      selectedSpecialist = 'implementor';
      isTeamMode = false;

      // Generate appropriate prompt based on error type
      const getResolutionPrompt = (errorType?: PullErrorType): string => {
        switch (errorType) {
          case 'stash-conflict':
            return `The branch was updated but your local changes conflict with the pulled changes. Your changes are saved in the git stash. Please:
1. Run \`git stash pop\` to apply the stashed changes
2. Resolve any conflicts in the affected files
3. Stage the resolved files with \`git add\`
4. Continue with your work`;

          case 'unstaged-changes':
            return `This branch has unstaged local changes that prevented pulling. Please:
1. Run \`git status\` to see the current state
2. Either commit the changes (\`git add . && git commit -m "WIP"\`) or stash them (\`git stash\`)
3. Pull the latest changes (\`git pull --rebase origin ${branch}\`)
4. If you stashed, run \`git stash pop\` to restore your changes`;

          case 'merge-conflict':
            return `Fix merge conflicts in this branch. Run \`git status\` to see conflicting files, resolve them, then run \`git add\` and \`git rebase --continue\`.`;

          default:
            return `There was an issue syncing this branch with the remote. Please:
1. Run \`git status\` to understand the current state
2. Address any uncommitted changes or conflicts
3. Try pulling again with \`git pull --rebase origin ${branch}\``;
        }
      };

      richTextarea?.setContent(getResolutionPrompt(options.errorType));
    }

    handleSubmit();
  }}
  onCancel={() => {
    showPullConflictDialog = false;
    pullError = null;
  }}
/>

<style>
  .repo-picker-row,
  .linear-row {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE/Edge */
  }
  .repo-picker-row::-webkit-scrollbar,
  .linear-row::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }

  /* Shimmer overlay for enhancement loading state */
  .enhance-shimmer-wrapper {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
    z-index: 1;
  }
  .enhance-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--color-background) 80%, transparent),
      transparent
    );
    background-size: 200% 100%;
    animation: enhance-shimmer 2s infinite;
  }

  @keyframes enhance-shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
</style>
