<script lang="ts">
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
  import type {
    FileColumn as FileColumnType,
    HoverState,
    VisualizationConfig,
    VisualizationLine,
  } from './types';
  import { DEFAULT_CONFIG } from './types';
  import {
  changeToFileColumn,
  chatChangeToFileColumn,
} from './utils';
  import FileColumn from './FileColumn.svelte';
  import LineHoverCard from './LineHoverCard.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { m } from '$shared/paraglide/messages.js';

  // Union type for both change types
  type AnyChange = TrackedChange | ChatFileChange;

  interface ChangeGroup<T extends AnyChange = AnyChange> {
    label: string;
    changes: T[];
  }

  interface Props {
    /** Flat list of TrackedChanges (will be displayed without grouping) */
    changes?: TrackedChange[];
    /** Flat list of ChatFileChanges (alternative to changes) */
    chatChanges?: ChatFileChange[];
    /** Grouped changes (staged/unstaged) - takes precedence over changes */
    groups?: ChangeGroup<TrackedChange>[];
    config?: Partial<VisualizationConfig>;
    onFileClick?: (change: AnyChange) => void;
    /** Called when a specific line is clicked - passes change, line index, and line info */
    onLineClick?: (change: AnyChange, lineIndex: number, line: VisualizationLine) => void;
    class?: string;
  }

  let {
    changes = [],
    chatChanges,
    groups,
    config = {},
    onFileClick,
    onLineClick,
    class: className = '',
  }: Props = $props();

  const mergedConfig = $derived({ ...DEFAULT_CONFIG, ...config });

  // Generate a stable key for the current changes to detect actual data changes
  function generateChangesKey(): string {
    if (chatChanges && chatChanges.length > 0) {
      return chatChanges
        .map((c) => `${c.filePath}|${c.additions}|${c.deletions}`)
        .join(';;');
    }
    if (groups) {
      return groups
        .map(
          (g) =>
            `${g.label}:${g.changes.map((c) => `${c.relativePath}|${c.stats?.additions ?? 0}|${c.stats?.deletions ?? 0}`).join(',')}`,
        )
        .join(';;');
    }
    return changes
      .map((c) => `${c.relativePath}|${c.stats?.additions ?? 0}|${c.stats?.deletions ?? 0}`)
      .join(';;');
  }

  // Memoize groupedColumns to prevent re-renders when the underlying data hasn't changed
  // This is critical for preventing visualization updates during streaming state changes
  type GroupedColumn = { label: string; columns: FileColumnType[] };
  let lastGroupedColumnsKey = '';
  let memoizedGroupedColumns = $state<GroupedColumn[]>([]);

  $effect(() => {
    const newKey = generateChangesKey();
    if (newKey === lastGroupedColumnsKey) {
      return; // Skip update - data hasn't changed
    }
    lastGroupedColumnsKey = newKey;

    // Convert changes to file columns, either grouped or flat
    // Include all files even if they have no additions/deletions parsed (they'll show synthetic lines)
    if (chatChanges && chatChanges.length > 0) {
      const columns = chatChanges.map(chatChangeToFileColumn);
      memoizedGroupedColumns = columns.length > 0 ? [{ label: '', columns }] : [];
      return;
    }

    if (groups) {
      memoizedGroupedColumns = groups
        .filter((g) => g.changes.length > 0)
        .map((g) => ({
          label: g.label,
          columns: g.changes.map(changeToFileColumn),
        }))
        .filter((g) => g.columns.length > 0);
      return;
    }

    // Flat mode - single group with no label
    const columns = changes.map(changeToFileColumn);
    memoizedGroupedColumns = columns.length > 0 ? [{ label: '', columns }] : [];
  });

  // Use memoized value for rendering
  const groupedColumns = $derived(memoizedGroupedColumns);

  // Hover state - show card immediately on hover
  let hoverState = $state<HoverState | null>(null);
  let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Check if a file column has actual content or only synthetic lines.
   * Synthetic lines are created when we have addition/deletion counts but no actual content.
   * These show empty content which is not useful for the hover card.
   */
  function hasActualContent(fileColumn: FileColumnType): boolean {
    // If all lines have empty content, these are synthetic lines
    return fileColumn.lines.some((line) => line.content && line.content.trim().length > 0);
  }

  function handleLineHover(state: HoverState | null) {
    // Clear any pending hide timeout
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      hoverTimeout = null;
    }

    if (state) {
      // Don't show hover card if the file only has synthetic lines (no actual content)
      if (!hasActualContent(state.fileColumn)) {
        hoverState = null;
        return;
      }
      // Show immediately - no delay
      hoverState = state;
    } else {
      // Delay hide to allow moving to hover card
      hoverTimeout = setTimeout(() => {
        hoverState = null;
      }, 150);
    }
  }

  function handleFileClick(column: FileColumnType) {
    const change = column.change || column.chatChange;
    if (onFileClick && change) {
      onFileClick(change);
    }
  }

  function handleLineClick(column: FileColumnType, lineIndex: number, line: VisualizationLine) {
    const change = column.change || column.chatChange;
    if (onLineClick && change) {
      onLineClick(change, lineIndex, line);
    } else if (onFileClick && change) {
      // Fall back to file click if no line click handler
      onFileClick(change);
    }
  }

  // Cleanup timeout on destroy
  $effect(() => {
    return () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
      }
    };
  });
</script>

{#if groupedColumns.length > 0}
  <div class="flex items-start gap-4 px-5 py-1.5 overflow-x-auto {className}">
    {#each groupedColumns as group, groupIndex (`group-${groupIndex}-${group.label || 'unlabeled'}`)}
      <div class="flex flex-col gap-1">
        {#if group.label}
          <div class="text-ui text-subtle font-medium px-1">{group.label}</div>
        {/if}
        <div class="flex items-start gap-1">
          {#each group.columns as column, i (column.id + '-' + i)}
            <FileColumn
              fileColumn={column}
              config={mergedConfig}
              onLineHover={handleLineHover}
              onClick={handleFileClick}
              onLineClick={handleLineClick}
            />
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- Hover card rendered in portal - shows immediately -->
  {#if hoverState}
    <Portal zIndex={100}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        onmouseenter={() => {
          if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
          }
        }}
        onmouseleave={() => {
          hoverState = null;
        }}
      >
        <LineHoverCard
          fileColumn={hoverState.fileColumn}
          lineIndex={hoverState.lineIndex}
          line={hoverState.line}
          position={hoverState.position}
        />
      </div>
    </Portal>
  {/if}
{:else}
  <div class="px-4 py-3 text-xs text-subtle">{m.fileTracking_changeSetViz_noChanges_label()}</div>
{/if}
