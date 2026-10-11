import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  crispOut,
  springIn,
  usePresence,
  usePresenceTransition,
  type PresenceEntry,
} from '@/lib/motion';

interface FeedbackValue {
  key: string;
  children: ReactNode;
  className: string;
  slot: string;
  scale: number;
  exitScale: number;
}

function FeedbackFrame({
  entry,
  remove,
}: {
  entry: PresenceEntry<FeedbackValue>;
  remove: (key: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { key, children, className, slot, scale, exitScale } = entry.value;
  const transition = useCallback(
    (node: HTMLElement) =>
      ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
        direction === 'in'
          ? springIn(node, { tier: 'fast', y: 0, scale })
          : crispOut(node, { tier: 'fast', scale: exitScale }),
    [scale, exitScale],
  );
  usePresenceTransition(ref, entry.present, () => remove(key), transition);
  return (
    <span ref={ref} data-slot={slot} className={className}>
      {children}
    </span>
  );
}

export function CopyFeedback({
  transitionKey,
  children,
  className,
  slot,
  scale,
  exitScale = 1,
}: Omit<FeedbackValue, 'key' | 'exitScale'> & { transitionKey: string; exitScale?: number }) {
  const items = useMemo(
    () => [{ key: transitionKey, children, className, slot, scale, exitScale }],
    [transitionKey, children, className, slot, scale, exitScale],
  );
  const { entries, remove } = usePresence(items, (item) => item.key);
  return entries.map((entry) => <FeedbackFrame key={entry.key} entry={entry} remove={remove} />);
}
