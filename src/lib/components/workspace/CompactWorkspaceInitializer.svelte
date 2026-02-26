<script lang="ts">
  import { goto } from '$app/navigation';
  import { agentService } from '$features/agent/agent.service';
  import { setupScriptStore } from '$features/setup-scripts';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import RichTextarea from '$lib/components/ui/RichTextarea.svelte';
  import { debugConfig } from '$lib/config/debug';
  import type { StarterPrompt } from '$lib/data/starter-prompts';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    getGitErrorMessage,
    validateBranchName,
    validateInitialPrompt,
    validateRepoPath,
  } from '$lib/utils/workspace-validation';
  import { unifiedIdService } from '$shared/services/unified-id.service';
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
  import Fa from 'svelte-fa';
  import PullConflictDialog, { type PullErrorType } from '../modals/PullConflictDialog.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { fade, fly, slide } from 'svelte/transition';
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
  import RemoteSetupSelector from './initializer/RemoteSetupSelector.svelte';
  import { noteUrl } from '$shared/constants/intent-links';
  import { getProviderAvailability } from '$features/providers/provider-availability.client';
  import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
  import {
    getDefaultModelForProvider,
    getDefaultProviderId,
    PROVIDER_MODEL_TIERS,
    parseCompoundModelId,
  } from '$shared/config/provider-config';

  const logger = createLogger('CompactWorkspaceInitializer');

  // Constants
  const AGENT_ID_KEY = 'compact-workspace-initializer-agent-id';
  const FORM_STATE_KEY = 'compact-workspace-initializer-state';
  // This key is shared with RepoSelector - keep in sync
  const LAST_SELECTED_REPO_KEY = 'workspace-initializer-last-repo';
  // This key is shared with BranchSelector - keep in sync
  const BRANCH_BY_REPO_KEY = 'workspace-initializer-branch-by-repo';

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

  export interface InitialRepoInfo {
    repoPath?: string;
    isGithub?: boolean;
    owner?: string;
    name?: string;
    environmentType?: string;
    sshConfig?: any;
    previousWorkspaceId?: string;
    previousWorkspaceTitle?: string;
  }

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
  export function applyPrefill() {
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

        // If we have previous workspace info, set up the pending mention
        if (data.previousWorkspaceId && data.previousWorkspaceTitle) {
          pendingPreviousWorkspace = {
            id: data.previousWorkspaceId,
            title: data.previousWorkspaceTitle,
          };
        }

        // Clear the prefill data so it doesn't get reapplied on next mount
        sessionStorage.removeItem(PREFILL_KEY);

        // Focus the prompt textarea so the user can immediately type what to do
        setTimeout(() => {
          richTextarea?.focus();
        }, 100);
      } catch (e) {
        logger.error('Failed to parse prefill data:', e);
        // Clear malformed data to prevent repeated failures
        sessionStorage.removeItem(PREFILL_KEY);
      }
    }
  }

  // Generate or retrieve agent ID
  function getOrCreateAgentId(): string {
    let storedAgentId = sessionStorage.getItem(AGENT_ID_KEY);
    if (!storedAgentId) {
      storedAgentId = unifiedIdService.generateAgentId();
      sessionStorage.setItem(AGENT_ID_KEY, storedAgentId);
    }
    return storedAgentId;
  }
  let initialAgentId = $state(getOrCreateAgentId());

  // Key for storing last submitted specialist/model (persists across form clears)
  const LAST_SUBMITTED_AGENT_KEY = 'workspace-initializer-last-agent';

  // Load saved form state from localStorage
  function loadSavedFormState() {
    try {
      const saved = localStorage.getItem(FORM_STATE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      logger.error('Failed to load saved form state:', e);
    }
    return null;
  }

  // Load last submitted specialist/model (used as defaults after form clear)
  function loadLastSubmittedAgent() {
    try {
      const saved = localStorage.getItem(LAST_SUBMITTED_AGENT_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      logger.error('Failed to load last submitted agent:', e);
    }
    return null;
  }

  const savedState = loadSavedFormState();
  const lastSubmittedAgent = loadLastSubmittedAgent();

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
  // Restore prompt from sessionStorage so users don't lose drafts on navigation
  let initialPrompt = $state(sessionStorage.getItem(`${FORM_STATE_KEY}-prompt`) ?? '');
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
  const currentProviderAtInit = activeProviderStore.activeProviderId ?? 'auggie';
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
  // Priority: active provider store (set via ProviderStatusPanel) takes precedence since it's the user's explicit choice
  let selectedProvider = $state<string>(activeProviderStore.activeProviderId ?? 'auggie');
  let hasSelectedContext = $state(false);
  let hasImages = $state(false);

  // Setup script state
  let setupScript = $state(savedState?.setupScript ?? '');
  let showSetupScript = $state(false); // Always collapsed on mount
  let setupScriptName = $state(savedState?.setupScriptName ?? 'Custom');
  let isCustomSetupScript = $state(savedState?.isCustomSetupScript ?? false);

  // Helper to restore the last used setup script for a repo
  // If no saved script exists for the repo, resets to defaults
  function restoreLastUsedSetupScript(repo: string) {
    const lastUsed = repo ? setupScriptStore.getLastUsedForRepo(repo) : undefined;
    if (lastUsed) {
      setupScript = lastUsed.content;
      setupScriptName = lastUsed.name;
      isCustomSetupScript = false;
    } else {
      // No saved script for this repo — reset to defaults
      // The SetupScriptEditor will apply the default template when opened
      setupScript = '';
      setupScriptName = 'Custom';
      isCustomSetupScript = false;
    }
  }

  // Skip worktree toggle
  let skipWorktree = $state(savedState?.skipWorktree ?? false);

  // Git availability state: null = checking, true = found, false = not found
  let gitAvailable: boolean | null = $state(null);

  // Stay on home page after creation
  let stayOnHomePage = $state(savedState?.stayOnHomePage ?? false);

  // GitHub auth state - tracks if user needs to authenticate for private repos
  let githubAuthNeeded = $state<'none' | 'not-authenticated' | 'no-access'>('none');

  // Branch status - received from BranchSelector
  // We always auto-pull when behind, so we just need to track the status for the pull operation
  let branchBehind = $state(0);
  let hasUncommittedChanges = $state(false);
  let shouldPullBeforeCreate = $state(true);
  let pendingBranchStatusRequest = $state<string | null>(null);
  let pullError = $state<string | null>(null);
  let showPullConflictDialog = $state(false);
  let isPulling = $state(false);
  // Track the selected PR's source branch (for "Use PR branch" suggestion)
  let selectedPRBranch = $state<string>('');

  // Save prompt to sessionStorage so it survives navigation (but not browser close)
  // Debounced to avoid blocking the main thread on every keystroke
  let promptSaveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const prompt = initialPrompt; // read dependency
    if (promptSaveTimer) clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(() => {
      const promptKey = `${FORM_STATE_KEY}-prompt`;
      if (prompt) {
        sessionStorage.setItem(promptKey, prompt);
      } else {
        sessionStorage.removeItem(promptKey);
      }
    }, 300);
  });

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

  // Save form state to localStorage whenever it changes
  $effect(() => {
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
        skipWorktree,
        stayOnHomePage,
      };
      localStorage.setItem(FORM_STATE_KEY, JSON.stringify(formState));
    }
  });

  // Track previous workspace info for inserting @ mention after mount
  let pendingPreviousWorkspace: { id: string; title: string } | null = $state(null);

  // Key for prefill data from sessionStorage (shared with layout and other components)
  const PREFILL_KEY = 'workspace-prefill';

  // Ref to RepoAndBranchPicker for focusing the input after prefill
  let repoAndBranchPicker: any = $state(null);

  // Preload Linear and Sentry issues as soon as this component mounts
  // so they're ready when the user expands the form
  // Also restore last selected repo from localStorage (moved from RepoSelector to avoid
  // side effects when RepoSelector mounts/unmounts during reset)
  onMount(() => {
    logger.debug('Preloading issues on mount');
    preloadIssues();

    // Check git availability
    (async () => {
      try {
        const result = await window.electronAPI?.invoke('system:check-git');
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

    // First check for prefill data from sessionStorage (takes priority over localStorage)
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

        // If we have previous workspace info, set up the pending mention
        // This will trigger the $effect that inserts the @ mention with the seed prompt
        if (data.previousWorkspaceId && data.previousWorkspaceTitle) {
          pendingPreviousWorkspace = {
            id: data.previousWorkspaceId,
            title: data.previousWorkspaceTitle,
          };
        }

        // Clear the prefill data so it doesn't get reapplied on next mount
        sessionStorage.removeItem(PREFILL_KEY);
      } catch (e) {
        logger.error('Failed to parse prefill data:', e);
        // Clear malformed data to prevent repeated failures
        sessionStorage.removeItem(PREFILL_KEY);
      }
    } else if (debugConfig.get('enableFormPersistence') && !repoPath) {
      // No prefill data - restore last selected repo from localStorage
      const savedRepo = localStorage.getItem(LAST_SELECTED_REPO_KEY);
      if (savedRepo) {
        try {
          const data = JSON.parse(savedRepo);
          repoPath = data.path || '';
          repoType = data.type || 'local';
          githubUrl = data.githubUrl || '';
          clonePath = data.clonePath || '';
          isNewRepo = data.isNewRepo || false;
          isValidPath = data.isValidPath ?? false;
          scope = data.scope || '';
        } catch (e) {
          logger.error('Failed to parse saved repo:', e);
        }
      }
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

  // Track last applied initial repo to avoid re-applying
  let lastAppliedInitialRepo: InitialRepoInfo | undefined = $state(undefined);

  // Apply initial repo when provided and focus the prompt input
  $effect(() => {
    if (initialRepo && initialRepo !== lastAppliedInitialRepo) {
      lastAppliedInitialRepo = initialRepo;

      if (initialRepo.repoPath) {
        repoPath = initialRepo.repoPath;
        isValidPath = true;
        isNewRepo = false; // Existing repo path means it's not a new repo
        // Reset scope when changing repos - scope is repo-specific
        scope = '';
        // Reset branch so BranchSelector loads the saved branch for this repo
        branch = '';

        // When we have a repoPath, it means the repo is already cloned locally.
        // Always use 'local' type - even for GitHub repos that were cloned previously.
        // The 'github' type is only for cloning repos that don't exist locally yet.
        repoType = 'local';

        // Still set githubUrl if we have GitHub info, for features like issue suggestions
        if (initialRepo.owner && initialRepo.name) {
          githubUrl = `https://github.com/${initialRepo.owner}/${initialRepo.name}`;
        }
      }

      // Apply remote environment settings if provided
      if (initialRepo.environmentType === 'remote' && initialRepo.sshConfig) {
        remoteSetup = {
          type: 'remote',
          ssh: initialRepo.sshConfig,
        };
      }

      // Set up previous workspace mention if provided (for "Start New Space" after merge)
      if (initialRepo.previousWorkspaceId && initialRepo.previousWorkspaceTitle) {
        pendingPreviousWorkspace = {
          id: initialRepo.previousWorkspaceId,
          title: initialRepo.previousWorkspaceTitle,
        };
      }
    }
  });

  $effect(() => {
    if (!isExpanded) return;
    // Focus the prompt input after the form expands
    setTimeout(() => {
      richTextarea?.focus();
    }, 100);
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

      if (prWithBranch && !selectedPRBranch) {
        try {
          const metadata = prWithBranch.metadata ? JSON.parse(prWithBranch.metadata) : null;
          if (metadata?.sourceBranch) {
            selectedPRBranch = metadata.sourceBranch;
            logger.debug('Restored selectedPRBranch from context mention', {
              branch: metadata.sourceBranch,
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
          const response = await window.electronAPI.invoke('git-tracking:get-pull-request', {
            owner,
            repo,
            number,
          });
          if (response?.success && response.data?.sourceBranch) {
            selectedPRBranch = response.data.sourceBranch;
            logger.debug('Fetched and set selectedPRBranch from restored context mention', {
              branch: response.data.sourceBranch,
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
  let cloneProgress = $state<{ phase: string; percent: number; message: string } | null>(null);
  let error: string | null = $state(null);
  let isFocused = $state(false);
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

  // Clone progress listener cleanup
  let cloneProgressListenerId: string | null = null;

  // Set up clone progress listener
  onMount(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      cloneProgressListenerId = window.electronAPI.on(
        'workspace:clone-progress',
        (data: { phase: string; percent: number; message: string }) => {
          // Only update during creation and when cloning a GitHub repo
          if (isCreating && repoType === 'github') {
            cloneProgress = data;
          }
        },
      );
    }
  });

  // Clean up listener on destroy
  onDestroy(() => {
    if (cloneProgressListenerId && window.electronAPI?.offById) {
      window.electronAPI.offById('workspace:clone-progress', cloneProgressListenerId);
    }
  });

  // Cycle through creation stages while creating (fallback for non-clone operations)
  $effect(() => {
    if (!isCreating) {
      creationStage = 0;
      cloneProgress = null;
      return;
    }

    // Only use fake stages if we're not getting clone progress
    if (cloneProgress) {
      return;
    }

    // Advance through stages every ~1.5 seconds
    const interval = setInterval(() => {
      creationStage = Math.min(creationStage + 1, CREATION_STAGES.length - 1);
    }, 1500);

    return () => clearInterval(interval);
  });

  // Fetch remote URL when local repo path changes
  $effect(() => {
    const path = repoPath;
    const type = repoType;

    // Only fetch for local repos with valid paths
    if (type !== 'local' || !path || (!path.startsWith('/') && !path.startsWith('~'))) {
      detectedGitHubOwner = null;
      detectedGitHubRepo = null;
      return;
    }

    // Fetch the remote URL for the local repo
    (async () => {
      try {
        const response = await window.electronAPI?.invoke('git-tracking:get-remote-url', {
          repoPath: path,
        });
        if (response?.success && response.data?.owner && response.data?.repo) {
          detectedGitHubOwner = response.data.owner;
          detectedGitHubRepo = response.data.repo;
          logger.debug('Detected GitHub from local repo', {
            path,
            owner: response.data.owner,
            repo: response.data.repo,
          });
        } else {
          detectedGitHubOwner = null;
          detectedGitHubRepo = null;
        }
      } catch (err) {
        logger.debug('Failed to get remote URL for repo', { path, error: err });
        detectedGitHubOwner = null;
        detectedGitHubRepo = null;
      }
    })();
  });

  // Auto-restore last used setup script when repo changes
  // This ensures the setup script name/content are correct in the button bar
  // without requiring the user to open the setup script modal
  let previousSetupScriptRepo = $state<string | null>(null);
  $effect(() => {
    const path = repoPath;
    // Only run when repo actually changes
    if (path === previousSetupScriptRepo) return;
    const isInitialMount = previousSetupScriptRepo === null;
    previousSetupScriptRepo = path;

    // On initial mount, don't override if there's already a setup script set
    // (e.g., from restored form state). On repo switches, always restore.
    if (isInitialMount && setupScript.trim()) return;

    // Restore last used script for this repo (or clear if no saved script exists)
    if (path) {
      restoreLastUsedSetupScript(path);
    } else {
      setupScript = '';
      setupScriptName = 'Custom';
      isCustomSetupScript = false;
    }
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

  // Helper to parse GitHub owner/repo from URL or path
  function parseGitHubInfo(url: string): { owner: string; repo: string } | null {
    // Handle GitHub URL formats
    const patterns = [
      /^https?:\/\/github\.com\/([^\/]+)\/([^\/\.]+?)(?:\.git)?(?:\/.*)?$/,
      /^git@github\.com:([^\/]+)\/([^\/\.]+?)(?:\.git)?$/,
    ];
    for (const pattern of patterns) {
      const match = url.trim().match(pattern);
      if (match) return { owner: match[1], repo: match[2] };
    }
    // Check for simple owner/repo format
    const simpleMatch = url.trim().match(/^([a-zA-Z0-9\-_]+)\/([a-zA-Z0-9\-_\.]+)$/);
    if (simpleMatch && !url.includes('\\') && !url.includes(':') && !url.startsWith('.')) {
      return { owner: simpleMatch[1], repo: simpleMatch[2] };
    }
    return null;
  }

  // Derived GitHub repo info for IssueSuggestions
  const githubRepoInfo = $derived.by(() => {
    // First try the explicit GitHub URL
    if (githubUrl) {
      return parseGitHubInfo(githubUrl);
    }
    // Try detected owner/repo from local repo's remote URL
    if (detectedGitHubOwner && detectedGitHubRepo) {
      return { owner: detectedGitHubOwner, repo: detectedGitHubRepo };
    }
    // Then try the repoPath (might be owner/repo format from GitHub selection)
    if (repoPath) {
      return parseGitHubInfo(repoPath);
    }
    return null;
  });

  // Collapse handler - blurs textarea and collapses
  function collapse() {
    isExpanded = false;
    isFocused = false;
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

      // Cmd+Enter (Mac) / Ctrl+Enter (Win/Linux) to submit from anywhere in the form
      // Guard: only fire when focus is inside the initializer, not in dialogs/popovers
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const activeEl = document.activeElement;
        const isInsideForm = activeEl && controlsContainer?.contains(activeEl);
        if (isInsideForm) {
          e.preventDefault();
          handleSubmit();
        }
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
      isFocused = false;
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

    // GitHub repos require a worktree - reset skipWorktree if switching to github type
    if (event.detail.type === 'github') {
      skipWorktree = false;
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
  function getRepoNameFromGithubUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        return pathParts[1].replace(/\.git$/, '');
      }
    } catch {
      // Fall back to parsing manually
      const parts = url.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 1].replace(/\.git$/, '');
      }
    }
    return url;
  }

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

    error = null;
    isCreating = true;

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
          const pullResult = await window.electronAPI?.invoke('git:pullBranch', {
            repoPath,
            branchName: branch,
          });
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

      const baseBranch = isNewRepo ? 'main' : branch;

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
        const specialist = specialistsStore.specialists.find((s) => s.id === selectedSpecialist);
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

      // Extract inline images from the editor
      const inlineImages = richTextarea?.getInlineImages() ?? [];
      logger.info('[CompactWorkspaceInitializer] Extracted inline images', {
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
      }

      // Convert inline images to imageBlocks (separate from contextReferences)
      // This ensures images are passed properly and don't trigger fallback text
      const imageBlocks: Array<{ type: 'image'; data: string; mimeType: string }> = [];
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
        resolvedBehaviorPrompt = specialistsStore.getEffectiveBehaviorPrompt(selectedSpecialist);
      }

      // Resolve the model for the selected specialist + provider so the agent is created
      // with the correct compound model ID (e.g., 'codex:gpt-5.3-codex').
      // Without this, model would be undefined and the backend falls back to DEFAULT_AGENT_MODEL
      // (an auggie model), which breaks provider inheritance when the coordinator delegates.
      let resolvedModel: string | undefined;
      if (modelWasOverridden) {
        resolvedModel = selectedModel;
      } else if (selectedSpecialist) {
        // Check for user model override first (from specialist settings)
        const specialistOverride =
          specialistsStore.userOverrides.modelOverrides[selectedSpecialist];
        if (specialistOverride) {
          resolvedModel = specialistOverride;
          logger.info('Using specialist model override', {
            specialistId: selectedSpecialist,
            override: specialistOverride,
          });
        } else {
          const specialist = specialistsStore.specialists.find((s) => s.id === selectedSpecialist);
          if (specialist?.defaultModelTier && selectedProvider in PROVIDER_MODEL_TIERS) {
            const baseModel = getDefaultModelForProvider(
              selectedProvider,
              specialist.defaultModelTier,
            );
            const defaultProviderId = getDefaultProviderId();
            resolvedModel =
              selectedProvider !== defaultProviderId
                ? `${selectedProvider}:${baseModel}`
                : baseModel;
          } else if (specialist?.defaultModel) {
            resolvedModel = specialist.defaultModel;
          }
        }
      }

      // Validate resolvedModel against available models. Tier-mapped model IDs
      // (e.g., 'opencode:anthropic/claude-opus-4-5') may not match actual model IDs
      // returned by the provider CLI, causing a visible flash in the ModelPicker.
      // Fall back to the model store's validated selected model if the resolved model
      // doesn't exist in the available list.
      // Only validate when the form's selectedProvider matches the model store's loaded
      // provider (activeProviderStore) — otherwise the available models are for a
      // different provider and we can't meaningfully validate.
      const storeProvider = activeProviderStore.activeProviderId;
      if (
        resolvedModel &&
        modelStore.availableModels.length > 0 &&
        selectedProvider === storeProvider
      ) {
        const availableModelValues = modelStore.availableModels.map((m) => m.value);
        if (!availableModelValues.includes(resolvedModel)) {
          logger.warn('Tier-resolved model not in available list, using store default', {
            resolvedModel,
            fallback: modelStore.selectedModel,
            selectedProvider,
            availableCount: availableModelValues.length,
          });
          resolvedModel = modelStore.selectedModel;
        }
      }

      const initialAgent = {
        agentId: String(initialAgentId),
        name: agentName,
        model: resolvedModel,
        specialist: specialistId, // Now accepts any specialist ID (not restricted to enum)
        behaviorPrompt: resolvedBehaviorPrompt, // Pass to IPC for workspace creation
        prompt: initialPrompt.trim() || undefined,
        agentType: createAgentTypeId('workspace'),
        provider: selectedProvider, // ACP provider ID (auggie, claude-code, codex)
        contextReferences: contextReferences.length > 0 ? contextReferences : undefined,
        imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
        metadata: {
          source: 'compact-initializer',
          isInitialAgent: true,
          specialist: specialistId ?? undefined,
          provider: selectedProvider, // Also store in metadata for reference
          createdAt: new Date().toISOString(),
        },
      };

      // Save branch per repo for persistence - ensures branch is remembered even if user
      // didn't explicitly click a branch in the dropdown (accepting the auto-selected default)
      if (debugConfig.get('enableFormPersistence') && repoPath && baseBranch && !isNewRepo) {
        try {
          const branchByRepoStr = localStorage.getItem(BRANCH_BY_REPO_KEY);
          let branchByRepo: Record<string, string> = {};
          if (branchByRepoStr) {
            try {
              branchByRepo = JSON.parse(branchByRepoStr);
            } catch (e) {
              logger.error('Failed to parse branch by repo', e);
            }
          }
          branchByRepo[repoPath] = baseBranch;
          localStorage.setItem(BRANCH_BY_REPO_KEY, JSON.stringify(branchByRepo));
          logger.debug('Saved branch per repo', { repoPath, branch: baseBranch });
        } catch (e) {
          logger.error('Failed to save branch per repo', e);
        }
      }

      const result = await workspaceStore.create({
        title: '', // Start with blank title - agent will set it based on the task
        repositoryPath: String(remoteSetupSnapshot?.workspacePath || repoPath),
        githubUrl: repoType === 'github' && githubUrl ? githubUrl : undefined, // GitHub URL to clone
        clonePath:
          repoType === 'github' && (clonePath || repoPath) ? clonePath || repoPath : undefined, // User-selected clone destination (falls back to repoPath since they're the same for GitHub repos)
        baseRef: String(baseBranch),
        setupScript: setupScript.trim() || undefined,
        environmentConfig,
        isNewRepo: Boolean(isNewRepo),
        skipWorktree: skipWorktree || undefined,
        scope: scope || undefined, // Scope for subdirectories of git repos
        initialAgent,
      });

      if (!result.ok) throw new Error(result.error || 'Failed to create workspace');

      const workspace = result.data;

      // Clear any stale panel layout data for this workspace ID.
      // This is important when workspace IDs are reused (e.g., after deletion and recreation).
      // Without this, the workspace page may load stale layout data with duplicate tabs.
      try {
        const { clearPanelLayout } = await import('$features/layout/panel-layout-manager.svelte');
        clearPanelLayout(workspace.id);
      } catch (error) {
        logger.debug('Could not clear panel layout', { error });
      }

      // Clear any stale workspace storage state (drawer state, main panel, etc.)
      // for this workspace ID. When workspace IDs are reused, stale drawer state
      // can cause the workspace page to open a non-existent agent from a previous
      // workspace, leading to spurious agent creation.
      try {
        const { workspaceStorageManager } = await import(
          '$features/workspace/workspace-storage-manager'
        );
        workspaceStorageManager.clearState(workspace.id);
      } catch (error) {
        logger.debug('Could not clear workspace storage state', { error });
      }

      // Set workspace default model to the EFFECTIVE model (the one the agent will actually use).
      // resolvedModel has already been validated against available models above.
      const effectiveModel = resolvedModel;

      if (effectiveModel) {
        modelStore.setWorkspaceDefaultModel(workspace.id, effectiveModel);
        logger.info('Set workspace default model', {
          workspaceId: workspace.id,
          effectiveModel,
          modelWasOverridden,
          selectedSpecialist,
        });
      }

      // Save the setup script to the store for future reuse
      if (setupScript.trim()) {
        setupScriptStore.save({
          name: setupScriptName || 'Custom Script',
          content: setupScript.trim(),
          repoPath,
          projectType: 'generic',
        });
        logger.info('Saved setup script to store', {
          name: setupScriptName,
          repoPath,
        });
      }

      // NOTE: resolvedBehaviorPrompt was resolved earlier and is now in initialAgent.behaviorPrompt

      // Store initial agent configuration for the workspace page to pick up
      const agentConfigData = {
        agentId: initialAgent.agentId,
        config: {
          ...initialAgent,
          behaviorPrompt: resolvedBehaviorPrompt, // Include resolved behavior prompt
          isInitialAgent: true,
          isFirstWorkspaceAgent: true,
        },
        timestamp: Date.now(),
      };

      // Store pending agent config with timestamp (workspace page checks this)
      sessionStorage.setItem(
        `workspace:${workspace.id}:initial-agent-pending`,
        JSON.stringify(agentConfigData),
      );

      // Store agent config for AuggieChatPanel to pick up
      sessionStorage.setItem(
        `workspace:${workspace.id}:agent-config`,
        JSON.stringify(agentConfigData.config),
      );

      // Store the initial agent ID
      sessionStorage.setItem(`workspace:${workspace.id}:initial-agent-id`, initialAgent.agentId);

      // Pre-store the workspace state with the drawer open
      const initialState = {
        version: 2,
        workspace: { id: workspace.id, status: 'loading' },
        mainPanel: { type: 'notes', selectedNoteId: 'spec' },
        drawer: { open: true, type: 'agent' as const, itemId: initialAgent.agentId },
        navigation: { history: [], currentIndex: -1 },
        ui: { hasInitialized: false, lastUpdated: Date.now() },
      };
      localStorage.setItem(`workspace:state:${workspace.id}`, JSON.stringify(initialState));
      // Note: Agent ID regeneration is now handled in clearForm() to prevent ID reuse in "stay on page" mode

      if (stayOnHomePage) {
        // Update the workspace in the store with agentSummary so the agent shows immediately
        // This is needed because the workspace returned from create() doesn't include agentSummary
        workspaceStore.updateLocalWorkspace(workspace.id, {
          agentSummary: {
            count: 1,
            agents: [
              {
                id: initialAgent.agentId,
                name: agentName,
                status: 'busy',
                specialist: (specialistId ?? null) as
                  | 'spec-writer'
                  | 'implementor'
                  | 'verifier'
                  | null, // Cast to WorkspaceAgentInfo specialist type
                lastActivity: new Date().toISOString(),
              },
            ],
          },
        });

        // Create the agent session and send the initial message
        // When staying on home page, the workspace page flow that normally does this is bypassed
        try {
          logger.info('[CompactWorkspaceInitializer] Creating agent session for home page', {
            workspaceId: workspace.id,
            agentId: initialAgent.agentId,
            hasPrompt: !!initialAgent.prompt,
            specialist: specialistId,
            hasBehaviorPrompt: !!resolvedBehaviorPrompt,
            behaviorPromptLength: resolvedBehaviorPrompt?.length || 0,
          });

          await agentService.createSession(workspace, {
            agentId: initialAgent.agentId,
            name: agentName,
            model: initialAgent.model,
            provider: selectedProvider, // ACP provider ID (auggie, claude-code, codex)
            agentType: initialAgent.agentType,
            initialMessage: initialAgent.prompt, // This sends the initial message
            contextReferences: initialAgent.contextReferences, // Pass file/issue context references for stdinContext
            behaviorPrompt: resolvedBehaviorPrompt, // Pass team coordinator or specialist behavior instructions for system prompt
            metadata: {
              ...initialAgent.metadata,
              isInitialAgent: true,
              isFirstWorkspaceAgent: true,
            },
            isPending: false,
          });

          // Mark the message as already sent in sessionStorage to prevent ChatPanel from sending it again
          // We keep the prompt for optimistic UI display, but set messageSent=true so ChatPanel knows not to send
          const agentConfigKey = `workspace:${workspace.id}:agent-config`;
          const storedConfig = sessionStorage.getItem(agentConfigKey);
          if (storedConfig) {
            try {
              const config = JSON.parse(storedConfig);
              config.messageSent = true; // Flag to prevent ChatPanel from sending again
              sessionStorage.setItem(agentConfigKey, JSON.stringify(config));
              logger.info(
                '[CompactWorkspaceInitializer] Marked message as sent in sessionStorage',
                {
                  workspaceId: workspace.id,
                  agentId: initialAgent.agentId,
                },
              );
            } catch (e) {
              // Ignore parse errors
            }
          }

          logger.info('[CompactWorkspaceInitializer] Agent session created and message sent', {
            workspaceId: workspace.id,
            agentId: initialAgent.agentId,
          });
        } catch (agentErr) {
          // Don't fail workspace creation if agent session creation fails
          // The user can still navigate to the workspace and interact with the agent there
          logger.error('[CompactWorkspaceInitializer] Failed to create agent session', {
            workspaceId: workspace.id,
            agentId: initialAgent.agentId,
            error: agentErr instanceof Error ? agentErr.message : 'Unknown error',
          });
        }
      } else {
        await goto(`/workspace/${workspace.id}`);
      }

      // Save last submitted agent settings before clearing form
      // This allows the form to restore these values after submission
      localStorage.setItem(
        LAST_SUBMITTED_AGENT_KEY,
        JSON.stringify({
          selectedSpecialist,
          selectedModel,
          modelWasOverridden,
          isTeamMode,
        }),
      );

      clearForm({ preserveRepo: stayOnHomePage });

      // Notify parent (e.g. modal) that creation succeeded
      oncreate?.();

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
    richTextarea?.clear(); // Clear the TipTap editor content
    // Immediately clear sessionStorage to prevent prompt from persisting across navigation
    // (the $effect may not run before navigation completes)
    sessionStorage.removeItem(`${FORM_STATE_KEY}-prompt`);
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
    hasImages = false;
    hasSelectedContext = false; // Reset context selection state
    error = null;
    // Reset branch status state
    branchBehind = 0;
    hasUncommittedChanges = false;
    pullError = null;
    showPullConflictDialog = false;
    pendingBranchStatusRequest = null;
    // Note: intentionally not resetting stayOnHomePage or shouldPullBeforeCreate - user preferences should persist

    // Generate a new agent ID for the next workspace creation
    // This is critical for "stay on page" mode to prevent agent ID reuse
    const newAgentId = unifiedIdService.generateAgentId();
    sessionStorage.setItem(AGENT_ID_KEY, newAgentId);
    initialAgentId = newAgentId;
  }

  function handleIssueSelect(_text: string, metadata?: IssueSelectionData) {
    if (!metadata) return;

    // Serialize metadata to JSON string for TipTap node storage
    const metadataJson = metadata.metadata ? JSON.stringify(metadata.metadata) : undefined;

    // Track the selected PR's source branch for the "Use PR branch" suggestion
    if (metadata.type === 'github' && metadata.metadata?.sourceBranch) {
      selectedPRBranch = metadata.metadata.sourceBranch;
    } else {
      selectedPRBranch = '';
    }

    // Insert context mention pill into the editor
    if (richTextarea) {
      hasSelectedContext = true;

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

  // Shared file processing logic - images are inserted inline, other files as mentions
  async function processImageFiles(files: File[]) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const insertedImageCount = { value: 0 };
    const insertedFileCount = { value: 0 };
    const oversizedFiles: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        oversizedFiles.push(file.name);
        continue;
      }

      // Images are inserted inline
      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await fileToDataUrl(file);
          richTextarea?.insertImage(dataUrl, file.name);
          insertedImageCount.value++;
          hasImages = true;
        } catch (err) {
          logger.error('Failed to insert image', { fileName: file.name, error: err });
          toast.error(`Failed to insert image: ${file.name}`);
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

    if (insertedImageCount.value > 0) {
      logger.debug(`Inserted ${insertedImageCount.value} image(s) inline`);
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
    // Check for inline images whenever content changes
    hasImages = (richTextarea?.getInlineImages()?.length ?? 0) > 0;

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
          const response = await window.electronAPI.invoke('git-tracking:get-pull-request', {
            owner,
            repo,
            number,
          });
          if (response?.success && response.data?.sourceBranch) {
            selectedPRBranch = response.data.sourceBranch;
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
      const result = await invoke<{
        success: boolean;
        enhanced?: string;
        error?: string;
      }>('agent:enhance-prompt', { prompt: initialPrompt });

      if (currentRequestId === cancelledRequestId) return;

      if (result?.success && result.enhanced) {
        initialPrompt = result.enhanced;
        await richTextarea?.setContent(result.enhanced);
        toast.success('Prompt enhanced');
      } else {
        toast.error('Failed to enhance prompt');
      }
    } catch (error) {
      if (currentRequestId === cancelledRequestId) return;
      logger.error('Failed to enhance prompt:', error);
      toast.error('Failed to enhance prompt');
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
  <div
    class="relative -ml-4 w-[calc(100%+32px)] border rounded-xl transition-all duration-200 border-border bg-background"
    class:drag-over={isDraggingOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onpaste={handlePaste}
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
          isFocused = true;
          isExpanded = true;
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
    <p
      class="mt-3 text-xs text-muted-foreground/50 leading-relaxed"
      transition:fade={{ duration: 200 }}
    >
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
              <p class="text-muted-foreground mt-1">
                Git is required to create workspaces. Please install Git and restart the app.
              </p>
              <button
                class="mt-2 text-primary hover:text-primary/80 underline cursor-pointer"
                onclick={() => {
                  if (typeof window !== 'undefined' && window.electronAPI) {
                    window.electronAPI.invoke('shell:openExternal', {
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
                {skipWorktree}
                {isNewRepo}
                {remoteSetup}
                suggestedBranch={selectedPRBranch}
                onRepoChange={handleRepoChange}
                onBranchChange={handleBranchChange}
                onSkipWorktreeChange={(value) => (skipWorktree = value)}
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
                {:else if cloneProgress}
                  {cloneProgress.message}
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
          class="mt-2 px-4.5 text-sm text-muted-foreground/70"
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
            bind:selectedModel
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
              class="flex items-center gap-1 whitespace-nowrap text-sm text-muted-foreground/75 hover:text-foreground transition-colors cursor-pointer"
              onclick={() => (showSetupScript = !showSetupScript)}
            >
              <span>Set up dev environment with</span>
              <div class="bg-background px-2 py-0.5 font-medium">{setupScriptName}</div>
              <p class="text-sm text-muted-foreground/75">script</p>
            </button>
            <!-- Right: rapid fire -->
            <Tooltip content="Stay on this page after creating a space" side="top" size="sm">
              <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
              <div
                class="flex whitespace-nowrap items-center gap-2 text-sm text-muted-foreground/75 hover:text-muted-foreground transition-colors cursor-pointer select-none ml-auto"
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
