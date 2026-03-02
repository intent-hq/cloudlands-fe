<script lang="ts">
  /**
   * WorkspaceDashboard
   *
   * A sleek dashboard shown when nothing is open in the main panel.
   * Provides workspace overview, task progress, code changes status,
   * and guidance on next steps.
   */

  import type { Workspace, Note, AgentSession, NoteId } from '$shared/types';
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import { Button } from '$lib/components/ui/button';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import Fa from 'svelte-fa';
  import {
    faCodeBranch,
    faCodePullRequest,
    faArrowRight,
    faPlus,
    faExternalLink,
    faEdit,
    faRobot,
    faPlay,
    faTerminal,
    faCircle,
    faStickyNote,
  } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import FileChangesList from '../file-tracking/FileChangesList.svelte';
  import { RepoVisualizer } from '../visualization/repo-visualizer';
  import { faGitRepo } from '$lib/icons/faGitRepo';
  import { notesStateManager } from '$features/notes/notes.store.svelte';
  import { navigateToTask } from '$lib/utils/workspace-navigation';
  import { SPEC_NOTE_ID } from '$shared/constants/notes';
  import { TASK_LINK_REGEX_EXACT } from '$shared/constants/intent-links';

  interface Terminal {
    id: string;
    type: 'terminal';
    title: string;
    workspaceId: string;
    createdAt: string;
    isConnected?: boolean;
    isExecuting?: boolean;
  }

  interface Props {
    workspace: Workspace;
    workspaceId: string;
    // Notes & Tasks
    notes?: Note[];
    specContent?: string;
    onOpenNote?: (noteId: string) => void;
    onDelegateTask?: (taskText: string) => void;
    // Code Changes
    unstagedChanges?: TrackedChange[];
    stagedChanges?: TrackedChange[];
    onOpenChange?: (change: TrackedChange) => void;
    onAcceptChanges?: () => void;
    // Git state
    commits?: Array<{
      hash?: string;
      message?: string;
      isPushed?: boolean;
      files?: Array<{ path: string }>;
    }>;
    unpushedCount?: number;
    pullRequests?: PRInfo[];
    prFiles?: string[]; // Files in open PRs
    currentBranch?: string;
    onOpenPR?: (url: string) => void;
    onOpenUrlInBrowser?: (url: string) => void;
    // Agents
    agents?: AgentSession[];
    onOpenAgent?: (agentId: string) => void;
    // Terminals
    terminals?: Terminal[];
    onOpenTerminal?: (terminalId: string) => void;
    onCreateTerminal?: () => void;
    // Actions
    onOpenSpec?: () => void;
    onOpenInEditor?: () => void;
    class?: string;
  }

  let {
    workspace,
    workspaceId,
    notes: _notes = [],
    specContent = '',
    onOpenNote,
    onDelegateTask,
    unstagedChanges = [],
    stagedChanges = [],
    onOpenChange,
    onAcceptChanges,
    commits = [],
    unpushedCount = 0,
    pullRequests = [],
    prFiles = [],
    currentBranch = '',
    onOpenPR,
    onOpenUrlInBrowser,
    agents = [],
    onOpenAgent,
    terminals = [],
    onOpenTerminal,
    onCreateTerminal,
    onOpenSpec,
    onOpenInEditor,
    class: className,
  }: Props = $props();

  // Visualization width - debounced to avoid excessive re-renders during sidebar animation
  let vizWidth = $state(600);
  let debouncedVizWidth = $state(600);
  let vizResizeTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (vizResizeTimeout) {
      clearTimeout(vizResizeTimeout);
    }
    vizResizeTimeout = setTimeout(() => {
      debouncedVizWidth = vizWidth;
    }, 150);

    return () => {
      if (vizResizeTimeout) {
        clearTimeout(vizResizeTimeout);
      }
    };
  });

  // Extract files from unpushed commits
  const filesCommitted = $derived([
    ...new Set(
      commits.filter((c) => !c.isPushed).flatMap((c) => c.files?.map((f) => f.path) || []),
    ),
  ]);

  // Group agents by status - running = actively streaming/processing
  const runningAgents = $derived(agents.filter((a) => a.isStreaming || a.isProcessing));
  const idleAgents = $derived(agents.filter((a) => !a.isStreaming && !a.isProcessing));

  // Calculate file stats for an agent
  function getAgentFileStats(agent: AgentSession): {
    files: number;
    additions: number;
    deletions: number;
  } {
    const changes = agent.fileChanges || [];
    // For now just count files - we can enhance this later with actual line stats
    return { files: changes.length, additions: 0, deletions: 0 };
  }

  // Get last message preview for an agent
  function getAgentPreview(agent: AgentSession): { userMessage?: string; response?: string } {
    const messages = agent.messages || [];
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');

    let userMessage = agent.lastUserMessage;
    let response = agent.lastAgentResponse;

    if (!userMessage && lastUserMsg) {
      const block = lastUserMsg.contentBlocks?.[0];
      userMessage = block && 'text' in block ? block.text : undefined;
    }
    if (!response && lastAssistantMsg) {
      const block = lastAssistantMsg.contentBlocks?.[0];
      response = block && 'text' in block ? block.text : undefined;
    }

    return { userMessage, response };
  }

  // Truncate text
  function truncate(text: string | undefined, maxLen: number): string {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  }

  // Parse tasks from spec content
  interface ParsedTask {
    text: string; // Display text (linked note title or raw task text)
    rawSpecText: string; // Text for search/navigation in the editor
    completed: boolean;
    inProgress: boolean;
    lineNumber: number;
    // Linked task properties (when task is delegated to a Task Note)
    isLinkedTask: boolean;
    linkedNoteId: NoteId | null;
  }

  // Helper to handle clicking on a regular task - opens spec and scrolls to task
  // We pass -1 for position to force text-based search since raw text positions don't match TipTap positions
  function handleRegularTaskClick(task: ParsedTask) {
    navigateToTask(SPEC_NOTE_ID, -1, task.rawSpecText);
  }

  // Helper to handle clicking on a linked task row - opens spec and scrolls to the task
  function handleLinkedTaskRowClick(task: ParsedTask) {
    navigateToTask(SPEC_NOTE_ID, -1, task.rawSpecText);
  }

  // Helper to handle clicking the sticky note icon - opens the linked note
  function handleStickyNoteClick(e: MouseEvent, task: ParsedTask) {
    e.stopPropagation();
    if (task.linkedNoteId) {
      onOpenNote?.(task.linkedNoteId);
    }
  }

  const parsedTasks = $derived.by((): ParsedTask[] => {
    if (!specContent) return [];
    const lines = specContent.split('\n');
    const tasks: ParsedTask[] = [];

    lines.forEach((line, index) => {
      const taskMatch = line.match(/^[\s]*[-*]\s*\[([ xX\/])\]\s*(.+?)(?:\s*<!--agent:[^>]+-->)?$/);
      if (taskMatch) {
        const marker = taskMatch[1];
        const rawText = taskMatch[2].trim();

        // Check if this is a linked task (delegated to a Task Note)
        const linkedMatch = rawText.match(TASK_LINK_REGEX_EXACT);
        if (linkedMatch) {
          const linkText = linkedMatch[1]; // Text inside the brackets [text]
          const noteId = linkedMatch[2] as NoteId;
          const linkedNote = notesStateManager.notes.get(noteId);
          const taskStatus = linkedNote?.metadata?.task?.status;

          tasks.push({
            text: linkedNote?.title || 'Linked Task',
            rawSpecText: linkText, // Use link text for search (what's rendered in the editor)
            completed: taskStatus === 'complete' || marker.toLowerCase() === 'x',
            inProgress: taskStatus === 'in_progress' || marker === '/',
            lineNumber: index + 1,
            isLinkedTask: true,
            linkedNoteId: noteId,
          });
        } else {
          tasks.push({
            text: rawText,
            rawSpecText: rawText,
            completed: marker.toLowerCase() === 'x',
            inProgress: marker === '/',
            lineNumber: index + 1,
            isLinkedTask: false,
            linkedNoteId: null,
          });
        }
      }
    });
    return tasks;
  });

  const taskStats = $derived({
    total: parsedTasks.length,
    completed: parsedTasks.filter((t) => t.completed).length,
    inProgress: parsedTasks.filter((t) => t.inProgress).length,
    pending: parsedTasks.filter((t) => !t.completed && !t.inProgress).length,
  });

  const hasChanges = $derived(unstagedChanges.length > 0 || stagedChanges.length > 0);
  const totalChanges = $derived(unstagedChanges.length + stagedChanges.length);
  const localCommits = $derived(commits.filter((c) => !c.isPushed));
  const activePR = $derived(pullRequests.find((pr) => pr.status === 'open'));

  // Calculate total additions/deletions
  const totalStats = $derived.by(() => {
    let additions = 0;
    let deletions = 0;
    [...unstagedChanges, ...stagedChanges].forEach((c) => {
      additions += c.stats?.additions || 0;
      deletions += c.stats?.deletions || 0;
    });
    return { additions, deletions };
  });

  // Determine current workflow stage
  type WorkflowStage = 'spec' | 'tasks' | 'coding' | 'review' | 'commit' | 'pr' | 'merged';
  const currentStage = $derived.by((): WorkflowStage => {
    if (activePR?.status === 'merged') return 'merged';
    if (activePR) return 'pr';
    if (localCommits.length > 0 || unpushedCount > 0) return 'commit';
    if (hasChanges) return 'review';
    if (taskStats.pending > 0) return 'tasks';
    if (taskStats.total === 0 && !specContent?.trim()) return 'spec';
    return 'coding';
  });

  // Get the next action guidance (kept for potential future use)
  const _nextAction = $derived.by(() => {
    switch (currentStage) {
      case 'spec':
        return {
          label: 'Define your spec',
          description: 'Start by writing what you want to build',
          action: onOpenSpec,
        };
      case 'tasks':
        return {
          label: 'Work on tasks',
          description: `${taskStats.pending} task${taskStats.pending !== 1 ? 's' : ''} remaining`,
          action: onOpenSpec,
        };
      case 'coding':
        return {
          label: 'Start coding',
          description: 'Make changes or delegate to an agent',
          action: onOpenInEditor,
        };
      case 'review':
        return {
          label: 'Review changes',
          description: `${totalChanges} file${totalChanges !== 1 ? 's' : ''} modified`,
          action: onAcceptChanges,
        };
      case 'commit':
        return {
          label: 'Push commits',
          description: `${localCommits.length || unpushedCount} commit${(localCommits.length || unpushedCount) !== 1 ? 's' : ''} ready`,
          action: onAcceptChanges,
        };
      case 'pr':
        return {
          label: 'Monitor PR',
          description: `PR #${activePR?.number} is open`,
          action: () => activePR?.htmlUrl && onOpenPR?.(activePR.htmlUrl),
        };
      case 'merged':
        return {
          label: 'Complete!',
          description: 'Your changes have been merged',
          action: undefined,
        };
      default:
        return { label: 'Get started', description: 'Open your spec to begin', action: onOpenSpec };
    }
  });
