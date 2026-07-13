<script lang="ts">
  /**
   * DiffHeader - Header component for the PureDiff viewer
   *
   * Displays file name, stats, and action buttons.
   * Supports collapsible mode with toggle button.
   */
  import Fa from 'svelte-fa';
  import {
  faChevronDown,
  faChevronRight,
  faFileCode,
  faPencil,
} from '@fortawesome/free-solid-svg-icons';
  import type { DiffAction } from './types.js';

  interface Props {
    /** Current file name */
    fileName: string;
    /** Previous file name (for renames) */
    oldFileName?: string;
    /** Number of additions */
    additions?: number;
    /** Number of deletions */
    deletions?: number;
    /** Whether the diff is collapsible */
    collapsible?: boolean;
    /** Whether the diff is currently collapsed */
    collapsed?: boolean;
    /** Action buttons */
    actions?: DiffAction[];
    /** Toggle callback */
    onToggle?: () => void;
  }

  let {
    fileName,
    oldFileName,
    additions,
    deletions,
    collapsible = false,
    collapsed = false,
    actions = [],
    onToggle,
  }: Props = $props();

  // Check if this is a rename
  const isRename = $derived(oldFileName && oldFileName !== fileName);

  // Format stats display
  const statsDisplay = $derived.by(() => {
    if (additions === undefined && deletions === undefined) return null;
    const parts: string[] = [];
    if (additions !== undefined && additions > 0) parts.push(`+${additions}`);
    if (deletions !== undefined && deletions > 0) parts.push(`-${deletions}`);
    return parts.length > 0 ? parts.join(' ') : null;
  });
</script>

<div class="diff-header">
  <button
    type="button"
    class="diff-header-content"
    class:clickable={collapsible}
    onclick={collapsible ? onToggle : undefined}
    disabled={!collapsible}
  >
    {#if collapsible}
      <span class="diff-header-chevron">
        <Fa icon={collapsed ? faChevronRight : faChevronDown} />
      </span>
    {/if}

    <span class="diff-header-icon">
      {#if isRename}
        <Fa icon={faPencil} />
      {:else}
        <Fa icon={faFileCode} />
      {/if}
    </span>

    <span class="diff-header-filename">
      {#if isRename}
        <span class="diff-header-old-name">{oldFileName}</span>
        <span class="diff-header-arrow">→</span>
      {/if}
      {fileName}
    </span>

    {#if statsDisplay}
      <span class="diff-header-stats">
        {#if additions !== undefined && additions > 0}
          <span class="diff-stat-additions">+{additions}</span>
        {/if}
        {#if deletions !== undefined && deletions > 0}
          <span class="diff-stat-deletions">-{deletions}</span>
        {/if}
      </span>
    {/if}
  </button>

  {#if actions.length > 0}
    <div class="diff-header-actions">
      {#each actions as action}
        <button
          type="button"
          class="diff-action-button"
          class:primary={action.variant === 'primary'}
          class:success={action.variant === 'success'}
          class:danger={action.variant === 'danger'}
          disabled={action.disabled}
          onclick={action.onClick}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border, hsl(var(--border)));
    gap: 0.5rem;
  }

  .diff-header-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: default;
  }

  .diff-header-content.clickable {
    cursor: pointer;
  }

  .diff-header-content.clickable:hover {
    opacity: 0.8;
  }

  .diff-header-chevron {
    color: var(--color-muted-foreground, hsl(var(--color-muted-foreground)));
    font-size: 0.75rem;
  }

  .diff-header-icon {
    color: hsl(var(--muted-foreground) / 0.3);
    font-size: 0.875rem;
  }

  .diff-header-filename {
    font-size: 1rem;
    overflow: hidden;
    color: var(--color-muted-foreground, hsl(var(--color-muted-foreground)));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-header-old-name {
    color: var(--color-muted-foreground, hsl(var(--color-muted-foreground)));
    text-decoration: line-through;
  }

  .diff-header-arrow {
    color: var(--color-muted-foreground, hsl(var(--color-muted-foreground)));
    margin: 0 0.25rem;
  }

  .diff-header-stats {
    display: flex;
    gap: 0.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .diff-stat-additions {
    color: var(--color-emerald-600, #059669);
  }

  :global(.dark) .diff-stat-additions {
    color: var(--color-emerald-400, #34d399);
  }

  .diff-stat-deletions {
    color: var(--color-red-600, #dc2626);
  }

  :global(.dark) .diff-stat-deletions {
    color: var(--color-red-400, #f87171);
  }

  .diff-header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .diff-action-button {
    padding: 0.25rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    border-radius: 0.25rem;
    border: 1px solid var(--border, hsl(var(--border)));
    background: var(--background, hsl(var(--background)));
    color: var(--foreground, hsl(var(--foreground)));
    cursor: pointer;
    transition: all 0.15s;
  }

  .diff-action-button:hover:not(:disabled) {
    background: var(--accent, hsl(var(--accent)));
  }

  .diff-action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .diff-action-button.primary {
    background: var(--primary, hsl(var(--primary)));
    color: var(--primary-foreground, hsl(var(--primary-foreground)));
    border-color: transparent;
  }

  .diff-action-button.success {
    background: var(--color-emerald-600, #059669);
    color: white;
    border-color: transparent;
  }

  .diff-action-button.danger {
    background: var(--color-red-600, #dc2626);
    color: white;
    border-color: transparent;
  }
</style>
