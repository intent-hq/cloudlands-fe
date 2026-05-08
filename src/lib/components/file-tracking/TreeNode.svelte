<script lang="ts">
  import type { TrackedChange } from '$features/file-tracking/types';
  import Fa from 'svelte-fa';
  import {
    faChevronDown,
    faChevronRight,
    faFolder,
    faFolderOpen,
    faFileCode,
    faExpand,
    faPlus,
    faMinus,
    faRotateLeft,
  } from '@fortawesome/free-solid-svg-icons';
  import { ListItem } from '$lib/components/ui/list';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import TreeNode from './TreeNode.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  interface Props {
    node: any;
    level: number;
    /** Prefix path for compact folders display (e.g., "src/lib" when compacting) */
    prefixPath?: string;
    showStats?: boolean;
    showActions?: boolean;
    selectedChangeId?: string;
    onFileClick?: (change: TrackedChange) => void;
    onExpandClick?: (change: TrackedChange) => void;
    onStageClick?: (change: TrackedChange) => void;
    onUnstageClick?: (change: TrackedChange) => void;
    onRevertClick?: (change: TrackedChange) => void;
  }

  let {
    node,
    level = 0,
    prefixPath = '',
    showStats = true,
    showActions = false,
    selectedChangeId,
    onFileClick,
    onExpandClick,
    onStageClick,
    onUnstageClick,
    onRevertClick,
  }: Props = $props();

  // Track expanded state - initialized from node prop if provided
  // Note: we intentionally capture node.expanded at initialization as the initial state
  // The parent can control expansion via the node prop's expanded field
  // svelte-ignore state_referenced_locally
  let expanded = $state(node.expanded ?? true);

  // Use $derived for reactive computation when level prop changes
  const indent = $derived(level * 16);

  // Determine the type of change
  // Uses status field if available (set by git-integration.service), falls back to stats-based heuristic
  function getChangeType(change: TrackedChange): 'added' | 'deleted' | 'modified' {
    // Use explicit status if available
    if (change.status === 'added') return 'added';
    if (change.status === 'deleted') return 'deleted';
    if (change.status === 'modified' || change.status === 'renamed') return 'modified';

    // Fallback to stats-based heuristic (for backward compatibility)
    const { additions, deletions } = change.stats;
    if (additions > 0 && deletions === 0) return 'added';
    if (deletions > 0 && additions === 0) return 'deleted';
    return 'modified';
  }

  // Get the appropriate label for the revert/discard/restore action
  function getRevertLabel(change: TrackedChange): string {
    const type = getChangeType(change);
    switch (type) {
      case 'added':
        return 'Delete';
      case 'deleted':
        return 'Restore';
      default:
        return 'Discard';
    }
  }

  // Get the appropriate tooltip for the revert/discard/restore action
  function getRevertTooltip(change: TrackedChange): string {
    const type = getChangeType(change);
    switch (type) {
      case 'added':
        return 'Delete new file';
      case 'deleted':
        return 'Restore deleted file';
      default:
        return 'Discard changes';
    }
  }

  // Helper to sort tree entries (directories first, then files, both alphabetically)
  function sortTreeEntries(entries: [string, any][]): [string, any][] {
    return entries.sort(([nameA, nodeA], [nameB, nodeB]) => {
      // Directories come before files
      if (nodeA.type === 'directory' && nodeB.type === 'file') return -1;
      if (nodeA.type === 'file' && nodeB.type === 'directory') return 1;
      // Within same type, sort alphabetically
      return nameA.localeCompare(nameB);
    });
  }

  // Compute display name with prefix
  const displayName = $derived(prefixPath ? `${prefixPath}/${node.name}` : node.name);

  // Check for compact folders: single child that is also a directory
  const childEntries = $derived(
    node.type === 'directory' && node.children ? Object.entries(node.children) : [],
  );
  const shouldCompact = $derived(
    node.type === 'directory' &&
      childEntries.length === 1 &&
      (childEntries[0][1] as any).type === 'directory',
  );
  const compactChild = $derived(shouldCompact ? (childEntries[0][1] as any) : null);

  // Collect agent IDs from a node and all its children (for directory bubbling)
  function collectAgentIds(n: any): string[] {
    const agentIds: string[] = [];
    if (n.type === 'file' && n.change?.attribution?.agent?.agentId) {
      agentIds.push(n.change.attribution.agent.agentId);
    }
    if (n.children) {
      for (const child of Object.values(n.children)) {
        agentIds.push(...collectAgentIds(child));
      }
    }
    // Return unique agent IDs
    return [...new Set(agentIds)];
  }

  // Get agent IDs for this node (for files: direct attribution, for directories: bubbled up from children)
  const agentIds = $derived(
    node.type === 'file'
      ? node.change?.attribution?.agent?.agentId
        ? [node.change.attribution.agent.agentId]
        : []
      : collectAgentIds(node),
  );