</script>

<div class={cn('h-full col-span-full row-span-full overflow-y-auto', className)}>
  <div class=" mx-auto px-20 py-20">
    <!-- Header with workspace title and branch -->
    <div class="mb-8 flex flex-col items-center text-center">
      <h1
        class="text-2xl font-semibold mb-1"
        class:text-foreground={workspace.title}
        class:opacity-50={!workspace.title}
      >
        {workspace.title || 'Untitled'}
      </h1>
      <!-- repo -->
      <div class="flex items-center gap-1.5 ml-0.5 text-sm text-subtle">
        <Fa icon={faGitRepo} size="15" class="w-3 opacity-50" />
        <button
          class="no-decoration hover:underline cursor-pointer"
          onclick={() =>
            onOpenUrlInBrowser?.(
              `https://github.com/${workspace.repositoryOwner}/${workspace.repositoryName}`,
            )}>{workspace.repositoryOwner} / {workspace.repositoryName}</button
        >
      </div>
      {#if currentBranch}
        <div class="flex items-center gap-1.5 ml-0.5 text-sm text-subtle">
          <Fa icon={faCodeBranch} size="12" class="w-3 opacity-50" />
          <span>{currentBranch}</span>
          <Fa icon={faArrowRight} size="xs" class="opacity-50" />
          <button
            class="no-decoration hover:underline cursor-pointer"
            onclick={() =>
              onOpenUrlInBrowser?.(
                `https://github.com/${workspace.repositoryOwner}/${workspace.repositoryName}/tree/${workspace.baseRef}`,
              )}>{workspace.baseRef || 'main'}</button
          >
        </div>
      {/if}
    </div>

    <!-- Codebase Visualization (3:4 aspect ratio, centered) -->
    {#if workspace.worktreePath || workspace.repositoryPath}
      {@const vizCanvasHeight = 580}
      {@const idealVizWidth = Math.round(vizCanvasHeight * (5 / 3))}
      {@const vizCanvasWidth = debouncedVizWidth
        ? Math.min(idealVizWidth, debouncedVizWidth)
        : idealVizWidth}
      <div class="mb-12 flex justify-center h-[580px] w-full" bind:clientWidth={vizWidth}>
        <RepoVisualizer
          workspacePath={workspace.worktreePath || workspace.repositoryPath || ''}
          {workspaceId}
          repoName={workspace.repositoryName}
          filesChanged={[...unstagedChanges, ...stagedChanges].map((c) => c.relativePath)}
          {filesCommitted}
          filesPR={prFiles}
          width={vizCanvasWidth}
          height={vizCanvasHeight}
          maxDepth={30}
        />
      </div>
    {/if}

    <!-- Next Action Card - Hero CTA -->
    <!-- <button
      type="button"
      class="w-full mb-6 px-5 py-3 rounded-xl transition-all group text-left"
      onclick={() => nextAction.action?.()}
      disabled={!nextAction.action}
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg font-medium text-foreground">{nextAction.label}</span>
            {#if currentStage !== 'merged'}
              <Fa
                icon={faArrowRight}
                class="text-accent opacity-0 group-hover:opacity-100 transition-opacity"
              />
            {/if}
          </div>
          <p class="text-sm text-subtle">{nextAction.description}</p>
        </div>
        {#if currentStage === 'merged'}
          <div class="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
            <Fa icon={faCheckCircle} class="text-green-500" />
          </div>
        {/if}
      </div>
    </button> -->

    <!-- Bento Grid -->
    <div class="grid grid-cols-[repeat(auto-fit,_minmax(400px,_1fr))] gap-6">
      <!-- Tasks Card (combined with checklist) -->
      <div class="p-4 rounded-xl bg-muted/20 border border-border">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <!-- <div class="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center">
              <Fa icon={faClipboardList} class="text-blue-500" size="xs" />
            </div> -->
            <span class="text-sm font-medium text-foreground">Tasks</span>
          </div>
          <button
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground"
            onclick={() => onOpenSpec?.()}
          >
            View in Spec
          </button>
        </div>

        {#if taskStats.total > 0}
          {@const completedPct = (taskStats.completed / taskStats.total) * 100}
          {@const inProgressPct = (taskStats.inProgress / taskStats.total) * 100}
          <!-- Progress bar -->
          <div class="w-full h-1 bg-muted-foreground/20 rounded-full overflow-hidden mb-3 flex">
            {#if taskStats.completed > 0}
              <div
                class="h-full bg-emerald-500 transition-all"
                style="width: {completedPct}%"
              ></div>
            {/if}
            {#if taskStats.inProgress > 0}
              <div class="h-full bg-primary transition-all" style="width: {inProgressPct}%"></div>
            {/if}
          </div>

          <!-- Task list -->
          <div class="space-y-px max-h-[400px] overflow-y-auto">
            {#each parsedTasks.slice(0, 50) as task (task.lineNumber)}
              {#if task.isLinkedTask && task.linkedNoteId}
                <!-- Linked task card (delegated to Task Note) -->
                {@const linkedNote = notesStateManager.notes.get(task.linkedNoteId)}
                {@const agentIds = linkedNote?.metadata?.task?.assignedAgentIds}
                {@const agentId = agentIds?.[agentIds.length - 1]}
                <button
                  type="button"
                  class="w-full flex gap-2 py-1 px-2 -mx-2 rounded hover:bg-muted/50 transition-colors group text-left cursor-pointer"
                  onclick={() => handleLinkedTaskRowClick(task)}
                >
                  <!-- Checkbox -->
                  <div
                    class="mt-[0.15rem] shrink-0 w-3.5 h-3.5 rounded-sm {task.completed
                      ? 'bg-emerald-500'
                      : task.inProgress
                        ? 'bg-primary'
                        : 'border border-muted-foreground/40'} flex items-center justify-center"
                  >
                    {#if task.completed}
                      <svg
                        class="w-2 h-2 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    {:else if task.inProgress}
                      <div class="w-1 h-1 rounded-full bg-white animate-pulse"></div>
                    {/if}
                  </div>
                  <!-- Task title -->
                  <span
                    class="flex-1 text-ui {task.completed
                      ? 'text-muted-foreground'
                      : 'text-foreground'} truncate break-all"
                  >
                    {task.text}
                  </span>
                  <!-- Link indicator - clickable to go to spec task -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="flex items-center gap-1.5">
                    <span
                      role="button"
                      tabindex="0"
                      class="shrink-0 p-1 -mt-0.5 rounded transition-colors cursor-pointer hover:bg-muted/80 text-ghost hover:text-muted-foreground/70"
                      onclick={(e) => handleStickyNoteClick(e, task)}
                      onkeydown={(e) =>
                        e.key === 'Enter' &&
                        handleStickyNoteClick(e as unknown as MouseEvent, task)}
                      title="Go to task in Spec"
                      aria-label="Go to task in Spec"
                    >
                      <Fa icon={faStickyNote} size="2xs" />
                    </span>
                    <!-- Agent avatar if assigned -->
                    {#if agentId}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        role="button"
                        tabindex="0"
                        class="-mt-0.5 transition-all cursor-pointer p-1 hover:bg-muted rounded flex flex-col"
                        onclick={(e) => {
                          e.stopPropagation();
                          onOpenAgent?.(agentId);
                        }}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            onOpenAgent?.(agentId);
                          }
                        }}
                        title="Open agent"
                        aria-label="Open agent"
                      >
                        <AuggieAvatar faceSeed={agentId} colorSeed={agentId} size={18} />
                      </span>
                    {/if}
                  </div>
                </button>
              {:else}
                <!-- Regular task - clickable to open spec and scroll to task -->
                <button
                  type="button"
                  class="w-full flex gap-2 py-1 px-2 -mx-2 rounded hover:bg-muted/50 transition-colors group text-left cursor-pointer"
                  onclick={() => handleRegularTaskClick(task)}
                >
                  <div
                    class="mt-[0.15rem] shrink-0 w-3.5 h-3.5 rounded-sm {task.completed
                      ? 'bg-emerald-500'
                      : task.inProgress
                        ? 'bg-primary'
                        : 'border border-muted-foreground/40'} flex items-center justify-center"
                  >
                    {#if task.completed}
                      <svg
                        class="w-2 h-2 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    {:else if task.inProgress}
                      <div class="w-1 h-1 rounded-full bg-white animate-pulse"></div>
                    {/if}
                  </div>
                  <span
                    class="flex-1 text-ui {task.completed
                      ? 'text-muted-foreground'
                      : 'text-foreground'} truncate break-all"
                  >
                    {task.text}
                  </span>
                  {#if task.inProgress && runningAgents.length > 0}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span
                      role="button"
                      tabindex="0"
                      class="shrink-0 -mt-0.5 transition-all cursor-pointer p-1 hover:bg-muted rounded flex flex-col"
                      onclick={(e) => {
                        e.stopPropagation();
                        onOpenAgent?.(runningAgents[0].id);
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') {
                          e.stopPropagation();
                          onOpenAgent?.(runningAgents[0].id);
                        }
                      }}
                      title="Open agent"
                      aria-label="Open agent"
                    >
                      <AuggieAvatar
                        faceSeed={runningAgents[0].id}
                        colorSeed={runningAgents[0].id}
                        size={18}
                      />
                    </span>
                  {:else if !task.completed && !task.inProgress}
                    <Button
                      class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      variant="ghost-light"
                      size="icon-xs"
                      onclick={(e) => {
                        e.stopPropagation();
                        onDelegateTask?.(task.text);
                      }}
                      title="Assign to agent"
                      aria-label="Assign to agent"
                    >
                      <Fa icon={faPlay} />
                    </Button>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>

          <div class="flex items-center justify-between text-xs mt-2 pt-2 border-t border-border">
            <span
              class={taskStats.completed === taskStats.total
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-subtle'}
            >
              {taskStats.completed}/{taskStats.total} done
            </span>
            {#if parsedTasks.length > 50}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground cursor-pointer"
                onclick={() => onOpenSpec?.()}
              >
                +{parsedTasks.length - 50} more
              </button>
            {:else if taskStats.inProgress > 0}
              <span class="text-primary">{taskStats.inProgress} active</span>
            {/if}
          </div>
        {:else}
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 p-4 rounded-lg border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground transition-colors"
            onclick={() => onOpenSpec?.()}
          >
            <Fa icon={faPlus} size="xs" />
            <span class="text-xs">Add tasks to spec</span>
          </button>
        {/if}
      </div>

      <!-- Changes Card (combined with file list) -->
      <div class="p-4 rounded-xl bg-muted/20 border border-border">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <!-- <div class="w-6 h-6 rounded-md bg-emerald-500/10 flex items-center justify-center">
              <Fa icon={faFileCode} class="text-emerald-500" size="xs" />
            </div> -->
            <span class="text-sm font-medium text-foreground">Code Changes</span>
            {#if hasChanges}
              <LineChangesBadge
                additions={totalStats.additions}
                deletions={totalStats.deletions}
                size="xs"
              />
            {/if}
          </div>
          {#if hasChanges}
            <button
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
              onclick={() => onAcceptChanges?.()}
            >
              Review
            </button>
          {/if}
        </div>

        {#if hasChanges}
          <div class="max-h-[400px] overflow-y-auto">
            {#if stagedChanges.length}
              <FileChangesList
                changes={stagedChanges.slice(0, 50)}
                viewMode="list"
                showActions={false}
                onFileClick={onOpenChange}
              />
            {/if}
            {#if stagedChanges.length < 50 && unstagedChanges.length > 0}
              {#if stagedChanges.length}
                <div class="w-full border-t border-border mt-1 pt-1"></div>
              {/if}
              <FileChangesList
                changes={unstagedChanges.slice(0, Math.max(0, 50 - stagedChanges.length))}
                viewMode="list"
                showActions={false}
                onFileClick={onOpenChange}
              />
            {/if}
          </div>

          {#if totalChanges > 50}
            <div class="flex items-center justify-between text-xs mt-1 ml-1.5">
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground"
                onclick={() => onAcceptChanges?.()}
              >
                +{totalChanges - 50} more
              </button>
            </div>
          {/if}
        {:else}
          <p class="text-xs text-subtle py-4 text-center">No pending changes</p>
        {/if}

        <!-- PR Status Card (if exists) -->
        {#if activePR}
          <button
            type="button"
            class="p-4 rounded-xl bg-muted/20 border border-border hover:border-muted-foreground/30 transition-all text-left col-span-2"
            onclick={() => activePR.htmlUrl && onOpenPR?.(activePR.htmlUrl)}
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-6 h-6 rounded-md bg-purple-500/10 flex items-center justify-center">
                  <Fa icon={faCodePullRequest} class="text-purple-500" size="xs" />
                </div>
                <div>
                  <div class="text-sm font-medium text-foreground">PR #{activePR.number}</div>
                  <div class="text-xs text-subtle truncate max-w-[300px]">
                    {activePR.title}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span
                  class="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500"
                  >Open</span
                >
                <Fa icon={faExternalLink} class="text-ghost" size="xs" />
              </div>
            </div>
          </button>
        {/if}

        <!-- Commits Card (if has local commits) -->
        {#if localCommits.length > 0 || unpushedCount > 0}
          <button
            type="button"
            class="p-4 rounded-xl bg-muted/20 border border-border hover:border-muted-foreground/30 transition-all text-left {activePR
              ? ''
              : 'col-span-2'}"
            onclick={() => onAcceptChanges?.()}
          >
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                <Fa icon={faCodeBranch} class="text-amber-500" size="xs" />
              </div>
              <span class="text-sm font-medium text-foreground">Local Commits</span>
              <span class="text-xs text-subtle">
                {localCommits.length || unpushedCount} ready to push
              </span>
            </div>
          </button>
        {/if}
      </div>

      <!-- Agents Card -->
      <!-- {#if agents.length > 0} -->
      <div class="p-4 rounded-xl bg-muted/20 border border-border">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <Fa icon={faRobot} class="text-ghost" size="sm" />
            <h3 class="text-sm font-medium text-foreground">Agents</h3>
          </div>
        </div>

        <div class="space-y-2">
          <!-- Running agents first -->
          {#each runningAgents.slice(0, 3) as agent (agent.id)}
            {@const fileStats = getAgentFileStats(agent)}
            <button
              type="button"
              class="w-full flex items-start gap-3 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20 hover:border-emerald-500/40 transition-colors text-left"
              onclick={() => onOpenAgent?.(agent.id)}
            >
              <div class="relative shrink-0">
                <AuggieAvatar faceSeed={agent.id} colorSeed={agent.id} size={24} />
                <div
                  class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-card animate-pulse"
                ></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground truncate">{agent.name}</span>
                  {#if fileStats.files > 0}
                    <span class="text-xs text-subtle"
                      >{fileStats.files} file{fileStats.files !== 1 ? 's' : ''}</span
                    >
                  {/if}
                </div>
                <div class="text-xs text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                  {agent.isStreaming ? 'Thinking...' : 'Working...'}
                </div>
              </div>
            </button>
          {/each}

          <!-- Idle agents -->
          {#each idleAgents.slice(0, 3) as agent (agent.id)}
            {@const preview = getAgentPreview(agent)}
            {@const fileStats = getAgentFileStats(agent)}
            <button
              type="button"
              class="w-full flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
              onclick={() => onOpenAgent?.(agent.id)}
            >
              <AuggieAvatar faceSeed={agent.id} colorSeed={agent.id} size={24} class="shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground truncate">{agent.name}</span>
                  {#if fileStats.files > 0}
                    <span class="text-xs text-subtle"
                      >{fileStats.files} file{fileStats.files !== 1 ? 's' : ''}</span
                    >
                  {/if}
                </div>
                {#if preview.response}
                  <div class="text-xs text-subtle truncate mt-0.5">
                    {truncate(preview.response, 60)}
                  </div>
                {/if}
              </div>
            </button>
          {/each}

          {#if agents.length > 6}
            <div class="text-center text-xs text-subtle pt-1">
              +{agents.length - 6} more agents
            </div>
          {/if}
        </div>
      </div>
      <!-- {/if} -->

      <!-- Terminals Card -->
      {#if terminals.length > 0 || onCreateTerminal}
        <div class="p-4 rounded-xl bg-muted/20 border border-border">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <Fa icon={faTerminal} class="text-ghost" size="sm" />
              <h3 class="text-sm font-medium text-foreground">Terminals</h3>
            </div>
            {#if onCreateTerminal}
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                onclick={() => onCreateTerminal?.()}
              >
                <Fa icon={faPlus} size="xs" />
                New
              </button>
            {/if}
          </div>

          <div class="space-y-1">
            {#each terminals.slice(0, 4) as terminal (terminal.id)}
              <button
                type="button"
                class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                onclick={() => onOpenTerminal?.(terminal.id)}
              >
                <div class="shrink-0 w-6 h-6 rounded bg-muted flex items-center justify-center">
                  <Fa icon={faTerminal} size="xs" class="text-ghost" />
                </div>
                <span class="flex-1 text-sm text-foreground truncate"
                  >{terminal.title || 'Terminal'}</span
                >
                {#if terminal.isExecuting}
                  <Fa icon={faCircle} size="xs" class="text-amber-500 animate-pulse" />
                {/if}
              </button>
            {/each}

            <!-- {#if terminals.length === 0}
              <button
                type="button"
                class="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground transition-colors"
                onclick={() => onCreateTerminal?.()}
              >
                <Fa icon={faPlus} size="xs" />
                <span class="text-sm">New Terminal</span>
              </button>
            {/if} -->
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer with quick actions -->
    <div class="mt-8 pt-6 border-t border-border flex items-center justify-center gap-4">
      <Button variant="ghost" size="sm" onclick={() => onOpenSpec?.()}>
        <Fa icon={faEdit} class="mr-2" size="sm" />
        Edit Spec
      </Button>
      {#if onOpenInEditor}
        <Button variant="ghost" size="sm" onclick={() => onOpenInEditor?.()}>
          <Fa icon={faExternalLink} class="mr-2" size="sm" />
          Open in Editor
        </Button>
      {/if}
    </div>
  </div>
</div>
