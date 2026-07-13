<script lang="ts">
  import type {
    FileColumn as FileColumnType,
    VisualizationLine,
    HoverState,
    VisualizationConfig,
  } from './types';
  import { DEFAULT_CONFIG } from './types';

  interface Props {
    fileColumn: FileColumnType;
    config?: Partial<VisualizationConfig>;
    onLineHover?: (state: HoverState | null) => void;
    onClick?: (fileColumn: FileColumnType) => void;
    onLineClick?: (fileColumn: FileColumnType, lineIndex: number, line: VisualizationLine) => void;
  }

  let { fileColumn, config = {}, onLineHover, onClick, onLineClick }: Props = $props();

  const mergedConfig = $derived({ ...DEFAULT_CONFIG, ...config });

  // Parse path into filename and directory
  const pathInfo = $derived.by(() => {
    const parts = fileColumn.filePath.split('/');
    const fileName = parts.pop() || fileColumn.filePath;
    const directory = parts.join('/');
    return { fileName, directory };
  });

  // Track hovered line index for dimming effect
  let hoveredLineIndex = $state<number | null>(null);

  // Container ref for mouse position calculation
  let containerRef: HTMLDivElement | undefined = $state(undefined);

  // Calculate effective line height to fit all lines within min/max height constraints
  const effectiveLineHeight = $derived.by(() => {
    const numLines = fileColumn.lines.length;
    if (numLines === 0) return mergedConfig.lineHeight;

    const naturalHeight = numLines * mergedConfig.lineHeight;
    const minHeight = mergedConfig.minColumnHeight;
    const maxHeight = mergedConfig.maxColumnHeight;

    // If natural height is less than min, expand each line proportionally
    if (naturalHeight < minHeight) {
      return minHeight / numLines;
    }

    // If natural height exceeds max, shrink each line to fit
    if (maxHeight > 0 && naturalHeight > maxHeight) {
      return maxHeight / numLines;
    }

    return mergedConfig.lineHeight;
  });

  // Calculate the actual column height
  const columnHeight = $derived.by(() => {
    const numLines = fileColumn.lines.length;
    if (numLines === 0) return mergedConfig.minColumnHeight;

    const height = numLines * effectiveLineHeight;
    return Math.max(
      mergedConfig.minColumnHeight,
      Math.min(height, mergedConfig.maxColumnHeight || Infinity),
    );
  });

  function getLineColor(type: VisualizationLine['type'], isHovered: boolean): string {
    // Use solid colors to avoid transparency stacking issues with sub-pixel line heights
    switch (type) {
      case 'add':
        return isHovered ? 'bg-[#7CE2A1] dark:bg-[#0B2916]' : 'bg-[#7CE2A1] dark:bg-[#0B2916]';
      case 'remove':
        return isHovered ? 'bg-[#F79697] dark:bg-[#331513]' : 'bg-[#F79697] dark:bg-[#220B09]';
      default:
        return isHovered ? 'bg-muted' : 'bg-background';
    }
  }

  // Calculate which line is at a given Y position within the container
  function getLineIndexFromY(clientY: number): number {
    if (!containerRef) return 0;
    const rect = containerRef.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    const lineIndex = Math.floor(relativeY / effectiveLineHeight);
    return Math.max(0, Math.min(lineIndex, fileColumn.lines.length - 1));
  }

  // Handle mouse move on the container to determine hovered line
  // This avoids issues with sub-pixel line heights not triggering individual line hovers
  function handleContainerMouseMove(event: MouseEvent) {
    const lineIndex = getLineIndexFromY(event.clientY);
    if (lineIndex !== hoveredLineIndex && lineIndex < fileColumn.lines.length) {
      hoveredLineIndex = lineIndex;
      const line = fileColumn.lines[lineIndex];
      if (onLineHover && line) {
        const rect = containerRef!.getBoundingClientRect();
        onLineHover({
          fileColumn,
          lineIndex,
          line,
          position: {
            x: rect.right + 8,
            y: rect.top + lineIndex * effectiveLineHeight,
          },
        });
      }
    }
  }

  function handleContainerMouseLeave() {
    hoveredLineIndex = null;
    onLineHover?.(null);
  }

  function handleClick(event: MouseEvent) {
    const lineIndex = getLineIndexFromY(event.clientY);
    const line = fileColumn.lines[lineIndex];

    if (onLineClick && line) {
      onLineClick(fileColumn, lineIndex, line);
    } else if (onClick) {
      onClick(fileColumn);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(fileColumn);
    }
  }
</script>

<div class="flex flex-col" style="width: {mergedConfig.columnWidth}px;">
  <!-- File name and path (shown above column) -->
  <div class="mb-1 px-0.5 min-w-0" title={fileColumn.filePath}>
    <div class="text-ui truncate">{pathInfo.fileName}</div>
    <!-- {#if pathInfo.directory}
      <div class="text-ui text-subtle truncate">{pathInfo.directory}</div>
    {/if} -->
  </div>
  <div
    bind:this={containerRef}
    class="flex flex-col rounded-sm overflow-hidden cursor-pointer transition-all border border-border"
    style="height: {columnHeight}px;"
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleKeyDown}
    onmousemove={handleContainerMouseMove}
    onmouseleave={handleContainerMouseLeave}
  >
    <!-- Lines visualization - uses container mouse tracking for reliable hover -->
    <div class="flex flex-col h-full">
      {#each fileColumn.lines as line, lineIndex (`line-${lineIndex}-${line.type}`)}
        {@const isHovered = hoveredLineIndex === lineIndex}
        <div
          class="{getLineColor(line.type, isHovered)} shrink-0"
          style="height: {effectiveLineHeight}px;"
          role="presentation"
        ></div>
      {/each}
    </div>
  </div>
</div>
