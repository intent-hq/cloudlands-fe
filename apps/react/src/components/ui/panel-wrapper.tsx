// Source: src/lib/components/ui/PanelWrapper.svelte.
import { useMemo, useRef, type ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import {
  ContentHeader,
  type ContentHeaderProps,
} from '@/features/layout/components/content-header';
import { fly, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface PanelWrapperProps extends Omit<ContentHeaderProps, 'icon'> {
  faIcon?: Icon;
  contentClass?: string;
  headerClass?: string;
  children?: ReactNode;
  /** Keep mounted and toggle open to retain the source fly outro before removal. */
  open?: boolean;
}

const transition = (node: HTMLElement) =>
  fly(node, { axis: 'y', distance: 10, tier: 'moderate' }, { direction: 'both' });

export function PanelWrapper({ open = true, ...props }: PanelWrapperProps) {
  const items = useMemo(() => (open ? ['panel'] : []), [open]);
  const presence = usePresence(items, (key) => key);
  return presence.entries.map(({ key, present }) => (
    <PanelSurface key={key} {...props} present={present} onExit={() => presence.remove(key)} />
  ));
}

function PanelSurface({
  faIcon,
  className = '',
  contentClass = '',
  headerClass = '',
  showClose = false,
  actions,
  children,
  present,
  onExit,
  ...header
}: Omit<PanelWrapperProps, 'open'> & { present: boolean; onExit: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, transition);

  return (
    <div
      ref={root}
      inert={!present}
      className={cn(
        'flex-1 min-h-0 h-[calc(100%_-_1.5rem)] flex flex-col overflow-auto rounded shadow shadow-muted-foreground/15 m-1 bg-background my-3.5 col-span-full row-span-full',
        className,
      )}
    >
      <ContentHeader
        {...header}
        icon={faIcon}
        showClose={showClose}
        actions={actions}
        className={headerClass}
      />
      <div className={cn('flex-1 min-h-0', contentClass)}>{children}</div>
    </div>
  );
}

export default PanelWrapper;
