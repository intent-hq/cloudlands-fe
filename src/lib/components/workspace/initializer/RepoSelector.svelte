<script lang="ts">
  /* eslint-disable max-lines */
  import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
  import { isElectronPlatform } from '$lib/utils/platform-capabilities';
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Select } from '$lib/components/ui/select';
  import { debugConfig } from '$lib/config/debug';
  import { createLogger } from '$lib/utils/client-logger';
  import { handleError } from '$lib/utils/error-handling';
  import { performanceMonitor } from '$lib/utils/performance';
  import { invoke } from '$lib/electron-bridge';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { getRecentRepos } from '$lib/utils/workspace-utils';
  import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
  import type { KnownRepo } from '$shared/types/known-repo';


  import { replaceWorkspaceList } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setWorkspaceInitializerDefaultParentPath,
    setWorkspaceInitializerLastSelectedRepo,
    setWorkspaceInitializerRecentRepos,
    setWorkspaceInitializerRemoteSetups,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import {
    selectWorkspaceInitializerDefaultParentPath,
    selectWorkspaceInitializerRecentRepos,
    selectWorkspaceInitializerRemoteSetups,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import type { WorkspaceInitializerRemoteSetup } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import {
    faFolder,
    faXmark,
    faPlus,
    faSpinner,
    faChevronDown,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import ServerIcon from '$lib/components/icons/ServerIcon.svelte';
  import AddRemoteSetupModal from './AddRemoteSetupModal.svelte';
  import DirectoryPickerModal from '$features/onboarding/messages/DirectoryPickerModal.svelte';
  import { selectIsFeatureEnabled } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { isolationNoun, resolveEffectiveIsolationMode, type IsolationMode } from './isolation-mode';

  const logger = createLogger('RepoSelector');

  // Effective isolated-checkout mode (worktree vs CoW clone) for creation copy
  let isolationMode = $state<IsolationMode>('worktree');
  $effect(() => {
    void resolveEffectiveIsolationMode().then((mode) => (isolationMode = mode));
  });
  const isolationLabel = $derived(isolationNoun(isolationMode));
  const defaultParentPath$ = selectWorkspaceInitializerDefaultParentPath();
  const workspaceInitializerRecentRepos$ = selectWorkspaceInitializerRecentRepos();
  const workspaceInitializerRemoteSetups$ = selectWorkspaceInitializerRemoteSetups();

  /** Join parent path + folder name using the platform's native separator */
  function joinNativePath(parent: string, name: string): string {
    // If the parent path contains backslashes (Windows), use backslash
    const sep = parent.includes('\\') ? '\\' : '/';
    // Remove trailing separator from parent if present
    const cleanParent = parent.replace(/[/\\]$/, '');
    return `${cleanParent}${sep}${name}`;
  }

  type RemoteSetup = WorkspaceInitializerRemoteSetup;

  export interface RepoChangeDetail {
    path: string;
    type: 'local' | 'github' | 'remote';
    githubUrl?: string;
    clonePath?: string; // User-selected folder where the repo should be cloned
    isNewRepo?: boolean;
    isValidPath?: boolean;
    scope?: string; // Relative path from git root for scoped subdirectories
    remoteSetup?: RemoteSetup;
  }

  interface Props {
    variant?: 'default' | 'ghost' | 'underline' | 'secondary';
    value?: string;
    onchange?: (event: CustomEvent<RepoChangeDetail>) => void;
    triggerClass?: string;
    displayValue?: string;
    triggerValueClass?: string;
    triggerContentClass?: string;
    emptyLabel?: string;
    showEmptyIcon?: boolean;
    showTriggerChevron?: boolean;
    triggerChevronClass?: string;
    onClear?: () => void;
  }

  let {
    variant = 'ghost',
    value = '',
    onchange,
    triggerClass,
    displayValue,
    triggerValueClass = 'text-subtle',
    triggerContentClass = 'gap-0.75',
    emptyLabel = 'Select a repository',
    showEmptyIcon = false,
    showTriggerChevron = false,
    triggerChevronClass = 'ml-2 opacity-50',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onClear,
  }: Props = $props();

  function onchangeWithTracking(detail: RepoChangeDetail) {
    if (!onchange) return;
    onchange(new CustomEvent('change', { detail }));
  }

  /**
   * Focus the repo input field
   * Used by parent components to focus the input after prefill
   */
  export function focusInput() {
    if (inputElement) {
      inputElement.focus();
    }
  }

  // State
  let selectedValue = $state(value);
  let inputValue = $state(value);
  let searchTerm = $state(''); // Separate search term that starts empty
  let inputElement: any;
  let isOpen = $state(false); // Track dropdown open state
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let isDialogOpen = $state(false); // Track if a native dialog is open (prevents dropdown from closing)
  let isLoading = $state(true); // Start as loading
  let isNewRepo = $state(false); // Track if this is a new repo creation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let isValidPath = $state(false); // Track if the input is a valid path
  let selectedRepoType = $state<'local' | 'github' | 'new'>('local'); // Track the type/tab of the selected repo
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let validationMessage = $state(''); // Message to show when path is invalid
  let directoryStatus = $state<{
    exists: boolean;
    isDirectory: boolean;
    isEmpty: boolean;
    isGitRepo: boolean;
    path: string;
    parentGitRoot?: string;
    relativePathFromGitRoot?: string;
    isSubdirectoryOfGitRepo?: boolean;
  } | null>(null);
  let recentRepos = $state<
    Array<{
      path: string;
      type: 'local' | 'github';
      githubUrl?: string;
      name: string;
      owner?: string;
    }>
  >($workspaceInitializerRecentRepos$);

  $effect(() => {
    if (isLoading) {
      recentRepos = $workspaceInitializerRecentRepos$;
    }
  });

  // Track if the current input is a recognized GitHub URL
  let detectedGitHub = $state<{ owner: string; repo: string; url: string } | null>(null);

  // Track if the current input is a recognized local path
  let detectedLocalPath = $state<string | null>(null);

  // Debounce timer for path/URL detection
  let detectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // TABBED INTERFACE STATE
  // ═══════════════════════════════════════════════════════════════════════════
  type TabId = 'local' | 'github' | 'new' | 'remote';
  let activeTab = $state<TabId>('local');

  // ═══════════════════════════════════════════════════════════════════════════
  // FOLDER-PICKER MODAL STATE
  // ═══════════════════════════════════════════════════════════════════════════
  // BE-driven folder browsing via `host.listDirectory` (DirectoryPickerModal),
  // replacing the retired native-dialog round-trip. One modal is
  // open at a time; `folderPickerPurpose` routes the picked path back to the
  // right destination (folder pick / new-repo parent / github-clone parent).
  type FolderPickerPurpose = 'select-repo' | 'new-repo-parent' | 'github-clone-parent';
  let folderPickerOpen = $state(false);
  let folderPickerPurpose = $state<FolderPickerPurpose>('select-repo');
  let folderPickerTitle = $state('Select folder');
  let folderPickerInitialPath = $state<string | undefined>(undefined);

  // ═══════════════════════════════════════════════════════════════════════════
  // REMOTE TAB STATE
  // ═══════════════════════════════════════════════════════════════════════════
  const remoteWorkspacesEnabled$ = selectIsFeatureEnabled('remote-workspaces');
  let remoteSetups = $state<RemoteSetup[]>($workspaceInitializerRemoteSetups$);
  let showAddRemoteModal = $state(false);

  $effect(() => {
    remoteSetups = $workspaceInitializerRemoteSetups$;
  });

  function saveRemoteSetups(setups = remoteSetups) {
    // Snapshot so no $state proxy enters the Redux store (src/store/renderer/AGENTS.md §2) —
    // a proxy in the persisted slice breaks settings.update's IPC structured clone.
    appStore.dispatch(setWorkspaceInitializerRemoteSetups($state.snapshot(setups)));
  }

  function handleSelectRemoteSetup(setup: RemoteSetup) {
    selectedValue = setup.name;
    inputValue = ''; // Don't contaminate the local/github input with remote server name
    selectedRepoType = 'local'; // Keep selectedRepoType compatible with existing code
    isNewRepo = false;
    isValidPath = true;

    const detail: RepoChangeDetail = {
      path: setup.workspacePath || setup.name,
      type: 'remote',
      remoteSetup: setup,
      isNewRepo: false,
      isValidPath: true,
    };
    onchangeWithTracking(detail);
    isOpen = false;
  }

  function handleRemoveRemoteSetup(id: string) {
    const nextSetups = remoteSetups.filter((s) => s.id !== id);
    remoteSetups = nextSetups;
    saveRemoteSetups(nextSetups);
  }

  function handleAddRemoteSetup() {
    showAddRemoteModal = true;
  }

  function handleSaveRemoteSetup(setup: RemoteSetup) {
    const nextSetups = [...remoteSetups, setup];
    remoteSetups = nextSetups;
    saveRemoteSetups(nextSetups);
    showAddRemoteModal = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE NEW REPO - Inline mode state
  // ═══════════════════════════════════════════════════════════════════════════
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let showCreateNewMode = $state(false); // Whether the inline create form is visible
  let newRepoParentPath = $state(''); // Parent directory for new repo
  let newRepoProjectName = $state('new-project'); // Project name for new repo

  // GitHub URL input for the tabbed interface
  let githubUrlInput = $state('');

  // GitHub clone destination (same pattern as new repo)
  let githubCloneParentPath = $state('');
  let githubCloneFolderName = $state('');

  // Confirmed GitHub URL - only set when user explicitly confirms a GitHub repo
  // This is separate from inputValue which changes as user types
  let confirmedGithubUrl = $state('');

  // Load default parent path from Redux; persistence is handled by the saga.
  function getDefaultParentPath(): string {
    return $defaultParentPath$ || '~/Developer';
  }

  function saveLastSelectedRepo(detail: RepoChangeDetail) {
    if (debugConfig.get('enableFormPersistence')) {
      appStore.dispatch(setWorkspaceInitializerLastSelectedRepo(detail));
    }
  }

  function saveDefaultParentPath(path: string) {
    appStore.dispatch(setWorkspaceInitializerDefaultParentPath(path));
  }

  // Validate a project/folder name: reject path separators, traversal, null bytes, unsafe chars
  function getProjectNameError(name: string): string | undefined {
    if (!name || name.trim().length === 0) return undefined; // empty is handled elsewhere
    const t = name.trim();
    if (t.includes('/') || t.includes('\\')) return 'Name cannot contain path separators (/ or \\)';
    if (t === '..' || t === '.' || /^\.+$/.test(t)) return "Name cannot be '.' or '..'";
    if (t.includes('\0')) return 'Name cannot contain null characters';
    if (/[<>:"|?*]/.test(t)) return 'Name contains invalid characters';
    if (t.length > 255) return 'Name is too long (max 255 characters)';
    return undefined;
  }

  // Derived validation error for new repo project name
  const newRepoNameError = $derived(getProjectNameError(newRepoProjectName));

  // Computed full path for new repo
  const newRepoFullPath = $derived(
    newRepoParentPath && newRepoProjectName && !newRepoNameError
      ? joinNativePath(newRepoParentPath, newRepoProjectName)
      : '',
  );

  // Track status of the new repo path (does it exist? is it a git repo?)
  let newRepoPathStatus = $state<{
    exists: boolean;
    isDirectory: boolean;
    isEmpty: boolean;
    isGitRepo: boolean;
    path: string;
  } | null>(null);
  let isCheckingNewRepoPath = $state(false);

  // Computed full path for GitHub clone
  const githubCloneFullPath = $derived(
    githubCloneParentPath && githubCloneFolderName
      ? joinNativePath(githubCloneParentPath, githubCloneFolderName)
      : githubCloneParentPath || '',
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // NON-GIT FOLDER HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  // When user selects a folder that exists but isn't a git repo, we need to
  // give them explicit options rather than silently proceeding
  let showNonGitFolderPrompt = $state(false);
  let nonGitFolderPath = $state('');

  // Filter repos based on search term and active tab type
  const filteredRepos = $derived(() => {
    // First filter by tab type
    const typeFilter = activeTab === 'local' ? 'local' : activeTab === 'github' ? 'github' : null;
    const typeFiltered = typeFilter ? recentRepos.filter((repo) => repo.type === typeFilter) : [];

    // Then filter by search term
    if (searchTerm === '') {
      return typeFiltered;
    }
    return typeFiltered.filter((repo) => {
      const search = searchTerm.toLowerCase();
      return repo.name.toLowerCase().includes(search) || repo.path.toLowerCase().includes(search);
    });
  });

  // Highlighted index for keyboard navigation (-1 means nothing highlighted)
  let highlightedIndex = $state(-1);

  // Reset highlighted index when filtered repos change
  $effect(() => {
    // Access filteredRepos to create dependency
    filteredRepos();
    highlightedIndex = -1;
  });

  // Update internal state when value prop changes
  $effect(() => {
    if (value && value !== selectedValue) {
      selectedValue = value;
      inputValue = value;
    }
  });

  // Handle dropdown open - set correct tab when opening
  function handleDropdownOpen() {
    // Clear search term when opening so all repos show
    searchTerm = '';

    // Set the correct tab based on the selected repo type
    const currentValue = selectedValue || value;
    logger.info('Dropdown opened', {
      currentValue,
      selectedRepoType,
    });

    if (currentValue) {
      // Use the stored repo type to determine the tab
      activeTab = selectedRepoType;

      // If GitHub, also populate the input from inputValue (which stores the GitHub URL)
      if (selectedRepoType === 'github' && inputValue) {
        const githubInfo = parseGitHubUrl(inputValue);
        if (githubInfo) {
          githubUrlInput = `${githubInfo.owner}/${githubInfo.repo}`;
          handleInputChange(`https://github.com/${githubInfo.owner}/${githubInfo.repo}`);
        }
      }
    } else {
      // No value selected, default to local
      activeTab = 'local';
    }

    // Focus input - always autofocus for better UX
    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      logger.info('Focusing input', inputElement);
      if (inputElement) {
        inputElement.focus();
        inputElement.select();
      }
    });
  }

  // Track previous open state outside reactive system to detect transitions
  let previousOpenState = false;

  // Watch for dropdown open transitions
  $effect(() => {
    const currentlyOpen = isOpen;
    if (currentlyOpen && !previousOpenState) {
      // Dropdown just opened
      handleDropdownOpen();
    }
    previousOpenState = currentlyOpen;
  });

  // Prevent Enter key from bubbling up and submitting the form when dropdown is open
  $effect(() => {
    if (!isOpen) return;

    function handleGlobalKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        // Prevent form submission when dropdown is open
        e.stopPropagation();
      }
    }

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleGlobalKeydown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeydown, true);
  });

  // Escape layer: while the dropdown is open it is the topmost overlay, so
  // Escape closes only the dropdown (not e.g. a modal hosting this selector)
  $effect(() => {
    if (!isOpen) return;
    return pushEscapeLayer(() => {
      isOpen = false;
    });
  });

  // Initialize parent path when switching to new repo tab
  $effect(() => {
    if (activeTab === 'new' && !newRepoParentPath) {
      newRepoParentPath = getDefaultParentPath();
    }
  });

  // Initialize parent path when switching to github tab
  $effect(() => {
    if (activeTab === 'github' && !githubCloneParentPath) {
      githubCloneParentPath = getDefaultParentPath();
    }
  });

  // Auto-set folder name when GitHub repo is detected
  $effect(() => {
    if (detectedGitHub) {
      githubCloneFolderName = detectedGitHub.repo;
    }
  });

  // Check directory status when new repo path changes
  $effect(() => {
    const path = newRepoFullPath;
    if (!path || !newRepoParentPath || !newRepoProjectName) {
      newRepoPathStatus = null;
      return;
    }

    // Debounce the check
    isCheckingNewRepoPath = true;
    const checkPath = async () => {
      if (!isElectronPlatform()) {
        isCheckingNewRepoPath = false;
        return;
      }
      try {
        const result = await invoke<any>('file:getDirectoryStatus', { path });
        if (result.success && result.data) {
          newRepoPathStatus = result.data;
        } else {
          newRepoPathStatus = null;
        }
      } catch {
        newRepoPathStatus = null;
      } finally {
        isCheckingNewRepoPath = false;
      }
    };

    // Small delay to avoid checking on every keystroke
    const timeout = setTimeout(checkPath, 300);
    return () => clearTimeout(timeout);
  });

  // Helper to detect the correct tab for a given value

  // Load recent repositories on mount
  // NOTE: We intentionally do NOT restore the last selected repo here.
  // That logic lives in the parent flow to avoid side effects when this component
  // mounts/unmounts (e.g., during reset). This component should
  // be "controlled" - it receives `value` as a prop and only fires `onchange` on user actions.
  onMount(async () => {
    performanceMonitor.start('loadRecentRepos');

    try {
      // Simulate network delay if enabled
      if (debugConfig.get('simulateSlowNetwork')) {
        await new Promise((resolve) => setTimeout(resolve, debugConfig.get('networkDelay') || 0));
      }

      // Load repos from both workspace-derived and persistent registry in parallel
      const [workspaceListResult, registryResult] = await Promise.all([
        workspaceClient.list({ lite: true }),
        invoke<{ success: boolean; data?: KnownRepo[] }>(
          WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
          {},
        ).catch(() => null),
      ]);

      const workspaces = workspaceListResult.ok ? workspaceListResult.data : [];
      if (workspaceListResult.ok) {
        appStore.dispatch(replaceWorkspaceList(workspaces));
      }

      // Build a map of repos by path (persistent registry first, then workspace-derived)
      const repoMap = new Map<
        string,
        { path: string; type: 'local' | 'github'; name: string; owner?: string }
      >();

      for (const repo of $workspaceInitializerRecentRepos$) {
        repoMap.set(repo.path, repo);
      }

      // Add persistent registry repos
      if (registryResult?.success && Array.isArray(registryResult.data)) {
        for (const repo of registryResult.data) {
          if (repo.path && !repo.path.includes('/.clones/')) {
            repoMap.set(repo.path, {
              path: repo.path,
              type: 'local' as const,
              name: repo.name,
              owner: repo.owner,
            });
          }
        }
      }

      // Merge workspace-derived repos (overrides registry entries with fresher data)
      if (workspaces && workspaces.length > 0) {
        const allRecentRepos = getRecentRepos(workspaces, 10);
        for (const repo of allRecentRepos) {
          const isLocalPath =
            repo.path.startsWith('/') ||
            repo.path.startsWith('~') ||
            repo.path.startsWith('.') ||
            repo.path.includes(':\\');
          const isLegacyClone = repo.path.includes('/.clones/');
          if (isLocalPath && !isLegacyClone) {
            repoMap.set(repo.path, {
              path: repo.path,
              type: 'local' as const,
              name: repo.name,
              owner: repo.owner,
            });
          }
        }
      }

      recentRepos = Array.from(repoMap.values()).slice(0, 9);

      // Save recent repos through Redux if persistence is enabled.
      if (debugConfig.get('enableFormPersistence')) {
        // Snapshot so no $state proxy enters the Redux store (src/store/renderer/AGENTS.md §2) —
        // a proxy in the persisted slice breaks settings.update's IPC structured clone.
        appStore.dispatch(setWorkspaceInitializerRecentRepos($state.snapshot(recentRepos)));
      }
    } catch (err) {
      const appError = handleError(err, { component: 'RepoSelector', action: 'loadRecentRepos' });
      logger.error('Failed to load recent repositories', appError);
    } finally {
      isLoading = false;
      performanceMonitor.end('loadRecentRepos');
    }
  });

  // Get GitHub avatar URL for org/user
  function getGitHubAvatarUrl(owner: string, size: number = 32): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }

  // Parse GitHub URL using the URL API for robust parsing
  function parseGitHubUrl(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Handle SSH format: git@github.com:owner/repo.git
    if (trimmed.startsWith('git@github.com:')) {
      const sshPath = trimmed.slice('git@github.com:'.length);
      const parts = sshPath.replace(/\.git$/, '').split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return { owner: parts[0], repo: parts[1] };
      }
      return null;
    }

    // Try parsing as a URL
    try {
      const url = new URL(trimmed);

      // Must be GitHub
      if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
        return null;
      }

      // Must be http or https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }

      // Parse the pathname: /owner/repo/... or /owner/repo.git
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) {
        return null;
      }

      const owner = pathParts[0];
      // Remove .git suffix if present
      const repo = pathParts[1].replace(/\.git$/, '');

      if (owner && repo) {
        return { owner, repo };
      }
    } catch {
      // Not a valid URL, check for simple owner/repo shorthand
    }

    // Check for simple owner/repo format (e.g., "facebook/react")
    // Must not look like a file path
    if (
      !trimmed.includes('\\') &&
      !trimmed.includes(':') &&
      !trimmed.startsWith('.') &&
      !trimmed.startsWith('/')
    ) {
      const parts = trimmed.split('/');
      if (parts.length === 2 && parts[0] && parts[1]) {
        // Validate that both parts look like valid GitHub identifiers
        const validIdentifier = (s: string) =>
          /^[a-zA-Z0-9]([a-zA-Z0-9\-_\.]*[a-zA-Z0-9])?$/.test(s) || /^[a-zA-Z0-9]$/.test(s);
        if (validIdentifier(parts[0]) && validIdentifier(parts[1])) {
          return { owner: parts[0], repo: parts[1] };
        }
      }
    }

    return null;
  }

  /**
   * Normalize GitHub input to just "owner/repo" format.
   * Handles all common input patterns:
   * - Full URLs: https://github.com/owner/repo → owner/repo
   * - URLs with www: https://www.github.com/owner/repo → owner/repo
   * - URLs with .git: https://github.com/owner/repo.git → owner/repo
   * - URLs with extra paths: https://github.com/owner/repo/tree/main → owner/repo
   * - SSH URLs: git@github.com:owner/repo.git → owner/repo
   * - With prefix: github.com/owner/repo → owner/repo
   * - Plain: owner/repo → owner/repo
   * - With trailing slash: owner/repo/ → owner/repo
   */
  function normalizeGitHubInput(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // Try to parse as a full GitHub URL first
    const parsed = parseGitHubUrl(trimmed);
    if (parsed) {
      return `${parsed.owner}/${parsed.repo}`;
    }

    // Handle "github.com/owner/repo" without protocol
    if (trimmed.toLowerCase().startsWith('github.com/')) {
      const path = trimmed.slice('github.com/'.length);
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
      }
      return path.replace(/\/$/, ''); // Return what we have, trimming trailing slash
    }

    // Handle "www.github.com/owner/repo" without protocol
    if (trimmed.toLowerCase().startsWith('www.github.com/')) {
      const path = trimmed.slice('www.github.com/'.length);
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
      }
      return path.replace(/\/$/, '');
    }

    // Already in owner/repo format or partial - just clean it up
    return trimmed.replace(/\/$/, '').replace(/\.git$/, '');
  }

  // Handle GitHub input change - only light normalization for typing
  function handleGitHubInputChange(value: string) {
    // Don't normalize on every keystroke - just update the value
    // Only strip obvious URL prefixes if user types/pastes them directly
    let cleaned = value;

    // If user somehow types a full URL, extract just the path
    if (cleaned.toLowerCase().startsWith('https://github.com/')) {
      cleaned = cleaned.slice('https://github.com/'.length);
    } else if (cleaned.toLowerCase().startsWith('http://github.com/')) {
      cleaned = cleaned.slice('http://github.com/'.length);
    } else if (cleaned.toLowerCase().startsWith('github.com/')) {
      cleaned = cleaned.slice('github.com/'.length);
    }

    githubUrlInput = cleaned;

    // Trigger detection with the full URL for the existing logic
    if (cleaned) {
      handleInputChange(`https://github.com/${cleaned}`);
    } else {
      handleInputChange('');
    }
  }

  // Handle paste in GitHub input - normalize pasted content
  function handleGitHubPaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') || '';
    if (pasted) {
      e.preventDefault();
      const normalized = normalizeGitHubInput(pasted);
      githubUrlInput = normalized;

      // Trigger detection
      if (normalized) {
        handleInputChange(`https://github.com/${normalized}`);
      }
    }
  }

  // Check directory status for local paths
  async function checkDirectoryStatus(path: string): Promise<void> {
    if (!isElectronPlatform()) return;

    try {
      const result = await invoke<any>('file:getDirectoryStatus', { path });
      if (result.success && result.data) {
        directoryStatus = result.data;
        // Determine if this is a new repo scenario
        // Only treat as new repo if directory doesn't exist AND is not inside a parent git repo
        isNewRepo = !result.data.exists && !result.data.isSubdirectoryOfGitRepo;
        // Mark as invalid if it's a file (not a directory)
        if (result.data.exists && !result.data.isDirectory) {
          isValidPath = false;
        }
      }
    } catch (err) {
      logger.warn('Failed to check directory status', err);
    }
  }

  // Handle input change - search first, then debounced detection
  function handleInputChange(value: string) {
    inputValue = value;
    searchTerm = value; // Update search term for filtering

    // Clear any pending detection
    if (detectionDebounceTimer) {
      clearTimeout(detectionDebounceTimer);
    }

    // Immediately clear detections when input changes
    // (they'll be re-detected after debounce if still valid)
    detectedGitHub = null;
    detectedLocalPath = null;

    // Clear validation message while typing
    validationMessage = '';

    // Debounce the path/URL detection
    detectionDebounceTimer = setTimeout(() => {
      detectPathOrUrl(value);
    }, 300);
  }

  // Debounced detection of paths and URLs
  // Check if value is an explicit GitHub URL (not shorthand like owner/repo)
  function isExplicitGitHubUrl(value: string): boolean {
    return (
      value.startsWith('https://github.com') ||
      value.startsWith('http://github.com') ||
      value.startsWith('github.com') ||
      value.startsWith('github:') ||
      value.startsWith('git@github.com')
    );
  }

  async function detectPathOrUrl(value: string) {
    if (!value || value.trim() === '') {
      detectedGitHub = null;
      detectedLocalPath = null;
      return;
    }

    // Check if it's a local path
    if (
      value.startsWith('/') ||
      value.startsWith('~') ||
      value.includes(':\\') ||
      value.startsWith('./') ||
      value.startsWith('../')
    ) {
      detectedGitHub = null;
      detectedLocalPath = value;

      // Check directory status asynchronously
      await checkDirectoryStatus(value);
      return;
    }

    // Only show GitHub detection for explicit URLs, not shorthand like owner/repo
    if (isExplicitGitHubUrl(value)) {
      const githubInfo = parseGitHubUrl(value);
      if (githubInfo) {
        const githubUrl = `https://github.com/${githubInfo.owner}/${githubInfo.repo}`;

        detectedLocalPath = null;
        detectedGitHub = {
          owner: githubInfo.owner,
          repo: githubInfo.repo,
          url: githubUrl,
        };
        return;
      }
    }

    // Not a recognized format - just clear detections, no warning
    detectedGitHub = null;
    detectedLocalPath = null;
  }

  // Handle confirming a detected local path
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async function handleConfirmLocalPath() {
    if (!detectedLocalPath) return;

    selectedValue = detectedLocalPath;
    selectedRepoType = 'local';
    confirmedGithubUrl = ''; // Clear GitHub URL when selecting local repo

    const detail: RepoChangeDetail = {
      path: detectedLocalPath,
      type: 'local',
      isNewRepo,
      isValidPath: true,
      scope: directoryStatus?.relativePathFromGitRoot,
    };
    onchangeWithTracking(detail);

    saveLastSelectedRepo(detail);

    // Close the dropdown
    isOpen = false;
  }

  // Handle selecting a recent repo
  function handleSelectRepo(repo: any) {
    selectedValue = repo.path;
    inputValue = repo.type === 'github' ? repo.githubUrl : repo.path;
    selectedRepoType = repo.type;
    // Set confirmedGithubUrl for GitHub repos, clear it for local repos
    confirmedGithubUrl = repo.type === 'github' ? repo.githubUrl || '' : '';

    // Recent repos are always existing repos and always valid
    isNewRepo = false;
    isValidPath = true;
    validationMessage = '';
    directoryStatus = null;

    // Only pass githubUrl if it's actually a GitHub repo
    const detail: RepoChangeDetail = {
      path: repo.path,
      type: repo.type,
      isNewRepo: false,
      isValidPath: true,
    };
    if (repo.type === 'github' && repo.githubUrl) {
      detail.githubUrl = repo.githubUrl;
      // For GitHub repos, path IS the clone destination
      detail.clonePath = repo.path;
    }

    onchangeWithTracking(detail);

    saveLastSelectedRepo(detail);

    // Close the dropdown
    isOpen = false;
  }

  // Open the BE-driven folder picker to choose a repository folder.
  function handleSelectFolder() {
    folderPickerPurpose = 'select-repo';
    folderPickerTitle = 'Select Repository Folder';
    folderPickerInitialPath = typeof selectedValue === 'string' ? selectedValue : undefined;
    folderPickerOpen = true;
  }

  // Apply a path picked via DirectoryPickerModal for the "select-repo" flow.
  async function applyPickedRepoFolder(path: string): Promise<void> {
    try {
      // Check directory status first
      await checkDirectoryStatus(path);

      // If it's an existing folder but NOT a git repo, show the prompt
      if (
        directoryStatus?.exists &&
        !directoryStatus?.isGitRepo &&
        !directoryStatus?.isSubdirectoryOfGitRepo
      ) {
        nonGitFolderPath = path;
        showNonGitFolderPrompt = true;
        // Don't close dropdown - let user decide what to do
        return;
      }

      selectedValue = path;
      inputValue = path;
      confirmedGithubUrl = ''; // Clear GitHub URL when picking local folder
      selectedRepoType = 'local';

      // Folder selection is always valid
      isValidPath = true;
      validationMessage = '';

      const detail: RepoChangeDetail = {
        path,
        type: 'local',
        isNewRepo,
        isValidPath: true,
        scope: directoryStatus?.relativePathFromGitRoot,
      };
      onchangeWithTracking(detail);

      saveLastSelectedRepo(detail);
      // Close the dropdown
      isOpen = false;
    } catch (err) {
      logger.error('Failed to select folder', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE NEW REPO HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Toggle the inline create new repo form

  // Open the BE-driven folder picker to choose a parent folder for a new repo.
  function handleSelectNewRepoParent() {
    isDialogOpen = true;
    folderPickerPurpose = 'new-repo-parent';
    folderPickerTitle = 'Select Parent Folder for New Repository';
    folderPickerInitialPath = newRepoParentPath || undefined;
    folderPickerOpen = true;
  }

  // Confirm and create the new repo selection
  function handleConfirmNewRepo() {
    if (!newRepoParentPath || !newRepoProjectName || newRepoNameError) return;

    const fullPath = joinNativePath(newRepoParentPath, newRepoProjectName);
    selectedValue = fullPath;
    inputValue = fullPath;
    confirmedGithubUrl = ''; // Clear GitHub URL when creating new repo
    isValidPath = true;
    validationMessage = '';
    directoryStatus = null;
    selectedRepoType = 'new';

    // If the path exists and is a git repo, treat it as existing (will create worktree)
    // Otherwise treat it as a new repo to be created
    const existingGitRepo = newRepoPathStatus?.exists && newRepoPathStatus?.isGitRepo;
    isNewRepo = !existingGitRepo;

    const detail: RepoChangeDetail = {
      path: fullPath,
      type: 'local',
      isNewRepo: !existingGitRepo,
      isValidPath: true,
    };
    onchangeWithTracking(detail);

    saveDefaultParentPath(newRepoParentPath);
    saveLastSelectedRepo(detail);

    // Reset and close
    showCreateNewMode = false;
    isOpen = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GITHUB CLONE FOLDER HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Open the BE-driven folder picker to choose a clone target folder.
  function handleSelectGitHubCloneParent() {
    isDialogOpen = true;
    folderPickerPurpose = 'github-clone-parent';
    folderPickerTitle = 'Select Folder to Clone Repository Into';
    folderPickerInitialPath = githubCloneParentPath || undefined;
    folderPickerOpen = true;
  }

  // Dispatch a picked path from DirectoryPickerModal to the right destination.
  async function handleFolderPickerSelect(path: string): Promise<void> {
    folderPickerOpen = false;
    const purpose = folderPickerPurpose;
    if (purpose === 'select-repo') {
      await applyPickedRepoFolder(path);
      return;
    }
    if (purpose === 'new-repo-parent') {
      newRepoParentPath = path;
      saveDefaultParentPath(newRepoParentPath);
    } else if (purpose === 'github-clone-parent') {
      githubCloneParentPath = path;
      saveDefaultParentPath(githubCloneParentPath);
    }
    isDialogOpen = false;
    // Re-open the dropdown so the user lands back in the correct flow.
    isOpen = true;
  }

  // Close the BE-driven folder picker without applying a selection.
  function handleFolderPickerClose(): void {
    folderPickerOpen = false;
    if (folderPickerPurpose !== 'select-repo') {
      isDialogOpen = false;
      // Re-open the dropdown after dialog closes (matches the prior dialog behavior).
      isOpen = true;
    }
  }

  // Confirm and select the GitHub clone
  function handleConfirmGitHubClone() {
    if (!detectedGitHub || !githubCloneParentPath || !githubCloneFolderName) return;

    const clonePath = joinNativePath(githubCloneParentPath, githubCloneFolderName);

    const detail: RepoChangeDetail = {
      path: clonePath,
      type: 'github',
      githubUrl: detectedGitHub.url,
      clonePath,
      isNewRepo: false,
      isValidPath: true,
    };

    selectedValue = clonePath;
    inputValue = detectedGitHub.url;
    confirmedGithubUrl = detectedGitHub.url;
    selectedRepoType = 'github';
    isValidPath = true;
    validationMessage = '';

    onchangeWithTracking(detail);

    saveDefaultParentPath(githubCloneParentPath);
    saveLastSelectedRepo(detail);

    // Close the dropdown
    isOpen = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NON-GIT FOLDER HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Handle when user wants to initialize git in a non-git folder
  function handleInitializeGitInFolder() {
    if (!nonGitFolderPath) return;

    selectedValue = nonGitFolderPath;
    inputValue = nonGitFolderPath;
    confirmedGithubUrl = ''; // Clear GitHub URL when selecting local folder
    selectedRepoType = 'local';
    isNewRepo = true; // Treat as new repo - will init git
    isValidPath = true;
    validationMessage = '';

    const detail: RepoChangeDetail = {
      path: nonGitFolderPath,
      type: 'local',
      isNewRepo: true,
      isValidPath: true,
    };
    onchangeWithTracking(detail);

    saveLastSelectedRepo(detail);

    showNonGitFolderPrompt = false;
    nonGitFolderPath = '';
    isOpen = false;
  }

  // Handle when user wants to choose a different folder
  function handleChooseDifferentFolder() {
    showNonGitFolderPrompt = false;
    nonGitFolderPath = '';
    // Keep dropdown open, clear the detected path
    detectedLocalPath = null;
    directoryStatus = null;
    inputValue = '';
    searchTerm = '';
  }

  // Format display value
  function formatDisplayValue(): string {
    if (!selectedValue) return 'Select a repository';

    // For confirmed GitHub repos, use the confirmed URL to display owner/repo
    // This uses confirmedGithubUrl which is only set when user explicitly confirms
    if (selectedRepoType === 'github' && confirmedGithubUrl) {
      const githubInfo = parseGitHubUrl(confirmedGithubUrl);
      if (githubInfo) {
        return `${githubInfo.owner}/${githubInfo.repo}`;
      }
    }

    // If selectedValue looks like owner/repo (from saved state), use it directly
    if (
      selectedValue.match(/^[^\/]+\/[^\/]+$/) &&
      !selectedValue.includes('\\') &&
      !selectedValue.startsWith('/')
    ) {
      return selectedValue;
    }

    // For local paths, show just the folder name
    const parts = selectedValue.split(/[\/\\]/);
    return parts[parts.length - 1] || selectedValue;
  }

  const triggerDisplayValue = $derived(displayValue ?? formatDisplayValue());
</script>

<div class="relative">
  <Select.Root bind:value={selectedValue} bind:open={isOpen}>
    <Select.Trigger {variant} class={`w-full ${triggerClass}`}>
      <div class={`flex w-full items-center truncate ${triggerContentClass}`}>
        <!-- {#if isNewRepo}
          <Fa icon={faPlus} size="sm" class="text-ghost" />
        {:else}
          <GitRepoIcon size={12} class="text-ghost -mb-0.25" />
        {/if} -->
        {#if showEmptyIcon && !selectedValue}
          <GitRepoIcon size={12} class="text-ghost -mb-0.25 mr-1" />
        {/if}
        <span class="flex-1 text-left truncate">
          {#if selectedValue}
            <span class={triggerValueClass}>{triggerDisplayValue}</span>
            {#if isNewRepo && !displayValue}
              <span class="text-sm text-subtle ml-1">(new)</span>
            {/if}
          {:else}
            <span class={triggerValueClass}>{emptyLabel}</span>
          {/if}
        </span>
        {#if showTriggerChevron}
          <Fa icon={faChevronDown} size={10} class={triggerChevronClass} />
        {/if}
      </div>
    </Select.Trigger>
    <Select.Content
      class="max-w-[500px] min-w-[400px]! max-h-[600px] overflow-hidden flex flex-col"
      portal
    >
      <!-- Header -->
      <div class="px-4 pt-2 pb-3">
        <h2 class="text-base font-semibold text-foreground">What repo should we work on?</h2>
        <p class="text-sm text-subtle mt-1">
          Select an existing codebase or make a new one. We'll create an isolated space to work in.
        </p>
      </div>

      <!-- Tab bar -->
      <div class="flex gap-0 mx-3 mb-3 bg-sidebar rounded-lg p-1">
        {#each [{ id: 'local' as TabId, label: 'Copy local repo' }, { id: 'github' as TabId, label: 'Clone from GitHub' }, { id: 'new' as TabId, label: 'New repo' }, ...($remoteWorkspacesEnabled$ ? [{ id: 'remote' as TabId, label: 'Remote server' }] : [])] as tab}
          <button
            type="button"
            class="flex-1 px-3 py-1.5 text-sm rounded-md cursor-pointer transition-all {activeTab ===
            tab.id
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- Input section - changes based on tab -->
      <div class="px-3 mb-3">
        {#if activeTab === 'local'}
          <!-- Local repo: folder picker button -->
          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-0 bg-sidebar text-left cursor-pointer"
            onclick={handleSelectFolder}
          >
            <span
              class="text-sm truncate {inputValue ? 'text-foreground' : 'text-muted-foreground'}"
            >
              {inputValue || 'Select a folder...'}
            </span>
            <Fa icon={faFolder} class="text-ghost opacity-50" />
          </button>
        {:else if activeTab === 'github'}
          <!-- GitHub: URL input with prefix -->
          <div class="flex items-center rounded-lg bg-sidebar">
            <Fa icon={faGithub} class="ml-3" />
            <span class="text-sm pl-1.5 shrink-0 select-none">github.com/</span>
            <Input
              bind:this={inputElement}
              type="text"
              bind:value={githubUrlInput}
              oninput={(e) => handleGitHubInputChange(e.currentTarget.value)}
              onpaste={handleGitHubPaste}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (detectedGitHub && githubCloneParentPath && githubCloneFolderName) {
                    handleConfirmGitHubClone();
                  }
                }
              }}
              placeholder="owner/repo"
              class="bg-sidebar border-none px-1 py-2.5! h-auto"
              noFocusStyle
            />
          </div>
          <!-- Parent folder picker -->
          <button
            type="button"
            class="w-full min-w-0 flex items-center gap-3 mt-2 text-left cursor-pointer"
            onclick={handleSelectGitHubCloneParent}
          >
            <span class="text-sm text-subtle shrink-0 w-24 pl-1">Clone into</span>
            <span
              class="flex-1 text-sm px-3 py-2.5 bg-sidebar rounded-lg flex items-center shrink justify-between {githubCloneParentPath
                ? 'text-foreground'
                : 'text-subtle'} truncate"
            >
              <div class="truncate">
                {githubCloneParentPath || 'Select folder...'}
              </div>
              <Fa icon={faFolder} class="text-ghost shrink-0 opacity-50" />
            </span>
          </button>
          <!-- Folder name -->
          <div class="flex items-center gap-3 mt-2">
            <span class="text-sm text-subtle shrink-0 w-24 pl-1">Folder name</span>
            <Input
              type="text"
              bind:value={githubCloneFolderName}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (detectedGitHub && githubCloneParentPath && githubCloneFolderName) {
                    handleConfirmGitHubClone();
                  }
                }
              }}
              placeholder={detectedGitHub?.repo || 'repo-name'}
              class="bg-sidebar border-none"
              noFocusStyle
            />
          </div>
          <!-- Full path preview + clone button -->
          {#if detectedGitHub}
            <div class="flex items-center justify-between gap-2 mt-2 px-1">
              {#if githubCloneFullPath}
                <span class="text-sm text-subtle truncate flex-1">
                  {githubCloneFullPath}
                </span>
                <Button size="sm" onclick={handleConfirmGitHubClone} class="shrink-0">Clone</Button>
              {:else}
                <span class="text-sm text-subtle truncate flex-1">
                  {#if !githubCloneParentPath}
                    Select a folder to clone into
                  {:else if !githubCloneFolderName}
                    Enter a folder name
                  {/if}
                </span>
                <Button size="sm" disabled class="shrink-0">Clone</Button>
              {/if}
            </div>
          {/if}
        {:else if activeTab === 'new'}
          <!-- New repo: parent folder + folder name -->
          <button
            type="button"
            class="w-full flex items-center gap-3 mb-2 text-left cursor-pointer"
            onclick={handleSelectNewRepoParent}
          >
            <span class="text-sm text-subtle shrink-0 w-24 pl-1">Parent folder</span>
            <span
              class="flex-1 text-sm px-3 py-2.5 bg-sidebar rounded-lg flex items-center justify-between {newRepoParentPath
                ? 'text-foreground'
                : 'text-subtle'} truncate"
            >
              <div class="truncate">
                {newRepoParentPath || 'Select...'}
              </div>
              <Fa icon={faFolder} class="text-ghost shrink-0 opacity-50" />
            </span>
          </button>
          <div class="flex items-center gap-3">
            <span class="text-sm text-subtle shrink-0 w-24 pl-1">Folder name</span>
            <Input
              type="text"
              bind:value={newRepoProjectName}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleConfirmNewRepo();
                }
              }}
              placeholder="new-project"
              class="bg-sidebar border-none"
              noFocusStyle
            />
          </div>
          <!-- Validation error for project name -->
          {#if newRepoNameError}
            <div class="mt-2 px-1">
              <span class="text-sm text-red-500">{newRepoNameError}</span>
            </div>
          {:else if newRepoFullPath}
            <!-- Full path preview + status message + action button -->
            <div class="mt-2 px-1">
              <!-- Path preview -->
              <div class="text-sm text-subtle truncate mb-2">
                {newRepoFullPath}
              </div>
              <!-- Status message and action -->
              {#if isCheckingNewRepoPath}
                <div class="flex items-center gap-2 text-sm text-subtle">
                  <Fa icon={faSpinner} class="animate-spin" size="sm" />
                  <span>Checking...</span>
                </div>
              {:else if newRepoPathStatus?.exists && newRepoPathStatus?.isGitRepo}
                <!-- Existing git repo - will create an isolated checkout -->
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-subtle">
                    Repo exists — we'll create a {isolationLabel} off it
                  </span>
                  <Button size="sm" onclick={handleConfirmNewRepo} class="shrink-0">Select</Button>
                </div>
              {:else if newRepoPathStatus?.exists && !newRepoPathStatus?.isGitRepo}
                <!-- Existing folder but not a git repo -->
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-amber-500"> Folder exists but is not a git repo </span>
                  <Button size="sm" onclick={handleConfirmNewRepo} class="shrink-0" disabled
                    >Create</Button
                  >
                </div>
              {:else}
                <!-- New folder - will create -->
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm text-subtle">New repo will be created</span>
                  <Button size="sm" onclick={handleConfirmNewRepo} class="shrink-0">Create</Button>
                </div>
              {/if}
            </div>
          {/if}
        {:else if activeTab === 'remote'}
          <!-- Remote server: list saved setups -->
          <div class="space-y-1">
            {#each remoteSetups as setup (setup.id)}
              <div
                role="button"
                tabindex="0"
                class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-sidebar text-left cursor-pointer hover:bg-muted/50 transition-colors"
                onclick={() => handleSelectRemoteSetup(setup)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectRemoteSetup(setup);
                  }
                }}
              >
                <ServerIcon size={14} class="text-ghost shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-sm">{setup.name}</div>
                  <div class="text-xs text-subtle">
                    {setup.transport === 'websocket'
                      ? setup.wsUrl
                      : `${setup.username}@${setup.host}:${setup.port}`}
                  </div>
                </div>
                <button
                  type="button"
                  onclick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handleRemoveRemoteSetup(setup.id);
                  }}
                  class="ml-1 p-0.5 rounded text-muted-foreground hover:text-destructive-foreground hover:bg-destructive/10"
                  title="Remove setup"
                >
                  <Fa icon={faXmark} size="xs" />
                </button>
              </div>
            {/each}
            {#if remoteSetups.length === 0}
              <div class="text-sm text-subtle px-3 py-2">No remote setups configured yet.</div>
            {/if}
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left cursor-pointer hover:bg-muted/50 transition-colors text-sm text-muted-foreground"
              onclick={handleAddRemoteSetup}
            >
              <Fa icon={faPlus} size="sm" />
              Add remote setup...
            </button>
          </div>
        {/if}
      </div>

      <!-- Non-git folder prompt - shows when user selects a folder that isn't a git repo -->
      {#if showNonGitFolderPrompt && nonGitFolderPath}
        <div class="mx-3 mb-3 p-3 bg-sidebar rounded-lg">
          <div class="flex items-start gap-3">
            <Fa icon={faFolder} class="text-ghost shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate mb-1" title={nonGitFolderPath}>
                {nonGitFolderPath.split('/').pop() || nonGitFolderPath}
              </div>
              <div class="text-sm text-subtle mb-2">This folder is not a Git repository.</div>
              <div class="flex gap-2">
                <Button size="sm" variant="secondary" onclick={handleInitializeGitInFolder}
                  >Initialize Git here</Button
                >
                <Button size="sm" variant="secondary" onclick={handleChooseDifferentFolder}>
                  Choose a different folder
                </Button>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Recent repos section - only show for local and github tabs when there are repos -->
      {#if activeTab !== 'new' && activeTab !== 'remote' && (isLoading || filteredRepos().length > 0)}
        <div class="overflow-y-auto flex-1 px-4 pb-3 pt-2">
          <Header size={6} class="mb-1">Recent</Header>
          {#if isLoading && recentRepos.length === 0}
            <div class="space-y-1">
              {#each [1, 2, 3] as { }}
                <div class="flex items-center gap-2 py-1.5">
                  <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                  <div class="h-4 bg-muted rounded flex-1 animate-pulse"></div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="">
              {#each filteredRepos() as repo, index (repo.path || repo.name)}
                <button
                  type="button"
                  class="w-full flex items-center gap-2 py-1.5 text-left hover:bg-muted/50 rounded-md px-2 pl-3 -mx-2 transition-colors cursor-pointer {index ===
                  highlightedIndex
                    ? 'bg-accent/20'
                    : ''}"
                  onclick={() => handleSelectRepo(repo)}
                >
                  {#if repo.owner}
                    <img
                      src={getGitHubAvatarUrl(repo.owner, 32)}
                      alt={repo.owner}
                      class="w-4 h-4 rounded-full shrink-0"
                      loading="lazy"
                      onerror={(e) =>
                        ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                    />
                  {:else}
                    <Fa
                      icon={repo.type === 'github' ? faGithub : faFolder}
                      class="text-subtle shrink-0 opacity-50"
                      size={12}
                    />
                  {/if}
                  <span class="text-sm text-foreground truncate">{repo.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </Select.Content>
  </Select.Root>
</div>

{#if $remoteWorkspacesEnabled$}
  <AddRemoteSetupModal
    isOpen={showAddRemoteModal}
    onclose={() => (showAddRemoteModal = false)}
    onsave={handleSaveRemoteSetup}
  />
{/if}

<!--
  BE-driven folder picker. One modal serves all three folder-selection flows
  (repo folder, new-repo parent, github clone parent); the picked path is
  routed back to the right destination via `folderPickerPurpose`.
-->
<DirectoryPickerModal
  open={folderPickerOpen}
  title={folderPickerTitle}
  initialPath={folderPickerInitialPath}
  selectLabel="Select folder"
  onSelect={handleFolderPickerSelect}
  onClose={handleFolderPickerClose}
/>
