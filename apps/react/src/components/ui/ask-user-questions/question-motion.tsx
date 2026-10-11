import { useMemo, useRef, type ReactNode } from 'react';
import { crispOut, scale, springIn, usePresence, usePresenceTransition } from '@/lib/motion';

export const stepTransition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in'
      ? springIn(node, { tier: 'slow', y: 4, scale: 1 })
      : crispOut(node, { tier: 'fast', y: -2 });
const actionTransition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) => {
    if (direction === 'out') return crispOut(node, { tier: 'fast', scale: 0.85 });
    const entrance = scale(node, { tier: 'fast' });
    return typeof entrance === 'function' ? entrance({ direction: 'in' }) : entrance;
  };
const errorTransition = (node: HTMLElement) => springIn(node, { tier: 'fast', y: -2 });

function ActionFrame({
  children,
  present,
  onExit,
}: {
  children: ReactNode;
  present: boolean;
  onExit: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  usePresenceTransition(ref, present, onExit, actionTransition);
  return (
    <span ref={ref} inert={!present} aria-hidden={!present || undefined}>
      {children}
    </span>
  );
}

export function QuestionAction({ show, children }: { show: boolean; children: ReactNode }) {
  const items = useMemo(() => (show ? [{ id: 'action', children }] : []), [show, children]);
  const { entries, remove } = usePresence(items, (item) => item.id);
  return entries.map(({ key, value, present }) => (
    <ActionFrame key={key} present={present} onExit={() => remove(key)}>
      {value.children}
    </ActionFrame>
  ));
}

export function QuestionError({ id, children }: { id: string; children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  usePresenceTransition(ref, true, () => {}, errorTransition);
  return (
    <p
      ref={ref}
      id={id}
      role="alert"
      className="min-w-0 px-2 text-left text-xs leading-snug text-danger sm:px-3"
    >
      {children}
    </p>
  );
}
