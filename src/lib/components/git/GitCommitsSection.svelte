<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faChevronDown,
    faChevronRight,
    faCodeCommit,
    faCloud,
    faXmark,
    faFileLines,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '../ui/button';
  import { Badge } from '../ui/badge';
  import LineChangesBadge from '../shared/LineChangesBadge.svelte';
  import { formatDistanceToNow } from '$lib/utils/date';
  import { tick } from 'svelte';

  interface CommitInfo {
    hash: string;
    sha?: string;
    author: string;
    email: string;
    date: string;
    message: string;
    files: any[];
    authorName?: string;
    isPushed?: boolean;
  }

  interface FileChange {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }

  let {
    title,
    commits,
    workspaceId,
    onShowCommitDiff,
    onShowFileDiff,
    onAmendCommitMessage,
  }: {
    title: string;
    commits: CommitInfo[];
    workspaceId: string;
    onShowCommitDiff?: (commit: CommitInfo) => void;
    onShowFileDiff?: (commit: CommitInfo, file: FileChange) => void;
    onAmendCommitMessage?: (commit: CommitInfo, newMessage: string) => void;
  } = $props();

  // Track expanded commits
  let expandedCommits = $state(new Set<string>());

  // Inline editing state
  let editingCommitHash: string | null = $state(null);
  let editingValue = $state('');
  let editInputRef: HTMLInputElement | null = $state(null);

  // Check if commit can be amended (only latest unpushed commit)
  function canAmendCommit(commit: CommitInfo, index: number): boolean {
    return !commit.isPushed && index === 0 && !!onAmendCommitMessage;
  }

  // Start editing a commit message
  async function startEditing(commit: CommitInfo) {
    editingCommitHash = commit.hash;
    editingValue = commit.message;
    await tick();
    editInputRef?.focus();
    editInputRef?.select();
  }

  // Save the edited message
  function saveEdit() {
    if (editingCommitHash && editingValue.trim() && onAmendCommitMessage) {
      const trimmed = editingValue.trim();
      const commit = commits.find((c) => c.hash === editingCommitHash);
      if (commit && trimmed !== commit.message) {
        onAmendCommitMessage(commit, trimmed);
      }
    }
    cancelEdit();
  }

  // Cancel editing
  function cancelEdit() {
    editingCommitHash = null;
    editingValue = '';
  }

  // Handle keyboard events during editing
  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  // Handle double-click on commit message
  function handleMessageDoubleClick(e: MouseEvent, commit: CommitInfo, index: number) {
    if (canAmendCommit(commit, index)) {
      e.stopPropagation();
      e.preventDefault();
      startEditing(commit);
    }
  }

  function toggleCommit(sha: string) {
    const newExpanded = new Set(expandedCommits);
    if (newExpanded.has(sha)) {
      newExpanded.delete(sha);
    } else {
      newExpanded.add(sha);
    }
    expandedCommits = newExpanded;
  }

  function getFileStatusColor(status: string) {
    switch (status) {
      case 'added':
        return 'text-green-500';
      case 'modified':
        return 'text-blue-500';
      case 'deleted':
        return 'text-red-500';
      case 'renamed':
        return 'text-yellow-500';
      default:
        return 'text-muted-foreground';
    }
  }

  function getFileStatusIcon(status: string) {
    switch (status) {
      case 'added':
        return '+';
      case 'modified':
        return 'M';
      case 'deleted':
        return '-';
      case 'renamed':
        return 'R';
      default:
        return '?';
    }
  }

  function formatCommitDate(dateStr: string) {
    try {
      return formatDistanceToNow(new Date(dateStr));
    } catch {
      return dateStr;
    }
  }

  function truncateCommitMessage(message: string, maxLength: number = 50) {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }
</script>

{#if commits.length > 0}
  <div class="space-y-px">
    <div class="flex items-center justify-between mb-1">
      <div class="text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <Badge variant="secondary" class="text-xs">
        {commits.length}
      </Badge>
    </div>

    <div class="space-y-1">
      {#each commits as commit, index (commit.hash)}
        <div class="border border-border rounded-md overflow-hidden">
          <!-- Commit header -->
          <button
            class="w-full flex items-start gap-2 p-2 hover:bg-accent/50 transition-colors text-left"
            onclick={() => editingCommitHash !== commit.hash && toggleCommit(commit.hash)}
          >
            <div class="shrink-0 mt-0.5">
              {#if expandedCommits.has(commit.hash)}
                <Fa icon={faChevronDown} size="sm" class="text-muted-foreground" />
              {:else}
                <Fa icon={faChevronRight} size="sm" class="text-muted-foreground" />
              {/if}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <Fa icon={faCodeCommit} size="xs" class="text-muted-foreground shrink-0" />
                    {#if editingCommitHash === commit.hash}
                      <!-- Inline edit mode -->
                      <input
                        bind:this={editInputRef}
                        type="text"
                        bind:value={editingValue}
                        onblur={saveEdit}
                        onkeydown={handleEditKeydown}
                        class="flex-1 text-sm font-medium bg-transparent border-none outline-none ring-0 focus:ring-0 focus:outline-none focus-visible:ring-0 focus-visible:outline-none min-w-0"
                        onclick={(e) => e.stopPropagation()}
                      />
                    {:else}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="text-sm font-medium truncate {canAmendCommit(commit, index) ? 'cursor-text' : ''}"
                        ondblclick={(e) => handleMessageDoubleClick(e, commit, index)}
                      >
                        {truncateCommitMessage(commit.message)}
                      </span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{commit.authorName}</span>
                    <span>•</span>
                    <span>{formatCommitDate(commit.date)}</span>
                    <span>•</span>
                    <span class="font-mono">{(commit.sha || commit.hash).substring(0, 7)}</span>
                  </div>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  {#if commit.isPushed}
                    <Fa icon={faCloud} size="sm" class="text-green-500" title="Pushed to remote" />
                  {:else}
                    <Fa icon={faXmark} size="sm" class="text-yellow-500" title="Not pushed" />
                  {/if}
                  <Badge variant="secondary" class="text-xs">
                    {commit.files.length} files
                  </Badge>
                </div>
              </div>
            </div>
          </button>

          <!-- Expanded content with file changes -->
          {#if expandedCommits.has(commit.hash)}
            <div class="border-t border-border bg-background/50">
              <!-- Full commit message if truncated -->
              {#if commit.message.length > 50}
                <div class="px-4 py-2 border-b border-border">
                  <p class="text-sm text-muted-foreground whitespace-pre-wrap">
                    {commit.message}
                  </p>
                </div>
              {/if}

              <!-- File changes -->
              <div class="p-2 space-y-1">
                {#each commit.files as file (file.path)}
                  <button
                    class="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 transition-colors text-left"
                    onclick={() => onShowFileDiff?.(commit, file)}
                  >
                    <span class={`font-mono text-xs ${getFileStatusColor(file.status)}`}>
                      {getFileStatusIcon(file.status)}
                    </span>
                    <Fa icon={faFileLines} size="xs" class="text-muted-foreground shrink-0" />
                    <span class="text-xs truncate flex-1">{file.path}</span>
                    <LineChangesBadge
                      additions={file.additions}
                      deletions={file.deletions}
                      size="xxs"
                    />
                  </button>
                {/each}
              </div>

              <!-- View full diff button -->
              {#if onShowCommitDiff}
                <div class="px-2 pb-2">
                  <Button
                    size="sm"
                    variant="ghost-light"
                    onclick={() => onShowCommitDiff(commit)}
                    class="w-full h-7 text-xs"
                  >
                    View Full Diff
                  </Button>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
