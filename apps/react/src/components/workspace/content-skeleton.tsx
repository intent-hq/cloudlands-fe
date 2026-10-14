// Source: src/lib/components/workspace/ContentSkeleton.svelte.
import type { PanelLayoutNode } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ContentSkeletonProps {
  panelCount?: number;
  layoutRoot?: PanelLayoutNode;
}

function LoadingPanel() {
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
      data-loading-panel=""
    >
      <div className="flex h-[var(--panel-header-height)] flex-none items-center gap-3 border-b border-border px-5">
        <Skeleton className="size-3.5 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-24 max-w-2/5" />
        <Skeleton className="ml-auto h-3 w-10" />
      </div>
      <div className="flex-1 space-y-6 p-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

function LoadingNode({ node }: { node: PanelLayoutNode }) {
  if (node.type === 'panel') return <LoadingPanel />;
  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 gap-2',
        node.direction === 'vertical' && 'flex-col',
      )}
      data-loading-split={node.direction}
    >
      {node.children.map((child, index) => {
        const size = node.sizes[index] ?? 100 / Math.max(1, node.children.length);
        return (
          <div key={index} className="min-h-0 min-w-0" style={{ flex: `${size} 1 0%` }}>
            <LoadingNode node={child} />
          </div>
        );
      })}
    </div>
  );
}

export function ContentSkeleton({ panelCount = 1, layoutRoot }: ContentSkeletonProps) {
  const visiblePanelCount = Number.isFinite(panelCount) ? Math.max(1, Math.floor(panelCount)) : 1;
  const fallbackLayoutRoot: PanelLayoutNode =
    visiblePanelCount === 1
      ? { type: 'panel', panelId: 'loading-panel-0' }
      : {
          type: 'split',
          direction: 'horizontal',
          children: Array.from({ length: visiblePanelCount }, (_, index) => ({
            type: 'panel',
            panelId: `loading-panel-${index}`,
          })),
          sizes: Array.from({ length: visiblePanelCount }, () => 100 / visiblePanelCount),
        };
  return (
    <div
      className="h-full w-full bg-sidebar p-2"
      data-workspace-content-skeleton=""
      data-panel-count={visiblePanelCount}
    >
      <LoadingNode node={layoutRoot ?? fallbackLayoutRoot} />
    </div>
  );
}
