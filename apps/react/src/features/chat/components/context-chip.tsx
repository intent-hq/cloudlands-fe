// Source: src/lib/components/chat/ContextChip.svelte.
import { useLayoutEffect, useRef } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import type { IconDefinition } from '$lib/icons/icon-definition';
import { m } from '$shared/paraglide/messages.js';

export interface ContextChipProps {
  type:
    | 'file'
    | 'diff'
    | 'note'
    | 'spec'
    | 'selection'
    | 'folder'
    | 'workspace'
    | 'memory'
    | 'personality'
    | 'linear'
    | 'github'
    | 'sentry'
    | 'external';
  label: string;
  /** Overrides the type's icon through the canonical icon-definition adapter. */
  icon?: IconDefinition;
  tooltip?: string;
  maxLabelWidth?: string;
  removable?: boolean;
  clickable?: boolean;
  onRemove?: () => void;
  /** Source spelling, retained for existing callers. */
  onclick?: () => void;
  /** React spelling takes precedence when both click callbacks are supplied. */
  onClick?: () => void;
}

// These are the source chip's type choices. The shared adapter owns all
// icon-definition-to-Phosphor resolution, including custom icons and fallback.
function getIconForType(type: ContextChipProps['type']): IconDefinition {
  switch (type) {
    case 'diff':
      return { iconName: 'code-branch' };
    case 'note':
      return { iconName: 'note-sticky' };
    case 'spec':
      return { iconName: 'clipboard' };
    case 'selection':
      return { iconName: 'i-cursor' };
    case 'folder':
    case 'workspace':
      return { iconName: 'folder' };
    case 'linear':
      return { iconName: 'ticket' };
    case 'github':
      return { iconName: 'code-pull-request' };
    case 'sentry':
      return { iconName: 'bug' };
    case 'external':
      return { iconName: 'link' };
    case 'file':
    default:
      return { iconName: 'file-lines' };
  }
}

export function ContextChip({
  type,
  label,
  icon: customIcon,
  tooltip,
  maxLabelWidth = '200px',
  removable = false,
  clickable = false,
  onRemove,
  onclick,
  onClick,
}: ContextChipProps) {
  const text = useRef<HTMLSpanElement>(null);
  const titleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);
  const overflowTitle = !tooltip || tooltip === label ? label : undefined;

  useLayoutEffect(() => {
    if (!text.current) return;
    const action = truncatedTitle(text.current, undefined);
    titleAction.current = action;
    return () => {
      action?.destroy?.();
      titleAction.current = undefined;
    };
    // Switching branches replaces the real label node and its observer owner.
  }, [clickable]);

  useLayoutEffect(() => {
    titleAction.current?.update?.(overflowTitle);
  }, [overflowTitle, clickable]);

  const content = (
    <>
      <IconDefinitionIcon
        icon={customIcon ?? getIconForType(type)}
        size={15}
        className="opacity-30"
      />
      <span ref={text} className="font-medium truncate" style={{ maxWidth: maxLabelWidth }}>
        {label}
      </span>
    </>
  );

  if (clickable) {
    return (
      <div className="group/button relative flex shrink-0">
        <Button
          type="button"
          variant="plain"
          className={cn(
            'type-caption flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded bg-muted/70 px-2 py-0.5 text-muted-foreground transition-colors hover:bg-muted',
            removable && 'pr-7',
          )}
          title={
            tooltip === label ? undefined : (tooltip ?? m.chat_contextChip_open_title({ label }))
          }
          onClick={onClick ?? onclick}
        >
          {content}
        </Button>
        {removable && (
          <Button
            variant="ghost-light"
            size="icon-xs"
            className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/button:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onRemove?.();
            }}
            title={m.chat_contextChip_remove_label()}
            aria-label={m.chat_contextChip_remove_label()}
          >
            <IconDefinitionIcon icon={{ iconName: 'xmark' }} size={10} />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className="group/button type-caption flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-muted/70 px-2 py-0.5 text-subtle"
      title={tooltip !== label ? tooltip : undefined}
    >
      {content}
      {removable && (
        <Button
          variant="ghost-light"
          size="icon-xs"
          className="opacity-0 group-hover/button:opacity-100 -my-1 -mr-2 -ml-2 transition-opacity"
          onClick={() => onRemove?.()}
          title={m.chat_contextChip_remove_label()}
          aria-label={m.chat_contextChip_remove_label()}
        >
          <IconDefinitionIcon icon={{ iconName: 'xmark' }} size={10} />
        </Button>
      )}
    </div>
  );
}

export default ContextChip;
