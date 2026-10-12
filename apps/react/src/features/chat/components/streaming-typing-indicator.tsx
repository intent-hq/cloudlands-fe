// Source: src/lib/components/chat/StreamingTypingIndicator.svelte.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IntentMarkLoader, type IntentMarkVariant } from '@/components/ui/indicators';
import { fade, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import {
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';

export interface StreamingTypingIndicatorProps {
  visible?: boolean;
  message?: string;
  showMessage?: boolean;
  lifecycleMessage?: string | null;
  elapsed?: string | null;
  onHoverChange?: (hovered: boolean) => void;
  variant?: IntentMarkVariant;
  class?: string;
  className?: string;
  compact?: boolean;
}

const typingFade = (node: HTMLElement) => fade(node, { tier: 'moderate' }, { direction: 'both' });

export function StreamingTypingIndicator({
  visible = false,
  onHoverChange,
  ...props
}: StreamingTypingIndicatorProps) {
  const [rendered, setRendered] = useState(visible);
  const hovered = useRef(false);
  const hoverCallback = useRef(onHoverChange);
  useLayoutEffect(() => {
    hoverCallback.current = onHoverChange;
  }, [onHoverChange]);
  const setHovered = useCallback((next: boolean) => {
    if (hovered.current === next) return;
    hovered.current = next;
    hoverCallback.current?.(next);
  }, []);
  useLayoutEffect(() => {
    if (visible) {
      // oxlint-disable-next-line react/set-state-in-effect -- Source pre-effect admits the row before paint and cancels pending hide.
      setRendered(true);
    } else if (rendered) {
      // Preserve the source's next-task hide, allowing same-turn visibility reversal.
      const timer = window.setTimeout(() => setRendered(false));
      return () => window.clearTimeout(timer);
    }
  }, [visible, rendered]);
  useLayoutEffect(() => {
    if (!rendered) setHovered(false);
  }, [rendered, setHovered]);
  useLayoutEffect(() => () => setHovered(false), [setHovered]);
  const items = useMemo(() => (rendered ? ['typing'] : []), [rendered]);
  const { entries, remove } = usePresence(items, (key) => key);
  return entries.map(({ key, present }) => (
    <TypingRow
      key={key}
      {...props}
      visible={visible}
      present={present}
      onExit={() => remove(key)}
      onHoverChange={setHovered}
    />
  ));
}

function TypingRow({
  visible,
  message = m.chat_streamingStatus_thinking_label(),
  showMessage = true,
  lifecycleMessage = null,
  elapsed = null,
  onHoverChange,
  variant = 'bloom',
  class: sourceClass,
  className,
  compact = false,
  present,
  onExit,
}: StreamingTypingIndicatorProps & { present: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, typingFade);
  return (
    <div
      ref={ref}
      className={cn(
        CHAT_OPERATIONAL_ROW_CLASS,
        'group font-family-child font-normal text-muted-foreground',
        sourceClass,
        className,
      )}
      data-streaming-typing-row=""
      aria-hidden={!visible}
      inert={!present}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      <div className={CHAT_OPERATIONAL_LEADING_CLASS} data-operational-leading="">
        <IntentMarkLoader variant={variant} size={16} playing={visible} />
      </div>
      {!compact && message && (
        <span
          className={CHAT_OPERATIONAL_SUMMARY_CLASS}
          data-operational-summary=""
          data-testid="streaming-status-thinking"
        >
          <span
            className="inline-flex min-w-0 max-w-full items-baseline gap-[0.5ch]"
            data-testid="streaming-status-copy"
          >
            <span
              className={showMessage ? 'shrink-0 font-normal text-foreground' : 'sr-only'}
              data-testid="streaming-status-thinking-label"
            >
              {message}
            </span>
            {lifecycleMessage && (
              <span
                className="min-w-0 truncate font-normal text-muted-foreground"
                data-testid="streaming-status-phase"
              >
                {lifecycleMessage}
              </span>
            )}
          </span>
        </span>
      )}
      {elapsed && (
        <span
          className="type-caption pointer-events-none opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100 motion-reduce:transition-none"
          aria-live="off"
          data-testid="streaming-status-elapsed"
        >
          {elapsed}
        </span>
      )}
    </div>
  );
}

export default StreamingTypingIndicator;
