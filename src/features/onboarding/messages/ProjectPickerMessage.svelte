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
  import { m } from '$shared/paraglide/messages.js';
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
   * Resolve the default on-disk location for the "New project" parent
   * folder. Prefers a previously saved value from Redux hydrated
   * persistence, falling back to `~/Developer`.
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
    projectName?: string;
    isValid: boolean;
    /** Local folder exists but has no Git repo; the daemon must initialize it. */
    initGit?: boolean;
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
  let localInitGit = $state(false);

  // GitHub repo state — a picked repo is identified by its URL only; the
  // daemon owns the checkout location (picked-repo flow).
  let githubUrl = $state('');
  let localScope = $state<string | undefined>(undefined);

  // New project state. `parentPath` defaults to the same shared location.
  // `projectName` defaults so the "Create" button is enabled immediately;
  // NewProjectTab focuses and selects the field on mount so typing
  // immediately replaces the default.
  let parentPath = $state(getDefaultLocation());
  // i18n-ignore — default directory name, kept ASCII-safe for the filesystem
  let projectName = $state('my-project');

  // Validate a project/folder name: reject path separators, traversal, null bytes, unsafe chars
  function getProjectNameError(name: string): string | undefined {
    if (!name || name.trim().length === 0) return undefined; // empty handled by isValid check
    const t = name.trim();
    if (t.includes('/') || t.includes('\\'))
      return m.onboarding_projectPicker_pathSeparators_error();
    if (t === '..' || t === '.' || /^\.+$/.test(t))
      return m.onboarding_projectPicker_dotName_error();
    if (t.includes('\0')) return m.onboarding_projectPicker_nullChars_error();
    if (/[<>:"|?*]/.test(t)) return m.onboarding_projectPicker_invalidChars_error();
    if (t.length > 255) return m.onboarding_projectPicker_nameTooLong_error();
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
    if (!newProjectDirStatus.isEmpty) return m.onboarding_projectPicker_targetExists_error();
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

  // Repo name parsed from the GitHub URL
  const githubRepoName = $derived(
    githubUrl.match(/github\.com\/[^/]+\/([^/\s#?]+)/i)?.[1]?.replace(/\.git$/, '') ?? '',
  );

  // owner/repo shorthand parsed from the GitHub URL — used as the selection's
  // repoPath (matches CompactWorkspaceInitializer's picked-repo convention).
  const githubOwnerRepo = $derived.by(() => {
    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/i);
    return match ? `${match[1]}/${match[2].replace(/\.git$/, '')}` : '';
  });

  function applyPersistedRepoSelection(data: WorkspaceInitializerRepoSelection | null) {
    if (!data) return;
    if (data.type === 'local' && data.path) {
      localRepoPath = data.path;
      localScope = data.scope;
      localInitGit = false;
      activeTab = 'local';
      localBranch = $branchByRepo$[data.path] || localBranch;
    } else if (data.type === 'github' && data.githubUrl) {
      githubUrl = data.githubUrl;
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
        localBranch = typeof data.branch === 'string' ? data.branch : '';
        localScope = data.scope;
        localInitGit = false;
        activeTab = 'local';
      } else if (data.githubUrl) {
        githubUrl = data.githubUrl;
        activeTab = 'github';
      } else if (data.projectName) {
        projectName = data.projectName;
        // svelte-ignore state_referenced_locally - intentional one-shot init-time read of the current default
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
        ...(localInitGit ? { initGit: true } : {}),
      };
    } else if (activeTab === 'github') {
      // Branch is chosen in the prompt/configuration step via the shared
      // BranchSelector, which updates the selection through
      // handleOnboardingProjectChange. We emit an empty string here and
      // let the next step populate it on first render.
      //
      // Picked-repo flow: no local clone destination. `repoPath` carries the
      // owner/repo shorthand (never a local path) — the same convention as
      // CompactWorkspaceInitializer's picked repos — so repo-identity keys
      // (setup-script cache, repo-config probe) stay stable per repo.
      return {
        type: 'github',
        repoPath: githubOwnerRepo,
        branch: '',
        githubUrl,
        projectName: githubRepoName || undefined,
        isValid: !!githubUrl && !!githubRepoName,
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
    {
      id: 'local',
      get label() {
        return m.onboarding_projectPicker_localFolder_label();
      },
    },
    {
      id: 'github',
      get label() {
        return m.onboarding_projectPicker_githubRepo_label();
      },
    },
    {
      id: 'new',
      get label() {
        return m.onboarding_projectPicker_new_label();
      },
    },
  ];
</script>

<!-- Message content — flies in from bottom -->
<div class="space-y-5" data-message in:fly={{ y: 30, duration: 500, easing: cubicOut }}>
  {#if !hideHeading}
    <h2
      class="text-2xl font-semibold tracking-tight"
      in:fly={{ y: 14, duration: 400, delay: 80, easing: cubicOut }}
    >
      {m.onboarding_projectPicker_chooseProject_title()}
    </h2>
    <p class="text-base text-muted-foreground leading-relaxed font-light max-w-lg">
      {m.onboarding_projectPicker_workOnA_description()}
    </p>
  {/if}

  <!-- Tab bar -->
  <div
    class="flex gap-0 rounded-lg p-1 border border-border bg-muted/30"
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
            onSelect={(path, scope, initGit) => {
              localRepoPath = path;
              localScope = scope;
              localInitGit = initGit === true;
              notifyParent();
            }}
            onSelectAndAdvance={(path, scope, initGit) => {
              // Capture reactive prop before state changes invalidate it.
              // Use typeof guard: during component teardown the Svelte 5
              // reactive proxy can return a truthy non-callable value,
              // which ?.() does not guard against.
              const advance = onSelectAndAdvance;
              localRepoPath = path;
              localScope = scope;
              localInitGit = initGit === true;
              notifyParent();
              if (typeof advance === 'function') advance();
            }}
          />
        {:else if activeTab === 'github'}
          <GitHubRepoTab
            {githubUrl}
            onGithubUrlChange={(url) => {
              githubUrl = url;
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
