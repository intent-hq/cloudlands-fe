<script lang="ts">
  import { arc as d3Arc } from 'd3';
  import type { Note, TaskStatus } from '$shared/types';
  import { isSpecNote } from '$shared/constants/notes';
  import {
    computeTaskStats,
    extractSpecTaskIds,
    EXCLUDED_STATUSES,
  } from '$shared/utils/task-stats';

  interface Props {
    notes: Note[];
    size?: number;
    innerRadiusRatio?: number;
    onSegmentClick?: (noteId: string) => void;
    onSegmentHover?: (noteId: string | null) => void;
  }

  let {
    notes = [],
    size = 120,
    innerRadiusRatio = 0.8,
    onSegmentClick,
    onSegmentHover,
  }: Props = $props();

  // Tree node with computed weight (leaf count)
  interface TaskTreeNode {
    note: Note;
    children: TaskTreeNode[];
    weight: number;
    isLeaf: boolean;
  }

  // Segment data for rendering
  interface SegmentData {
    node: TaskTreeNode;
    startAngle: number;
    endAngle: number;
    innerRadius: number;
    outerRadius: number;
    depth: number;
  }



  // Build task tree from notes (same logic as WorkspaceProgressCard)
  function buildTaskTree(notesList: Note[]): TaskTreeNode[] {
    const specNote = notesList.find((n) => isSpecNote(n.id as string));

    const seenIds = new Set<string>();
    const allTaskNotes = notesList.filter((n) => {
      if (!n.metadata?.task || isSpecNote(n.id as string) || EXCLUDED_STATUSES.has(n.metadata.task.status))
        return false;
      const noteId = n.id as string;
      if (seenIds.has(noteId)) return false;
      seenIds.add(noteId);
      return true;
    });

    const specDescendantIds = new Set<string>();
    for (const note of allTaskNotes) {
      if (isSpecNote(note.parentId as string)) specDescendantIds.add(note.id as string);
    }

    let foundNew = true;
    while (foundNew) {
      foundNew = false;
      for (const note of allTaskNotes) {
        const noteId = note.id as string;
        const parentId = note.parentId as string | undefined;
        if (!specDescendantIds.has(noteId) && parentId && specDescendantIds.has(parentId)) {
          specDescendantIds.add(noteId);
          foundNew = true;
        }
      }
    }

    const taskNotes = allTaskNotes.filter((n) => specDescendantIds.has(n.id as string));
    const childrenMap = new Map<string | undefined, Note[]>();
    for (const note of taskNotes) {
      const rawParentId = note.parentId as string | undefined;
      const parentId = rawParentId && !isSpecNote(rawParentId) ? rawParentId : undefined;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(note);
    }

    function buildNode(note: Note): TaskTreeNode {
      const childNotes = childrenMap.get(note.id as string) || [];
      const children = childNotes.map(buildNode);
      const isLeaf = children.length === 0;
      const weight = isLeaf ? 1 : children.reduce((sum, c) => sum + c.weight, 0);
      return { note, children, weight, isLeaf };
    }

    // Only include roots that are referenced in the spec note content
    // If spec has no task links, fall back to all direct children of spec
    const specTaskIds = extractSpecTaskIds(specNote?.content);
    const hasSpecLinks = specTaskIds.size > 0;
    const roots = taskNotes.filter(
      (n) =>
        isSpecNote(n.parentId as string) && (!hasSpecLinks || specTaskIds.has(n.id as string)),
    );
    return roots.map(buildNode);
  }

  // Convert tree to radial segments (half arc - semicircle at top)
  function treeToSegments(roots: TaskTreeNode[], rad: number, innerRatio: number): SegmentData[] {
    if (roots.length === 0) return [];
    const segments: SegmentData[] = [];
    const totalWeight = roots.reduce((sum, r) => sum + r.weight, 0);

    function getMaxDepth(node: TaskTreeNode, depth: number): number {
      if (node.isLeaf) return depth;
      return Math.max(...node.children.map((c) => getMaxDepth(c, depth + 1)));
    }
    const maxDepth = Math.max(...roots.map((r) => getMaxDepth(r, 1)));
    const innerRadius = rad * innerRatio;
    // Thinner segments
    const ringThickness = ((rad - innerRadius) / Math.max(maxDepth, 1)) * 0.6;

    function processNode(node: TaskTreeNode, startAngle: number, endAngle: number, depth: number) {
      segments.push({
        node,
        startAngle,
        endAngle,
        innerRadius: innerRadius + (depth - 1) * ringThickness,
        outerRadius: innerRadius + depth * ringThickness,
        depth,
      });
      if (!node.isLeaf) {
        const angleRange = endAngle - startAngle;
        let currentAngle = startAngle;
        for (const child of node.children) {
          const childAngle = (child.weight / node.weight) * angleRange;
          processNode(child, currentAngle, currentAngle + childAngle, depth + 1);
          currentAngle += childAngle;
        }
      }
    }

    // Half arc: from -PI/2 (left/9 o'clock) to PI/2 (right/3 o'clock), spanning top
    let currentAngle = -Math.PI / 2;
    for (const root of roots) {
      const rootAngle = (root.weight / totalWeight) * Math.PI; // Half circle = PI radians
      processNode(root, currentAngle, currentAngle + rootAngle, 1);
      currentAngle += rootAngle;
    }
    return segments;
  }

  function getStatusColor(status: TaskStatus): string {
    switch (status) {
      case 'complete':
        return 'var(--color-emerald-500)';
      case 'in_progress':
        return 'var(--color-sky-400)';
      case 'review_required':
        return 'var(--color-blue-500)';
      case 'waiting':
        return 'hsl(var(--muted-foreground) / 0.3)';
      default:
        return 'hsl(var(--muted-foreground) / 0.2)';
    }
  }

  const taskStats = $derived(computeTaskStats(notes));

  const taskTree = $derived(buildTaskTree(notes));
  const radius = $derived(size / 2);
  const segments = $derived(treeToSegments(taskTree, radius - 2, innerRadiusRatio));
  const percentDone = $derived(
    taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0,
  );
  const progressText = $derived(
    taskStats.total > 0 ? `${taskStats.completed} of ${taskStats.total}` : 'No tasks',
  );

  const arcGenerator = $derived(
    d3Arc<SegmentData>()
      .innerRadius((d) => d.innerRadius)
      .outerRadius((d) => d.outerRadius)
      .startAngle((d) => d.startAngle)
      .endAngle((d) => d.endAngle)
      .padAngle(0.02)
      .cornerRadius(2),
  );

  let hoveredNoteId = $state<string | null>(null);

  function handleMouseEnter(noteId: string) {
    hoveredNoteId = noteId;
    onSegmentHover?.(noteId);
  }

  function handleMouseLeave() {
    hoveredNoteId = null;
    onSegmentHover?.(null);
  }

  function handleClick(noteId: string) {
    onSegmentClick?.(noteId);
  }
