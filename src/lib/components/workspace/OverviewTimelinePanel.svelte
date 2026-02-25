<script lang="ts">
  import type { WorkspacePhaseInfo, WorkspacePhaseStats } from './workspace-phase';
  import { cn } from '$lib/utils';
  import { joinPath } from '$lib/utils/path-utils';
  import type { Note, Workspace } from '$shared/types';
  import { isSpecNote } from './sidebar';
  import { getNoteIcon, getNoteTitle, getNoteIconClass, getNoteDepth } from './sidebar/utils';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import type { TaskStatus } from '$shared/types';
  import Fa from 'svelte-fa';
  import {
    faArrowRight,
    faCodeBranch,
    faCodeCommit,
    faCodePullRequest,
    faPlus,
  } from '@fortawesome/free-solid-svg-icons';
  import AgentCard from '$lib/components/chat/AgentCard.svelte';
  import { ListItem } from '$lib/components/ui/list';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import FileRow from '$lib/components/file-tracking/accept-changes/FileRow.svelte';
  import type { UIFileChange } from '$lib/components/file-tracking/accept-changes/types';
  import OpenComboButton from '$lib/components/ui/OpenComboButton.svelte';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { getFileTypeIconSvg } from '$lib/utils/file-type-icons';
  import { faFolder } from '@fortawesome/free-solid-svg-icons';

  interface OverviewAgent {
    id: string;
    name?: string;
    specialist?: 'spec-writer' | 'implementor' | 'verifier' | 'ui-designer' | null;
    state: AvatarState;
    isActive: boolean;
    isInitialAgent?: boolean;
    isBackground?: boolean;
    parentAgentId?: string | null;
    hasUnread?: boolean;
    digest?: string;
    /** e.g. 'waiting', 'running', 'idle' */
    statusLabel?: string;
    /** How many sub-agents this agent is waiting for */
    waitingForCount?: number;
  }

  interface OverviewChange {
    path: string;
    additions: number;
    deletions: number;
    status?: 'added' | 'modified' | 'deleted' | 'renamed';
    staged: boolean;
  }

  interface OverviewCommit {
    hash: string;
    message: string;
  }

  interface Props {
    workspace: Workspace;
    phase: WorkspacePhaseInfo;
    stats: WorkspacePhaseStats;
    notes?: Note[];
    agents?: OverviewAgent[];
    changedFiles?: OverviewChange[];
    commits?: OverviewCommit[];
    selectedNoteId?: string | null;
    selectedAgentId?: string | null;
    selectedFilePath?: string | null;
    /** The file path from the active diff view (for highlighting changed files) */
    activeFilePath?: string | null;
    /** Loading states for each section */
    agentsLoading?: boolean;
    notesLoading?: boolean;
    changesLoading?: boolean;
    onSwitchTab?: (tabId: string) => void;
    onOpenNote?: (noteId: string) => void;
    onOpenAgent?: (agentId: string) => void;
    onOpenFile?: (filePath: string) => void;
    onOpenFileInPanel?: (filePath: string) => void;
    class?: string;
  }

  let {
    workspace,
    phase: _phase,
    stats,
    notes = [],
    agents = [],
    changedFiles = [],
    commits = [],
    selectedNoteId = null,
    selectedAgentId = null,
    selectedFilePath = null,
    activeFilePath = null,
    agentsLoading = false,
    notesLoading = false,
    changesLoading = false,
    onSwitchTab,
    onOpenNote,
    onOpenAgent,
    onOpenFile,
    onOpenFileInPanel,
    class: className,
  }: Props = $props();

  // Agents
  let primaryAgent = $derived(
    agents.find((a) => a.isInitialAgent) || (agents.length === 1 ? agents[0] : null),
  );

  // Is the primary agent a Coordinator (spec-writer)?
  let isCoordinator = $derived(primaryAgent?.specialist === 'spec-writer');

  // Other agents: when coordinator, only show agents that are NOT delegated by coordinator
  // and NOT background, OR are currently running
  let otherAgents = $derived.by(() => {
    const others = agents.filter((a) => a !== primaryAgent);
    if (!isCoordinator || !primaryAgent) return others;
    // In coordinator mode, only show agents NOT delegated by the coordinator
    return others.filter((a) => a.parentAgentId !== primaryAgent.id);
  });
  let runningOtherCount = $derived(
    otherAgents.filter((a) => a.state === 'running' || a.state === 'responding').length,
  );
  // Count of all delegated agents (for coordinator display)
  let delegatedCount = $derived(
    agents.filter((a) => a !== primaryAgent && a.parentAgentId === primaryAgent?.id).length,
  );

  // Spec note
  let specNote = $derived(notes.find((n) => isSpecNote(n.id as string)));

  // Tasks
  let taskNotes = $derived(notes.filter((n) => !isSpecNote(n.id as string) && n.metadata?.task));

  // Context items: spec + other notes (non-task)
  let otherNotes = $derived(notes.filter((n) => !isSpecNote(n.id as string) && !n.metadata?.task));
  let contextItemCount = $derived((specNote ? 1 : 0) + taskNotes.length + otherNotes.length);

  // Show up to 6 notes total, distributing slots between tasks and other notes
  const MAX_CONTEXT_ITEMS = 6;
  let taskSlots = $derived.by(() => {
    const specSlots = specNote ? 1 : 0;
    const remaining = MAX_CONTEXT_ITEMS - specSlots;
    return Math.min(taskNotes.length, remaining);
  });
  let otherSlots = $derived(
    Math.min(otherNotes.length, MAX_CONTEXT_ITEMS - (specNote ? 1 : 0) - taskSlots),
  );
  let shownContextCount = $derived((specNote ? 1 : 0) + taskSlots + otherSlots);
  let moreContextCount = $derived(Math.max(0, contextItemCount - shownContextCount));

  // Changes
  let topFiles = $derived(changedFiles.slice(0, 12));
  let moreFilesCount = $derived(Math.max(0, changedFiles.length - 12));

  // Convert OverviewChange to UIFileChange for FileRow component
  function toUIFileChange(change: OverviewChange): UIFileChange {
    return {
      path: change.path,
      additions: change.additions,
      deletions: change.deletions,
      status: change.status,
      staged: change.staged,
    };
  }

  // Root file listing for the Files card
  interface RootFileEntry {
    name: string;
    isDirectory: boolean;
    path: string;
  }
  const MAX_ROOT_FILES = 12;
  let rootFiles = $state<RootFileEntry[]>([]);
  let rootFilesTotal = $state(0);
  let rootFilesLoading = $state(false);

  async function loadRootFiles() {
    const worktreePath = workspace?.worktreePath;
    if (!worktreePath) return;
    rootFilesLoading = true;
    try {
      const response = (await invoke('file:readDirWithStats', { path: worktreePath })) as {
        success: boolean;
        data?: { name: string; isDirectory: boolean }[];
      };
      if (response?.success && response.data) {
        // Sort: directories first, then alphabetically
        const sorted = response.data
          .filter((e) => !e.name.startsWith('.'))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        rootFilesTotal = sorted.length;
        rootFiles = sorted.slice(0, MAX_ROOT_FILES).map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory,
          path: joinPath(worktreePath, e.name),
        }));
      }
    } catch {
      // ignore
    } finally {
      rootFilesLoading = false;
    }
  }

  $effect(() => {
    if (workspace?.worktreePath) {
      loadRootFiles();
    }
  });
