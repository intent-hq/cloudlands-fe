<script lang="ts">
  import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.store.svelte';
  import { linearAuthStore } from '$features/linear-auth/renderer/linear-auth.store.svelte';
  import LinearIcon from '$lib/components/icons/LinearIcon.svelte';
  import type { OptionGroup } from '$lib/components/ui/grouped-combobox/types';
  import { Input } from '$lib/components/ui/input';
  import { createLogger } from '$lib/utils/client-logger';
  import { faCheck, faSpinner, faUsers, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';

  const logger = createLogger('LinearIssuePicker');

  interface Props {
    selectedIssue?: LinearIssueResult | null;
    promptText?: string;
    onSelect?: (issue: LinearIssueResult | null) => void;
  }

  let { selectedIssue = $bindable(null), promptText = $bindable(''), onSelect }: Props = $props();

  // State
  let isLinearAuthenticated = $state(false);
  let linearIssues = $state<LinearIssueResult[]>([]);
  let isLoadingLinearIssues = $state(false);
  let linearIssueSearchValue = $state('');
  let linearIssueDropdownOpen = $state(false);
  let linearIssueSearchInputElement: any = $state();
  let selectedLinearIssueIdentifier = $state<string>('');
  let containerRef = $state<HTMLDivElement | null>(null);
  let leftPanelRef = $state<HTMLDivElement | null>(null);

  // Auth flow state
  let linearAuthStarted = $state(false);
  let isCheckingLinearAuth = $state(false);
  let authPollingInterval: ReturnType<typeof setInterval> | null = null;

  // Hover state for flyout
  let hoveredTeamKey = $state<string | null>(null);
  let isHoveringTeam = $state(false);
  let isHoveringFlyout = $state(false);
  let flyoutVisible = $state(false);
  let closeTimeout: ReturnType<typeof setTimeout> | null = null;
  let openTimeout: ReturnType<typeof setTimeout> | null = null;

  // Keyboard navigation state
  let focusedTeamIndex = $state<number>(-1);
  let focusedIssueIndex = $state<number>(-1);
  let focusPanel = $state<'teams' | 'issues'>('teams');

  // Flyout position
  let flyoutMaxHeight = $state(400);
  let flyoutTop = $state(0);

  // Group issues by team
  const issuesByTeam = $derived.by(() => {
    const groups: OptionGroup[] = [];
    const teamMap = new Map<string, { name: string; issues: LinearIssueResult[] }>();

    for (const issue of linearIssues) {
      const teamKey = issue.teamKey || 'unknown';
      const teamName = issue.teamName || 'Unknown Team';

      if (!teamMap.has(teamKey)) {
        teamMap.set(teamKey, { name: teamName, issues: [] });
      }
      teamMap.get(teamKey)!.issues.push(issue);
    }

    const sortedTeams = Array.from(teamMap.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    );

    for (const [key, { name, issues }] of sortedTeams) {
      groups.push({
        key,
        label: name,
        icon: faUsers,
        options: issues.map((issue) => ({
          value: issue.identifier,
          label: issue.title,
          description: issue.identifier,
          data: issue,
        })),
      });
    }

    return groups;
  });

  // Filter teams/issues based on search
  const filteredTeamGroups = $derived.by(() => {
    if (!linearIssueSearchValue) return issuesByTeam;

    const search = linearIssueSearchValue.toLowerCase();
    return issuesByTeam
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
    hoveredTeamKey ? filteredTeamGroups.find((g) => g.key === hoveredTeamKey) : null,
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

  // Calculate flyout position based on hovered team row
  function calculateFlyoutPosition(teamKey: string) {
    if (!leftPanelRef) return;

    const teamRow = leftPanelRef.querySelector(`[data-team-key="${teamKey}"]`) as HTMLElement;
    if (!teamRow) return;

    const panelRect = leftPanelRef.getBoundingClientRect();
    const rowRect = teamRow.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    const topRelativeToPanel = rowRect.top - panelRect.top;
    flyoutTop = topRelativeToPanel;

    const spaceBelow = viewportHeight - rowRect.top - 20;
    const spaceAbove = rowRect.bottom - 20;
    flyoutMaxHeight = Math.min(400, Math.max(spaceBelow, spaceAbove, 200));
  }

  // Programmatically select a team (for keyboard nav + search)
  function selectTeam(teamKey: string) {
    clearAllTimeouts();
    hoveredTeamKey = teamKey;
    calculateFlyoutPosition(teamKey);
    flyoutVisible = true;
    focusedIssueIndex = -1;
  }

  // Hover handlers with delays for forgiveness
  function handleTeamMouseEnter(teamKey: string, event: MouseEvent) {
    clearAllTimeouts();
    isHoveringTeam = true;

    // Sync keyboard focus with mouse
    const idx = filteredTeamGroups.findIndex((g) => g.key === teamKey);
    if (idx !== -1) {
      focusedTeamIndex = idx;
      focusPanel = 'teams';
    }

    openTimeout = setTimeout(() => {
      selectTeam(teamKey);
    }, 50);
  }

  function handleTeamMouseLeave() {
    isHoveringTeam = false;
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
    // Don't close if keyboard is driving navigation
    if (focusPanel === 'issues' || focusedTeamIndex >= 0) return;

    clearAllTimeouts();
    closeTimeout = setTimeout(() => {
      if (!isHoveringTeam && !isHoveringFlyout) {
        flyoutVisible = false;
        setTimeout(() => {
          if (!isHoveringTeam && !isHoveringFlyout) {
            hoveredTeamKey = null;
          }
        }, 150);
      }
    }, 200);
  }

  // Load Linear issues if authenticated
  async function loadLinearIssues() {
    try {
      await linearAuthStore.initialize();
      isLinearAuthenticated = linearAuthStore.state.isAuthenticated;

      if (!isLinearAuthenticated) {
        logger.info('Linear not authenticated, skipping issue load');
        return;
      }

      type FilterType = 'assigned' | 'created' | 'subscribed' | 'team' | 'all';
      let filter: FilterType = 'all';
      if (typeof window !== 'undefined' && window.electronAPI) {
        try {
          const result = await window.electronAPI.invoke('settings:get', {
            key: 'linearIssueFilter',
          });
          if (result?.data && typeof result.data === 'string') {
            filter = result.data as FilterType;
          }
        } catch {
          // Use default filter
        }
      }

      isLoadingLinearIssues = true;
      const issues = await linearAuthStore.fetchMyIssues(filter);
      linearIssues = issues;
      logger.info('Loaded Linear issues', { count: issues.length, filter });
    } catch (error) {
      logger.error('Failed to load Linear issues', error as Error);
    } finally {
      isLoadingLinearIssues = false;
    }
  }

  // Start Linear OAuth flow
  async function handleLinearConnect() {
    linearAuthStarted = true;
    try {
      await linearAuthStore.startAuth();
      // After startAuth, if we have an OAuth URL, start fast polling
      if (linearAuthStore.state.oauthUrl) {
        startAuthPolling();
      }
      if (linearAuthStore.state.isAuthenticated) {
        linearAuthStarted = false;
        await loadLinearIssues();
      }
    } catch (error) {
      logger.error('Linear auth failed', error as Error);
    }
  }

  // Cancel Linear OAuth flow
  function handleLinearCancel() {
    linearAuthStore.cancelAuth();
    linearAuthStarted = false;
    stopAuthPolling();
  }

  // Check auth status (manual check)
  async function handleCheckAuth() {
    isCheckingLinearAuth = true;
    try {
      const { linearAuthClient } = await import(
        '$features/linear-auth/renderer/linear-auth.client'
      );
      const authState = await linearAuthClient.getAuthState(true);
      if (authState.isAuthenticated) {
        await linearAuthStore.initialize();
        isLinearAuthenticated = true;
        linearAuthStarted = false;
        stopAuthPolling();
        await loadLinearIssues();
      }
    } catch (error) {
      logger.warn('Failed to check Linear auth', error as Error);
    } finally {
      isCheckingLinearAuth = false;
    }
  }

  // Start fast polling for auth completion
  function startAuthPolling() {
    stopAuthPolling(); // Clear any existing interval
    authPollingInterval = setInterval(async () => {
      try {
        const { linearAuthClient } = await import(
          '$features/linear-auth/renderer/linear-auth.client'
        );
        const authState = await linearAuthClient.getAuthState(true);
        if (authState.isAuthenticated) {
          logger.info('Linear auth completed via polling');
          await linearAuthStore.initialize();
          isLinearAuthenticated = true;
          linearAuthStarted = false;
          stopAuthPolling();
          await loadLinearIssues();
        }
      } catch {
        // Ignore polling errors
      }
    }, 1500); // Poll every 1.5 seconds
  }

  // Stop auth polling
  function stopAuthPolling() {
    if (authPollingInterval) {
      clearInterval(authPollingInterval);
      authPollingInterval = null;
    }
  }

  // Handle Linear issue selection
  function handleLinearIssueSelect(identifier: string) {
    const issue = linearIssues.find((i) => i.identifier === identifier);
    if (issue) {
      selectedIssue = issue;
      selectedLinearIssueIdentifier = identifier;
      linearIssueSearchValue = '';
      linearIssueDropdownOpen = false;
      hoveredTeamKey = null;
      flyoutVisible = false;
      resetKeyboardState();

      const issueText = `[${issue.identifier}] ${issue.title}${issue.description ? `\n\n${issue.description}` : ''}`;

      // Append to existing text instead of overwriting
      const currentText = promptText?.trim() || '';
      if (currentText) {
        // Check if this issue is already in the text to avoid duplicates
        const issuePattern = new RegExp(`\\[${issue.identifier}\\].*?(?=\\n\\n|$)`, 's');
        if (issuePattern.test(currentText)) {
          // Issue already exists, don't append
          onSelect?.(issue);
          return;
        }
        // Append with spacing
        promptText = `${currentText}\n\n${issueText}`;
      } else {
        // No existing text, just set it
        promptText = issueText;
      }

      onSelect?.(issue);
    } else {
      selectedIssue = null;
      selectedLinearIssueIdentifier = '';
      onSelect?.(null);
    }
  }

  // Clear selection
  function clearSelection() {
    selectedIssue = null;
    selectedLinearIssueIdentifier = '';
    linearIssueSearchValue = '';
    onSelect?.(null);
  }

  // Reset keyboard navigation state
  function resetKeyboardState() {
    focusedTeamIndex = -1;
    focusedIssueIndex = -1;
    focusPanel = 'teams';
  }

  // Handle clicking outside to close
  function handleClickOutside(event: MouseEvent) {
    if (containerRef && !containerRef.contains(event.target as Node)) {
      linearIssueDropdownOpen = false;
      hoveredTeamKey = null;
      flyoutVisible = false;
      resetKeyboardState();
    }
  }

  // Keyboard navigation handler
  function handleKeydown(event: KeyboardEvent) {
    if (!linearIssueDropdownOpen) return;

    const teams = filteredTeamGroups;
    const issues = activeGroup?.options ?? [];

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (focusPanel === 'issues') {
          // Go back to teams panel
          focusPanel = 'teams';
          focusedIssueIndex = -1;
        } else if (flyoutVisible) {
          flyoutVisible = false;
          hoveredTeamKey = null;
        } else {
          linearIssueDropdownOpen = false;
          resetKeyboardState();
        }
        break;

      case 'ArrowDown':
        event.preventDefault();
        if (focusPanel === 'teams') {
          focusedTeamIndex = Math.min(focusedTeamIndex + 1, teams.length - 1);
          if (focusedTeamIndex >= 0 && teams[focusedTeamIndex]) {
            selectTeam(teams[focusedTeamIndex].key);
          }
        } else if (focusPanel === 'issues') {
          focusedIssueIndex = Math.min(focusedIssueIndex + 1, issues.length - 1);
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (focusPanel === 'teams') {
          focusedTeamIndex = Math.max(focusedTeamIndex - 1, 0);
          if (teams[focusedTeamIndex]) {
            selectTeam(teams[focusedTeamIndex].key);
          }
        } else if (focusPanel === 'issues') {
          if (focusedIssueIndex <= 0) {
            // Go back to teams
            focusPanel = 'teams';
            focusedIssueIndex = -1;
          } else {
            focusedIssueIndex = focusedIssueIndex - 1;
          }
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (focusPanel === 'teams' && flyoutVisible && issues.length > 0) {
          focusPanel = 'issues';
          focusedIssueIndex = 0;
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (focusPanel === 'issues') {
          focusPanel = 'teams';
          focusedIssueIndex = -1;
        }
        break;

      case 'Enter':
        event.preventDefault();
        if (focusPanel === 'teams' && focusedTeamIndex >= 0) {
          // Enter on team -> go to issues
          if (issues.length > 0) {
            focusPanel = 'issues';
            focusedIssueIndex = 0;
          }
        } else if (focusPanel === 'issues' && focusedIssueIndex >= 0 && issues[focusedIssueIndex]) {
          handleLinearIssueSelect(issues[focusedIssueIndex].value);
        }
        break;

      case 'Tab':
        // Allow tab to close dropdown naturally
        linearIssueDropdownOpen = false;
        resetKeyboardState();
        break;
    }
  }

  // Auto-open first team on search
  $effect(() => {
    if (linearIssueSearchValue && filteredTeamGroups.length > 0) {
      // Debounce slightly to avoid flicker during fast typing
      const timeout = setTimeout(() => {
        const firstTeam = filteredTeamGroups[0];
        if (firstTeam) {
          focusedTeamIndex = 0;
          focusPanel = 'teams';
          selectTeam(firstTeam.key);
        }
      }, 100);
      return () => clearTimeout(timeout);
    } else if (!linearIssueSearchValue) {
      // Clear selection when search is cleared
      hoveredTeamKey = null;
      flyoutVisible = false;
      resetKeyboardState();
    }
  });

  // Focus search input when dropdown opens
  $effect(() => {
    if (linearIssueDropdownOpen) {
      resetKeyboardState();
      requestAnimationFrame(() => {
        linearIssueSearchInputElement?.focus();
      });
    }
  });

  // Sync selectedLinearIssueIdentifier with selectedIssue
  $effect(() => {
    if (selectedIssue) {
      selectedLinearIssueIdentifier = selectedIssue.identifier;
    } else if (!selectedIssue && selectedLinearIssueIdentifier) {
      selectedLinearIssueIdentifier = '';
    }
  });

  // Add event listeners
  $effect(() => {
    if (linearIssueDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeydown);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKeydown);
        clearAllTimeouts();
      };
    }
  });

  // Watch for auth completion
  $effect(() => {
    if (linearAuthStarted && linearAuthStore.state.isAuthenticated) {
      linearAuthStarted = false;
      isLinearAuthenticated = true;
      stopAuthPolling();
      loadLinearIssues();
    }
  });

  // Check auth on window focus when waiting for OAuth
  $effect(() => {
    if (linearAuthStarted && linearAuthStore.state.oauthUrl) {
      const handleFocus = () => handleCheckAuth();
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
    }
  });

  onMount(() => {
    loadLinearIssues();
    return () => {
      stopAuthPolling();
    };
  });
</script>

<div class="relative" bind:this={containerRef}>
  <!-- Trigger Button - Always visible -->
  <button
    type="button"
    onclick={() => (linearIssueDropdownOpen = !linearIssueDropdownOpen)}
    class="h-8 w-8 p-0 flex items-center justify-center rounded-md border-0 bg-transparent cursor-pointer"
    aria-label="Link Linear issue"
    aria-haspopup="true"
    aria-expanded={linearIssueDropdownOpen}
  >
    <LinearIcon size={12} class={selectedIssue ? 'text-primary' : 'text-muted-foreground'} />
  </button>

  <!-- Dropdown -->
  {#if linearIssueDropdownOpen}
    <div class="absolute top-full left-0 z-9999 mt-1.5">
      {#if !isLinearAuthenticated}
        <!-- Not Authenticated: Show connect message -->
        <div class="w-[260px] bg-popover border border-border rounded-lg shadow-xl overflow-hidden">
          <div class="px-3 py-2 border-b border-border/50">
            <span class="text-ui font-medium text-muted-foreground uppercase tracking-wide">
              Linear
            </span>
          </div>
          <div class="p-4 text-center">
            {#if linearAuthStarted && linearAuthStore.state.oauthUrl}
              <!-- Waiting for OAuth -->
              <div class="space-y-3">
                <Fa icon={faSpinner} class="w-6 h-6 mx-auto animate-spin text-subtle" />
                <p class="text-sm text-subtle">
                  {isCheckingLinearAuth ? 'Checking...' : 'Waiting for authorization...'}
                </p>
                <div class="flex items-center justify-center gap-2">
                  {#if !isCheckingLinearAuth}
                    <button
                      type="button"
                      class="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onclick={handleCheckAuth}
                    >
                      Check now
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="text-xs text-muted-foreground hover:text-foreground"
                    onclick={handleLinearCancel}
                  >
                    <Fa icon={faXmark} size="xs" />
                  </button>
                </div>
              </div>
            {:else if linearAuthStarted && linearAuthStore.state.isAuthenticating}
              <!-- Starting auth -->
              <div class="space-y-3">
                <Fa icon={faSpinner} class="w-6 h-6 mx-auto animate-spin text-subtle" />
                <p class="text-sm text-subtle">Starting...</p>
              </div>
            {:else}
              <!-- Not connected - show connect prompt -->
              <LinearIcon size={24} class="mx-auto text-subtle mb-3" />
              <p class="text-sm text-foreground mb-1">Connect to Linear</p>
              <p class="text-xs text-subtle mb-4">Link issues to your space tasks</p>
              <button
                type="button"
                class="px-4 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
                onclick={handleLinearConnect}
              >
                Connect
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <!-- Authenticated: Show issues panel -->
        <div class="relative flex items-start">
          <!-- Left Panel: Teams -->
          <div
            bind:this={leftPanelRef}
            class="w-[220px] bg-popover border border-border rounded-lg shadow-xl overflow-hidden flex flex-col"
          >
            <!-- Header -->
            <div class="px-2.5 py-1.5 border-b border-border/50 shrink-0">
              <div class="flex items-center justify-between">
                <span class="text-ui font-medium text-muted-foreground uppercase tracking-wide">
                  Link Linear Issue
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

            <!-- Search -->
            <div class="p-1.5 border-b border-border/50 shrink-0">
              <Input
                bind:this={linearIssueSearchInputElement}
                bind:value={linearIssueSearchValue}
                placeholder="Search issues..."
                class="h-7 text-xs bg-muted/50 border-0 focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/60"
              />
            </div>

            <!-- Teams List -->
            <div class="overflow-y-auto max-h-[350px] flex-1 overscroll-contain">
              {#if isLoadingLinearIssues && linearIssues.length === 0}
                <div class="p-2 space-y-1.5">
                  {#each [1, 2, 3, 4] as _}
                    <div class="flex items-center gap-2 py-1">
                      <div class="w-4 h-4 bg-muted rounded animate-pulse"></div>
                      <div class="h-3 bg-muted rounded flex-1 animate-pulse"></div>
                    </div>
                  {/each}
                </div>
              {:else if filteredTeamGroups.length > 0}
                <div class="py-0.5" role="listbox" aria-label="Teams">
                  {#each filteredTeamGroups as group, idx (group.key)}
                    {@const isKeyboardFocused = focusPanel === 'teams' && focusedTeamIndex === idx}
                    {@const isActive = hoveredTeamKey === group.key}
                    <div
                      data-team-key={group.key}
                      class="flex items-center gap-2 px-2 py-1.5 transition-colors duration-150 cursor-pointer
                               {isActive || isKeyboardFocused ? 'bg-muted/70' : ''}
                               {isKeyboardFocused ? 'ring-1 ring-inset ring-primary/50' : ''}"
                      role="option"
                      aria-selected={isActive}
                      tabindex={isKeyboardFocused ? 0 : -1}
                      onmouseenter={(e) => handleTeamMouseEnter(group.key, e)}
                      onmouseleave={handleTeamMouseLeave}
                    >
                      <div
                        class="w-4 h-4 rounded bg-muted/80 flex items-center justify-center shrink-0"
                      >
                        <Fa icon={faUsers} class="w-2 h-2 text-ghost" />
                      </div>
                      <span class="flex-1 text-xs font-medium truncate">{group.label}</span>
                      <span class="text-ui text-subtle tabular-nums"
                        >{group.options.length}</span
                      >
                      <svg
                        class="w-3.5 h-3.5 text-subtle transition-transform duration-150
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
              {:else if linearIssueSearchValue && !isLoadingLinearIssues}
                <div class="px-2.5 py-6 text-center">
                  <p class="text-xs text-subtle">
                    No issues match "{linearIssueSearchValue}"
                  </p>
                </div>
              {:else if !isLoadingLinearIssues}
                <div class="px-2.5 py-6 text-center">
                  <LinearIcon size={20} class="mx-auto opacity-50 text-subtle mb-1.5" />
                  <p class="text-xs text-subtle">No issues found</p>
                </div>
              {/if}
            </div>

            <!-- Footer with keyboard hints -->
            {#if filteredTeamGroups.length > 0 && !isLoadingLinearIssues}
              <div
                class="px-2.5 py-1 border-t border-border/50 shrink-0 flex items-center justify-between"
              >
                <span class="text-ui text-subtle">
                  {linearIssueSearchValue ? 'Type to filter' : 'Hover or ↑↓ to browse'}
                </span>
                <span class="text-ui text-subtle"> → to select </span>
              </div>
            {/if}
          </div>

          <!-- Right Panel: Issues Flyout -->
          {#if hoveredTeamKey && activeGroup}
            <div
              class="absolute left-full top-0 ml-1 w-[280px] transition-all duration-150 ease-out
                       {flyoutVisible
                ? 'opacity-100 translate-x-0'
                : 'opacity-0 -translate-x-2 pointer-events-none'}"
              style="top: {flyoutTop}px;"
              role="presentation"
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
                    class="text-ui font-medium text-muted-foreground uppercase tracking-wide"
                  >
                    {activeGroup.label}
                  </span>
                  {#if focusPanel === 'issues'}
                    <span class="text-ui text-subtle">← back</span>
                  {/if}
                </div>

                <!-- Issues List -->
                <div
                  class="overflow-y-auto flex-1 py-0.5 overscroll-contain"
                  role="listbox"
                  aria-label="Issues"
                >
                  {#each activeGroup.options as option, idx (option.value)}
                    {@const isSelected = selectedIssue?.identifier === option.value}
                    {@const isKeyboardFocused =
                      focusPanel === 'issues' && focusedIssueIndex === idx}
                    <button
                      type="button"
                      onclick={() => handleLinearIssueSelect(option.value)}
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
                        class="w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5
                                 {isSelected ? 'bg-primary/20' : 'bg-muted/60'}"
                      >
                        {#if isSelected}
                          <Fa icon={faCheck} class="w-2 h-2 text-primary" />
                        {:else}
                          <LinearIcon size={10} class="text-ghost" />
                        {/if}
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1 mb-0.5">
                          <span class="text-ui font-mono text-subtle">
                            {option.description}
                          </span>
                        </div>
                        <span
                          class="text-xs leading-snug line-clamp-2
                                   {isSelected
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
