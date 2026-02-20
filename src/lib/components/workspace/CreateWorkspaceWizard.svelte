<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  import { gitClient } from '$features/git/git.client';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { getRecentRepos } from '$lib/utils/workspace-utils';
  import { Button } from '$lib/components/ui/button';
  import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { SearchableSelect } from '$lib/components/ui/searchable-select';
  import { Select } from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import { open } from '$lib/electron-bridge';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { faCheck, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import {
    faCloud,
    faCodeBranch,
    faFolder,
    faServer,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import RemoteFilePicker from './RemoteFilePicker.svelte';
  import { featureCodesStore } from '$lib/stores/feature-codes.store.svelte';

  // Props for callbacks and initial values
  let {
    oncreate,
    oncancel,
    onclose,
    initialRepoPath = '',
    initialBranch = 'main',
    initialEnvironmentType = 'local' as 'local' | 'remote',
    initialSshConfig = null as any,
    deepLinkParams = null as Record<string, string> | null,
    isEmbedded = false,
  }: {
    oncreate?: (event: CustomEvent) => void;
    oncancel?: () => void;
    onclose?: () => void;
    initialRepoPath?: string;
    initialBranch?: string;
    initialEnvironmentType?: 'local' | 'remote';
    initialSshConfig?: any;
    deepLinkParams?: Record<string, string> | null;
    isEmbedded?: boolean;
  } = $props();

  // Svelte 5: Use $state for reactive variables
  // Form data
  let title = $state('');
  let repoSource: 'search' | 'local' = $state('search');
  let repoPath = $state(initialRepoPath);
  let searchQuery = $state('');
  let selectedRepo: any = $state(null);
  let branch = $state(initialBranch);
  let remoteWorkspacesEnabled = $derived(featureCodesStore.isFeatureEnabled('remote-workspaces'));
  let isRemote = $state(false);

  // Git repository info
  let repoInfo: {
    owner?: string;
    name?: string;
    remoteUrl?: string;
    currentBranch?: string;
    branches?: string[];
  } = $state({});
  let fetchingBranches = $state(false);
  let availableBranches = $state<Array<{ value: string; label: string }>>([]);

  // Git remotes (for fork workflows)
  let remotes = $state<Array<{ name: string; fetchUrl: string; pushUrl: string }>>([]);
  let selectedRemote = $state('origin');
  let currentRemotesFetchId = 0; // Used to ignore stale fetch results

  // SSH configuration for remote
  let sshConfig = $state(
    initialSshConfig || {
      host: '',
      port: 22,
      user: '',
      password: '',
      keyPath: '',
      useAgent: true,
      workspacePath: '/home/user/workspace',
    },
  );

  let errors = $state<Record<string, string>>({});
  let showRemoteFilePicker = $state(false);
  let isCreating = $state(false);

  // Linear issue selection
  let isLinearAuthenticated = $state(false);
  let selectedLinearIssue = $state<{
    id: string;
    identifier: string;
    title: string;
    description?: string;
    url?: string;
    teamName?: string;
    teamKey?: string;
    state?: string;
  } | null>(null);
  let linearIssues = $state<
    Array<{
      id: string;
      identifier: string;
      title: string;
      description?: string;
      url?: string;
      teamName?: string;
      teamKey?: string;
      state?: string;
    }>
  >([]);
  let isLoadingLinearIssues = $state(false);
  let linearIssueSearchValue = $state('');
  let linearIssueDropdownOpen = $state(false);
  let linearIssueSearchInputElement: any;
  let selectedLinearIssueIdentifier = $state<string>('');
  let linearIssueOptions = $derived(
    linearIssues.map((issue) => ({
      value: issue.identifier,
      label: `${issue.identifier}: ${issue.title}`,
      group: issue.teamName || 'Other',
    })),
  );

  // Filter Linear issues based on search
  const filteredLinearIssues = $derived(
    linearIssueSearchValue === ''
      ? linearIssues
      : linearIssues.filter((issue) => {
          const search = linearIssueSearchValue.toLowerCase();
          return (
            issue.identifier.toLowerCase().includes(search) ||
            issue.title.toLowerCase().includes(search) ||
            (issue.teamName && issue.teamName.toLowerCase().includes(search))
          );
        }),
  );

  // Recent repositories from existing workspaces
  interface RecentRepo {
    name: string;
    path: string;
    owner?: string;
    selected?: boolean;
    remote?: string;
  }
  let recentRepos: RecentRepo[] = $state([]);

  const commonBranches = [
    { value: 'main', label: 'main' },
    { value: 'master', label: 'master' },
    { value: 'develop', label: 'develop' },
    { value: 'staging', label: 'staging' },
  ];

  // Load Linear issues if authenticated
  async function loadLinearIssues() {
    try {
      const { linearAuthStore } =
        await import('$features/linear-auth/renderer/linear-auth.store.svelte');

      // Initialize the store first to get the latest auth status
      await linearAuthStore.initialize();
      isLinearAuthenticated = linearAuthStore.state.isAuthenticated;

      if (!isLinearAuthenticated) {
        logger.info('Linear not authenticated, skipping issue load');
        return;
      }

      isLoadingLinearIssues = true;
      const issues = await linearAuthStore.fetchMyIssues();
      linearIssues = issues;
      logger.info('Loaded Linear issues', { count: issues.length });
    } catch (error) {
      logger.error('Failed to load Linear issues', error as Error);
    } finally {
      isLoadingLinearIssues = false;
    }
  }

  // Focus search input when dropdown opens
  $effect(() => {
    if (linearIssueDropdownOpen) {
      requestAnimationFrame(() => {
        if (linearIssueSearchInputElement) {
          linearIssueSearchInputElement.focus();
          linearIssueSearchInputElement.select();
        }
      });
    }
  });

  // Handle Linear issue selection
  function handleLinearIssueSelect(identifier: string) {
    const issue = linearIssues.find((i) => i.identifier === identifier);
    if (issue) {
      selectedLinearIssue = issue;
      selectedLinearIssueIdentifier = identifier;
      linearIssueSearchValue = '';
      linearIssueDropdownOpen = false;
      // Optionally populate title if empty
      if (!title.trim() && issue.title) {
        title = issue.title;
      }
    } else {
      selectedLinearIssue = null;
      selectedLinearIssueIdentifier = '';
    }
  }

  // Handle Select value change
  $effect(() => {
    if (selectedLinearIssueIdentifier && selectedLinearIssueIdentifier !== selectedLinearIssue?.identifier) {
      handleLinearIssueSelect(selectedLinearIssueIdentifier);
    } else if (!selectedLinearIssueIdentifier && selectedLinearIssue) {
      selectedLinearIssue = null;
    }
  });

  // Load recent repositories and last selections
  onMount(async () => {
    // Set isRemote from initial prop only if remote-workspaces feature is enabled
    if (featureCodesStore.isFeatureEnabled('remote-workspaces') && initialEnvironmentType === 'remote') {
      isRemote = true;
    }

    // Load recent repos first
    loadRecentRepos();

    // Load Linear issues in background
    loadLinearIssues();

    // Apply deep link params if provided
    if (deepLinkParams) {
      if (deepLinkParams.title) title = deepLinkParams.title;
      if (deepLinkParams.repo) {
        // Determine if it's a GitHub URL or local path
        if (deepLinkParams.repo.includes('github.com')) {
          // Parse GitHub URL to extract repo info
          const match = deepLinkParams.repo.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            selectedRepo = {
              owner: match[1],
              name: match[2],
              fullName: `${match[1]}/${match[2]}`,
            };
            searchQuery = selectedRepo.fullName;
            repoSource = 'search';
          }
        } else {
          repoSource = 'local';
          repoPath = deepLinkParams.repo;
        }
      }
      if (deepLinkParams.branch) branch = deepLinkParams.branch;
      if (deepLinkParams.env === 'remote' && featureCodesStore.isFeatureEnabled('remote-workspaces')) {
        isRemote = true;
        if (deepLinkParams.ssh_host) sshConfig.host = deepLinkParams.ssh_host;
        if (deepLinkParams.ssh_user) sshConfig.user = deepLinkParams.ssh_user;
        if (deepLinkParams.ssh_port) sshConfig.port = parseInt(deepLinkParams.ssh_port);
        if (deepLinkParams.ssh_key_path) sshConfig.keyPath = deepLinkParams.ssh_key_path;
      }
      // Note: spec content would be handled after workspace creation
    } else {
      // Load last selections after recent repos are loaded
      await loadLastSelections();
    }
  });

  function loadRecentRepos() {
    const workspaces = workspaceStore.items;

    // Build a map of repo path -> owner for adding owner info
    const ownerMap = new Map<string, string | undefined>();
    for (const workspace of workspaces) {
      if (workspace.repositoryPath && workspace.repositoryOwner) {
        // Keep the owner from the most recent workspace (getRecentRepos handles this)
        if (!ownerMap.has(workspace.repositoryPath)) {
          ownerMap.set(workspace.repositoryPath, workspace.repositoryOwner);
        }
      }
    }

    // Use shared utility for deduplication and sorting
    const recentFromWorkspaces = getRecentRepos(workspaces);

    // Map to local RecentRepo format with owner and selected fields
    const sortedRepos: RecentRepo[] = recentFromWorkspaces.map((repo) => ({
      name: repo.name,
      path: repo.path,
      owner: ownerMap.get(repo.path),
      selected: false,
    }));

    // Merge with stored recent repos to maintain history
    const stored = localStorage.getItem('recent-repos');
    if (stored) {
      try {
        const storedRepos = JSON.parse(stored);
        // Add stored repos that aren't already in the list
        for (const storedRepo of storedRepos) {
          if (!sortedRepos.some((r) => r.path === storedRepo.path)) {
            sortedRepos.push({ ...storedRepo, selected: false });
          }
        }
      } catch (e) {
        logger.error('Failed to parse stored repos:', e);
      }
    }

    // Take only the top 3 most recent
    recentRepos = sortedRepos.slice(0, 3);
  }

  async function loadLastSelections() {
    // Load last used repo source
    const lastRepoSource = localStorage.getItem('last-repo-source');
    if (lastRepoSource === 'local' || lastRepoSource === 'search') {
      repoSource = lastRepoSource;
    }

    // Load last used branch first (it's independent of repo type)
    const lastBranch = localStorage.getItem('last-branch');
    if (lastBranch) {
      branch = lastBranch;
    }

    // Load repository based on source type
    if (repoSource === 'search') {
      // Load GitHub repository
      const lastGithubRepo = localStorage.getItem('last-github-repo');
      if (lastGithubRepo) {
        try {
          selectedRepo = JSON.parse(lastGithubRepo);
          if (selectedRepo && selectedRepo.fullName) {
            searchQuery = selectedRepo.fullName;
            // Trigger the GitHub URL handler to populate repo info, preserving branch
            handleGitHubUrlInput(`https://github.com/${selectedRepo.fullName}`, true);
          }
        } catch (e) {
          logger.error('Failed to parse last GitHub repo:', e);
        }
      }
    } else {
      // Load local repository path
      const lastRepoPath = localStorage.getItem('last-repo-path');
      if (lastRepoPath) {
        repoPath = lastRepoPath;

        // Check if this repo is in the recent repos list
        const matchingRepo = recentRepos.find((r) => r.path === lastRepoPath);
        if (matchingRepo) {
          // Mark it as selected
          recentRepos = recentRepos.map((r) => ({
            ...r,
            selected: r.path === lastRepoPath,
          }));
        }

        // Fetch repo info to populate the card
        await fetchRepoInfo(lastRepoPath);
      }
    }
  }

  function saveLastSelections() {
    // Save repo source
    localStorage.setItem('last-repo-source', repoSource);

    // Save branch
    localStorage.setItem('last-branch', branch);

    // Save repository information based on source
    if (repoSource === 'local' && repoPath) {
      localStorage.setItem('last-repo-path', repoPath);

      // Add to recent repos if not already there
      if (!recentRepos.some((r) => r.path === repoPath)) {
        const newRepo: RecentRepo = {
          name: repoPath.split('/').pop() || 'Unknown',
          path: repoPath,
          owner: repoInfo.owner,
        };
        recentRepos = [newRepo, ...recentRepos].slice(0, 10); // Keep last 10
        localStorage.setItem('recent-repos', JSON.stringify(recentRepos));
      }
    } else if (repoSource === 'search' && selectedRepo) {
      // Save GitHub repository info
      localStorage.setItem('last-github-repo', JSON.stringify(selectedRepo));
      // Don't save a path for GitHub repos since they don't have local paths

      // GitHub repos from search don't get added to recent repos
      // since they don't have local paths
    }
  }

  async function browseForRepo() {
    if (isRemote) {
      // Show remote file picker
      showRemoteFilePicker = true;
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Repository Directory',
      });

      if (selected) {
        repoPath = Array.isArray(selected) ? selected[0] : selected;
        repoSource = 'local';
        // Fetch git info for the selected folder
        await fetchRepoInfo(repoPath);
      }
    } catch (error) {
      logger.error('Failed to open directory picker:', error);
    }
  }

  function handleRemotePathSelect(path: string) {
    repoPath = path;
    showRemoteFilePicker = false;
  }

  function handleRemotePickerCancel() {
    showRemoteFilePicker = false;
  }

  async function selectRepo(repo: RecentRepo) {
    // Toggle selection
    recentRepos = recentRepos.map((r) => ({
      ...r,
      selected: r.path === repo.path ? !r.selected : false,
    }));

    const selected = recentRepos.find((r) => r.selected);
    if (selected) {
      repoPath = selected.path;
      repoSource = 'local';
      // Fetch repo info to populate the card, including owner from recent repo if available
      await fetchRepoInfo(selected.path);
      // Preserve owner info from recent repo
      if (selected.owner) {
        repoInfo = {
          ...repoInfo,
          owner: selected.owner,
        };
      }
    } else {
      // Deselected - clear repo info
      repoInfo = {};
    }
  }

  // Fetch git repository information
  async function fetchRepoInfo(path: string) {
    // For local repositories, just use the folder name
    // Note: git:info and git:branches IPC handlers don't exist yet
    const folderName = path.split('/').pop() || 'repository';
    repoInfo = {
      name: folderName,
      currentBranch: branch,
    };

    // Use common branches for now
    availableBranches = [...commonBranches];
    fetchingBranches = false;

    // Fetch remotes to enable fork workflows (e.g., origin vs upstream)
    // Use fetch ID to ignore stale results if user switches repos quickly
    const fetchId = ++currentRemotesFetchId;
    try {
      const remotesResult = await gitClient.getRemotes(path);
      // Ignore if a newer fetch has started
      if (fetchId !== currentRemotesFetchId) {
        return;
      }
      if (remotesResult.ok) {
        remotes = remotesResult.data.remotes;
        selectedRemote = remotesResult.data.defaultRemote;
      } else {
        // Silently ignore errors - remotes are optional
        remotes = [];
        selectedRemote = 'origin';
      }
    } catch (error) {
      // Ignore if a newer fetch has started
      if (fetchId !== currentRemotesFetchId) {
        return;
      }
      logger.debug('Failed to fetch remotes:', error);
      remotes = [];
      selectedRemote = 'origin';
    }
  }

  // Handle GitHub URL input
  function handleGitHubUrlInput(url: string, preserveBranch: boolean = false) {
    searchQuery = url;

    // Parse GitHub URL
    const githubUrlPattern = /^https?:\/\/github\.com\/([^\/]+)\/([^\/\s]+)(\.git)?$/;
    const match = url.match(githubUrlPattern);

    if (match) {
      const owner = match[1];
      const name = match[2].replace(/\.git$/, '');

      selectedRepo = {
        owner,
        name,
        fullName: `${owner}/${name}`,
      };

      repoInfo = {
        owner,
        name,
        remoteUrl: `https://github.com/${owner}/${name}.git`,
        currentBranch: branch || 'main', // Use existing branch if set
      };

      // Only update branch if not preserving and no branch is set
      if (!preserveBranch && !branch) {
        branch = 'main';
      }

      // Try to fetch branches for this repo
      // For now, use common branches
      availableBranches = [...commonBranches];
    } else {
      // Clear selection if URL is invalid
      selectedRepo = null;
      repoInfo = {};
    }
  }

  function validate(): boolean {
    errors = {};

    if (repoSource === 'search' && !selectedRepo && !searchQuery) {
      errors.repo = 'Please search for and select a repository';
    }

    if (repoSource === 'local' && (!repoPath || !repoPath.trim())) {
      errors.repo = 'Please select a local folder';
    }

    if (!branch || !branch.trim()) {
      errors.branch = 'Branch is required';
    }

    // Validate SSH config if remote
    if (isRemote) {
      if (!sshConfig.host) errors.host = 'Host is required';
      if (!sshConfig.user) errors.user = 'Username is required';
      if (!sshConfig.workspacePath) errors.workspacePath = 'Remote path is required';
    }

    return Object.keys(errors).length === 0;
  }

  async function handleCreate() {
    if (!validate()) return;

    isCreating = true;

    try {
      // Save selections for next time
      saveLastSelections();

      const detail = {
        title: title.trim() || undefined,
        baseRef: branch,
        repoPath: repoSource === 'local' ? repoPath : selectedRepo?.path,
        githubUrl: selectedRepo?.fullName
          ? `https://github.com/${selectedRepo.fullName}`
          : undefined,
        environmentType: isRemote ? 'remote' : 'local',
        sshConfig: isRemote ? sshConfig : null,
        // Include remote if not the default 'origin'
        remote: remotes.length > 1 ? selectedRemote : undefined,
        // Include Linear issue if selected
        linearIssue: selectedLinearIssue
          ? {
              id: selectedLinearIssue.id,
              identifier: selectedLinearIssue.identifier,
              title: selectedLinearIssue.title,
              description: selectedLinearIssue.description,
              url: selectedLinearIssue.url,
              teamName: selectedLinearIssue.teamName,
            }
          : undefined,
      };

      if (oncreate) {
        oncreate(new CustomEvent('create', { detail }));
      }
    } finally {
      isCreating = false;
    }
  }

  function cancel() {
    if (oncancel) {
      oncancel();
    } else if (onclose) {
      onclose();
    }
    resetForm();
  }

  function resetForm() {
    title = '';
    // Don't reset repoSource, repoPath, or branch - keep last selections
    errors = {};
  }
