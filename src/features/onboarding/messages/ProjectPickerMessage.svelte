<script lang="ts">
  /**
   * ProjectPickerMessage — Message 2 of the onboarding flow.
   *
   * Tabbed picker: Local repo | GitHub repo | New project.
   * Pre-fills from Redux persistence. On valid selection:
   *   - emits project config
   *   - triggers sidebar slide-in
   *   - reveals Message 3
   */
  import { onMount } from 'svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { invoke } from '$shared/generated/ipc-client';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import LocalRepoTab from './LocalRepoTab.svelte';
  import GitHubRepoTab from './GitHubRepoTab.svelte';
  import NewProjectTab from './NewProjectTab.svelte';
  import {
  selectWorkspaceInitializerBranchByRepo,
  selectWorkspaceInitializerDefaultParentPath,
  selectWorkspaceInitializerHydrated,
  selectWorkspaceInitializerLastSelectedRepo,
} from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import type { WorkspaceInitializerRepoSelection } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

  const logger = createLogger('ProjectPickerMessage');

  const WORKSPACE_PREFILL_KEY = 'workspace-prefill';
  const workspaceInitializerHydrated$ = selectWorkspaceInitializerHydrated();
  const defaultParentPath$ = selectWorkspaceInitializerDefaultParentPath();
  const lastSelectedRepo$ = selectWorkspaceInitializerLastSelectedRepo();
  const branchByRepo$ = selectWorkspaceInitializerBranchByRepo();

  /**
   * Resolve the default on-disk location for both the "New project" parent
   * folder and the "GitHub repo" clone destination. Prefers a previously
   * saved value from Redux hydrated persistence, falling back to `~/Developer`. Keeping
   * this in one place means both tabs always agree on a sensible default
   * and the user doesn't have to pick a folder twice.
   */
  function getDefaultLocation(): string {
    return $defaultParentPath$ || '~/Developer';
  }

  type TabId = 'local' | 'github' | 'new';

  export interface ProjectSelection {
    type: 'local' | 'github' | 'new';
    repoPath: string;
    branch: string;
    scope?: string;
    githubUrl?: string;
    clonePath?: string;
    projectName?: string;
    isValid: boolean;
  }

  interface Props {
    /** Called when project selection changes */
    onProjectChange?: (selection: ProjectSelection) => void;
    /** Called when user presses Enter on a focused item — selects AND advances */
    onSelectAndAdvance?: () => void;
    /** Hide the heading text (used in split layout where heading is in the left panel) */
    hideHeading?: boolean;
  }

  let { onProjectChange, onSelectAndAdvance, hideHeading = false }: Props = $props();

  // Tab state
  const TAB_ORDER: TabId[] = ['local', 'github', 'new'];
  let activeTab = $state<TabId>('local');
  let previousTabIndex = $state(0);
  let currentTabIndex = $derived(TAB_ORDER.indexOf(activeTab));
  let slideDirection = $derived(currentTabIndex >= previousTabIndex ? 1 : -1);

  // Local repo state
  let localRepoPath = $state('');
  let localBranch = $state('');

  // GitHub repo state. `clonePath` defaults to the shared location so the
  // "Store project in:" button shows a useful value immediately and the
  // form is submittable as soon as the user picks a repo.
  let githubUrl = $state('');
  let clonePath = $state(getDefaultLocation());
  let localScope = $state<string | undefined>(undefined);

  // New project state. `parentPath` defaults to the same shared location.
  // `projectName` defaults so the "Create" button is enabled immediately;
  // NewProjectTab focuses and selects the field on mount so typing
  // immediately replaces the default.
  let parentPath = $state(getDefaultLocation());
  let projectName = $state('my-project');

  // Validate a project/folder name: reject path separators, traversal, null bytes, unsafe chars
  function getProjectNameError(name: string): string | undefined {
    if (!name || name.trim().length === 0) return undefined; // empty handled by isValid check
    const t = name.trim();
    if (t.includes('/') || t.includes('\\')) return 'Name cannot contain path separators (/ or \\)';
    if (t === '..' || t === '.' || /^\.+$/.test(t)) return "Name cannot be '.' or '..'";
    if (t.includes('\0')) return 'Name cannot contain null characters';
    if (/[<>:"|?*]/.test(t)) return 'Name contains invalid characters';
    if (t.length > 255) return 'Name is too long (max 255 characters)';
    return undefined;
  }

  const projectNameError = $derived(getProjectNameError(projectName));

  // Track directory status of the new project target path
  let newProjectDirStatus = $state<{
    exists: boolean;
    isDirectory: boolean;
    isEmpty: boolean;
    isGitRepo: boolean;
  } | null>(null);
  let isCheckingNewProjectDir = $state(false);

  // Computed full path for new project (used for dir-status checks and display)
  const newProjectFullPath = $derived(
    parentPath && projectName && !getProjectNameError(projectName)
      ? `${parentPath.replace(/\/$/, '')}/${projectName}`
      : '',
  );

  // Check directory status when new project path changes
  $effect(() => {
    const targetPath = newProjectFullPath;
    if (!targetPath) {
      newProjectDirStatus = null;
      return;
    }

    isCheckingNewProjectDir = true;
    const checkPath = async () => {
      if (typeof window === 'undefined' || !window.electronAPI) {
        isCheckingNewProjectDir = false;
        return;
      }
      try {
        const result = await invoke<any>('file:getDirectoryStatus', {
          path: targetPath,
        });
        if (result.success && result.data) {
          newProjectDirStatus = result.data;
        } else {
          newProjectDirStatus = null;
        }
      } catch {
        newProjectDirStatus = null;
      } finally {
        isCheckingNewProjectDir = false;
      }
    };

    const timeout = setTimeout(checkPath, 300);
    return () => clearTimeout(timeout);
  });

  // Error when target directory exists and is non-empty.
  // For "New project", the target must be absent or empty — existing repos
  // (even git repos) should be selected through the Local tab instead.
  const newProjectDirError = $derived.by(() => {
    if (!newProjectDirStatus?.exists) return undefined;
    if (!newProjectDirStatus.isEmpty)
      return 'Target folder already exists and is not empty. Choose a different name.';
    return undefined;
  });

  // Re-notify parent when directory check resolves (affects isValid in buildSelection)
  $effect(() => {
    // Subscribe to the derived values so the effect re-runs when they change
    void newProjectDirError;
    void isCheckingNewProjectDir;
    if (activeTab === 'new') {
      onProjectChange?.(buildSelection());
    }
  });

  function applyPersistedRepoSelection(data: WorkspaceInitializerRepoSelection | null) {
    if (!data) return;
    if (data.type === 'local' && data.path) {
      localRepoPath = data.path;
      localScope = data.scope;
      activeTab = 'local';
      localBranch = $branchByRepo$[data.path] || localBranch;
    } else if (data.type === 'github' && data.githubUrl) {
      githubUrl = data.githubUrl;
      clonePath = data.clonePath || '';
      activeTab = 'github';
    }
  }

  let didApplyPrefill = false;
  let didApplyPersistedRepo = $state(false);

  // Pre-fill from sessionStorage (modal/deep-link/repo quick-actions), then Redux persistence.
  try {
    const prefill = sessionStorage.getItem(WORKSPACE_PREFILL_KEY);
    if (prefill) {
      const data = JSON.parse(prefill);
      if (data.repoPath) {
        localRepoPath = data.repoPath;
        localBranch = data.branch || 'main';
        localScope = data.scope;
        activeTab = 'local';
      } else if (data.githubUrl) {
        githubUrl = data.githubUrl;
        clonePath = data.clonePath || clonePath;
        activeTab = 'github';
      } else if (data.projectName) {
        projectName = data.projectName;
        parentPath = data.parentPath || parentPath;
        activeTab = 'new';
      }
      sessionStorage.removeItem(WORKSPACE_PREFILL_KEY);
      didApplyPrefill = true;
    }
  } catch (e) {
    logger.error('Failed to restore saved repo', e);
  }

  $effect(() => {
    if (!$workspaceInitializerHydrated$ || didApplyPrefill || didApplyPersistedRepo) return;
    applyPersistedRepoSelection($lastSelectedRepo$);
    didApplyPersistedRepo = true;
    notifyParent();
  });

  // Build the current selection from component state — called directly from event handlers
  // to avoid $effect → callback → state change → $effect infinite loops.
  function buildSelection(): ProjectSelection {
    if (activeTab === 'local') {
      return {
        type: 'local',
        repoPath: localRepoPath,
        branch: localBranch,
        scope: localScope,
        isValid: !!localRepoPath,
      };
    } else if (activeTab === 'github') {
      // Branch is chosen in the prompt/configuration step via the shared
      // BranchSelector, which updates the selection through
      // handleOnboardingProjectChange. We emit an empty string here and
      // let the next step populate it on first render.
      //
      // clonePath is the parent directory (e.g. ~/Developer). We append
      // the repo name so the actual clone target is ~/Developer/repo-name.
      const repoName = githubUrl
        .match(/github\.com\/[^/]+\/([^/\s#?]+)/i)?.[1]
        ?.replace(/\.git$/, '');
      const normalizedClonePath = clonePath.replace(/\/$/, '');
      const fullClonePath =
        repoName && normalizedClonePath.split('/').pop() !== repoName
          ? `${normalizedClonePath}/${repoName}`
          : normalizedClonePath;
      return {
        type: 'github',
        repoPath: fullClonePath,
        branch: '',
        githubUrl,
        clonePath: fullClonePath,
        projectName: repoName,
        isValid: !!githubUrl && !!clonePath,
      };
    } else {
      const nameError = getProjectNameError(projectName);
      const dirError = newProjectDirError;
      const hasError = !!nameError || !!dirError;
      const fullPath =
        parentPath && projectName && !hasError
          ? `${parentPath.replace(/\/$/, '')}/${projectName}`
          : '';
      return {
        type: 'new',
        repoPath: fullPath,
        branch: 'main',
        projectName,
        isValid: !!parentPath && !!projectName && !hasError && !isCheckingNewProjectDir,
      };
    }
  }

  /** Notify parent of current selection. Called from event handlers, NOT from $effect. */
  function notifyParent() {
    onProjectChange?.(buildSelection());
  }

  // Notify parent once on mount with pre-filled persisted values (if any)
  onMount(() => {
    notifyParent();
  });

  const tabs: { id: TabId; label: string }[] = [
    { id: 'local', label: 'Local folder' },
    { id: 'github', label: 'GitHub repo' },
    { id: 'new', label: 'New' },
  ];
</script>

<!-- Message content — flies in from bottom -->
<div class="space-y-5" data-message in:fly={{ y: 30, duration: 500, easing: cubicOut }}>
  {#if !hideHeading}
    <h2
      class="text-2xl font-semibold tracking-tight"
      in:fly={{ y: 14, duration: 400, delay: 80, easing: cubicOut }}
    >
      Choose a project
    </h2>
    <p class="text-base text-muted-foreground leading-relaxed font-light max-w-lg">
      You can work on a...
    </p>
  {/if}

  <!-- Tab bar -->
  <div
    class="flex gap-0 rounded-lg p-1 border border-border/20 bg-muted/30"
    in:fly={{ y: 12, duration: 350, delay: 150, easing: cubicOut }}
  >
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="flex-1 px-3 py-2.5 text-sm rounded-md cursor-pointer transition-all duration-200
          {activeTab === tab.id
          ? 'bg-foreground font-medium text-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => {
          previousTabIndex = TAB_ORDER.indexOf(activeTab);
          activeTab = tab.id;
          notifyParent();
        }}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="min-h-[120px]" in:fly={{ y: 10, duration: 300, delay: 250, easing: cubicOut }}>
    {#key activeTab}
      <div in:fly={{ x: slideDirection * 150, duration: 250, easing: cubicOut }}>
        {#if activeTab === 'local'}
          <LocalRepoTab
            selectedPath={localRepoPath}
            onSelect={(path, scope) => {
              localRepoPath = path;
              localScope = scope;
              notifyParent();
            }}
            onSelectAndAdvance={(path, scope) => {
              // Capture reactive prop before state changes invalidate it.
              // Use typeof guard: during component teardown the Svelte 5
              // reactive proxy can return a truthy non-callable value,
              // which ?.() does not guard against.
              const advance = onSelectAndAdvance;
              localRepoPath = path;
              localScope = scope;
              notifyParent();
              if (typeof advance === 'function') advance();
            }}
          />
        {:else if activeTab === 'github'}
          <GitHubRepoTab
            {githubUrl}
            {clonePath}
            onGithubUrlChange={(url) => {
              githubUrl = url;
              notifyParent();
            }}
            onClonePathChange={(path) => {
              clonePath = path;
              notifyParent();
            }}
            onSelectAndAdvance={(url) => {
              // Capture reactive prop before state changes invalidate it.
              // Use typeof guard (see LocalRepoTab callback above).
              const advance = onSelectAndAdvance;
              githubUrl = url;
              notifyParent();
              if (typeof advance === 'function') advance();
            }}
          />
        {:else if activeTab === 'new'}
          <NewProjectTab
            {parentPath}
            {projectName}
            nameError={projectNameError || newProjectDirError}
            onParentPathChange={(path) => {
              parentPath = path;
              notifyParent();
            }}
            onProjectNameChange={(name) => {
              projectName = name;
              notifyParent();
            }}
          />
        {/if}
      </div>
    {/key}
  </div>
</div>
