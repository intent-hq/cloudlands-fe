import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { formatInteger } from '$lib/i18n/format';
import type { AvatarState } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
import {
  agentAvatarGeometry,
  type AgentAvatarVariant,
} from '../../../../../../../src/features/agent/components/agent-avatar/avatar-size';
import {
  computeAdaptiveVisibleCount,
  createDeferredWidthApplier,
} from '../../../../../../../src/features/agent/components/agent-avatar/avatar-stack-fit';
import { AgentAvatarWithState } from './agent-avatar-with-state';
import './agent-avatar-stack.css';

export interface AgentAvatarStackItem {
  key: string;
  agentId: string;
  specialist?: string | null;
  /** Specialist icon metadata takes precedence over the specialist-id map when valid. */
  icon?: string | null;
  state?: AvatarState;
}

const FALLBACK_OVERFLOW_TEXT_WIDTH = 20;
const OVERFLOW_INLINE_PADDING = 12;
let overflowMeasureContext: CanvasRenderingContext2D | null | undefined;
let overflowFont: string | undefined;
const overflowTextWidths = new Map<string, number>();

function overflowTextWidth(remaining: number, root: HTMLElement): number {
  const text = `+${formatInteger(remaining)}`;
  const cached = overflowTextWidths.get(text);
  if (cached !== undefined) return cached;
  if (overflowMeasureContext === undefined) {
    overflowMeasureContext = document.createElement('canvas').getContext('2d');
  }
  if (!overflowMeasureContext) return FALLBACK_OVERFLOW_TEXT_WIDTH;
  overflowFont ??= `500 12px ${getComputedStyle(root).fontFamily}`;
  overflowMeasureContext.font = overflowFont;
  const width = overflowMeasureContext.measureText(text).width;
  overflowTextWidths.set(text, width);
  return width;
}

export interface AgentAvatarStackProps {
  items: AgentAvatarStackItem[];
  maxVisible?: number;
  adaptive?: boolean;
  align?: 'start' | 'end';
  variant?: AgentAvatarVariant;
  interactive?: boolean;
  overflowId?: string;
  overflowTestId?: string;
  itemContent?: (item: AgentAvatarStackItem) => ReactNode;
  class?: string;
  className?: string;
}

export function AgentAvatarStack({
  items,
  maxVisible = 3,
  adaptive = false,
  align = 'end',
  variant = 'card-stack',
  interactive = false,
  overflowId,
  overflowTestId,
  itemContent,
  class: sourceClass = '',
  className = '',
}: AgentAvatarStackProps) {
  const rootElement = useRef<HTMLSpanElement>(null);
  // Preserve the source's deferred first measurement: render maxVisible until
  // the observer's width is applied in the next frame, clipped by the root.
  const [availableWidth, setAvailableWidth] = useState<number>();
  const [measuredVisibleCount, setMeasuredVisibleCount] = useState<number>();
  const geometry = agentAvatarGeometry[variant];
  const itemCount = items.length;

  // Canvas/font reads are DOM measurements. Keep them out of React render,
  // but settle fitting before paint after the deferred width or props change.
  useLayoutEffect(() => {
    const root = rootElement.current;
    if (!adaptive || availableWidth === undefined || !root) return;
    setMeasuredVisibleCount(
      computeAdaptiveVisibleCount({
        itemCount,
        maxVisible,
        availableWidth,
        surface: geometry.surface,
        overlap: geometry.overlap,
        overflowOverlap: geometry.overlap,
        measureOverflowText: (remaining) =>
          Math.max(geometry.surface, overflowTextWidth(remaining, root) + OVERFLOW_INLINE_PADDING),
      }),
    );
  }, [adaptive, availableWidth, itemCount, maxVisible, geometry]);
  const visibleCount = Math.min(
    items.length,
    Math.max(0, adaptive ? (measuredVisibleCount ?? maxVisible) : maxVisible),
  );
  const visibleItems = items.slice(0, visibleCount);
  const overflowCount = Math.max(0, items.length - visibleItems.length);
  const itemStep = geometry.surface - geometry.overlap;
  const trackWidth =
    visibleItems.length === 0 ? 0 : geometry.surface + (visibleItems.length - 1) * itemStep;

  useLayoutEffect(() => {
    const root = rootElement.current;
    if (!adaptive || !root || typeof ResizeObserver === 'undefined') return;
    const deferredWidth = createDeferredWidthApplier(setAvailableWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      deferredWidth.set(entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      deferredWidth.cancel();
    };
  }, [adaptive]);

  return (
    <span
      ref={rootElement}
      className={`agent-avatar-stack ${adaptive ? 'agent-avatar-stack--adaptive' : ''} ${align === 'start' ? 'agent-avatar-stack--start' : ''} ${sourceClass} ${className}`}
      data-agent-avatar-stack=""
      data-agent-avatar-stack-align={align}
      data-agent-avatar-stack-overlap="later-on-top"
      data-avatar-variant={variant}
      data-agent-avatar-stack-clear-space={geometry.ring}
      aria-hidden={!interactive && !overflowId ? 'true' : undefined}
    >
      {visibleItems.length > 0 && (
        <span className="agent-avatar-stack-track" style={{ width: `${trackWidth}px` }}>
          {visibleItems.map((item, index) => (
            <span
              key={item.key}
              className={`agent-avatar-stack-item ${overflowCount > 0 && index === visibleItems.length - 1 ? 'agent-avatar-stack-item--before-overflow' : ''}`}
              style={{ insetInlineStart: `${index * itemStep}px`, zIndex: index + 1 }}
              data-agent-avatar-stack-item=""
              data-agent-avatar-stack-index={index}
              data-agent-avatar-stack-key={item.key}
              data-agent-avatar-stack-agent-id={item.agentId}
              data-agent-avatar-stack-specialist={item.specialist ?? undefined}
              aria-hidden={!interactive ? 'true' : undefined}
            >
              {itemContent ? (
                itemContent(item)
              ) : (
                <AgentAvatarWithState
                  agentId={item.agentId}
                  specialist={item.specialist}
                  icon={item.icon}
                  state={item.state ?? 'idle'}
                  variant={variant}
                  className="agent-avatar-stack-surface"
                />
              )}
            </span>
          ))}
        </span>
      )}
      {overflowCount > 0 && (
        <span
          id={overflowId}
          className="agent-avatar-stack-overflow"
          style={{
            marginInlineStart: `${visibleItems.length > 0 ? -geometry.overlap : 0}px`,
            zIndex: visibleItems.length + 1,
          }}
          data-agent-avatar-overflow=""
          data-testid={overflowTestId}
        >
          +{formatInteger(overflowCount)}
        </span>
      )}
    </span>
  );
}