</script>

<div
  class="relative flex items-center justify-center"
  style="width: {size}px; height: {radius + 20}px;"
>
  <svg width={size} height={radius + 20} viewBox="0 0 {size} {radius + 20}">
    <g transform="translate({radius}, {radius + 5})">
      {#if segments.length > 0}
        {#each segments as segment (segment.node.note.id)}
          {@const noteId = segment.node.note.id as string}
          {@const status = segment.node.note.metadata?.task?.status ?? 'not_started'}
          {@const isHovered = hoveredNoteId === noteId}
          {@const path = arcGenerator(segment)}
          <path
            d={path}
            fill={getStatusColor(status)}
            class="segment"
            class:hovered={isHovered}
            class:dimmed={hoveredNoteId !== null && !isHovered}
            role="button"
            tabindex="0"
            aria-label={segment.node.note.title}
            onmouseenter={() => handleMouseEnter(noteId)}
            onmouseleave={handleMouseLeave}
            onclick={() => handleClick(noteId)}
            onkeydown={(e) => e.key === 'Enter' && handleClick(noteId)}
          />
        {/each}
      {:else}
        <!-- Empty state: half arc -->
        <path
          d="M {-radius + 4} 0 A {radius - 4} {radius - 4} 0 0 1 {radius - 4} 0"
          fill="none"
          stroke="hsl(var(--muted-foreground) / 0.2)"
          stroke-width="6"
        />
      {/if}
    </g>
  </svg>

  <div class="absolute bottom-0 left-1/2 -translate-x-1/2 text-center pointer-events-none">
    <div class="text-2xl font-light leading-none text-foreground">
      {percentDone}<span class="opacity-30 text-lg ml-0.5">%</span>
    </div>
    <div class="text-xs text-subtle mt-0.5">{progressText}</div>
  </div>
</div>

<style>
  .segment {
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .segment:hover,
  .segment.hovered {
    filter: brightness(1.15);
  }

  .segment.dimmed {
    opacity: 0.4;
  }
</style>
