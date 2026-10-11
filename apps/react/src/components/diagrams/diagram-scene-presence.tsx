import { useLayoutEffect, useRef, type ReactNode, type SVGProps } from 'react';
import { usePresence, onReducedMotionChange, prefersReducedMotion, spring } from '@/lib/motion';

/** Retain outgoing SVG paint while its real browser animation completes. */
export function DiagramScenePresence<T extends { id: string }>({
  items,
  children,
}: {
  items: readonly T[];
  children: (item: T, present: boolean, onExit: () => void) => ReactNode;
}) {
  const presence = usePresence(items, (item) => item.id);
  return (
    <>
      {presence.entries.map((entry) => (
        <SceneItem key={entry.key}>
          {children(entry.value, entry.present, () => presence.remove(entry.key))}
        </SceneItem>
      ))}
    </>
  );
}
function SceneItem({ children }: { children: ReactNode }) {
  return children;
}

export function DiagramPaint({
  as = 'g',
  present,
  onExit,
  enterDuration,
  exitDuration,
  reveal = false,
  children,
  ...props
}: {
  as?: 'g' | 'foreignObject';
  present: boolean;
  onExit: () => void;
  enterDuration: number;
  exitDuration: number;
  reveal?: boolean;
  children: ReactNode;
} & Omit<SVGProps<SVGElement>, 'ref'>) {
  const ref = useRef<SVGElement | null>(null);
  const latest = useRef({ onExit, present });
  const progress = useRef(0);
  useLayoutEffect(() => {
    latest.current = { onExit, present };
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let animation: Animation | undefined;
    const from = progress.current,
      target = present ? 1 : 0;
    const duration = prefersReducedMotion(element.ownerDocument)
      ? 0
      : (present ? enterDuration : exitDuration) * Math.abs(target - from);
    const complete = () => {
      progress.current = target;
      if (!latest.current.present) latest.current.onExit();
    };
    if (!duration) {
      complete();
      return;
    }
    // Animate the mask's real stroke offset. This remains observable by getAnimations,
    // so scene settlement cannot race a requestAnimationFrame-only reveal.
    const paint = reveal ? (element.querySelector('.edge-reveal-mask-path') ?? element) : element;
    const frames = Array.from({ length: 61 }, (_, index) => {
      const offset = index / 60;
      const value = from + (target - from) * spring.fast.easing(offset);
      return reveal ? { offset, strokeDashoffset: `${1 - value}px` } : { offset, opacity: value };
    });
    animation = paint.animate(frames, { duration, fill: 'both' });
    animation.finished.then(complete, () => {});
    const stop = onReducedMotionChange((reduced) => {
      if (reduced) animation?.finish();
    }, element.ownerDocument);
    return () => {
      const current = Number(animation?.effect?.getComputedTiming().progress);
      if (Number.isFinite(current))
        progress.current = from + (target - from) * spring.fast.easing(current);
      animation?.cancel();
      stop();
    };
  }, [present, enterDuration, exitDuration, reveal]);
  const Element = as;
  return (
    <Element
      {...props}
      ref={(element) => {
        ref.current = element;
      }}
    >
      {children}
    </Element>
  );
}
