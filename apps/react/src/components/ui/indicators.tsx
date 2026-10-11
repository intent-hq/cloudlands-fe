import { useLayoutEffect, useRef, type ComponentProps } from 'react';
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
import './indicators.css';

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