</script>

{#if shouldCompact && compactChild}
  <!-- Compact folders: recurse with accumulated path prefix -->
  <TreeNode
    node={compactChild}
    {level}
    prefixPath={displayName}
    {showStats}
    {showActions}
    {selectedChangeId}
    {onFileClick}
    {onExpandClick}
    {onStageClick}
    {onUnstageClick}
    {onRevertClick}
  />
{:else if node.type === 'directory'}
  <!-- Directory node -->
  <div>
    <div class="relative flex items-center">
      <div
        class="absolute left-0 flex items-center"
        style="padding-left: {indent + 4}px; top: 50%; transform: translateY(-50%)"
      >
        <Fa
          icon={expanded ? faChevronDown : faChevronRight}
          size="10"
          class="text-subtle"
        />
      </div>
      <ListItem
        icon={expanded ? faFolderOpen : faFolder}
        iconClass="text-ghost"
        title={displayName}
        onclick={() => (expanded = !expanded)}
        size="sm"
        indent={level}
        class="pl-5 flex-1"
      />
      {#if !expanded && agentIds.length > 0}
        <div class="flex items-center -space-x-1 mr-2">
          {#each agentIds.slice(0, 3) as agentId (agentId)}
            <div class="rounded-full overflow-hidden" title="Recently edited by agent">
              <AuggieAvatar {agentId} size={16} />
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if expanded && node.children}
      <div>
        {#each sortTreeEntries(Object.entries(node.children)) as [childName, childNode] (childNode.path || childName)}
          <TreeNode
            node={childNode}
            level={level + 1}
            {showStats}
            {showActions}
            {selectedChangeId}
            {onFileClick}
            {onExpandClick}
            {onStageClick}
            {onUnstageClick}
            {onRevertClick}
          />
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <!-- File node -->
  <ListItem
    icon={faFileCode}
    iconClass="text-ghost"
    title={node.name}
    active={selectedChangeId === node.change?.id}
    onclick={() => onFileClick?.(node.change)}
    size="sm"
    indent={level + 1}
    actions={showActions && node.change
      ? [
          ...(onExpandClick
            ? [
                {
                  icon: faExpand,
                  label: 'Expand',
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onExpandClick(node.change);
                  },
                },
              ]
            : []),
          // Revert/Discard/Restore action for unstaged files
          ...(node.change.stage === 'unstaged' && onRevertClick
            ? [
                {
                  icon: faRotateLeft,
                  label: getRevertLabel(node.change),
                  tooltip: getRevertTooltip(node.change),
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onRevertClick(node.change);
                  },
                },
              ]
            : []),
          ...(node.change.stage === 'unstaged' && onStageClick
            ? [
                {
                  icon: faPlus,
                  label: 'Stage',
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onStageClick(node.change);
                  },
                },
              ]
            : []),
          ...(node.change.stage === 'staged' && onUnstageClick
            ? [
                {
                  icon: faMinus,
                  label: 'Unstage',
                  onClick: (e: MouseEvent) => {
                    e.stopPropagation();
                    onUnstageClick(node.change);
                  },
                },
              ]
            : []),
        ]
      : []}
    actionsVisible="hover"
  >
    <div class="ml-auto flex items-center gap-1">
      {#if showStats && node.change}
        <LineChangesBadge
          additions={node.change.stats.additions}
          deletions={node.change.stats.deletions}
          size="xs"
        />
      {/if}
      {#if agentIds.length > 0}
        <div class="flex items-center -space-x-1">
          {#each agentIds.slice(0, 3) as agentId (agentId)}
            <div class="rounded-full overflow-hidden" title="Recently edited by agent">
              <AuggieAvatar {agentId} size={16} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </ListItem>
{/if}
