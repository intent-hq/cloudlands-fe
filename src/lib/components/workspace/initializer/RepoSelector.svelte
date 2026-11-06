<script lang="ts">
  /* eslint-disable max-lines */
  import { selectIsHostMember } from '$store/renderer/slices/host-execution/host-execution-selectors';
  import {
    selectCanAdministerHost,
    selectPrincipalActionContext,
  } from '$store/renderer/slices/principal/principal-selectors';
  import HostExecutionNotice from '$features/providers/HostExecutionNotice.svelte';
  const hostMember$ = selectIsHostMember();
  const canAdministerHost$ = selectCanAdministerHost();
  const admission$ = selectPrincipalActionContext();
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Header from '$lib/components/ui/Header.svelte';
  import RepositoryPickerIcon from './RepositoryPickerIcon.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import { createLogger } from '$lib/utils/client-logger';
  import { invoke } from '$lib/electron-bridge';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import * as Menu from '$lib/components/ui/menu';
  import {
    dismissWorkspaceInitializerRecentRepo,
    setWorkspaceInitializerDefaultParentPath,
    setWorkspaceInitializerRemoteSetups,
    workspaceInitializerDirectoryStatusReleased,
    workspaceInitializerDirectoryStatusRequested,
    workspaceInitializerRecentReposRefreshReleased,
    workspaceInitializerRecentReposRefreshRequested,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import {
    selectWorkspaceInitializerDefaultParentPath,
    selectWorkspaceInitializerDirectoryStatusCheck,
    selectWorkspaceInitializerDismissedRecentRepoKeys,
    selectWorkspaceInitializerHydrated,
    selectWorkspaceInitializerRecentRepoRefresh,
    selectWorkspaceInitializerRecentRepos,
    selectWorkspaceInitializerRemoteSetups,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { recentRepoKey } from '$store/renderer/slices/workspace-initializer/utils/recent-repo-key';
  import type {
    WorkspaceInitializerRecentRepo,
    WorkspaceInitializerRemoteSetup,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import {
    faFolder,
    faXmark,
    faPlus,
    faChevronDown,
    faArrowLeft,
    faArrowUpRightFromSquare,
  } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { handleLink } from '$features/navigation/link-handler';
  import ServerIcon from '$lib/components/icons/ServerIcon.svelte';
  import AddRemoteSetupModal from './AddRemoteSetupModal.svelte';
  import GitLabProjectPicker from './GitLabProjectPicker.svelte';
  import RepositoryPickerList from './RepositoryPickerList.svelte';
  import RepositoryPickerRow from './RepositoryPickerRow.svelte';
  import type { GitLabProjectPickerProps } from './gitlab-picker-types';
  import DirectoryPickerModal from '$features/onboarding/messages/DirectoryPickerModal.svelte';
  import { pickDirectory } from '$lib/directory-picker-service';
  import { selectIsFeatureEnabled } from '$store/renderer/slices/feature-codes/feature-codes-selectors';
  import GitHubAuthBanner from '$lib/components/GitHubAuthBanner.svelte';
  import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { classifyPlainFolderTarget, newProjectDefaultParent } from './plain-folder-create';
  import InitializeGitToggle from './InitializeGitToggle.svelte';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import {
    selectCloneSourceVisible,
    selectForgeConnectionState,
    selectPlainFolderCreationAvailable,
  } from '$store/renderer/slices/workspace-initializer/plain-folder-selectors';
  import { resolveRepositoryRowLabelKind } from './repository-row-label';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import {
    loadGithubRepos,
    type GithubRepoItem,
  } from '$store/renderer/slices/github-repos/github-repos-slice';
  import {
    selectGithubRepos,
    selectGithubReposError,
    selectGithubReposLoaded,
    selectGithubReposLoading,
  } from '$store/renderer/slices/github-repos/github-repos-selectors';
  import { searchGithubRepos } from '$store/renderer/slices/github-repo-search/github-repo-search-slice';
  import {
    selectGithubRepoSearchLastQuery,
    selectGithubRepoSearchLoading,
    selectGithubRepoSearchResults,
  } from '$store/renderer/slices/github-repo-search/github-repo-search-selectors';
  import { store as appStore } from '$store/renderer/store';
  import {
    isolationNoun,
    resolveEffectiveIsolationMode,
    type IsolationMode,
  } from './isolation-mode';
  import {
    getGitHubPickOwner,
    getRecentRepoLabel,
    getRecentRepoIdentity,
    getRecentRepoTooltip,
    getRepoFolderName,
    matchesRecentRepoSearch,
  } from './recent-repo-display';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { workspacePickerStyles } from './workspace-picker-styles';
  import { canPlaceBeside } from '$lib/components/ui/overlay-positioning';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';

  const logger = createLogger('RepoSelector');
  const dialogPortalTarget = useDialogPortalTarget();
  const isMobile = new IsMobile();
  let formTriggerElement = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let formMenuBelow = $state(false);

  // Effective isolated-checkout mode (worktree vs CoW clone) for creation copy.
  // Re-resolves when workspace items hydrate (cowSupported is read off them).
  const workspaceItemsForIsolation$ = selectWorkspaceItems();
  let isolationMode = $state<IsolationMode>('worktree');
  $effect(() => {
    void resolveEffectiveIsolationMode($workspaceItemsForIsolation$).then(
      (mode) => (isolationMode = mode),
    );
  });
  const isolationLabel = $derived(isolationNoun(isolationMode));
  const mountedDispatch = appStore.dispatch;
  const initializerHydrated$ = selectWorkspaceInitializerHydrated();
  const dismissedRecentRepoKeys$ = selectWorkspaceInitializerDismissedRecentRepoKeys();
  const defaultParentPath$ = selectWorkspaceInitializerDefaultParentPath();
  const workspaceInitializerRecentRepos$ = selectWorkspaceInitializerRecentRepos();
  const workspaceInitializerRemoteSetups$ = selectWorkspaceInitializerRemoteSetups();
  const recentRepoRefreshId = crypto.randomUUID();
  const directoryStatusCheckId = crypto.randomUUID();
  const recentRepoRefresh$ = selectWorkspaceInitializerRecentRepoRefresh(recentRepoRefreshId);
  const directoryStatusCheck$ =
    selectWorkspaceInitializerDirectoryStatusCheck(directoryStatusCheckId);
  let recentRepoRequestId: string | undefined;
  let directoryStatusRequestId: string | undefined;

  // GitHub autocomplete sources for the "Clone" tab: the user's own
  // repos (client-side filtered) plus a debounced global search.
  const isGithubAuthenticated$ = selectGitHubAuthIsAuthenticated();
  const canBrowseGithub = $derived(
    $hostMember$ || ($canAdministerHost$ && $isGithubAuthenticated$),
  );
  const githubRepos$ = selectGithubRepos();
  const githubReposLoading$ = selectGithubReposLoading();
  const githubReposLoaded$ = selectGithubReposLoaded();
  const githubReposError$ = selectGithubReposError();
  const githubSearchResults$ = selectGithubRepoSearchResults();
  const githubSearchLoading$ = selectGithubRepoSearchLoading();
  const githubSearchLastQuery$ = selectGithubRepoSearchLastQuery();

  /** Join parent path + folder name using the platform's native separator */
  function joinNativePath(parent: string, name: string): string {
    // If the parent path contains backslashes (Windows), use backslash
    const sep = parent.includes('\\') ? '\\' : '/';
    // Remove trailing separator from parent if present
    const cleanParent = parent.replace(/[/\\]$/, '');
    return `${cleanParent}${sep}${name}`;
  }

  type RemoteSetup = WorkspaceInitializerRemoteSetup;

  /** The git switch (Labs plain folders) shown in the folder tabs. */
  export interface RepoSelectorGitChoice {
    /** The git choice: initialize a folder without git, or not. */
    checked: boolean;
    /** The current Existing folder pick, or null when nothing local is picked. */
    folder?: 'git-repo' | 'folder' | null;
    /** For a picked git repo the switch shows its isolation: its own worktree. */
    worktree?: boolean;
    disabled?: boolean;
    /** `tab` is the folder tab the choice was flipped in. */
    onCheckedChange: (checked: boolean, tab: 'local' | 'new') => void;
  }

  export interface RepoChangeDetail {
    path: string;
    type: 'local' | 'github' | 'remote';
    githubUrl?: string;
    isNewRepo?: boolean;
    isValidPath?: boolean;
    scope?: string; // Relative path from git root for scoped subdirectories
    remoteSetup?: RemoteSetup;
    /** Plain-folder pick (Labs): an existing non-git folder, or a new folder to create. */
    plainFolder?: 'existing' | 'new';
  }

  interface Props {
    variant?: 'default' | 'ghost' | 'underline' | 'secondary';
    value?: string;
    onchange?: (event: CustomEvent<RepoChangeDetail>) => void;
    triggerClass?: string;
    /** Form picker label; becomes "Folder" when plain folders (Labs) apply and no git repository is listed. */
    rowLabel?: string;
    displayValue?: string;
    /** Dimmed suffix rendered after the repo name, e.g. "owner/repo" */
    triggerSuffix?: string;
    triggerValueClass?: string;
    triggerContentClass?: string;
    emptyLabel?: string;
    showEmptyIcon?: boolean;
    showTriggerChevron?: boolean;
    triggerChevronClass?: string;
    triggerIcon?: any;
    triggerAriaLabel?: string;
    onClear?: () => void;
    /** Qualified GitLab state supplied by the checkout owner. */
    gitlab?: GitLabProjectPickerProps;
    gitlabSelected?: boolean;
    /**
     * "Initialize as git repository" is off (Labs): a non-git folder is picked
     * as a plain folder instead of offering git initialization, and the new
     * tab creates a plain folder. Git repositories and their subfolders still
     * pick as git.
     */
    plainFolderMode?: boolean;
    /** The current selection is a plain folder (Labs); drives the form row label. */
    plainFolderSelected?: boolean;
    /**
     * The git choice (Labs), rendered inside the "Existing folder" and "New"
     * tabs and never on Clone. `onCheckedChange` names the tab it was flipped in.
     */
    gitChoice?: RepoSelectorGitChoice;
  }

  let {
    variant = 'ghost',
    value = '',
    onchange,
    triggerClass,
    rowLabel,
    displayValue,
    triggerSuffix,
    triggerValueClass = 'text-subtle',
    triggerContentClass = 'gap-0.75',
    emptyLabel = m.workspace_repoSelector_selectRepository_label(),
    showEmptyIcon = false,
    showTriggerChevron = false,
    triggerChevronClass = 'ml-2 opacity-50',
    triggerIcon,
    triggerAriaLabel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onClear,
    gitlab,
    gitlabSelected = false,
    plainFolderMode = false,
    plainFolderSelected = false,
    gitChoice,
  }: Props = $props();

  function onchangeWithTracking(detail: RepoChangeDetail) {
    // Any committed selection supersedes a recent entry still being probed.
    recentProbeToken++;
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

  /** Open the dropdown on a folder tab (a pick made for the other git choice was dropped). */
  export function openOnLocalTab(tab: 'local' | 'new' = 'local') {
    if (selectedValue && !value) {
      selectedValue = '';
      inputValue = '';
      selectedRepoType = 'local';
      confirmedGithubUrl = '';
    }
    openOnTab = tab;
    if (rowLabel) formStep = 'add';
    isOpen = true;
  }

  // State
  // svelte-ignore state_referenced_locally - intentional initial capture; prop only seeds the selection
  let selectedValue = $state(value);
  // svelte-ignore state_referenced_locally - intentional initial capture; prop only seeds the input
  let inputValue = $state(value);
  let searchTerm = $state(''); // Separate search term that starts empty
  let inputElement = $state<Input>();
  /** The GitHub tab's owner/repo input, so the window-level Enter interceptor
   *  can target it exactly rather than matching any focused text field. */
  let githubInputElement = $state<HTMLInputElement | null>(null);
  let isOpen = $state(false); // Track dropdown open state
  let openOnTab: 'local' | 'new' | null = null; // One-shot tab for the next open
  let isDialogOpen = $state(false); // Track if a native dialog is open (prevents dropdown from closing)
  const isLoading = $derived(
    !$recentRepoRefresh$ ||
      ($recentRepoRefresh$.admission === $admission$ && $recentRepoRefresh$.status === 'pending'),
  );
  let isNewRepo = $state(false); // Track if this is a new repo creation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let isValidPath = $state(false); // Track if the input is a valid path
  // svelte-ignore state_referenced_locally - intentional initial capture; prop only seeds the tab
  let selectedRepoType = $state<'local' | 'github' | 'new'>(repoTypeForValue(value)); // Track the type/tab of the selected repo
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
  const recentRepos = $derived.by(() => {
    const saved = $workspaceInitializerRecentRepos$;
    const sourceView = $recentRepoRefresh$;
    if (
      !sourceView ||
      sourceView.admission !== $admission$ ||
      appStore.dispatch !== mountedDispatch
    )
      return saved;
    const merged = new Map<string, WorkspaceInitializerRecentRepo>();
    if (rowLabel) {
      // The admitted source already includes saved entries in usage order.
      // Keep that order and show every known repository in the form picker.
      for (const repo of [...sourceView.repos, ...saved]) {
        const key = recentRepoKey(repo);
        if (!merged.has(key)) merged.set(key, repo);
      }
    } else {
      for (const repo of saved) merged.set(recentRepoKey(repo), repo);
      for (const repo of sourceView.repos) merged.set(recentRepoKey(repo), repo);
    }
    const visible = [...merged.values()].filter(
      (repo) => !$dismissedRecentRepoKeys$[recentRepoKey(repo)],
    );
    return rowLabel ? visible : visible.slice(0, 9);
  });

  async function handleDismissRecentRepo(event: MouseEvent, repo: WorkspaceInitializerRecentRepo) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget as HTMLButtonElement;
    const row = button.closest('[data-recent-repo-row]');
    const nextRow = row?.nextElementSibling ?? row?.previousElementSibling;
    const dialog = button.closest('[role="dialog"]');
    const nextFocus =
      nextRow?.querySelector<HTMLButtonElement>('[data-remove-recent-repo]') ??
      dialog?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      dialog?.querySelector<HTMLElement>('[data-repo-search]');
    appStore.dispatch(dismissWorkspaceInitializerRecentRepo({ path: repo.path, type: repo.type }));
    await tick();
    nextFocus?.focus();
  }

  // Track if the current input is a recognized GitHub URL
  let detectedGitHub = $state<{ owner: string; repo: string; url: string } | null>(null);

  // Track if the current input is a recognized local path
  let detectedLocalPath = $state<string | null>(null);

  // Debounce timer for path/URL detection
  let detectionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // TABBED INTERFACE STATE
  // ═══════════════════════════════════════════════════════════════════════════
  type TabId = 'local' | 'github' | 'gitlab' | 'new' | 'remote';
  let activeTab = $state<TabId>('github');
  let preferredForge = $state<'github' | 'gitlab'>('github');
  const authenticatedForges = $derived([
    ...($isGithubAuthenticated$
      ? [{ id: 'github' as const, label: 'github.com/', icon: faGithub }]
      : []),
    ...(gitlab?.authenticated && gitlab.instanceBaseUrl
      ? [
          {
            id: 'gitlab' as const,
            label: `${gitlab.instanceBaseUrl.replace(/^https:\/\//, '').replace(/\/$/, '')}/`,
            icon: faGitlab,
          },
        ]
      : []),
  ]);
  const selectedForge = $derived(
    authenticatedForges.find((forge) => forge.id === preferredForge) ?? authenticatedForges[0],
  );
  const repositoryTab = $derived(selectedForge?.id ?? 'github');
  const repositoryTabActive = $derived(activeTab === 'github' || activeTab === 'gitlab');
  const repositoryTabLabel = $derived(selectedForge?.label ?? m.workspace_repoSelector_clone_tab());

  // Clone is hidden only once forge status is known and nothing is connected;
  // pending or failed reads keep it (same fail-safe as the git-toggle default).
  // A forge the checkout owner reports as authenticated, or a host member's
  // host-side GitHub access, always keeps it.
  const cloneSourceVisible$ = selectCloneSourceVisible();
  const cloneTabVisible = $derived(
    $cloneSourceVisible$ || authenticatedForges.length > 0 || $hostMember$,
  );
  /** The tab to open in place of `tab` when Clone is hidden. */
  function visibleTab(tab: TabId): TabId {
    return !cloneTabVisible && (tab === 'github' || tab === 'gitlab') ? 'local' : tab;
  }
  function handleConnectToClone() {
    isOpen = false;
    void navigateToSettings({ tab: 'connections', hash: 'integrations' }).catch((error: unknown) =>
      logger.error('Failed to open connection settings', error),
    );
  }
  function selectForge(forge: 'github' | 'gitlab') {
    if (!authenticatedForges.some((choice) => choice.id === forge)) return;
    preferredForge = forge;
    activeTab = forge;
  }

  // Report visibility changes, not page/query revisions. The consumer owns the
  // draft's lease; loading a scoped result must not reopen and recapture it.
  $effect(() => {
    if (!isOpen || activeTab !== 'gitlab') return;
    return untrack(() => {
      const opened = gitlab;
      if (!opened) return;
      opened.onOpenChange?.(true, opened.scopeKey);
      return () =>
        untrack(() => {
          const current = gitlab ?? opened;
          current.onOpenChange?.(false, current.scopeKey);
        });
    });
  });

  $effect(() => {
    if (isOpen && activeTab === 'gitlab' && !gitlab) isOpen = false;
  });

  // Authentication may withdraw a choice while the picker is open. Reconcile
  // presentation only; the existing checkout owner still retires its lease.
  $effect(() => {
    if (repositoryTabActive) activeTab = visibleTab(repositoryTab);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FOLDER-PICKER STATE
  // ═══════════════════════════════════════════════════════════════════════════
  // One picker is open at a time. Local Electron uses the native dialog; remote
  // and web flows use DirectoryPickerModal. `folderPickerPurpose` routes the
  // picked path back to the right destination.
  type FolderPickerPurpose = 'select-repo' | 'new-repo-parent';
  let folderPickerOpen = $state(false);
  let folderPickerPurpose = $state<FolderPickerPurpose>('select-repo');
  let folderPickerTitle = $state<string>(m.workspace_repoSelector_selectFolder_title());
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

  // Confirmed GitHub URL - only set when user explicitly confirms a GitHub repo
  // This is separate from inputValue which changes as user types
  let confirmedGithubUrl = $state('');

  // Load default parent path from Redux; persistence is handled by the saga.
  function getDefaultParentPath(): string {
    return newProjectDefaultParent($defaultParentPath$, plainFolderMode);
  }

  // Follow the mode's built-in fallback parent until the user picks one.
  $effect(() => {
    const plain = plainFolderMode;
    const saved = $defaultParentPath$;
    untrack(() => {
      if (newRepoParentPath === newProjectDefaultParent(saved, !plain))
        newRepoParentPath = newProjectDefaultParent(saved, plain);
    });
  });

  function saveDefaultParentPath(path: string) {
    appStore.dispatch(setWorkspaceInitializerDefaultParentPath(path));
  }

  // Validate a project/folder name: reject path separators, traversal, null bytes, unsafe chars
  function getProjectNameError(name: string): string | undefined {
    if (!name || name.trim().length === 0) return undefined; // empty is handled elsewhere
    const t = name.trim();
    if (t.includes('/') || t.includes('\\')) return m.workspace_repoSelector_nameSeparators_error();
    if (t === '..' || t === '.' || /^\.+$/.test(t))
      return m.workspace_repoSelector_nameDots_error();
    if (t.includes('\0')) return m.workspace_repoSelector_nameNull_error();
    if (/[<>:"|?*]/.test(t)) return m.workspace_repoSelector_nameInvalid_error();
    if (t.length > 255) return m.workspace_repoSelector_nameTooLong_error();
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
  const newRepoPathStatus = $derived(
    $directoryStatusCheck$?.admission === $admission$ &&
      $directoryStatusCheck$.path === newRepoFullPath &&
      $directoryStatusCheck$.status === 'ready'
      ? $directoryStatusCheck$.result
      : null,
  );
  // Plain-folder kind for the new tab's target: null keeps today's git flow
  // (an existing repository, or a folder inside one).
  let newRepoParentGitProbe = $state<{ parent: string; inRepo: boolean } | null>(null);
  // The toggle is off, so an unavailable status keeps the plain-folder flow
  // and the daemon decides (it rejects a folder inside a git repository). The
  // target may already exist, so it counts as existing: the in-place, no-undo
  // confirmation is never skipped for a folder that might hold user files.
  const newRepoPathStatusUnavailable = $derived(
    $directoryStatusCheck$?.admission === $admission$ &&
      $directoryStatusCheck$.path === newRepoFullPath &&
      ($directoryStatusCheck$.status === 'failed' ||
        $directoryStatusCheck$.status === 'unsupported'),
  );
  const newRepoPlainFolderKind = $derived(
    plainFolderMode
      ? newRepoPathStatusUnavailable
        ? 'existing'
        : classifyPlainFolderTarget(
            newRepoPathStatus,
            newRepoParentGitProbe?.parent === newRepoParentPath
              ? newRepoParentGitProbe.inRepo
              : null,
          )
      : null,
  );

  // A missing target reports no repository; probe its parent so a new folder
  // inside a git repository stays on the git flow (plain-folder mode only).
  $effect(() => {
    const parent = newRepoParentPath;
    if (!plainFolderMode || !parent) return;
    if (newRepoParentGitProbe?.parent === parent) return;
    let cancelled = false;
    void invoke<any>('file:getDirectoryStatus', { path: parent })
      .then(
        (result) =>
          !!(result?.success && (result.data?.isGitRepo || result.data?.isSubdirectoryOfGitRepo)),
      )
      .catch(() => false)
      .then((inRepo) => {
        if (!cancelled) newRepoParentGitProbe = { parent, inRepo };
      });
    return () => {
      cancelled = true;
    };
  });
  const isCheckingNewRepoPath = $derived(
    $directoryStatusCheck$?.admission === $admission$ &&
      $directoryStatusCheck$.path === newRepoFullPath &&
      $directoryStatusCheck$.status === 'pending',
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // NON-GIT FOLDER HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  // When user selects a folder that exists but isn't a git repo, we need to
  // give them explicit options rather than silently proceeding
  let showNonGitFolderPrompt = $state(false);
  let nonGitFolderPath = $state('');
  // Bumped by every selection so a late recent-entry probe never overrides it.
  let recentProbeToken = 0;

  // Filter repos based on search term and active tab type
  const filteredRepos = $derived(() => {
    // Discovery choice does not partition saved repositories. Local copy keeps its own list.
    const typeFiltered = recentRepos.filter((repo) =>
      activeTab === 'local' ? repo.type === 'local' : repositoryTabActive && repo.type === 'github',
    );

    // Each forge keeps its own query; local/GitHub retain the existing search behavior.
    const query = activeTab === 'gitlab' ? (gitlab?.query ?? '') : searchTerm;
    if (query === '') {
      return typeFiltered;
    }
    return typeFiltered.filter((repo) => matchesRecentRepoSearch(repo, query));
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FORM PICKER (rowLabel): one recency-ordered list, plus an Add step
  // ═══════════════════════════════════════════════════════════════════════════
  // The default view lists every known repository once, in saved recency order,
  // across its actual source identity. Linking, local copy, new and remote
  // flows live behind "Add repository" and reuse the tabbed forms below.
  let formStep = $state<'browse' | 'add'>('browse');
  let formQuery = $state('');
  let formSearchElement = $state<HTMLInputElement | null>(null);
  let formListElement = $state<HTMLDivElement | undefined>();
  const formRepositoryChoices = $derived.by(() => {
    if (recentRepos.some(isCurrentRepo)) return recentRepos;
    let current: WorkspaceInitializerRecentRepo | undefined;
    if (gitlabSelected && gitlab?.instanceBaseUrl && gitlab.selectedProjectPath) {
      const projectPath = gitlab.selectedProjectPath;
      const url = `${gitlab.instanceBaseUrl}/${projectPath}`;
      current = {
        path: url,
        type: 'github',
        githubUrl: url,
        name: projectPath.split('/').at(-1)!,
        owner: projectPath.split('/').slice(0, -1).join('/'),
        repositoryIdentity: {
          provider: 'gitlab',
          instanceBaseUrl: gitlab.instanceBaseUrl,
          projectPath,
        },
      };
    } else if (!gitlabSelected && selectedValue) {
      const github =
        selectedRepoType === 'github' ? parseGitHubUrl(confirmedGithubUrl || selectedValue) : null;
      current = github
        ? {
            path: `${github.owner}/${github.repo}`,
            type: 'github',
            githubUrl: `https://github.com/${github.owner}/${github.repo}`,
            name: github.repo,
            owner: github.owner,
          }
        : {
            path: selectedValue,
            type: 'local',
            name: getRepoFolderName(selectedValue),
            ...(plainFolderSelected ? { plainFolder: true } : {}),
          };
    }
    return current ? [current, ...recentRepos] : recentRepos;
  });
  // The form row label follows what the list holds (plain folders, Labs):
  // "Codebase" with any git repository listed, otherwise "Folder" without a
  // forge or with a plain folder listed.
  const plainFolderCreationAvailable$ = selectPlainFolderCreationAvailable();
  const forgeConnectionState$ = selectForgeConnectionState();
  const isPlainFolderEntry = (repo: WorkspaceInitializerRecentRepo) =>
    repo.type === 'local' && repo.plainFolder === true;
  const formRowLabel = $derived.by(() => {
    if (!rowLabel) return undefined;
    const kind = resolveRepositoryRowLabelKind({
      plainFoldersOffered: $plainFolderCreationAvailable$,
      forgeState:
        authenticatedForges.length > 0 || $hostMember$ ? 'connected' : $forgeConnectionState$,
      hasGitRepositoryEntry: formRepositoryChoices.some((repo) => !isPlainFolderEntry(repo)),
      hasPlainFolderEntry: formRepositoryChoices.some(isPlainFolderEntry),
    });
    return kind === 'folder' ? m.workspace_compactInitializer_folder_label() : rowLabel;
  });
  const formRepos = $derived(
    formQuery.trim() === ''
      ? formRepositoryChoices
      : formRepositoryChoices.filter((repo) => matchesRecentRepoSearch(repo, formQuery.trim())),
  );

  function isFormRepoDisabled(repo: WorkspaceInitializerRecentRepo): boolean {
    const identity = getRecentRepoIdentity(repo, gitlab?.instanceBaseUrl);
    return (
      repo.type !== 'local' &&
      identity?.provider === 'gitlab' &&
      (!gitlab?.authenticated ||
        identity.instanceBaseUrl !== gitlab.instanceBaseUrl ||
        (!gitlab.scopeKey && !gitlab.onSelectRecent) ||
        gitlab.page.status === 'unavailable')
    );
  }

  /** The row matching the current selection, by source identity. */
  function isCurrentRepo(repo: WorkspaceInitializerRecentRepo): boolean {
    const identity = getRecentRepoIdentity(repo, gitlab?.instanceBaseUrl);
    if (repo.type !== 'local' && identity?.provider === 'gitlab') {
      return (
        gitlabSelected &&
        gitlab?.instanceBaseUrl === identity.instanceBaseUrl &&
        gitlab.selectedProjectPath === identity.projectPath
      );
    }
    if (gitlabSelected || !selectedValue) return false;
    if (repo.type === 'github') {
      return (
        selectedRepoType === 'github' &&
        isSameGitHubRepo(repo.githubUrl || repo.path, confirmedGithubUrl || selectedValue)
      );
    }
    return selectedRepoType !== 'github' && repo.path === selectedValue;
  }

  function formRowButtons(): HTMLButtonElement[] {
    return [...(formListElement?.querySelectorAll<HTMLElement>('[data-recent-repo-row]') ?? [])]
      .map((row) => row.querySelector<HTMLButtonElement>('button:not([data-remove-recent-repo])'))
      .filter((button): button is HTMLButtonElement => !!button && !button.disabled);
  }

  function handleFormSearchKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown') {
      const first = formRowButtons()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const first = formRepos.find((repo) => !isFormRepoDisabled(repo));
      if (first) handleSelectRepo(first);
    }
  }

  function handleFormListKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = formRowButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    if (event.key === 'ArrowUp' && index === 0) formSearchElement?.focus();
    else {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[Math.min(buttons.length - 1, index + step)]?.focus();
    }
  }

  function openAddStep() {
    const query = formQuery.trim();
    if (query && cloneTabVisible) {
      const github = parseGitHubUrl(normalizeGitHubInput(query));
      if (github) {
        preferredForge = 'github';
        activeTab = 'github';
        handleGitHubInputChange(`${github.owner}/${github.repo}`);
      } else if (activeTab === 'github') {
        handleGitHubInputChange(query);
      }
    }
    formStep = 'add';
    void tick().then(() => {
      if (activeTab === 'github') githubInputElement?.focus();
    });
  }

  function closeAddStep() {
    formStep = 'browse';
    void tick().then(() => formSearchElement?.focus());
  }

  function selectRepositoryTab(value: string) {
    const next = value === 'repository' ? repositoryTab : (value as TabId);
    if (rowLabel && next === 'local' && parseGitHubUrl(inputValue)) {
      handleInputChange('');
    }
    activeTab = next;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GITHUB AUTOCOMPLETE ("Clone" tab)
  // ═══════════════════════════════════════════════════════════════════════════
  // Mirrors the onboarding GitHubRepoTab: the user's own repos filtered
  // client-side by the typed text, followed by deduped global search results.

  /** Trimmed owner/repo text currently in the GitHub input. */
  const githubQuery = $derived(githubUrlInput.trim());

  const ownedGithubSuggestions = $derived.by<GithubRepoItem[]>(() => {
    const all = $githubRepos$;
    if (!all.length) return [];
    const q = githubQuery.toLowerCase();
    return q ? all.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(q)) : all;
  });

  const discoverGithubSuggestions = $derived.by<GithubRepoItem[]>(() => {
    if ($githubSearchLastQuery$ !== githubQuery) return [];
    const results = $githubSearchResults$;
    if (!results.length) return [];
    const ownedIds = new Set($githubRepos$.map((r) => r.id));
    return results.filter((r) => !ownedIds.has(r.id));
  });

  /** Single combined suggestion list rendered under the GitHub input. */
  const githubSuggestions = $derived.by<GithubRepoItem[]>(() =>
    activeTab === 'github' && canBrowseGithub
      ? [...ownedGithubSuggestions, ...discoverGithubSuggestions]
      : [],
  );

  /** True when the detected repo already appears in the suggestion list, so
   *  the detected-repo Select row would duplicate a suggestion. */
  const detectedGitHubIsDuplicate = $derived.by(() => {
    const detected = detectedGitHub;
    if (!detected) return false;
    const owner = detected.owner.toLowerCase();
    const repo = detected.repo.toLowerCase();
    return githubSuggestions.some(
      (r) => r.owner.toLowerCase() === owner && r.name.toLowerCase() === repo,
    );
  });

  /** Keyboard highlight within the suggestion list (-1 = nothing highlighted). */
  let suggestionIndex = $state(-1);

  $effect(() => {
    githubSuggestions; // track
    suggestionIndex = -1;
  });

  /**
   * On-demand repo load: only while the GitHub tab is showing and the user is
   * authenticated. The guards skip the fetch when a load is in flight, cached,
   * or previously errored, preventing duplicate or runaway fetches.
   */
  $effect(() => {
    if (
      activeTab === 'github' &&
      canBrowseGithub &&
      !$githubReposLoaded$ &&
      !$githubReposLoading$ &&
      !$githubReposError$
    ) {
      appStore.dispatch(loadGithubRepos());
    }
  });

  /** User-initiated retry. The on-demand effect above skips loads while an
   *  error is present, so this explicit dispatch is what clears it and
   *  re-fetches (mirrors GitHubRepoTab's "Try again"). */
  function retryGithubRepos() {
    appStore.dispatch(loadGithubRepos());
  }

  /** Confirm a suggestion as a path-less GitHub pick. */
  function handleSelectGithubSuggestion(repo: GithubRepoItem) {
    githubUrlInput = `${repo.owner}/${repo.name}`;
    detectedGitHub = {
      owner: repo.owner,
      repo: repo.name,
      url: `https://github.com/${repo.owner}/${repo.name}`,
    };
    handleConfirmGitHubPick();
  }

  /** Keep suggestion navigation and acceptance owned by the focused input. */
  function handleGitHubInputKeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmGitHubFromKeyboard();
      return;
    }
    if (e.key === 'ArrowDown') {
      if (!githubSuggestions.length) return;
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, githubSuggestions.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!githubSuggestions.length) return;
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, -1);
    }
  }

  /** Enter on the GitHub tab: take the highlighted suggestion when there is
   *  one, otherwise fall back to confirming the typed owner/repo. */
  function confirmGitHubFromKeyboard() {
    const highlighted = suggestionIndex >= 0 ? githubSuggestions[suggestionIndex] : undefined;
    if (highlighted) {
      handleSelectGithubSuggestion(highlighted);
    } else {
      handleConfirmGitHubPick();
    }
  }

  // Highlighted index for keyboard navigation (-1 means nothing highlighted)
  let highlightedIndex = $state(-1);

  // Reset highlighted index when filtered repos change
  $effect(() => {
    // Access filteredRepos to create dependency
    filteredRepos();
    highlightedIndex = -1;
  });

  /** Classify a value supplied via the `value` prop: an owner/repo shorthand
   *  or GitHub URL is a GitHub pick; anything else is a local path. */
  function repoTypeForValue(val: string): 'local' | 'github' {
    return val && parseGitHubUrl(val) ? 'github' : 'local';
  }

  /** Whether two GitHub values (URL or shorthand) name the same owner/repo. */
  function isSameGitHubRepo(a: string, b: string): boolean {
    const left = parseGitHubUrl(a);
    const right = parseGitHubUrl(b);
    return (
      !!left &&
      !!right &&
      left.owner.toLowerCase() === right.owner.toLowerCase() &&
      left.repo.toLowerCase() === right.repo.toLowerCase()
    );
  }

  // Update internal state when value prop changes; re-derive the repo type so
  // the dropdown opens on the tab matching the restored selection. A confirmed
  // GitHub URL only survives when the new value still names the same repo.
  $effect(() => {
    if (value && value !== selectedValue) {
      selectedValue = value;
      inputValue = value;
      selectedRepoType = repoTypeForValue(value);
      if (confirmedGithubUrl && !isSameGitHubRepo(confirmedGithubUrl, value)) {
        confirmedGithubUrl = '';
      }
    }
  });

  // Handle dropdown open - set correct tab when opening
  function handleDropdownOpen() {
    formMenuBelow = !canPlaceBeside(formTriggerElement, 360);
    // Clear search term when opening so all repos show
    searchTerm = '';
    if (rowLabel && formStep === 'browse') {
      formQuery = '';
      requestAnimationFrame(() => {
        if (isOpen && formStep === 'browse') formSearchElement?.focus();
      });
      // The Add step keeps its last tab; seed it from the current selection below.
    } else if (rowLabel) {
      if (openOnTab) {
        activeTab = openOnTab;
        openOnTab = null;
      }
      return;
    }

    // Set the correct tab based on the selected repo type
    const currentValue = selectedValue || value;
    logger.info('Dropdown opened', {
      currentValue,
      selectedRepoType,
    });

    if (openOnTab) {
      activeTab = openOnTab;
      openOnTab = null;
    } else if (gitlabSelected && authenticatedForges.some((forge) => forge.id === 'gitlab')) {
      preferredForge = 'gitlab';
      activeTab = 'gitlab';
    } else if (currentValue) {
      // Use the stored repo type to determine the tab
      activeTab = visibleTab(selectedRepoType === 'github' ? repositoryTab : selectedRepoType);

      // If GitHub, also populate the input from inputValue (which stores the GitHub URL)
      if (selectedRepoType === 'github' && cloneTabVisible && inputValue) {
        const githubInfo = parseGitHubUrl(inputValue);
        if (githubInfo) {
          githubUrlInput = `${githubInfo.owner}/${githubInfo.repo}`;
          // Pass an empty search term: the open-time pre-fill must not filter
          // the Recent list — only actual typing should (see handleGitHubInputChange).
          handleInputChange(`https://github.com/${githubInfo.owner}/${githubInfo.repo}`, '');
        }
      }
    } else {
      // No value selected: default to the "Clone" tab ("Existing folder" when hidden)
      activeTab = visibleTab(repositoryTab);
    }

    // Focus input - always autofocus for better UX
    // Use requestAnimationFrame for better timing
    requestAnimationFrame(() => {
      if (rowLabel) return;
      if (isOpen && activeTab !== 'gitlab' && inputElement) {
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
    } else if (
      !currentlyOpen &&
      previousOpenState &&
      rowLabel &&
      !isDialogOpen &&
      !folderPickerOpen
    ) {
      // A folder dialog reopens the Add step; any other close returns to the list.
      formStep = 'browse';
    }
    previousOpenState = currentlyOpen;
  });

  // Escape layer: while the dropdown is open it is the topmost overlay, so
  // Escape closes only the dropdown (not e.g. a modal hosting this selector)
  $effect(() => {
    if (!isOpen) return;
    return pushEscapeLayer((event) => {
      if (!event.isComposing) isOpen = false;
    });
  });

  // Initialize parent path when switching to new repo tab
  $effect(() => {
    if (activeTab === 'new' && !newRepoParentPath) {
      newRepoParentPath = getDefaultParentPath();
    }
  });

  // Check directory status when new repo path changes
  $effect(() => {
    const path = newRepoFullPath;
    const admission = $admission$;
    if (!path || !newRepoParentPath || !newRepoProjectName || !admission) return;
    directoryStatusRequestId = crypto.randomUUID();
    appStore.dispatch(
      workspaceInitializerDirectoryStatusRequested(
        directoryStatusCheckId,
        directoryStatusRequestId,
        admission,
        path,
      ),
    );
  });

  // Helper to detect the correct tab for a given value

  $effect(() => {
    if ($canAdministerHost$) appStore.dispatch(initializeGitHubAuth());
  });
  $effect(() => {
    const admission = $admission$;
    const gitlabInstance = gitlab?.instanceBaseUrl;
    // Hydration changes trigger a second read so provisional source suggestions
    // can merge with saved history before publication.
    void $initializerHydrated$;
    if (!admission || appStore.dispatch !== mountedDispatch) return;
    recentRepoRequestId = crypto.randomUUID();
    appStore.dispatch(
      workspaceInitializerRecentReposRefreshRequested(
        recentRepoRefreshId,
        recentRepoRequestId,
        admission,
        gitlabInstance,
      ),
    );
  });

  onDestroy(() => {
    if (recentRepoRequestId) {
      mountedDispatch(
        workspaceInitializerRecentReposRefreshReleased(recentRepoRefreshId, recentRepoRequestId),
      );
    }
    if (directoryStatusRequestId) {
      mountedDispatch(
        workspaceInitializerDirectoryStatusReleased(
          directoryStatusCheckId,
          directoryStatusRequestId,
        ),
      );
    }
  });

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

    // Trigger detection with the full URL for the existing logic; pass the
    // raw typed text as the search term so the Recent list filters by it
    if (cleaned) {
      handleInputChange(`https://github.com/${cleaned}`, cleaned);
    } else {
      handleInputChange('');
    }

    dispatchGithubSearch(cleaned);
  }

  /**
   * Global GitHub search. The search middleware debounces (~300ms), so we can
   * dispatch on every keystroke; short queries are short-circuited downstream.
   * Signed-out users get no dispatch at all.
   */
  function dispatchGithubSearch(query: string) {
    if (!canBrowseGithub) return;
    appStore.dispatch(searchGithubRepos(query.trim()));
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
        handleInputChange(`https://github.com/${normalized}`, normalized);
      }
      dispatchGithubSearch(normalized);
    }
  }

  // Check directory status for local paths
  async function checkDirectoryStatus(path: string): Promise<void> {
    // The bridge forwards to the daemon's host.directoryStatus in every build.
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

  // Handle input change - search first, then debounced detection.
  // `search` is the plain text used to filter the Recent list; callers that
  // pass a URL-prefixed `value` (GitHub tab) supply the unprefixed text so
  // the name/owner match clauses are reachable (intent-hq/monorepo#859).
  function handleInputChange(value: string, search: string = value) {
    inputValue = value;
    searchTerm = search; // Update search term for filtering

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

    // Close the dropdown
    isOpen = false;
  }

  // Handle selecting a recent repo
  function handleSelectRepo(repo: any) {
    // Any recent pick (GitLab included) supersedes a local entry still being probed.
    recentProbeToken++;
    if (rowLabel && isCurrentRepo(repo)) {
      isOpen = false;
      return;
    }
    const identity = getRecentRepoIdentity(repo, gitlab?.instanceBaseUrl);
    if (repo.type !== 'local' && identity?.provider === 'gitlab') {
      if (
        !gitlab?.authenticated ||
        identity.instanceBaseUrl !== gitlab.instanceBaseUrl ||
        (!gitlab.scopeKey && !gitlab.onSelectRecent) ||
        gitlab.page.status === 'unavailable'
      )
        return;
      if (gitlab.onSelectRecent)
        gitlab.onSelectRecent(identity.projectPath, identity.instanceBaseUrl);
      else gitlab.onSelect(identity.projectPath, gitlab.scopeKey);
      isOpen = false;
      return;
    }
    // A local recent entry may be a plain folder (Labs): classify it through the
    // same folder-status probe as a picked folder instead of assuming git.
    if (repo.type === 'local' && (plainFolderMode || repo.plainFolder === true)) {
      void selectLocalRecent(repo);
      return;
    }
    selectRecentRepo(repo);
  }

  async function probeDirectoryStatus(path: string): Promise<typeof directoryStatus> {
    try {
      const result = await invoke<any>('file:getDirectoryStatus', { path });
      return result?.success && result.data ? result.data : null;
    } catch (err) {
      logger.warn('Failed to check directory status', err);
      return null;
    }
  }

  async function selectLocalRecent(repo: WorkspaceInitializerRecentRepo) {
    const token = recentProbeToken;
    const status = await probeDirectoryStatus(repo.path);
    if (token !== recentProbeToken) return;
    const inRepo = !!status && (status.isGitRepo || !!status.isSubdirectoryOfGitRepo);
    // Unknown status: a known plain-folder row, or the toggle being off, keeps
    // the plain-folder flow (the daemon rejects a path inside a git repository).
    const nonGitFolder = status
      ? status.exists && status.isDirectory && !inRepo
      : repo.plainFolder === true || plainFolderMode;
    if (nonGitFolder) {
      if (plainFolderMode) {
        selectPlainFolder(repo.path, 'existing');
        return;
      }
      // Same prompt as a picked non-git folder; the dropdown stays open.
      nonGitFolderPath = repo.path;
      showNonGitFolderPrompt = true;
      return;
    }
    if (plainFolderMode && status && !status.exists && !inRepo) {
      selectPlainFolder(repo.path, 'new');
      return;
    }
    selectRecentRepo(repo, status?.isSubdirectoryOfGitRepo ? status.relativePathFromGitRoot : '');
  }

  function selectRecentRepo(repo: any, scope = '') {
    // GitHub picks are path-less: identify the repo by its owner/repo shorthand
    const githubInfo =
      repo.type === 'github' && repo.githubUrl ? parseGitHubUrl(repo.githubUrl) : null;
    const path = githubInfo ? `${githubInfo.owner}/${githubInfo.repo}` : repo.path;

    selectedValue = path;
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
      path,
      type: repo.type,
      isNewRepo: false,
      isValidPath: true,
    };
    if (scope) detail.scope = scope;
    if (repo.type === 'github' && repo.githubUrl) {
      detail.githubUrl = repo.githubUrl;
    }

    onchangeWithTracking(detail);

    // Close the dropdown
    isOpen = false;
  }

  function openFolderPicker(
    purpose: FolderPickerPurpose,
    title: string,
    initialPath: string | undefined,
  ): void {
    folderPickerPurpose = purpose;
    folderPickerTitle = title;
    folderPickerInitialPath = initialPath;
    void pickDirectory({
      title,
      defaultPath: initialPath,
      openModal: () => (folderPickerOpen = true),
      onSelect: handleFolderPickerSelect,
    });
  }

  // Open the appropriate folder picker to choose a repository folder.
  function handleSelectFolder() {
    openFolderPicker(
      'select-repo',
      m.workspace_repoSelector_selectRepoFolder_title(),
      typeof selectedValue === 'string' ? selectedValue : undefined,
    );
  }

  // Apply a picked path for the "select-repo" flow.
  async function applyPickedRepoFolder(path: string): Promise<void> {
    recentProbeToken++;
    try {
      // Check directory status first
      await checkDirectoryStatus(path);

      // If it's an existing folder but NOT a git repo, show the prompt
      if (
        directoryStatus?.exists &&
        !directoryStatus?.isGitRepo &&
        !directoryStatus?.isSubdirectoryOfGitRepo
      ) {
        if (plainFolderMode) {
          selectPlainFolder(path, 'existing');
          return;
        }
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

  // Open the appropriate folder picker to choose a parent folder for a new repo.
  function handleSelectNewRepoParent() {
    isDialogOpen = true;
    openFolderPicker(
      'new-repo-parent',
      m.workspace_repoSelector_selectNewRepoParent_title(),
      newRepoParentPath || undefined,
    );
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
    // Plain-folder mode: a folder outside any git repository is created (or
    // used, when it already exists) without git.
    const plainKind = newRepoPlainFolderKind;
    if (plainKind) {
      // The git default location is not changed by a plain-folder pick.
      selectPlainFolder(fullPath, plainKind);
      showCreateNewMode = false;
      return;
    }
    isNewRepo = !existingGitRepo;

    const detail: RepoChangeDetail = {
      path: fullPath,
      type: 'local',
      isNewRepo: !existingGitRepo,
      isValidPath: true,
    };
    onchangeWithTracking(detail);

    saveDefaultParentPath(newRepoParentPath);

    // Reset and close
    showCreateNewMode = false;
    isOpen = false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GITHUB PICK HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  // Dispatch a picked path to the right destination.
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

  // Confirm current input, never a previous debounced detection.
  function handleConfirmGitHubPick() {
    const parsed = parseGitHubUrl(githubUrlInput);
    if (!parsed) return;
    const picked = {
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
    };

    const shorthand = `${picked.owner}/${picked.repo}`;

    const detail: RepoChangeDetail = {
      path: shorthand,
      type: 'github',
      githubUrl: picked.url,
      isNewRepo: false,
      isValidPath: true,
    };

    selectedValue = shorthand;
    inputValue = picked.url;
    confirmedGithubUrl = picked.url;
    selectedRepoType = 'github';
    isValidPath = true;
    validationMessage = '';

    onchangeWithTracking(detail);

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

    showNonGitFolderPrompt = false;
    nonGitFolderPath = '';
    isOpen = false;
  }

  // Select a plain folder (Labs): no git initialization, no branch.
  function selectPlainFolder(path: string, kind: 'existing' | 'new') {
    selectedValue = path;
    inputValue = path;
    confirmedGithubUrl = '';
    selectedRepoType = kind === 'new' ? 'new' : 'local';
    isNewRepo = false;
    isValidPath = true;
    validationMessage = '';
    directoryStatus = null;
    onchangeWithTracking({
      path,
      type: 'local',
      isNewRepo: false,
      isValidPath: true,
      plainFolder: kind,
    });
    showNonGitFolderPrompt = false;
    nonGitFolderPath = '';
    isOpen = false;
  }

  // The git switch was flipped. A folder without git still awaiting
  // "Initialize Git here" is picked as a plain folder when it is turned off.
  function handleGitSwitchChange(value: boolean, tab: 'local' | 'new') {
    const pending = tab === 'local' && showNonGitFolderPrompt ? nonGitFolderPath : '';
    gitChoice?.onCheckedChange(value, tab);
    if (pending && !value) selectPlainFolder(pending, 'existing');
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
    if (!selectedValue) return m.workspace_repoSelector_selectRepository_label();

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

  const triggerDisplayValue = $derived(
    gitlabSelected
      ? (displayValue ?? gitlab?.selectedProjectPath ?? '')
      : (displayValue ?? formatDisplayValue()),
  );
  const hasTriggerValue = $derived(gitlabSelected ? !!triggerDisplayValue : !!selectedValue);
  const pickerId = $props.id();
  const suggestionsId = `${pickerId}-github-suggestions`;
  // Owner avatars use the selected provider identity, never a guessed GitLab image URL.
  const selectedGitLabProject = $derived(
    gitlabSelected &&
      gitlab?.authenticated &&
      gitlab.scopeKey &&
      gitlab.page.status !== 'unavailable' &&
      gitlab.selectedProject?.projectPath === gitlab.selectedProjectPath
      ? gitlab.selectedProject
      : undefined,
  );
  const triggerAvatarOwner = $derived(
    gitlabSelected
      ? null
      : getGitHubPickOwner({ selectedValue, selectedRepoType, confirmedGithubUrl }, parseGitHubUrl),
  );
  const triggerRecentRepo = $derived(formRepositoryChoices.find(isCurrentRepo));
  const triggerRepositoryIdentity = $derived(
    triggerRecentRepo ? getRecentRepoIdentity(triggerRecentRepo, gitlab?.instanceBaseUrl) : null,
  );

  function repositoryAvatarUrl(identity: ReturnType<typeof getRecentRepoIdentity>) {
    if (
      identity?.provider !== 'gitlab' ||
      !gitlab?.authenticated ||
      !gitlab.scopeKey ||
      identity.instanceBaseUrl !== gitlab.instanceBaseUrl ||
      gitlab.page.status !== 'ready'
    )
      return undefined;
    return (
      gitlab.page.items.find((project) => project.projectPath === identity.projectPath) ??
      (gitlab.selectedProject?.projectPath === identity.projectPath
        ? gitlab.selectedProject
        : undefined)
    )?.ownerAvatarUrl;
  }
</script>

<div class="relative min-w-0">
  {#snippet recentRepoRows(
    repos: WorkspaceInitializerRecentRepo[],
    isSelected: (repo: WorkspaceInitializerRecentRepo, index: number) => boolean,
  )}
    {#each repos as repo, index (recentRepoKey(repo))}
      {@const label = getRecentRepoLabel(repo)}
      {@const identity = getRecentRepoIdentity(repo, gitlab?.instanceBaseUrl)}
      {@const owner = identity
        ? identity.projectPath.split('/').slice(0, -1).join('/')
        : label.ownerPrefix}
      {@const tooltip = getRecentRepoTooltip(repo)}
      {@const avatarUrl = repositoryAvatarUrl(identity)}
      <div
        class="group/recent-repo flex min-w-0 items-center {rowLabel
          ? 'rounded-(--radius-row)'
          : ''} {rowLabel && isSelected(repo, index) ? 'bg-selected' : ''}"
        data-recent-repo-row
      >
        {#snippet repoRow()}
          <RepositoryPickerRow
            {owner}
            name={identity && repo.type !== 'local'
              ? identity.projectPath.split('/').at(-1)!
              : label.primary}
            suffix={label.suffix}
            provider={identity?.provider}
            {avatarUrl}
            local={repo.type === 'local'}
            showOwner={repo.type !== 'local'}
            showForge
            recent
            selected={isSelected(repo, index)}
            formStyle={!!rowLabel}
            class="flex-1"
            onclick={() => handleSelectRepo(repo)}
            disabled={repo.type !== 'local' &&
              identity?.provider === 'gitlab' &&
              (!gitlab?.authenticated ||
                identity.instanceBaseUrl !== gitlab.instanceBaseUrl ||
                (!gitlab.scopeKey && !gitlab.onSelectRecent) ||
                gitlab.page.status === 'unavailable')}
          />
        {/snippet}
        {#if tooltip}
          <Tooltip content={tooltip} delayDuration={300} side="bottom" class="flex min-w-0 flex-1">
            {@render repoRow()}
          </Tooltip>
        {:else}
          {@render repoRow()}
        {/if}
        {#if rowLabel && identity}
          {@const repositoryUrl = `${identity.instanceBaseUrl.replace(/\/$/, '')}/${identity.projectPath}`}
          <Button
            variant="ghost"
            size="icon-compact"
            iconOnly
            href={repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            tooltip={m.browser_embedded_openExternal_tooltip()}
            aria-label={m.browser_embedded_openExternal_ariaLabel()}
            class="mr-1 shrink-0 text-subtle"
            onclick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleLink(repositoryUrl, { event, forceExternal: true });
            }}
          >
            <Fa icon={faArrowUpRightFromSquare} size={12} />
          </Button>
        {/if}
        {#if !rowLabel}
          <Button
            variant="ghost"
            type="button"
            size="icon-compact"
            iconOnly
            data-remove-recent-repo
            class="mr-2 shrink-0 opacity-0 pointer-events-none group-hover/recent-repo:opacity-100 group-hover/recent-repo:pointer-events-auto group-focus-within/recent-repo:opacity-100 group-focus-within/recent-repo:pointer-events-auto"
            aria-label={m.workspace_repoSelector_removeRecent_ariaLabel({
              repository: repo.path,
            })}
            title={m.workspace_repoSelector_removeRecent_tooltip()}
            onclick={(event) => handleDismissRecentRepo(event, repo)}
          >
            <Fa icon={faXmark} size={12} />
          </Button>
        {/if}
      </div>
    {/each}
  {/snippet}

  {#snippet forgePrefix()}
    {#if authenticatedForges.length > 1}
      <Menu.Root>
        <Menu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="plain"
              class="group/forge relative h-auto shrink-0 rounded-none py-2.5 pl-3 pr-4 text-sm font-normal hover:underline focus:underline"
            >
              {repositoryTabLabel}
              <Fa
                icon={faChevronDown}
                size={10}
                class="absolute right-0 opacity-0 group-hover/forge:opacity-100 group-focus/forge:opacity-100"
              />
            </Button>
          {/snippet}
        </Menu.Trigger>
        <Menu.Content
          portalProps={{ to: dialogPortalTarget() }}
          aria-label={m.workspace_repoSelector_whichRepo_label()}
        >
          <Menu.RadioGroup
            value={selectedForge?.id}
            onValueChange={(value) => selectForge(value as 'github' | 'gitlab')}
          >
            {#each authenticatedForges as forge (forge.id)}
              <Menu.RadioItem value={forge.id} closeOnSelect>
                {#snippet leading()}<Fa icon={forge.icon} size={12} />{/snippet}
                {forge.label}
              </Menu.RadioItem>
            {/each}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Root>
    {:else}
      <!-- i18n-ignore (configured forge URL, or existing GitHub connect field) -->
      <span class="text-sm pl-3 shrink-0 select-none">{selectedForge?.label ?? 'github.com/'}</span>
    {/if}
  {/snippet}

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          bind:ref={formTriggerElement}
          {variant}
          wrapContent={!rowLabel}
          class={`w-full ${triggerClass ?? ''}`}
          aria-label={triggerAriaLabel ??
            (rowLabel
              ? undefined
              : `${m.workspace_repoSelector_selectRepository_label()}: ${triggerDisplayValue}`)}
          aria-labelledby={rowLabel && !triggerAriaLabel
            ? `${pickerId}-field-label ${pickerId}-field-value`
            : undefined}
        >
          <div class={`flex w-full min-w-0 items-center truncate ${triggerContentClass}`}>
            {#if rowLabel}
              <span class={workspacePickerStyles.fieldLabel} id={`${pickerId}-field-label`}
                >{formRowLabel}</span
              >
            {/if}
            <!-- {#if isNewRepo}
          <Fa icon={faPlus} size="sm" class="text-ghost" />
        {:else}
          <GitRepoIcon size={12} class="text-ghost -mb-0.25" />
        {/if} -->
            {#if triggerIcon}
              <Fa icon={triggerIcon} size="xs" />
            {:else if showEmptyIcon && !hasTriggerValue}
              <GitRepoIcon size={12} class="text-ghost -mb-0.25 mr-1" />
            {/if}
            {#if !triggerIcon && hasTriggerValue}
              <RepositoryPickerIcon
                owner={triggerRepositoryIdentity?.projectPath.split('/').slice(0, -1).join('/') ||
                  triggerAvatarOwner ||
                  selectedGitLabProject?.namespace}
                provider={triggerRepositoryIdentity?.provider ??
                  (gitlabSelected ? 'gitlab' : triggerAvatarOwner ? 'github' : undefined)}
                avatarUrl={repositoryAvatarUrl(triggerRepositoryIdentity) ??
                  selectedGitLabProject?.ownerAvatarUrl}
                local={triggerRecentRepo?.type === 'local' ||
                  (!gitlabSelected && selectedRepoType !== 'github')}
                size={rowLabel ? 20 : 16}
              />
            {:else if !triggerIcon && rowLabel && !showEmptyIcon}
              <GitRepoIcon size={16} class="shrink-0 text-muted-foreground" />
            {/if}
            {#if !triggerIcon && (hasTriggerValue || emptyLabel)}
              <span
                class="min-w-0 flex-1 text-left truncate"
                id={rowLabel ? `${pickerId}-field-value` : undefined}
              >
                {#if hasTriggerValue}
                  <span class={triggerValueClass}>{triggerDisplayValue}</span>
                  {#if isNewRepo && !displayValue && !gitlabSelected}
                    <span class="text-sm text-subtle ml-1"
                      >{m.workspace_repoSelector_new_label()}</span
                    >
                  {/if}
                {:else}
                  <span class={triggerValueClass}>{emptyLabel}</span>
                {/if}
                {#if triggerSuffix}
                  <span class="text-sm text-subtle ml-1">({triggerSuffix})</span>
                {/if}
              </span>
            {/if}
            {#if showTriggerChevron}
              <Fa icon={faChevronDown} size={10} class={triggerChevronClass} />
            {/if}
          </div>
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content
      role="dialog"
      aria-label={formRowLabel ?? m.workspace_repoSelector_whichRepo_label()}
      class={rowLabel
        ? `w-[360px] max-w-[calc(100vw-1rem)] min-w-0 max-h-[min(440px,var(--bits-popover-content-available-height,calc(100dvh-1rem)))] flex flex-col ${formStep === 'browse' ? 'overflow-hidden' : 'overflow-y-auto'}`
        : 'w-[400px] max-w-[calc(100vw-16px)] min-w-0 max-h-[min(600px,var(--bits-popover-content-available-height,100dvh))] overflow-y-auto flex flex-col'}
      side={rowLabel ? (isMobile.current || formMenuBelow ? 'bottom' : 'left') : undefined}
      sideOffset={rowLabel ? (isMobile.current || formMenuBelow ? 4 : 24) : undefined}
      align={rowLabel ? (isMobile.current || formMenuBelow ? 'end' : 'start') : undefined}
      onkeydown={(event) => {
        if (
          rowLabel &&
          formStep === 'browse' &&
          event.target instanceof Node &&
          formListElement?.contains(event.target)
        )
          handleFormListKeydown(event);
        if (event.key === 'Enter') event.stopPropagation();
      }}
      portalProps={{ to: dialogPortalTarget() }}
      strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
      portal
    >
      {#if rowLabel && formStep === 'browse'}
        <div class="shrink-0 px-2 pt-1">
          <Input
            bind:ref={formSearchElement}
            variant="search"
            type="text"
            role="searchbox"
            data-repo-search
            data-testid="repo-form-search"
            value={formQuery}
            oninput={(event) => (formQuery = event.currentTarget.value)}
            onkeydown={handleFormSearchKeydown}
            placeholder={m.workspace_repoSelector_search_placeholder()}
            aria-label={m.workspace_repoSelector_search_placeholder()}
            aria-controls={`${pickerId}-form-repos`}
          />
        </div>
        <div
          bind:this={formListElement}
          id={`${pickerId}-form-repos`}
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1"
          data-testid="recent-repositories"
          role="group"
          aria-label={m.workspace_repoSelector_recent_label()}
        >
          {#if isLoading && formRepositoryChoices.length === 0}
            <div role="status">
              {#each [1, 2, 3] as { }}
                <div class="flex min-h-10 items-center gap-2 px-3 py-2">
                  <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                  <div class="h-4 bg-muted rounded flex-1 animate-pulse"></div>
                </div>
              {/each}
            </div>
          {:else if formRepos.length === 0}
            <p class="type-body px-3 py-2 text-muted-foreground" role="status">
              {m.hud_filter_noRepositories_label()}
            </p>
          {:else}
            {@render recentRepoRows(formRepos, (repo) => isCurrentRepo(repo))}
          {/if}
        </div>
        <div class="shrink-0 border-t border-border p-2">
          <Button
            variant="ghost"
            type="button"
            wrapContent={false}
            data-testid="repo-form-add"
            class="{workspacePickerStyles.row} w-full"
            onclick={openAddStep}
          >
            <Fa icon={faPlus} class="size-4 shrink-0" />
            <span>{m.workspace_repoSelector_addRepository_label()}</span>
          </Button>
        </div>
      {:else}
        {#if rowLabel}
          <div class="flex shrink-0 items-center gap-1 px-2 pt-2 pb-2">
            <Button
              variant="ghost"
              type="button"
              size="icon-sm"
              iconOnly
              data-testid="repo-form-back"
              class="shrink-0 text-muted-foreground"
              aria-label={m.ui_navButtons_goBack_tooltip()}
              onclick={closeAddStep}
            >
              <Fa icon={faArrowLeft} class="size-3.5!" />
            </Button>
            <h2 class="{workspacePickerStyles.title} min-w-0 truncate">
              {m.workspace_repoSelector_addRepository_label()}
            </h2>
          </div>
        {:else}
          <!-- Header -->
          <div class="shrink-0 px-4 pt-2 pb-3">
            <h2 class="text-base font-semibold text-foreground">
              {m.workspace_repoSelector_whichRepo_label()}
            </h2>
            <p class="text-sm text-subtle mt-1">
              {m.workspace_repoSelector_whichRepo_description()}
            </p>
          </div>
        {/if}

        <!-- Tab bar -->
        <Tabs.Root
          value={repositoryTabActive ? 'repository' : activeTab}
          onValueChange={selectRepositoryTab}
          class="flex flex-col {rowLabel ? 'shrink-0' : 'min-h-0'}"
        >
          <Tabs.List
            aria-label={m.workspace_repoSelector_whichRepo_label()}
            class="flex shrink-0 gap-0 mx-3 mb-3 bg-sidebar rounded-lg p-1"
          >
            {#if cloneTabVisible}
              <Tabs.Trigger
                value="repository"
                class="flex-1 min-w-0 h-auto min-h-(--control-height-medium) px-2 py-1.5 text-sm whitespace-normal rounded-md cursor-pointer transition-all {repositoryTabActive
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'}"
              >
                {m.workspace_repoSelector_clone_tab()}
              </Tabs.Trigger>
            {/if}
            {#each [{ id: 'local' as TabId, label: m.workspace_repoSelector_existingFolder_tab() }, { id: 'new' as TabId, label: m.workspace_repoSelector_new_tab() }, ...($remoteWorkspacesEnabled$ ? [{ id: 'remote' as TabId, label: m.workspace_repoSelector_remoteServer_tab() }] : [])] as tab}
              <Tabs.Trigger
                value={tab.id}
                class="flex-1 min-w-0 h-auto min-h-(--control-height-medium) px-2 py-1.5 text-sm whitespace-normal rounded-md cursor-pointer transition-all {activeTab ===
                tab.id
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'}"
              >
                {tab.label}
              </Tabs.Trigger>
            {/each}
          </Tabs.List>
          {#if !cloneTabVisible && $canAdministerHost$}
            <Button
              type="button"
              variant="link"
              size="sm"
              class="mx-3 -mt-1 mb-2 h-auto self-start p-0 text-xs"
              onclick={handleConnectToClone}
            >
              {m.workspace_repoSelector_connectForgeToClone_label()}
            </Button>
          {/if}
          <Tabs.Content
            value={repositoryTabActive ? 'repository' : activeTab}
            class="mt-0 min-h-0 flex flex-col"
          >
            <!-- Input section - changes based on tab -->
            <div class="shrink-0 px-3 mb-3">
              {#if gitChoice && (activeTab === 'local' || activeTab === 'new')}
                {@const tab = activeTab}
                {@const folder =
                  tab === 'new'
                    ? 'new'
                    : showNonGitFolderPrompt && nonGitFolderPath
                      ? 'folder'
                      : (gitChoice.folder ?? null)}
                <InitializeGitToggle
                  class="mb-3 px-1"
                  {folder}
                  checked={folder === 'git-repo' ? gitChoice.worktree !== false : gitChoice.checked}
                  disabled={gitChoice.disabled}
                  onCheckedChange={(value) => handleGitSwitchChange(value, tab)}
                />
              {/if}
              {#if activeTab === 'gitlab' && gitlab}
                <GitLabProjectPicker
                  {...gitlab}
                  scrollable={!rowLabel}
                  formStyle={!!rowLabel}
                  prefix={forgePrefix}
                  onSelect={(projectPath, scopeKey) => {
                    recentProbeToken++;
                    gitlab?.onSelect(projectPath, scopeKey);
                    isOpen = false;
                  }}
                />
              {:else if activeTab === 'local'}
                <!-- Local repo: folder picker button -->
                <Button
                  type="button"
                  class="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border-0 text-left cursor-pointer"
                  onclick={handleSelectFolder}
                >
                  <span
                    class="text-sm truncate {inputValue
                      ? 'text-foreground'
                      : 'text-muted-foreground'}"
                  >
                    {inputValue || m.workspace_repoSelector_selectAFolder_placeholder()}
                  </span>
                  <Fa icon={faFolder} class="text-ghost opacity-50" />
                </Button>
              {:else if activeTab === 'github'}
                <HostExecutionNotice kind="repository" />
                <HostExecutionNotice />
                <!-- GitHub: URL input with prefix (path-less pick — no clone destination) -->
                <div
                  class="flex items-center rounded-lg bg-sidebar focus-within:ring-1 focus-within:ring-ring"
                >
                  {@render forgePrefix()}
                  <Input
                    placeholder={/* i18n-ignore (GitHub path format example placeholder) */ 'owner/repo'}
                    bind:this={inputElement}
                    bind:ref={githubInputElement}
                    type="text"
                    bind:value={githubUrlInput}
                    oninput={(e) => handleGitHubInputChange(e.currentTarget.value)}
                    onpaste={handleGitHubPaste}
                    onkeydown={handleGitHubInputKeydown}
                    class="min-w-0 bg-sidebar border-none px-1 py-2.5! h-auto text-sm"
                    noFocusStyle
                    role="combobox"
                    aria-label={m.workspace_repoSelector_githubSuggestions_ariaLabel()}
                    aria-autocomplete="list"
                    aria-controls={githubSuggestions.length > 0 ? suggestionsId : undefined}
                    aria-expanded={githubSuggestions.length > 0}
                    aria-activedescendant={githubSuggestions[suggestionIndex]
                      ? `${suggestionsId}-${suggestionIndex}`
                      : undefined}
                  />
                </div>
                <!--
            Autocomplete suggestions: the user's own repos filtered by the
            typed text, then deduped global search results. Signed-out users
            get a connect hint instead; manual owner/repo entry keeps working.
          -->
                {#if !canBrowseGithub && $canAdministerHost$}
                  <GitHubAuthBanner
                    class="mt-2"
                    message={m.workspace_repoSelector_githubSignIn_description()}
                  />
                {:else if canBrowseGithub}
                  <RepositoryPickerList
                    formStyle={!!rowLabel}
                    id={suggestionsId}
                    items={githubSuggestions}
                    getKey={(repo) => repo.id}
                    getOwner={(repo) => repo.owner}
                    getName={(repo) => repo.name}
                    provider="github"
                    label={m.workspace_repoSelector_githubSuggestions_ariaLabel()}
                    loading={!githubSuggestions.length &&
                      ($githubReposLoading$ || Boolean(githubQuery && $githubSearchLoading$))}
                    loadingLabel={githubQuery
                      ? m.workspace_repoSelector_searchingGithub_label({ query: githubQuery })
                      : m.gitlabCheckout_loading_label()}
                    emptyLabel={m.hud_filter_noRepositories_label()}
                    error={$githubReposError$
                      ? $hostMember$
                        ? $githubReposError$
                        : m.workspace_repoSelector_suggestionsUnavailable_label()
                      : undefined}
                    retryLabel={m.workspace_repoSelector_retrySuggestions_label()}
                    onRetry={retryGithubRepos}
                    bind:activeIndex={suggestionIndex}
                    onSelect={handleSelectGithubSuggestion}
                  />
                {/if}
                <!-- Detected repo + select button (hidden when it would duplicate a
               suggestion row; Enter-to-confirm still works via handleConfirmGitHubPick) -->
                {#if detectedGitHub && !detectedGitHubIsDuplicate}
                  <div class="flex items-center justify-between gap-2 mt-2 px-1">
                    <span class="text-sm text-subtle truncate flex-1">
                      {detectedGitHub.owner}/{detectedGitHub.repo}
                    </span>
                    <Button size="sm" onclick={handleConfirmGitHubPick} class="shrink-0"
                      >{m.workspace_repoSelector_select_label()}</Button
                    >
                  </div>
                {/if}
              {:else if activeTab === 'new'}
                <!-- New repo: parent folder + folder name -->
                <Button
                  type="button"
                  variant="plain"
                  wrapContent={false}
                  class="w-full flex items-center gap-3 mb-2 text-left cursor-pointer"
                  onclick={handleSelectNewRepoParent}
                >
                  <span class="text-sm text-subtle shrink-0 w-24 pl-1"
                    >{m.workspace_repoSelector_parentFolder_label()}</span
                  >
                  <span
                    class="flex-1 min-w-0 text-sm h-(--control-height-medium) px-3 bg-sidebar rounded-(--radius-medium) flex items-center justify-between {newRepoParentPath
                      ? 'text-foreground'
                      : 'text-subtle'} truncate"
                  >
                    <div class="truncate">
                      {newRepoParentPath || m.workspace_repoSelector_select_placeholder()}
                    </div>
                    <Fa icon={faFolder} class="text-ghost shrink-0 opacity-50" />
                  </span>
                </Button>
                <div class="flex items-center gap-3">
                  <span class="text-sm text-subtle shrink-0 w-24 pl-1"
                    >{m.workspace_repoSelector_folderName_label()}</span
                  >
                  <Input
                    placeholder={/* i18n-ignore (example folder name placeholder) */ 'new-project'}
                    type="text"
                    bind:value={newRepoProjectName}
                    onkeydown={(e) => {
                      if (e.key === 'Enter' && !e.isComposing) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleConfirmNewRepo();
                      }
                    }}
                    class="bg-sidebar border-none"
                    noFocusStyle
                  />
                </div>
                <!-- Validation error for project name -->
                {#if newRepoNameError}
                  <div class="mt-2 px-1">
                    <span class="text-sm text-danger">{newRepoNameError}</span>
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
                        <IntentMarkLoader size={14} />
                        <span>{m.workspace_repoSelector_checking_label()}</span>
                      </div>
                    {:else if newRepoPathStatus?.exists && newRepoPathStatus?.isGitRepo}
                      <!-- Existing git repo - will create an isolated checkout -->
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-subtle">
                          {m.workspace_repoSelector_repoExists_label({ isolationLabel })}
                        </span>
                        <Button size="sm" onclick={handleConfirmNewRepo} class="shrink-0"
                          >{m.workspace_repoSelector_select_label()}</Button
                        >
                      </div>
                    {:else if newRepoPlainFolderKind === 'existing'}
                      <!-- Plain-folder mode: an existing non-git folder is used as-is -->
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-subtle">
                          {m.onboarding_localRepoTab_plainFolder_description()}
                        </span>
                        <Button size="sm" onclick={handleConfirmNewRepo} class="shrink-0"
                          >{m.workspace_repoSelector_select_label()}</Button
                        >
                      </div>
                    {:else if newRepoPlainFolderKind === 'new'}
                      <!-- Plain-folder mode: a new folder without git -->
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-subtle"
                          >{m.workspace_repoSelector_newFolderWillBeCreated_label()}</span
                        >
                        <Button
                          size="sm"
                          variant="primary"
                          onclick={handleConfirmNewRepo}
                          class="shrink-0">{m.workspace_repoSelector_create_label()}</Button
                        >
                      </div>
                    {:else if newRepoPathStatus?.exists && !newRepoPathStatus?.isGitRepo}
                      <!-- Existing folder but not a git repo -->
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-warning-ink">
                          {m.workspace_repoSelector_folderNotGitRepo_label()}
                        </span>
                        <Button
                          size="sm"
                          variant="primary"
                          onclick={handleConfirmNewRepo}
                          class="shrink-0"
                          disabled>{m.workspace_repoSelector_create_label()}</Button
                        >
                      </div>
                    {:else}
                      <!-- New folder - will create -->
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-subtle"
                          >{m.workspace_repoSelector_newRepoWillBeCreated_label()}</span
                        >
                        <Button
                          size="sm"
                          variant="primary"
                          onclick={handleConfirmNewRepo}
                          class="shrink-0">{m.workspace_repoSelector_create_label()}</Button
                        >
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
                      <Button
                        variant="ghost"
                        type="button"
                        size="icon-compact"
                        iconOnly
                        onclick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleRemoveRemoteSetup(setup.id);
                        }}
                        class="ml-1 rounded text-muted-foreground hover:text-danger hover:bg-danger-background/10"
                        title={m.workspace_repoSelector_removeSetup_tooltip()}
                      >
                        <Fa icon={faXmark} size="xs" />
                      </Button>
                    </div>
                  {/each}
                  {#if remoteSetups.length === 0}
                    <div class="text-sm text-subtle px-3 py-2">
                      {m.workspace_repoSelector_noRemoteSetups_label()}
                    </div>
                  {/if}
                  <Button
                    variant="ghost"
                    type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left cursor-pointer hover:bg-muted/50 transition-colors text-sm text-muted-foreground"
                    onclick={handleAddRemoteSetup}
                  >
                    <Fa icon={faPlus} size="sm" />
                    {m.workspace_repoSelector_addRemoteSetup_label()}
                  </Button>
                </div>
              {/if}
            </div>

            <!-- Non-git folder prompt - shows when user selects a folder that isn't a git repo -->
            {#if activeTab !== 'gitlab' && showNonGitFolderPrompt && nonGitFolderPath}
              <div class="mx-3 mb-3 p-3 bg-sidebar rounded-lg">
                <div class="flex items-start gap-3">
                  <Fa icon={faFolder} class="text-ghost shrink-0 mt-0.5" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate mb-1" title={nonGitFolderPath}>
                      {nonGitFolderPath.split('/').pop() || nonGitFolderPath}
                    </div>
                    <div class="text-sm text-subtle mb-2">
                      {m.workspace_repoSelector_notGitRepository_label()}
                    </div>
                    <div class="flex gap-2">
                      <Button size="sm" variant="secondary" onclick={handleInitializeGitInFolder}
                        >{m.workspace_repoSelector_initializeGit_label()}</Button
                      >
                      <Button size="sm" variant="secondary" onclick={handleChooseDifferentFolder}>
                        {m.workspace_repoSelector_chooseDifferentFolder_label()}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}

            <!-- One shared Recent list; local-copy entries remain separate. -->
            {#if !rowLabel && (activeTab === 'local' || repositoryTabActive) && (isLoading || filteredRepos().length > 0)}
              <div class="min-h-16 overflow-y-auto flex-1 px-4 pb-3 pt-2">
                <Header size={5} class="mb-2">{m.workspace_repoSelector_recent_label()}</Header>
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
                  <div class="-mx-2" data-testid="recent-repositories">
                    {@render recentRepoRows(
                      filteredRepos(),
                      (_repo, index) => index === highlightedIndex,
                    )}
                  </div>
                {/if}
              </div>
            {/if}
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </Popover.Content>
  </Popover.Root>
</div>

{#if $remoteWorkspacesEnabled$}
  <AddRemoteSetupModal
    isOpen={showAddRemoteModal}
    onclose={() => (showAddRemoteModal = false)}
    onsave={handleSaveRemoteSetup}
  />
{/if}

<!--
  Remote/web fallback picker. One modal serves all three folder-selection
  flows; the picked path is routed via `folderPickerPurpose`.
-->
<DirectoryPickerModal
  open={folderPickerOpen}
  title={folderPickerTitle}
  initialPath={folderPickerInitialPath}
  selectLabel="Select folder"
  onSelect={handleFolderPickerSelect}
  onClose={handleFolderPickerClose}
/>
