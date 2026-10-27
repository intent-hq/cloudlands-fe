import type { DockPointerRect } from '$shared/dock-layout';
import {
  DOCK_FLOATING_COMPACT_SIZE,
  getDockCompactNotchSize,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';

interface DockShellLayoutInput {
  surfaceExpanded: boolean;
  conversationOpen?: boolean;
  conversationSize?: { width: number; height: number };
  reveal: number;
  rowLimit: number;
  workspaceCount: number;
  compactWingWidth: number;
  hasFeedback: boolean;
}

interface DockShellLayout {
  desiredWidth: number;
  desiredHeight: number;
  headerHeight: number;
  railHeight: number;
  compactWidth: number;
  compactHeight: number;
  railOffset: number;
  floatingCompact: DockPointerRect;
  shown: DockPointerRect;
  contentClip: string;
}

/** Pure layout shared by the visible silhouette, clip and native input-region publication. */
export function getDockShellLayout(
  placement: DockPlacementSnapshot,
  {
    surfaceExpanded,
    conversationOpen = false,
    conversationSize = { width: 420, height: 520 },
    reveal,
    rowLimit,
    workspaceCount,
    compactWingWidth,
    hasFeedback,
  }: DockShellLayoutInput,
): DockShellLayout {
  const dragging = placement.phase === 'dragging';
  const side = placement.placement.kind === 'edge' ? placement.placement.side : null;
  const notch = placement.shape === 'notch' && !dragging;
  const edge = placement.shape === 'edge' && !dragging;
  const floating = placement.shape === 'floating' && !dragging;
  const floatingUp = floating && placement.expansionDirection === 'up';
  const compactNotchSize =
    !dragging && placement.placement.kind === 'notch'
      ? getDockCompactNotchSize(placement.cutout, compactWingWidth)
      : null;
  const headerHeight = compactNotchSize?.height ?? 40;
  // Cap the viewport, not the rendered list: every workspace remains scrollable.
  const overviewHeight = (Math.min(workspaceCount, rowLimit) + 1) * 52 + 20;
  const railHeight = 48 + (Math.min(workspaceCount, rowLimit) + 1) * 32;
  const full = placement.surface;
  const desiredWidth = dragging
    ? 224
    : edge
      ? 40
      : surfaceExpanded
        ? notch
          ? Math.max(conversationSize.width, compactNotchSize?.width ?? 0)
          : conversationSize.width
        : (compactNotchSize?.width ?? DOCK_FLOATING_COMPACT_SIZE.width);
  const desiredHeight = dragging
    ? 40
    : edge
      ? railHeight
      : surfaceExpanded
        ? headerHeight + (conversationOpen ? conversationSize.height : overviewHeight)
        : hasFeedback
          ? headerHeight + 104
          : headerHeight;
  const compactWidth = edge ? 40 : (compactNotchSize?.width ?? DOCK_FLOATING_COMPACT_SIZE.width);
  const compactHeight = edge ? railHeight : headerHeight;
  const along = placement.placement.kind === 'edge' ? placement.placement.along : 0;
  const railOffset = edge ? Math.max(0, full.height - railHeight) * along : 0;
  // Native supplies the compact anchor in window coordinates, including edge clamping.
  // Keep the grip at that anchor while the surrounding shell grows in either direction.
  const anchor = floating ? placement.floatingAnchor : undefined;
  const anchorWidth = Math.min(full.width, anchor?.width ?? compactWidth);
  const anchorHeight = Math.min(full.height, anchor?.height ?? compactHeight);
  const floatingCompact = {
    x: anchor ? anchor.x - full.x : (full.width - anchorWidth) / 2,
    y: anchor ? anchor.y - full.y : floatingUp ? full.height - anchorHeight : 0,
    width: anchorWidth,
    height: anchorHeight,
  };
  const progress = edge ? 0 : dragging ? 1 : reveal;
  const width = Math.min(full.width, compactWidth + (full.width - compactWidth) * progress);
  const height = Math.min(full.height, compactHeight + (full.height - compactHeight) * progress);
  const shown = floating
    ? {
        x: floatingCompact.x * (1 - progress),
        y: floatingCompact.y * (1 - progress),
        width: floatingCompact.width + (full.width - floatingCompact.width) * progress,
        height: floatingCompact.height + (full.height - floatingCompact.height) * progress,
      }
    : {
        x: edge ? (side === 'right' ? full.width - width : 0) : (full.width - width) / 2,
        y: edge ? (full.height - height) * along : 0,
        width,
        height,
      };
  const contentRadius = notch
    ? '0 0 20px 20px'
    : edge
      ? side === 'left'
        ? '0 14px 14px 0'
        : '14px 0 0 14px'
      : '14px';
  const contentClip = `inset(${shown.y}px ${Math.max(0, full.width - shown.x - shown.width)}px ${Math.max(0, full.height - shown.y - shown.height)}px ${shown.x}px round ${contentRadius})`;
  return {
    desiredWidth,
    desiredHeight,
    headerHeight,
    railHeight,
    compactWidth,
    compactHeight,
    railOffset,
    floatingCompact,
    shown,
    contentClip,
  };
}

/** Capture the visible grab area in the native revision's window coordinates. */
export function getDockHeaderBounds(
  placement: DockPlacementSnapshot,
  shown: DockPointerRect,
  compact: DockPointerRect,
  height: number,
): DockPointerRect {
  return {
    x: placement.surface.x + shown.x,
    y: placement.surface.y + (placement.shape === 'floating' ? compact.y : shown.y),
    width: shown.width,
    height: Math.min(height, shown.height),
  };
}

/** The attached edge stays open; decorative shoulders use the native margin. */
export function getDockEdgeContour(
  shown: DockPointerRect,
  surface: DockPointerRect,
  windowBounds: DockPointerRect,
  side: 'left' | 'right' | null,
): string {
  const { x, y, width: w, height: h } = shown;
  const r = Math.min(14, h / 2, w / 2);
  const top = Math.max(0, Math.min(8, surface.y + y));
  const bottom = Math.max(0, Math.min(8, windowBounds.height - surface.y - y - h));
  if (side === 'left')
    return `M ${x} ${y - top} Q ${x} ${y} ${x + top} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + bottom} Q ${x} ${y + h} ${x} ${y + h + bottom}`;
  return `M ${x + w} ${y - top} Q ${x + w} ${y} ${x + w - top} ${y} H ${x + r} Q ${x} ${y} ${x} ${y + r} V ${y + h - r} Q ${x} ${y + h} ${x + r} ${y + h} H ${x + w - bottom} Q ${x + w} ${y + h} ${x + w} ${y + h + bottom}`;
}

export function getDockNotchContour(shown: DockPointerRect): string {
  const { x, y, width: w, height: h } = shown;
  const r = Math.min(20, h / 2, w / 2);
  return `M ${x - 8} ${y} Q ${x} ${y} ${x} ${y + 8} V ${y + h - r} Q ${x} ${y + h} ${x + r} ${y + h} H ${x + w - r} Q ${x + w} ${y + h} ${x + w} ${y + h - r} V ${y + 8} Q ${x + w} ${y} ${x + w + 8} ${y}`;
}

export function getDockSilhouette(
  shown: DockPointerRect,
  notchContour: string,
  edgeContour: string,
  radius: number,
): string {
  const { x, y, width: w, height: h } = shown;
  const r = Math.min(radius, h / 2, w / 2);
  if (notchContour) return `${notchContour} Z`;
  if (edgeContour) return `${edgeContour} Z`;
  return `M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
}
