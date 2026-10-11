import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { m } from '$shared/paraglide/messages.js';
import {
  createIntentMarkMotion,
  type IntentMarkMotionController,
  type IntentMarkVariant,
} from '$lib/components/ui/indicators/intent-mark-motion';
import {
  intentMarkPaths,
  intentMarkStrokeWidth,
  intentMarkViewBox,
  pulseKeyframes,
} from '$lib/components/ui/indicators/intent-mark-vector';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { fade, spring, usePresence, usePresenceTransition } from '@/lib/motion';
import { formatInteger } from '$lib/i18n/format';
import './indicators.css';

export {
  intentMarkMotionTiming,
  intentMarkVariants,
  type IntentMarkVariant,
} from '$lib/components/ui/indicators/intent-mark-motion';
export { spinnerMetadata } from '$lib/components/ui/indicators/spinner.meta';

const badgeFade = (node: HTMLElement) => fade(node, { tier: 'slow' });
const unsavedFade = (node: HTMLElement) => fade(node, { tier: 'moderate' });

export interface AgentBadgeProps {
  count?: number;
  className?: string;
}

export function AgentBadge({ count = 0, className }: AgentBadgeProps) {
  const visible = count > 0;
  const items = useMemo(() => (visible ? ['badge'] : []), [visible]);
  const presence = usePresence(items, (key) => key);
  return presence.entries.map(({ key, present }) => (
    <AgentBadgeSurface
      key={key}
      count={count}
      className={className}
      present={present}
      onExit={() => presence.remove(key)}
    />
  ));
}

function AgentBadgeSurface({
  count = 0,
  className,
  present,
  onExit,
}: AgentBadgeProps & { present: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The source count-change animation lasts one shared spring interval.
    setUpdating(true);
    const timer = setTimeout(() => setUpdating(false), spring.slow.settleMs);
    return () => clearTimeout(timer);
  }, [count]);
  usePresenceTransition(ref, present, onExit, badgeFade);
  const tooltip =
    count === 1
      ? m.ui_agentBadge_unread_one()
      : m.ui_agentBadge_unread_many({ count: formatInteger(count) });
  return (
    <Tooltip content={tooltip} side="bottom" size="sm">
      <div
        ref={ref}
        className={cn('agent-badge', updating && 'updating', className)}
        aria-label={tooltip}
      >
        <span className="badge-text">{formatInteger(count)}</span>
      </div>
    </Tooltip>
  );
}

export interface UnsavedIndicatorProps {
  visible?: boolean;
  className?: string;
}

export function UnsavedIndicator({ visible = false, className }: UnsavedIndicatorProps) {
  const items = useMemo(() => (visible ? ['unsaved'] : []), [visible]);
  const presence = usePresence(items, (key) => key);
  return presence.entries.map(({ key, present }) => (
    <UnsavedIndicatorSurface
      key={key}
      className={className}
      present={present}
      onExit={() => presence.remove(key)}
    />
  ));
}

function UnsavedIndicatorSurface({
  className,
  present,
  onExit,
}: Pick<UnsavedIndicatorProps, 'className'> & { present: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, unsavedFade);
  return (
    <div
      ref={ref}
      className={cn('flex items-center justify-center shrink-0', className)}
      aria-label={m.ui_unsavedIndicator_tooltip()}
      title={m.ui_unsavedIndicator_tooltip()}
    >
      <div className="w-1 h-1 rounded-full bg-warning animate-pulse motion-reduce:animate-none" />
    </div>
  );
}

export function IntentMarkLoader({
  variant = 'bloom',
  size = 24,
  playing = true,
  className,
  ...props
}: Omit<ComponentProps<'svg'>, 'children'> & {
  variant?: IntentMarkVariant;
  size?: number;
  playing?: boolean;
}) {
  const root = useRef<SVGSVGElement>(null);
  const initialOptions = useRef({ variant, playing });
  const controller = useRef<IntentMarkMotionController | null>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    controller.current = createIntentMarkMotion(root.current, initialOptions.current);
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    controller.current?.update({ variant, playing });
  }, [variant, playing]);
  return (
    <svg
      ref={root}
      width={size}
      height={size}
      viewBox={intentMarkViewBox}
      fill="none"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG loading glyph needs a named status without an extra layout wrapper.
      role="status"
      aria-label={m.ui_spinner_loading_ariaLabel()}
      data-slot="intent-mark-loader"
      data-variant={variant}
      data-playing={playing}
      data-motion-state="neutral"
      className={cn('intent-mark-loader', className)}
      {...props}
    >
      <g data-mark-layer="neutral" aria-hidden="true">
        {intentMarkPaths.map((d, index) => (
          <path
            key={d}
            d={d}
            data-mark-arm={index}
            pathLength="100"
            stroke="currentColor"
            strokeWidth={intentMarkStrokeWidth}
            style={{ transform: String(pulseKeyframes(index)[0].transform) }}
          />
        ))}
      </g>
    </svg>
  );
}
