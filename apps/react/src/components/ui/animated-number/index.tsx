import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import {
  Spring,
  onReducedMotionChange,
  prefersReducedMotion,
  type SpringTierName,
} from '@/lib/motion';
import { createFormatters } from '$shared/i18n/formatters';
import { getLocale } from '$shared/paraglide/runtime.js';
import './animated-number.css';

const { formatInteger } = createFormatters(getLocale);
const defaultFormat = (value: number) => formatInteger(value);
const subscribeMotion = (update: () => void) => onReducedMotionChange(update);
const serverMotion = () => false;

export interface AnimatedNumberProps {
  value: number;
  tier?: SpringTierName;
  secondaryValue?: number;
  format?: (value: number, secondaryValue?: number) => string;
  className?: string;
  accessible?: boolean;
  pulse?: boolean;
}

export function AnimatedNumber({
  value,
  tier = 'slow',
  secondaryValue,
  format = defaultFormat,
  className = '',
  accessible = true,
  pulse = true,
}: AnimatedNumberProps) {
  const [motion] = useState(() => ({
    primary: new Spring(value, tier),
    secondary: new Spring(secondaryValue ?? 0, tier),
  }));
  const displayValue = useSyncExternalStore(
    motion.primary.subscribe,
    motion.primary.getSnapshot,
    motion.primary.getSnapshot,
  );
  const displaySecondaryValue = useSyncExternalStore(
    motion.secondary.subscribe,
    motion.secondary.getSnapshot,
    motion.secondary.getSnapshot,
  );
  const reducedMotion = useSyncExternalStore(subscribeMotion, prefersReducedMotion, serverMotion);
  const [animation, setAnimation] = useState({
    value,
    secondaryValue,
    reducedMotion,
    direction: null as 'up' | 'down' | null,
  });
  let direction = animation.direction;
  if (
    animation.value !== value ||
    animation.secondaryValue !== secondaryValue ||
    animation.reducedMotion !== reducedMotion
  ) {
    const from = value !== animation.value ? animation.value : animation.secondaryValue;
    const to = value !== animation.value ? value : secondaryValue;
    direction = reducedMotion ? null : (to ?? 0) > (from ?? 0) ? 'up' : 'down';
    if (value === animation.value && secondaryValue === animation.secondaryValue) direction = null;
    setAnimation({ value, secondaryValue, reducedMotion, direction });
  }
  const run = useRef(0);

  useLayoutEffect(() => {
    const currentRun = ++run.current;
    void Promise.all([
      motion.primary.set(value, { instant: reducedMotion }),
      motion.secondary.set(secondaryValue ?? 0, { instant: reducedMotion }),
    ]).then(() => {
      if (run.current === currentRun) {
        setAnimation((current) =>
          current.direction === null ? current : { ...current, direction: null },
        );
      }
    });
  }, [value, secondaryValue, reducedMotion, motion]);

  useLayoutEffect(
    () => () => {
      run.current += 1;
      motion.primary.stop();
      motion.secondary.stop();
    },
    [motion],
  );

  return (
    <span
      className={cn('animated-number', pulse && direction && `animating-${direction}`, className)}
      data-pulse={pulse ? 'true' : 'false'}
    >
      <span className="animated-number-value" aria-hidden={accessible || undefined}>
        {format(displayValue, secondaryValue === undefined ? undefined : displaySecondaryValue)}
      </span>
      {accessible && (
        <span className="animated-number-target" aria-atomic="true">
          {format(value, secondaryValue)}
        </span>
      )}
    </span>
  );
}
