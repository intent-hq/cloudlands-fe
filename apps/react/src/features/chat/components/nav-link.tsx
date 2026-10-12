import { useLayoutEffect, useRef } from 'react';
import { getHighlightIdFromTarget } from '$lib/components/chat/nav-link-target';
import { isResolvableNavTarget } from '$shared/app-ui-targets';
import { WorkspaceId } from '$shared/types/branded-ids';
import { isCmdClickModifier, type LinkHandlerOptions } from '$shared/utils/link-helpers';
import { store } from '@/store';
import { requestUiHighlight } from '../../../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';

export interface NavLinkProps {
  target: string;
  label?: string;
  workspaceId?: string;
  canOpenFile?: () => boolean;
  onNavigate: (target: string) => void | Promise<void>;
  onOpenLink: (url: string, options: LinkHandlerOptions) => Promise<boolean>;
}

export function NavLink(props: NavLinkProps) {
  const { target, label } = props;
  const resolvable = isResolvableNavTarget(target);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const currentProps = useRef(props);

  useLayoutEffect(() => {
    currentProps.current = props;
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    async function handleClick(event: MouseEvent) {
      event.preventDefault();
      const { target, workspaceId, canOpenFile, onNavigate, onOpenLink } = currentProps.current;
      if (!target) return;

      if (target.trim().startsWith('intent://')) {
        await onOpenLink(target.trim(), {
          workspaceId: workspaceId ? WorkspaceId(workspaceId) : undefined,
          event,
          canOpenFile,
        });
        return;
      }

      await onNavigate(target);
      // Svelte reads the current prop again after navigation settles.
      const highlightId = getHighlightIdFromTarget(
        currentProps.current.target,
        window.location.origin,
      );
      if (highlightId) {
        requestAnimationFrame(() => store.dispatch(requestUiHighlight(highlightId)));
      }
    }

    function handleKeydown(event: KeyboardEvent) {
      const { target, workspaceId, canOpenFile, onOpenLink } = currentProps.current;
      if (
        event.key === 'Enter' &&
        target.trim().startsWith('intent://') &&
        isCmdClickModifier({ event })
      ) {
        event.preventDefault();
        void onOpenLink(target.trim(), {
          workspaceId: workspaceId ? WorkspaceId(workspaceId) : undefined,
          event,
          canOpenFile,
        });
      }
    }

    // Preserve the actual native event, including its currentTarget during dispatch.
    anchor.addEventListener('click', handleClick);
    anchor.addEventListener('keydown', handleKeydown);
    return () => {
      anchor.removeEventListener('click', handleClick);
      anchor.removeEventListener('keydown', handleKeydown);
    };
  }, [resolvable]);

  if (resolvable) {
    return (
      <a
        ref={anchorRef}
        href={target}
        className="ws-block-widget type-body my-2 inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-medium text-foreground shadow-(--elevation-raised) transition-[background-color,border-color,color] hover:border-input hover:bg-accent focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
      >
        <span>{label || target}</span>
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
      </a>
    );
  }

  return label || target ? (
    <span data-nav-link-unresolved="" className="type-body text-foreground">
      {label || target}
    </span>
  ) : null;
}
