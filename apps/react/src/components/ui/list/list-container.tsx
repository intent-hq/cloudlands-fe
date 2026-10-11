// Source: src/lib/components/ui/list/ListContainer.svelte.
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { createProximityHover, type ProximityHover } from '@/lib/interaction';
import { cn } from '@/lib/utils';
import { ListProximityContext } from './list-context';

export type ListContainerProps = ComponentProps<'div'> & {
  spacing?: 'compact' | 'normal' | 'relaxed';
  interactive?: boolean;
};
export function ListContainer({
  ref,
  className,
  spacing = 'normal',
  interactive = false,
  children,
  ...props
}: ListContainerProps) {
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  const next = useRef(0);
  const claimIndex = useCallback(() => next.current++, []);
  useLayoutEffect(() => {
    if (!root.current || !interactive) {
      setHover(null);
      return;
    }
    const instance = createProximityHover(root.current);
    setHover(instance);
    return () => instance.destroy();
  }, [interactive]);
  const context = useMemo(
    () => ({ interactive, hover, claimIndex }),
    [interactive, hover, claimIndex],
  );
  return (
    <ListProximityContext value={context}>
      <div
        {...props}
        ref={(node) => {
          root.current = node;
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        data-slot="list-container"
        data-interactive={interactive || undefined}
        className={cn(
          'flex min-w-0 flex-col overflow-hidden text-foreground',
          { compact: 'gap-px p-px', normal: 'gap-px p-1', relaxed: 'gap-px p-1.5' }[spacing],
          className,
        )}
      >
        {children}
      </div>
    </ListProximityContext>
  );
}