</script>

<div class={cn('flex flex-col gap-3 px-1', className)}>
  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- AGENT ORCHESTRATION CARD                               -->
  <!-- ═══════════════════════════════════════════════════════ -->
  {#if agentsLoading}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <h3 class="text-sm font-semibold text-foreground">Agents</h3>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Agents working on your task in this space.
        </p>
      </div>
      <div class="px-4 pb-3">
        <div class="flex items-center gap-2 py-2">
          <Skeleton class="size-6 rounded-full" />
          <Skeleton class="h-3 flex-1" />
        </div>
        <div class="flex items-center gap-2 py-2">
          <Skeleton class="size-6 rounded-full" />
          <Skeleton class="h-3 w-3/4" />
        </div>
      </div>
    </section>
  {:else if isCoordinator && primaryAgent}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <!-- Card header -->
      <div class="px-4 pt-3 pb-1">
        <button
          class="flex items-center gap-1 w-full text-left cursor-pointer"
          onclick={() => onSwitchTab?.('agents')}
        >
          <h3 class="text-sm font-semibold text-foreground hover:underline">Agent orchestration</h3>
          <Fa icon={faArrowRight} size="xs" class="ml-auto text-muted-foreground/40 shrink-0" />
        </button>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          A coordinator agent breaks down your task into a spec, then delegates work to specialist
          agents that run in parallel.
        </p>
      </div>

      <div class="px-2 pb-2">
        <div>
          <!-- Coordinator agent -->
          <AgentCard
            agentId={primaryAgent.id}
            selected={selectedAgentId === primaryAgent.id}
            onclick={() => onOpenAgent?.(primaryAgent!.id)}
          />

          <!-- Delegated agents (within parent card) -->
          {#if delegatedCount > 0}
            <button
              class="flex items-center gap-2 w-full px-3 pl-9 py-1.5 text-left transition-colors cursor-pointer hover:bg-muted/30"
              onclick={() => onSwitchTab?.('agents')}
            >
              <div class="flex -space-x-1.5 shrink-0">
                {#each agents
                  .filter((a) => a !== primaryAgent && a.parentAgentId === primaryAgent?.id)
                  .slice(0, 5) as agent}
                  <AugieAvatarWithState
                    agentId={agent.id}
                    state={agent.state}
                    size={14}
                    specialist={agent.specialist}
                  />
                {/each}
              </div>
              <span class="text-muted-foreground/60 text-xs">
                {delegatedCount} delegated agent{delegatedCount !== 1 ? 's' : ''}
                {#if runningOtherCount > 0}
                  <span class="text-emerald-500 font-medium">· {runningOtherCount} working</span>
                {/if}
              </span>
            </button>
          {/if}
        </div>

        <!-- Non-delegated agents (hide preview unless actively running) -->
        {#if otherAgents.length > 0}
          <div class="flex flex-col gap-0.5 mt-1">
            {#each otherAgents.slice(0, 3) as agent}
              <AgentCard
                agentId={agent.id}
                selected={selectedAgentId === agent.id}
                onclick={() => onOpenAgent?.(agent.id)}
                hidePreview={!agent.isActive}
              />
            {/each}
            {#if otherAgents.length > 3}
              <button
                class="text-[11px] text-muted-foreground/40 text-left px-2 py-0.5 hover:text-muted-foreground transition-colors cursor-pointer"
                onclick={() => onSwitchTab?.('agents')}
              >
                <Fa icon={faPlus} size="xs" class="ml-0.75 -mt-px mr-0.75" />
                +{otherAgents.length - 3} more
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {:else if agents.length > 0}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <button
          class="flex items-center gap-1 w-full text-left cursor-pointer"
          onclick={() => onSwitchTab?.('agents')}
        >
          <h3 class="text-sm font-semibold text-foreground hover:underline">Agents</h3>
          <Fa icon={faArrowRight} size="xs" class="ml-auto text-muted-foreground/40 shrink-0" />
        </button>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Agents working on your task in this space.
        </p>
      </div>

      {#if primaryAgent}
        <div class="px-2 pb-2">
          <AgentCard
            agentId={primaryAgent.id}
            showBorder
            selected={selectedAgentId === primaryAgent.id}
            onclick={() => onOpenAgent?.(primaryAgent!.id)}
          />

          {#if otherAgents.length > 0}
            <button
              class="flex items-center gap-2 text-sm text-muted-foreground/70 transition-colors cursor-pointer pl-8 pr-2 py-1 rounded-md w-full hover:bg-muted/30"
              onclick={() => onSwitchTab?.('agents')}
            >
              <div class="flex -space-x-1.5">
                {#each otherAgents.slice(0, 5) as agent}
                  <AugieAvatarWithState
                    agentId={agent.id}
                    state={agent.state}
                    size={14}
                    specialist={agent.specialist}
                  />
                {/each}
              </div>
              <span class="text-muted-foreground/50">
                {otherAgents.length} delegated
                {#if runningOtherCount > 0}
                  <span class="text-emerald-500 font-medium">· {runningOtherCount} working</span>
                {/if}
              </span>
            </button>
          {/if}
        </div>
      {:else}
        <div class="px-2 pb-2 flex flex-col gap-0.5">
          {#each agents.slice(0, 3) as agent}
            <AgentCard
              agentId={agent.id}
              selected={selectedAgentId === agent.id}
              onclick={() => onOpenAgent?.(agent.id)}
            />
          {/each}
          {#if agents.length > 3}
            <button
              class="text-[11px] text-muted-foreground/60 text-left px-2 py-0.5 flex items-center cursor-pointer"
              onclick={() => onSwitchTab?.('agents')}
            >
              See all...
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- CONTEXT CARD                                            -->
  <!-- ═══════════════════════════════════════════════════════ -->
  {#if notesLoading}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <h3 class="text-sm font-semibold text-foreground">Context</h3>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Context about the task, shared with all agents in this space.
        </p>
      </div>
      <div class="px-4 pb-3">
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-4 rounded" />
          <Skeleton class="h-3 flex-1" />
        </div>
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-4 rounded" />
          <Skeleton class="h-3 w-2/3" />
        </div>
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-4 rounded" />
          <Skeleton class="h-3 w-1/2" />
        </div>
      </div>
    </section>
  {:else if specNote || taskNotes.length > 0 || otherNotes.length > 0}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <button
          class="flex items-center gap-1 w-full text-left cursor-pointer"
          onclick={() => onSwitchTab?.('context')}
        >
          <h3 class="text-sm font-semibold text-foreground hover:underline">Context</h3>
          <Fa icon={faArrowRight} size="xs" class="ml-auto text-muted-foreground/40 shrink-0" />
        </button>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Context about the task, shared with all agents in this space.
        </p>
      </div>

      <div class="px-2 pb-2 flex flex-col">
        <!-- Spec -->
        {#if specNote}
          {@const depth = getNoteDepth(specNote, notes)}
          <ListItem
            title={getNoteTitle(specNote)}
            icon={getNoteIcon(specNote)}
            iconClass={getNoteIconClass(specNote)}
            indent={depth}
            variant="subtle"
            active={selectedNoteId === 'spec'}
            onclick={() => onOpenNote?.('spec')}
            class="cursor-pointer text-foreground"
          />
        {/if}

        <!-- Task items with status -->
        {#each taskNotes.slice(0, taskSlots) as task}
          {@const taskStatus = task.metadata?.task?.status ?? 'not_started'}
          {@const depth = getNoteDepth(task, notes)}
          <ListItem
            title={task.title || 'Untitled task'}
            titleClass={taskStatus === 'complete' ? 'text-muted-foreground/50' : ''}
            indent={depth}
            variant="subtle"
            active={selectedNoteId === task.id}
            onclick={() => onOpenNote?.(task.id as string)}
            class="cursor-pointer text-foreground"
          >
            {#snippet iconSnippet()}
              <TaskStatusIcon status={taskStatus as TaskStatus} size={14} />
            {/snippet}
          </ListItem>
        {/each}

        <!-- Other notes -->
        {#each otherNotes.slice(0, otherSlots) as note}
          {@const depth = getNoteDepth(note, notes)}
          <ListItem
            title={getNoteTitle(note)}
            icon={getNoteIcon(note)}
            iconClass={getNoteIconClass(note)}
            indent={depth}
            variant="subtle"
            active={selectedNoteId === note.id}
            onclick={() => onOpenNote?.(note.id as string)}
            class="cursor-pointer text-foreground"
          />
        {/each}

        <!-- +N more link -->
        {#if moreContextCount > 0}
          <button
            class="text-[11px] text-muted-foreground/60 text-left px-2 py-0.5 flex items-center cursor-pointer"
            onclick={() => onSwitchTab?.('context')}
          >
            <Fa icon={faPlus} size="xs" class="ml-0.75 -mt-px mr-0.75" />
            {moreContextCount} more notes
          </button>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- CHANGES CARD                                            -->
  <!-- ═══════════════════════════════════════════════════════ -->
  {#if changesLoading}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <h3 class="text-sm font-semibold text-foreground">Changes</h3>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Changes made to files by agents working in this space.
        </p>
      </div>
      <div class="px-4 pb-3">
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-3 rounded" />
          <Skeleton class="h-3 flex-1" />
          <Skeleton class="h-3 w-10" />
        </div>
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-3 rounded" />
          <Skeleton class="h-3 w-3/4" />
          <Skeleton class="h-3 w-8" />
        </div>
        <div class="flex items-center gap-2 py-1.5">
          <Skeleton class="size-3 rounded" />
          <Skeleton class="h-3 w-1/2" />
          <Skeleton class="h-3 w-10" />
        </div>
      </div>
    </section>
  {:else}
    <section class="bg-background/50 rounded-lg overflow-hidden">
      <div class="px-4 pt-3 pb-1">
        <button
          class="flex items-center gap-1 w-full text-left cursor-pointer"
          onclick={() => onSwitchTab?.('changes')}
        >
          <h3 class="text-sm font-semibold text-foreground hover:underline">Changes</h3>
          <Fa icon={faArrowRight} size="xs" class="ml-auto text-muted-foreground/40 shrink-0" />
        </button>
        <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight mb-2">
          Changes made to files by agents working in this space.
        </p>
      </div>

      <div class="px-4 pb-2 flex flex-col gap-0.5">
        {#if workspace?.branch}
          <div class="flex items-center gap-1 text-sm py-0.5">
            <Fa icon={faCodeBranch} size="xs" class="text-muted-foreground/30" />
            <span class="text-muted-foreground/60 truncate text-xs">{workspace.branch}</span>
            {#if workspace.baseRef}
              <Fa icon={faArrowRight} size="xs" class="text-muted-foreground/30" />
              <span class="text-muted-foreground/60 truncate text-xs">{workspace.baseRef}</span>
            {/if}
          </div>
        {/if}
      </div>

      <!-- File list -->
      <div class="px-4 pb-1 flex flex-col gap-0">
        {#each topFiles as file}
          <FileRow
            file={toUIFileChange(file)}
            active={activeFilePath === file.path || selectedFilePath === file.path}
            onFileClick={() => {
              if (onOpenFile) onOpenFile(file.path);
              else onSwitchTab?.('changes');
            }}
          />
        {/each}

        {#if moreFilesCount > 0}
          <button
            class="mt-1 flex items-center text-xs text-muted-foreground/60 text-left py-0.5 transition-colors cursor-pointer px-2"
            onclick={() => onSwitchTab?.('changes')}
          >
            <Fa icon={faPlus} size="xs" class="ml-0.75 -mt-px mr-0.75" />
            {moreFilesCount} more files changed
          </button>
        {/if}
      </div>

      <div class="px-4 pb-2 flex flex-col gap-0.5">
        <!-- Commits -->
        {#if commits.length > 0}
          <div class="flex flex-col gap-0.5">
            {#each commits.slice(0, 6) as commit}
              <div class="flex items-center gap-2 text-[11px] py-0.5">
                <Fa icon={faCodeCommit} size="xs" class="text-muted-foreground/20 shrink-0" />
                <span class="text-muted-foreground/50 truncate">{commit.message}</span>
              </div>
            {/each}
            {#if commits.length > 6}
              <span class="text-[10px] text-muted-foreground/40 pl-5"
                >+{commits.length - 6} more</span
              >
            {/if}
          </div>
        {/if}

        <!-- PR status -->
        {#if stats.pr.hasOpen || stats.pr.hasMerged}
          <div class="flex items-center gap-2 text-sm py-0.5">
            <Fa icon={faCodePullRequest} size="xs" class="text-muted-foreground/30" />
            {#if stats.pr.hasOpen && stats.pr.number}
              <span class="text-muted-foreground/60 text-[11px]">PR #{stats.pr.number}</span>
              <span
                class="text-emerald-500 font-medium text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10"
                >open</span
              >
            {:else if stats.pr.hasMerged}
              <span class="text-muted-foreground/60 text-[11px]">PR merged</span>
              <span
                class="text-purple-500 font-medium text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10"
                >merged</span
              >
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- FILES CARD                                              -->
  <!-- ═══════════════════════════════════════════════════════ -->
  <section class="bg-background/50 rounded-lg overflow-hidden">
    <div class="px-4 pt-3 pb-1">
      <div class="flex items-center gap-1">
        <button
          class="flex items-center gap-1 text-left cursor-pointer"
          onclick={() => onSwitchTab?.('files')}
        >
          <h3 class="text-sm font-semibold text-foreground hover:underline">Files</h3>
        </button>
        {#if workspace?.worktreePath}
          <div class="ml-auto -my-1">
            <OpenComboButton filePath={workspace.worktreePath} isDirectory />
          </div>
        {/if}

        <button
          class="flex items-center gap-1 text-left cursor-pointer ml-2"
          onclick={() => onSwitchTab?.('files')}
        >
          <Fa icon={faArrowRight} size="xs" class="ml-auto text-muted-foreground/40 shrink-0" />
        </button>
      </div>
      <p class="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight">
        The agents in this space are working off a copy of your files.
      </p>
    </div>

    <div class="px-2 pb-3.5 flex flex-col">
      {#if rootFilesLoading}
        <div class="px-2 py-1 space-y-1">
          {#each Array(6) as _}
            <div class="flex items-center gap-2 py-1">
              <Skeleton class="size-4 rounded shrink-0" />
              <Skeleton class="h-3 flex-1" />
            </div>
          {/each}
        </div>
      {:else}
        {#each rootFiles as entry (entry.path)}
          <button
            class="flex items-center gap-1.5 w-full px-2 py-0.75 text-left text-[0.82rem] hover:bg-muted/50 transition-colors border cursor-pointer truncate {activeFilePath ===
              entry.path || selectedFilePath === entry.path
              ? 'bg-background border-border shadow-xs'
              : 'border-transparent'}"
            onclick={() => {
              if (!entry.isDirectory && onOpenFileInPanel) onOpenFileInPanel(entry.path);
              else onSwitchTab?.('files');
            }}
          >
            {#if entry.isDirectory}
              <Fa icon={faFolder} size="xs" class="text-muted-foreground/50 shrink-0 w-4" />
            {:else}
              <span class="w-4 h-4 shrink-0 [&>svg]:w-full [&>svg]:h-full">
                {@html getFileTypeIconSvg(entry.name)}
              </span>
            {/if}
            <span class="truncate text-foreground/80">{entry.name}</span>
          </button>
        {/each}

        {#if rootFilesTotal > MAX_ROOT_FILES}
          <button
            class="mt-1 flex items-center text-xs text-muted-foreground/60 text-left py-0.5 transition-colors cursor-pointer px-2 hover:text-muted-foreground"
            onclick={() => onSwitchTab?.('files')}
          >
            <Fa icon={faPlus} size="xs" class="ml-0.75 -mt-px mr-0.75" />
            {rootFilesTotal - MAX_ROOT_FILES} more
          </button>
        {/if}
      {/if}
    </div>
  </section>
</div>
