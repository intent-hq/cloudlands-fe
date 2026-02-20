<script lang="ts">
  import { handleLink } from '$features/navigation/link-handler';
  import type { SentryIssueResult } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import { sentryAuthStore } from '$features/sentry-auth/renderer/sentry-auth.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import SentryIcon from '$lib/components/icons/SentryIcon.svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { OptionGroup } from '$lib/components/ui/grouped-combobox/types';
  import { Input } from '$lib/components/ui/input';
  import { createLogger } from '$lib/utils/client-logger';
  import { faCheck, faFolder, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  const logger = createLogger('SentryIssuePicker');

  interface Props {
    selectedIssue?: SentryIssueResult | null;
    promptText?: string;
    onSelect?: (issue: SentryIssueResult | null) => void;
  }

  let { selectedIssue = $bindable(null), promptText = $bindable(''), onSelect }: Props = $props();

  // State
  let isSentryAuthenticated = $state(false);
  let sentryIssues = $state<SentryIssueResult[]>([]);
  let isLoadingSentryIssues = $state(false);
  let sentryIssueSearchValue = $state('');
  let sentryIssueDropdownOpen = $state(false);
  let sentryIssueSearchInputElement: { focus: () => void } | undefined = $state();
  let selectedSentryIssueId = $state<string>('');
  let containerRef = $state<HTMLDivElement | null>(null);
  let leftPanelRef = $state<HTMLDivElement | null>(null);

  // Config form state (for unauthenticated users)
  let configFormOpen = $state(false);
  let sentryOrg = $state('');
  let sentryToken = $state('');
  let isConnecting = $state(false);

  // Hover state for flyout
  let hoveredProjectKey = $state<string | null>(null);
  let isHoveringProject = $state(false);
  let isHoveringFlyout = $state(false);
  let flyoutVisible = $state(false);
  let closeTimeout: ReturnType<typeof setTimeout> | null = null;
  let openTimeout: ReturnType<typeof setTimeout> | null = null;

  // Keyboard navigation state
  let focusedProjectIndex = $state<number>(-1);
  let focusedIssueIndex = $state<number>(-1);
  let focusPanel = $state<'projects' | 'issues'>('projects');

  // Flyout position
  let flyoutMaxHeight = $state(400);
  let flyoutTop = $state(0);

  // Group issues by project
  const issuesByProject = $derived.by(() => {
    const groups: OptionGroup[] = [];
    const projectMap = new Map<string, { name: string; issues: SentryIssueResult[] }>();

    for (const issue of sentryIssues) {
      const projectSlug = issue.projectSlug || 'unknown';
      const projectName = issue.projectName || 'Unknown Project';

      if (!projectMap.has(projectSlug)) {
        projectMap.set(projectSlug, { name: projectName, issues: [] });
      }
      projectMap.get(projectSlug)!.issues.push(issue);
    }

    const sortedProjects = Array.from(projectMap.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    );

    for (const [key, { name, issues }] of sortedProjects) {
      groups.push({
        key,
        label: name,
        icon: faFolder,
        options: issues.map((issue) => ({
          value: issue.id,
          label: issue.title,
          description: issue.shortId,
          data: issue,
        })),
      });
    }

    return groups;
  });

  // Filter projects/issues based on search
  const filteredProjectGroups = $derived.by(() => {
    if (!sentryIssueSearchValue) return issuesByProject;

    const search = sentryIssueSearchValue.toLowerCase();
    return issuesByProject
      .map((group) => ({
        ...group,
        options: group.options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(search) ||
            opt.description?.toLowerCase().includes(search) ||
            group.label.toLowerCase().includes(search),
        ),
      }))
      .filter((group) => group.options.length > 0);
  });

  // Active group for flyout
  const activeGroup = $derived(
    hoveredProjectKey ? filteredProjectGroups.find((g) => g.key === hoveredProjectKey) : null,
  );

  // Clear all timeouts
  function clearAllTimeouts() {
    if (closeTimeout) {
      clearTimeout(closeTimeout);
      closeTimeout = null;
    }
    if (openTimeout) {
      clearTimeout(openTimeout);
      openTimeout = null;
    }
  }

  // Calculate flyout position based on hovered project row
  function calculateFlyoutPosition(projectKey: string) {
    if (!leftPanelRef) return;

    const projectRow = leftPanelRef.querySelector(
      `[data-project-key="${projectKey}"]`,
    ) as HTMLElement;
    if (!projectRow) return;

    const panelRect = leftPanelRef.getBoundingClientRect();
    const rowRect = projectRow.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    const topRelativeToPanel = rowRect.top - panelRect.top;
    flyoutTop = topRelativeToPanel;

    const spaceBelow = viewportHeight - rowRect.top - 20;
    const spaceAbove = rowRect.bottom - 20;
    flyoutMaxHeight = Math.min(400, Math.max(spaceBelow, spaceAbove, 200));
  }

  // Programmatically select a project (for keyboard nav + search)
  function selectProject(projectKey: string) {
    clearAllTimeouts();
    hoveredProjectKey = projectKey;
    calculateFlyoutPosition(projectKey);
    flyoutVisible = true;
    focusedIssueIndex = -1;
  }

  // Hover handlers
  function handleProjectMouseEnter(projectKey: string) {
    clearAllTimeouts();
    isHoveringProject = true;
    const idx = filteredProjectGroups.findIndex((g) => g.key === projectKey);
    if (idx !== -1) {
      focusedProjectIndex = idx;
      focusPanel = 'projects';
    }
    openTimeout = setTimeout(() => selectProject(projectKey), 50);
  }

  function handleProjectMouseLeave() {
    isHoveringProject = false;
    scheduleClose();
  }

  function handleFlyoutMouseEnter() {
    clearAllTimeouts();
    isHoveringFlyout = true;
  }

  function handleFlyoutMouseLeave() {
    isHoveringFlyout = false;
    scheduleClose();
  }

  function scheduleClose() {
    if (focusPanel === 'issues' || focusedProjectIndex >= 0) return;
    clearAllTimeouts();
    closeTimeout = setTimeout(() => {
      if (!isHoveringProject && !isHoveringFlyout) {
        flyoutVisible = false;
        setTimeout(() => {
          if (!isHoveringProject && !isHoveringFlyout) hoveredProjectKey = null;
        }, 150);
      }
    }, 200);
  }

  // Load Sentry issues
  async function loadSentryIssues() {
    try {
      await sentryAuthStore.initialize();
      isSentryAuthenticated = sentryAuthStore.state.isAuthenticated;

      if (!isSentryAuthenticated) {
        logger.info('Sentry not authenticated, skipping issue load');
        return;
      }

      isLoadingSentryIssues = true;
      const [projects, issues] = await Promise.all([
        sentryAuthStore.fetchProjects(),
        sentryAuthStore.fetchIssues(),
      ]);
      sentryIssues = issues;
      logger.info('Loaded Sentry issues', { count: issues.length, projects: projects.length });
    } catch (error) {
      logger.error('Failed to load Sentry issues', error as Error);
    } finally {
      isLoadingSentryIssues = false;
    }
  }

  // Handle Sentry connection
  async function handleSentryConnect() {
    if (!sentryOrg.trim() || !sentryToken.trim()) return;
    isConnecting = true;
    try {
      const success = await sentryAuthStore.connect(sentryOrg.trim(), sentryToken.trim());
      if (success) {
        configFormOpen = false;
        sentryOrg = '';
        sentryToken = '';
        isSentryAuthenticated = true;
        await loadSentryIssues();
      }
    } finally {
      isConnecting = false;
    }
  }

  function handleSentryCancel() {
    configFormOpen = false;
    sentryOrg = '';
    sentryToken = '';
    sentryAuthStore.clearError();
  }

  // Handle issue selection
  function handleSentryIssueSelect(issueId: string) {
    const issue = sentryIssues.find((i) => i.id === issueId);
    if (issue) {
      selectedIssue = issue;
      selectedSentryIssueId = issueId;
      sentryIssueSearchValue = '';
      sentryIssueDropdownOpen = false;
      hoveredProjectKey = null;
      flyoutVisible = false;
      resetKeyboardState();

      // Build comprehensive error context
      const parts: string[] = [`[${issue.shortId}] ${issue.title}`];

      // Add error type and value if available
      if (issue.type || issue.value) {
        const errorInfo = [issue.type, issue.value].filter(Boolean).join(': ');
        if (errorInfo && errorInfo !== issue.title) {
          parts.push(`Error: ${errorInfo}`);
        }
      }

      // Add location info
      if (issue.filename || issue.function || issue.culprit) {
        const location = issue.filename
          ? `${issue.filename}${issue.function ? ` in ${issue.function}()` : ''}`
          : issue.culprit;
        if (location) {
          parts.push(`Location: ${location}`);
        }
      }

      // Add stats
      const stats: string[] = [];
      if (issue.count) stats.push(`${issue.count} events`);
      if (issue.userCount) stats.push(`${issue.userCount} users affected`);
      if (issue.level) stats.push(`Level: ${issue.level}`);
      if (issue.status) stats.push(`Status: ${issue.status}`);
      if (stats.length > 0) {
        parts.push(stats.join(' · '));
      }

      // Add timestamps
      if (issue.firstSeen || issue.lastSeen) {
        const formatDate = (dateStr: string) => {
          try {
            return new Date(dateStr).toLocaleString();
          } catch {
            return dateStr;
          }
        };
        const times: string[] = [];
        if (issue.firstSeen) times.push(`First seen: ${formatDate(issue.firstSeen)}`);
        if (issue.lastSeen) times.push(`Last seen: ${formatDate(issue.lastSeen)}`);
        parts.push(times.join(' · '));
      }

      // Add URL
      if (issue.url) {
        parts.push(`URL: ${issue.url}`);
      }

      const issueText = parts.join('\n');
      const currentText = promptText?.trim() || '';
      if (currentText) {
        const issuePattern = new RegExp(`\\[${issue.shortId}\\].*?(?=\\n\\n|$)`, 's');
        if (!issuePattern.test(currentText)) {
          promptText = `${currentText}\n\n${issueText}`;
        }
      } else {
        promptText = issueText;
      }
      onSelect?.(issue);
    } else {
      selectedIssue = null;
      selectedSentryIssueId = '';
      onSelect?.(null);
    }
  }

  function clearSelection() {
    selectedIssue = null;
    selectedSentryIssueId = '';
    sentryIssueSearchValue = '';
    onSelect?.(null);
  }

  function resetKeyboardState() {
    focusedProjectIndex = -1;
    focusedIssueIndex = -1;
    focusPanel = 'projects';
  }

  function handleClickOutside(event: MouseEvent) {
    if (containerRef && !containerRef.contains(event.target as Node)) {
      sentryIssueDropdownOpen = false;
      hoveredProjectKey = null;
      flyoutVisible = false;
      resetKeyboardState();
    }
  }

  // Keyboard navigation handler
  function handleKeydown(event: KeyboardEvent) {
    if (!sentryIssueDropdownOpen) return;

    const projects = filteredProjectGroups;
    const issues = activeGroup?.options ?? [];

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (focusPanel === 'issues') {
          // Go back to projects panel
          focusPanel = 'projects';
          focusedIssueIndex = -1;
        } else if (flyoutVisible) {
          flyoutVisible = false;
          hoveredProjectKey = null;
        } else {
          sentryIssueDropdownOpen = false;
          resetKeyboardState();
        }
        break;

      case 'ArrowDown':
        event.preventDefault();
        if (focusPanel === 'projects') {
          focusedProjectIndex = Math.min(focusedProjectIndex + 1, projects.length - 1);
          if (focusedProjectIndex >= 0 && projects[focusedProjectIndex]) {
            selectProject(projects[focusedProjectIndex].key);
          }
        } else if (focusPanel === 'issues') {
          focusedIssueIndex = Math.min(focusedIssueIndex + 1, issues.length - 1);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (focusPanel === 'projects') {
          focusedProjectIndex = Math.max(focusedProjectIndex - 1, 0);
          if (projects[focusedProjectIndex]) {
            selectProject(projects[focusedProjectIndex].key);
          }
        } else if (focusPanel === 'issues') {
          if (focusedIssueIndex <= 0) {
            // Go back to projects
            focusPanel = 'projects';
            focusedIssueIndex = -1;
          } else {
            focusedIssueIndex = focusedIssueIndex - 1;
          }
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (focusPanel === 'projects' && flyoutVisible && issues.length > 0) {
          focusPanel = 'issues';
          focusedIssueIndex = 0;
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (focusPanel === 'issues') {
          focusPanel = 'projects';
          focusedIssueIndex = -1;
        }
        break;

      case 'Enter':
        event.preventDefault();
        if (focusPanel === 'projects' && focusedProjectIndex >= 0) {
          // Enter on project -> go to issues
          if (issues.length > 0) {
            focusPanel = 'issues';
            focusedIssueIndex = 0;
          }
        } else if (focusPanel === 'issues' && focusedIssueIndex >= 0 && issues[focusedIssueIndex]) {
          handleSentryIssueSelect(issues[focusedIssueIndex].value);
        }
        break;

      case 'Tab':
        // Allow tab to close dropdown naturally
        sentryIssueDropdownOpen = false;
        resetKeyboardState();
        break;
    }
  }

  // Auto-open first project on search
  $effect(() => {
    if (sentryIssueSearchValue && filteredProjectGroups.length > 0) {
      const timeout = setTimeout(() => {
        const firstProject = filteredProjectGroups[0];
        if (firstProject) {
          focusedProjectIndex = 0;
          focusPanel = 'projects';
          selectProject(firstProject.key);
        }
      }, 100);
      return () => clearTimeout(timeout);
    } else if (!sentryIssueSearchValue) {
      hoveredProjectKey = null;
      flyoutVisible = false;
      resetKeyboardState();
    }
  });

  // Effects
  $effect(() => {
    if (sentryIssueDropdownOpen) {
      resetKeyboardState();
      requestAnimationFrame(() => sentryIssueSearchInputElement?.focus());
    }
  });

  $effect(() => {
    if (selectedIssue) {
      selectedSentryIssueId = selectedIssue.id;
    } else if (!selectedIssue && selectedSentryIssueId) {
      selectedSentryIssueId = '';
    }
  });

  $effect(() => {
    if (sentryIssueDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeydown);
        clearAllTimeouts();
      };
    }
  });

  onMount(() => {
    loadSentryIssues();
  });