</script>

<div
  class={isEmbedded
    ? ''
    : 'fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-sm'}
  onclick={isEmbedded ? undefined : cancel}
  onkeydown={isEmbedded
    ? undefined
    : (e) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && validate() && !isCreating) {
          e.preventDefault();
          handleCreate();
        }
      }}
  aria-label={isEmbedded ? undefined : 'Close dialog'}
  role={isEmbedded ? undefined : 'button'}
>
  <Card
    class={isEmbedded
      ? 'w-full max-w-[700px] mx-auto shadow-lg bg-white dark:bg-background'
      : 'w-[90%] max-w-[700px] shadow-2xl bg-white dark:bg-background cursor-auto'}
    onclick={isEmbedded ? undefined : (e) => e.stopPropagation()}
    onkeydown={isEmbedded
      ? (e) => {
          if (e.key === 'Escape' && onclose) onclose();
          if (e.key === 'Enter' && validate() && !isCreating) {
            e.preventDefault();
            handleCreate();
          }
        }
      : undefined}
    role={isEmbedded ? undefined : 'dialog'}
    aria-modal={isEmbedded ? undefined : 'true'}
    aria-labelledby="create-workspace-title"
  >
    <CardHeader class="pb-6">
      <CardTitle id="create-workspace-title" class="text-3xl font-bold"
        >Create a Space</CardTitle
      >
      <p class="text-base text-muted-foreground mt-2">
        Create an isolated clone of a repo, ready to plan and tackle any task.
      </p>
    </CardHeader>

    <CardContent class="space-y-6 pb-8">
      <!-- Remote Toggle (gated behind remote-workspaces feature code) -->
      {#if remoteWorkspacesEnabled}
        <div class="flex items-center gap-3">
          <Label for="remote-toggle" class="text-base font-normal flex-1 cursor-pointer">
            Run on a remote server
          </Label>
          <Switch
            id="remote-toggle"
            bind:checked={isRemote}
            class="data-[state=checked]:bg-primary"
          />
        </div>
      {/if}

      <!-- Remote SSH Configuration -->
      {#if isRemote}
        <div
          class="space-y-4 p-4 bg-muted/30 rounded-lg border border-border"
          transition:slide={{ axis: 'y' }}
        >
          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label for="ssh-host" class="text-sm">Host</Label>
              <Input
                id="ssh-host"
                bind:value={sshConfig.host}
                placeholder="localhost"
                class="mt-1 {errors.host ? 'border-destructive' : ''}"
              />
              {#if errors.host}
                <span class="text-xs text-destructive">{errors.host}</span>
              {/if}
            </div>
            <div>
              <Label for="ssh-port" class="text-sm">Port</Label>
              <Input
                id="ssh-port"
                type="number"
                bind:value={sshConfig.port}
                placeholder="2222"
                class="mt-1"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label for="ssh-user" class="text-sm">Username</Label>
              <Input
                id="ssh-user"
                bind:value={sshConfig.user}
                placeholder="admin"
                class="mt-1 {errors.user ? 'border-destructive' : ''}"
              />
              {#if errors.user}
                <span class="text-xs text-destructive">{errors.user}</span>
              {/if}
            </div>
            <div>
              <Label for="ssh-password" class="text-sm">Password</Label>
              <Input
                id="ssh-password"
                type="password"
                bind:value={sshConfig.password}
                placeholder="••••••"
                class="mt-1"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label for="ssh-path" class="text-sm">Remote Space path</Label>
              <div class="flex gap-2 mt-1">
                <Input
                  id="ssh-path"
                  bind:value={sshConfig.workspacePath}
                  placeholder="/home/user/workspace"
                  class={errors.workspacePath ? 'border-destructive' : ''}
                />
                <Button size="icon" variant="outline" onclick={browseForRepo}>
                  <Fa icon={faFolder} class="h-4 w-4" />
                </Button>
              </div>
              {#if errors.workspacePath}
                <span class="text-xs text-destructive">{errors.workspacePath}</span>
              {/if}
            </div>
            <div>
              <Label for="ssh-key" class="text-sm">SSH key path</Label>
              <div class="flex gap-2 mt-1">
                <Input id="ssh-key" bind:value={sshConfig.keyPath} placeholder="~/.ssh/id_rsa" />
                <Button size="icon" variant="outline" onclick={() => {}}>
                  <Fa icon={faFolder} class="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <p class="text-xs text-muted-foreground italic">Connection will test automatically...</p>
        </div>
      {/if}

      <!-- Repository Selection -->
      <div class="space-y-4">
        <!-- GitHub URL Input and Local Folder on same row -->
        <div class="flex items-center gap-3">
          <!-- GitHub URL Input -->
          <div class="relative flex-1">
            <div class="absolute left-3 top-1/2 -translate-y-1/2 z-10">
              <Fa icon={faGithub} class="h-5 w-5 text-muted-foreground" />
            </div>
            <Input
              bind:value={searchQuery}
              placeholder="Paste a GitHub URL"
              oninput={(e) => {
                handleGitHubUrlInput(e.currentTarget.value);
                repoSource = 'search';
              }}
              class="w-full pl-12 pr-10"
            />
            {#if searchQuery}
              <button
                type="button"
                onclick={() => {
                  searchQuery = '';
                  selectedRepo = null;
                  repoInfo = {};
                  availableBranches = [...commonBranches];
                  remotes = [];
                  selectedRemote = 'origin';
                }}
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Fa icon={faXmark} class="h-4 w-4" />
              </button>
            {/if}
          </div>

          <!-- Or divider -->
          <span class="text-sm text-muted-foreground">or</span>

          <!-- Local folder button/display -->
          {#if repoPath}
            <!-- Show selected folder with X -->
            <div
              class="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-accent bg-accent/10"
            >
              <div class="relative flex items-center justify-center w-6 h-6">
                <Fa icon={faFolder} class="h-5 w-5 text-accent" />
              </div>
              <span class="text-sm font-medium whitespace-nowrap">
                {repoInfo.name || repoPath.split('/').pop() || 'Folder selected'}
              </span>
              <button
                type="button"
                onclick={() => {
                  repoPath = '';
                  repoSource = 'search';
                  repoInfo = {};
                  availableBranches = [...commonBranches];
                  remotes = [];
                  selectedRemote = 'origin';
                }}
                class="ml-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Fa icon={faXmark} class="h-4 w-4" />
              </button>
            </div>
          {:else}
            <!-- Show browse button -->
            <button
              type="button"
              onclick={browseForRepo}
              class="flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors border-border hover:bg-accent/10"
            >
              <div class="relative flex items-center justify-center w-6 h-6">
                <Fa icon={faFolder} class="h-5 w-5 text-muted-foreground" />
              </div>
              <span class="text-sm font-medium whitespace-nowrap"> Clone a local folder </span>
            </button>
          {/if}
        </div>

        {#if errors.repo}
          <span class="text-sm text-destructive">{errors.repo}</span>
        {/if}
      </div>

      <!-- Recent Repos - Always visible -->
      {#if recentRepos.length > 0}
        <div class="space-y-3">
          <p class="text-sm font-medium text-muted-foreground">Recent repos</p>
          <div class="space-y-px">
            {#each recentRepos as repo (repo.path || repo.name)}
              <Button
                onclick={() => selectRepo(repo)}
                class="w-full"
                variant={selectedRepo === repo ? 'secondary' : 'ghost'}
              >
                <Fa icon={faFolder} class="h-4 w-4 text-muted-foreground" />
                <div class="flex-1 min-w-0 justify-start text-left">
                  <div class="text-sm">
                    {#if repo.owner}
                      <span class="text-muted-foreground">{repo.owner} / </span>
                    {/if}
                    <span class="font-medium">{repo.name}</span>
                  </div>
                  {#if repo.remote}
                    <div class="text-xs text-muted-foreground mt-0.5">
                      <Fa icon={faCloud} class="inline h-3 w-3 mr-1" />
                      {repo.remote}
                    </div>
                  {/if}
                </div>
              </Button>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Repository Info Display -->
      {#if (selectedRepo || repoPath) && (repoInfo.name || repoInfo.owner)}
        <div class="p-4 bg-muted/30 rounded-lg border border-border">
          <div class="flex items-start gap-3">
            <div
              class="flex items-center justify-center w-10 h-10 rounded-full bg-accent/10 text-accent"
            >
              <Fa icon={repoSource === 'search' ? faGithub : faFolder} class="h-5 w-5" />
            </div>
            <div class="flex-1">
              <div class="font-medium text-base">
                {#if repoInfo.owner}
                  {repoInfo.owner} / {repoInfo.name}
                {:else}
                  {repoInfo.name}
                {/if}
              </div>
              {#if repoInfo.remoteUrl}
                <div class="text-sm text-muted-foreground mt-1">
                  <Fa icon={faCodeBranch} class="inline h-3 w-3 mr-1" />
                  {repoInfo.currentBranch || branch}
                </div>
              {/if}
              {#if repoSource === 'local' && repoPath}
                <div class="text-xs text-muted-foreground mt-1 font-mono">
                  {repoPath}
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Branch Selection -->
      {#if (repoSource === 'search' && selectedRepo) || (repoSource === 'local' && repoPath)}
        <div class="space-y-2">
          <Label for="branch" class="text-sm font-medium">Branch</Label>
          <SearchableSelect
            bind:value={branch}
            options={availableBranches.length > 0 ? availableBranches : commonBranches}
            placeholder={fetchingBranches ? 'Loading branches...' : 'Select or enter a branch'}
            searchPlaceholder="Search branches..."
            allowCustom={true}
            disabled={fetchingBranches}
            class="w-full"
          />
          {#if errors.branch}
            <span class="text-xs text-destructive">{errors.branch}</span>
          {/if}
        </div>
      {/if}

      <!-- Remote Selection (only shown for repos with multiple remotes, e.g., forks) -->
      {#if remotes.length > 1 && repoSource === 'local' && repoPath}
        <div class="flex items-center gap-1">
          <Select.Root bind:value={selectedRemote}>
            <Select.Trigger
              class="border-0 bg-transparent hover:bg-none text-muted-foreground h-8 px-2 transition-colors"
            >
              <div class="flex items-center gap-1.5 truncate text-muted-foreground">
                <Fa icon={faServer} class="h-3 w-3" />
                <span class="flex-1 text-left truncate text-xs">
                  {selectedRemote}
                </span>
              </div>
            </Select.Trigger>
            <Select.Content class="max-h-60 overflow-y-auto">
              {#each remotes as remote}
                <Select.Item value={remote.name}>
                  <div class="flex flex-col gap-0.5">
                    <span class="font-medium">{remote.name}</span>
                    <span class="text-xs text-muted-foreground truncate max-w-[250px]">
                      {remote.fetchUrl}
                    </span>
                  </div>
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <!-- Linear Issue Selection (optional) -->
      {#if isLinearAuthenticated}
        <div class="flex items-center gap-1">
          <div class="relative">
            <Select.Root
              bind:value={selectedLinearIssueIdentifier}
              bind:open={linearIssueDropdownOpen}
            >
              <Select.Trigger
                class="border-0 bg-transparent hover:bg-none text-muted-foreground h-8 px-2 transition-colors"
              >
                <div class="flex items-center gap-1.5 truncate text-muted-foreground">
                  <LinearIcon size={14} class="text-muted-foreground" />
                  <span class="flex-1 text-left truncate">
                    {#if selectedLinearIssue}
                      <span>{selectedLinearIssue.identifier}</span>
                    {:else if isLoadingLinearIssues}
                      <span>Loading issues...</span>
                    {:else if linearIssues.length === 0}
                      <span>No issues found</span>
                    {:else}
                      <span>Link Linear Issue</span>
                    {/if}
                  </span>
                  {#if isLoadingLinearIssues && !selectedLinearIssue}
                    <Fa icon={faSpinner} class="ml-auto animate-spin text-muted-foreground" size="sm" />
                  {/if}
                </div>
              </Select.Trigger>
              <Select.Content
                class="max-w-[400px] min-w-[400px] max-h-[600px] overflow-hidden flex flex-col"
              >
                <div class="w-full text-sm px-3 py-2 mb-2 -mt-1 bg-muted/50 text-muted-foreground">
                  Link a Linear issue to this workspace (optional)
                </div>
                <div class="-mt-1 px-2 pb-1 pt-1 sticky -top-1 bg-background z-10">
                  <Input
                    bind:this={linearIssueSearchInputElement}
                    bind:value={linearIssueSearchValue}
                    autofocus
                    placeholder="Search issues..."
                    class="bg-sidebar focus:ring-0! focus:outline-none! border-0"
                  />
                </div>
                <div class="overflow-y-auto flex-1 pt-2">
                  {#if isLoadingLinearIssues && linearIssues.length === 0}
                    <div class="px-4 py-3">
                      <div class="space-y-3">
                        {#each [1, 2, 3] as _}
                          <div class="flex items-center gap-2">
                            <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                            <div class="h-4 bg-muted rounded flex-1 animate-pulse"></div>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {:else if filteredLinearIssues.length > 0}
                    <div class="px-2 pb-1">
                      {#each filteredLinearIssues as issue (issue.id)}
                        <Button
                          variant="ghost"
                          onclick={() => handleLinearIssueSelect(issue.identifier)}
                          class="w-full justify-start text-left"
                        >
                          <LinearIcon size={14} class="text-muted-foreground shrink-0" />
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1">
                              <span class="text-sm font-medium">{issue.identifier}</span>
                              {#if selectedLinearIssue && issue.identifier === selectedLinearIssue.identifier}
                                <Fa icon={faCheck} class="text-primary" size="sm" />
                              {/if}
                            </div>
                            <span class="text-xs text-muted-foreground truncate block">{issue.title}</span>
                          </div>
                        </Button>
                      {/each}
                    </div>
                  {:else if linearIssueSearchValue && !isLoadingLinearIssues}
                    <div class="px-2 py-2 text-sm text-muted-foreground">No issues match your search</div>
                  {:else if !isLoadingLinearIssues}
                    <div class="px-2 py-2 text-sm text-muted-foreground">No issues found</div>
                  {/if}
                </div>
              </Select.Content>
            </Select.Root>
          </div>
          {#if selectedLinearIssue}
            <button
              type="button"
              onclick={() => {
                selectedLinearIssue = null;
                selectedLinearIssueIdentifier = '';
                linearIssueSearchValue = '';
              }}
              class="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Fa icon={faXmark} class="h-4 w-4" />
            </button>
          {/if}
        </div>
      {/if}

      <!-- Create Button -->
      <Button
        onclick={handleCreate}
        type="submit"
        size="lg"
        disabled={isCreating || (!selectedRepo && repoSource === 'search' && !repoPath)}
        class="w-full"
      >
        {#if isCreating}
          <Fa icon={faServer} class="mr-2 h-4 w-4 animate-spin" />
          Creating workspace...
        {:else}
          Take me to my new Workspace!
        {/if}
      </Button>
    </CardContent>
  </Card>
</div>

<!-- Remote File Picker Modal -->
{#if showRemoteFilePicker}
  <button
    type="button"
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-60 animate-in fade-in duration-200 cursor-default"
    onclick={handleRemotePickerCancel}
    onkeydown={(e) => e.key === 'Escape' && handleRemotePickerCancel()}
    aria-label="Close remote file picker"
  >
    <div
      class="bg-background rounded-lg w-[90%] max-w-[800px] p-6 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 cursor-auto"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label="Browse Remote Filesystem"
      tabindex="-1"
    >
      <div class="mb-4">
        <h3 class="text-xl font-semibold">Browse Remote Filesystem</h3>
        <p class="text-sm text-muted-foreground mt-1">
          Select a directory on <strong>{sshConfig.host}</strong>
        </p>
      </div>

      <RemoteFilePicker
        {sshConfig}
        initialPath="/home"
        onSelect={handleRemotePathSelect}
        onCancel={handleRemotePickerCancel}
      />
    </div>
  </button>
{/if}