</script>

<div class="relative" bind:this={containerRef}>
  <!-- Trigger Button -->
  <button
    type="button"
    onclick={() => (sentryIssueDropdownOpen = !sentryIssueDropdownOpen)}
    class="size-8 p-0 pt-1 flex items-center justify-center rounded-md border-0 bg-transparent cursor-pointer"
    aria-label="Link Sentry issue"
    aria-haspopup="true"
    aria-expanded={sentryIssueDropdownOpen}
  >
    <SentryIcon size={18} class={selectedIssue ? 'text-primary' : 'text-muted-foreground'} />
  </button>

  <!-- Dropdown -->
  {#if sentryIssueDropdownOpen}
    <div class="absolute top-full left-0 z-9999 mt-1.5">
      {#if !isSentryAuthenticated}
        <!-- Not Authenticated -->
        <div class="w-[280px] bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          <div class="px-3 py-2 border-b border-border/50">
            <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Sentry
            </span>
          </div>
          <div class="p-4">
            {#if configFormOpen}
              <div class="space-y-3">
                <div class="space-y-1.5">
                  <label for="sentry-org-picker" class="text-xs text-muted-foreground"
                    >Organization</label
                  >
                  <input
                    id="sentry-org-picker"
                    type="text"
                    bind:value={sentryOrg}
                    placeholder="my-organization"
                    class="w-full h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div class="space-y-1.5">
                  <label for="sentry-token-picker" class="text-xs text-muted-foreground"
                    >API Token</label
                  >
                  <input
                    id="sentry-token-picker"
                    type="password"
                    bind:value={sentryToken}
                    placeholder="sntrys_..."
                    class="w-full h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {#if sentryAuthStore.state.error}
                  <p class="text-xs text-destructive">{sentryAuthStore.state.error}</p>
                {/if}
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="flex-1 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50"
                    onclick={handleSentryConnect}
                    disabled={isConnecting || !sentryOrg.trim() || !sentryToken.trim()}
                  >
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    onclick={handleSentryCancel}
                  >
                    <Fa icon={faXmark} size="xs" />
                  </button>
                </div>
              </div>
            {:else}
              <div class="text-center">
                <SentryIcon size={24} class="mx-auto text-muted-foreground/50 mb-3" />
                <p class="text-sm text-foreground mb-1">Connect to Sentry</p>
                <p class="text-xs text-muted-foreground mb-3">
                  Link error issues to your workspace
                </p>
                <p class="text-xs text-muted-foreground/80 mb-4">
                  Create a token at{' '}
                  <button
                    type="button"
                    onclick={() => {
                      const wsId = workspaceStore.current?.id;
                      if (wsId) {
                        handleLink('https://sentry.io/settings/account/api/auth-tokens/', {
                          workspaceId: WorkspaceId(wsId),
                        });
                      }
                    }}
                    class="text-primary hover:underline cursor-pointer"
                  >
                    sentry.io/.../auth-tokens
                  </button>
                  {' '}with scopes:
                  <span class="font-mono text-foreground/70"
                    >org:read, project:read, event:read</span
                  >
                </p>
                <button
                  type="button"
                  class="px-4 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90"
                  onclick={() => (configFormOpen = true)}
                >
                  Connect
                </button>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Authenticated: Show issues panel -->
        <div class="relative flex items-start">
          <!-- Left Panel: Projects -->
          <div
            bind:this={leftPanelRef}
            class="w-[220px] bg-popover border border-border rounded-lg shadow-xl overflow-hidden flex flex-col"
          >
            <div class="px-2.5 py-1.5 border-b border-border/50 shrink-0">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Link Sentry Issue
                </span>
                {#if selectedIssue}
                  <button
                    type="button"
                    onclick={clearSelection}
                    class="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                {/if}
              </div>
            </div>

            <div class="p-1.5 border-b border-border/50 shrink-0">
              <Input
                bind:this={sentryIssueSearchInputElement}
                bind:value={sentryIssueSearchValue}
                placeholder="Search issues..."
                class="h-7 text-xs bg-muted/50 border-0 focus:ring-1 focus:ring-primary/30"
              />
            </div>

            <div class="overflow-y-auto max-h-[350px] flex-1 overscroll-contain">
              {#if isLoadingSentryIssues && sentryIssues.length === 0}
                <div class="p-2 space-y-1.5">
                  {#each [1, 2, 3] as _}
                    <div class="flex items-center gap-2 py-1">
                      <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                      <div class="h-3 bg-muted rounded flex-1 animate-pulse"></div>
                    </div>
                  {/each}
                </div>
              {:else if filteredProjectGroups.length > 0}
                <div class="py-0.5" role="listbox">
                  {#each filteredProjectGroups as group, idx (group.key)}
                    {@const isActive = hoveredProjectKey === group.key}
                    {@const isKeyboardFocused =
                      focusPanel === 'projects' && focusedProjectIndex === idx}
                    <div
                      data-project-key={group.key}
                      class="flex items-center gap-2 px-2 py-1.5 transition-colors duration-150 cursor-pointer
                             {isActive || isKeyboardFocused ? 'bg-muted/70' : ''}
                             {isKeyboardFocused ? 'ring-1 ring-inset ring-primary/50' : ''}"
                      role="option"
                      tabindex="-1"
                      aria-selected={isActive}
                      onmouseenter={() => handleProjectMouseEnter(group.key)}
                      onmouseleave={handleProjectMouseLeave}
                    >
                      <div
                        class="w-4 h-4 rounded bg-muted/80 flex items-center justify-center shrink-0"
                      >
                        <Fa icon={faFolder} class="w-2 h-2 text-muted-foreground" />
                      </div>
                      <span class="flex-1 text-xs font-medium truncate">{group.label}</span>
                      <span class="text-[10px] text-muted-foreground tabular-nums"
                        >{group.options.length}</span
                      >
                      <svg
                        class="w-3.5 h-3.5 text-muted-foreground transition-transform duration-150
                               {isActive || isKeyboardFocused ? 'translate-x-0.5' : ''}"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </div>
                  {/each}
                </div>
              {:else if sentryIssueSearchValue && !isLoadingSentryIssues}
                <div class="px-2.5 py-6 text-center">
                  <p class="text-xs text-muted-foreground">
                    No issues match "{sentryIssueSearchValue}"
                  </p>
                </div>
              {:else if !isLoadingSentryIssues}
                <div class="px-2.5 py-6 text-center">
                  <SentryIcon size={20} class="mx-auto opacity-50 text-muted-foreground mb-1.5" />
                  <p class="text-xs text-muted-foreground">No issues found</p>
                </div>
              {/if}
            </div>

            <!-- Footer with keyboard hints -->
            {#if filteredProjectGroups.length > 0 && !isLoadingSentryIssues}
              <div
                class="px-2.5 py-1 border-t border-border/50 shrink-0 flex items-center justify-between"
              >
                <span class="text-[9px] text-muted-foreground/60">
                  {sentryIssueSearchValue ? 'Type to filter' : 'Hover or ↑↓ to browse'}
                </span>
                <span class="text-[9px] text-muted-foreground/60"> → to select </span>
              </div>
            {/if}
          </div>

          <!-- Right Panel: Issues Flyout -->
          {#if hoveredProjectKey && activeGroup}
            <div
              class="absolute left-full top-0 ml-1 w-[280px] transition-all duration-150
                     {flyoutVisible
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-2 pointer-events-none'}"
              style="top: {flyoutTop}px;"
              role="region"
              aria-label="Issues for {activeGroup.label}"
              onmouseenter={handleFlyoutMouseEnter}
              onmouseleave={handleFlyoutMouseLeave}
            >
              <div class="absolute -left-2 top-0 w-2 h-full"></div>
              <div
                class="bg-popover border border-border rounded-lg shadow-xl overflow-hidden flex flex-col"
                style="max-height: {flyoutMaxHeight}px;"
              >
                <!-- Flyout Header -->
                <div
                  class="px-2.5 py-1.5 border-b border-border/50 shrink-0 flex items-center justify-between"
                >
                  <span
                    class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
                  >
                    {activeGroup.label}
                  </span>
                  {#if focusPanel === 'issues'}
                    <span class="text-[9px] text-muted-foreground/60">← back</span>
                  {/if}
                </div>
                <div class="overflow-y-auto flex-1 py-0.5 overscroll-contain" role="listbox">
                  {#each activeGroup.options as option, idx (option.value)}
                    {@const isSelected = selectedIssue?.id === option.value}
                    {@const isKeyboardFocused =
                      focusPanel === 'issues' && focusedIssueIndex === idx}
                    <button
                      type="button"
                      onclick={() => handleSentryIssueSelect(option.value)}
                      class="w-full text-left px-2 py-1.5 flex items-start gap-2 transition-colors duration-100 cursor-pointer
                             {isSelected
                        ? 'bg-primary/10'
                        : isKeyboardFocused
                          ? 'bg-muted/70'
                          : 'hover:bg-muted/70'}
                             {isKeyboardFocused ? 'ring-1 ring-inset ring-primary/50' : ''}"
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div
                        class="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5 {isSelected
                          ? 'bg-primary/20'
                          : 'bg-muted/60'}"
                      >
                        {#if isSelected}
                          <Fa icon={faCheck} class="w-2 h-2 text-primary" />
                        {:else}
                          <SentryIcon size={10} class="text-muted-foreground" />
                        {/if}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1 mb-0.5">
                          <span class="text-[10px] font-mono text-muted-foreground"
                            >{option.description}</span
                          >
                        </div>
                        <span
                          class="text-xs leading-snug line-clamp-2 {isSelected
                            ? 'text-foreground font-medium'
                            : 'text-foreground/90'}"
                        >
                          {option.label}
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
