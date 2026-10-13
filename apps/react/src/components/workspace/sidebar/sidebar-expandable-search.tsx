// Source: src/lib/components/workspace/sidebar/SidebarExpandableSearch.svelte.
import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import { m } from '$shared/paraglide/messages.js';
import { SidebarActionIcon } from './sidebar-action-icon';
import { SidebarHeaderAction } from './sidebar-header-action';
import './sidebar-expandable-search.css';

export interface SidebarExpandableSearchProps {
  query?: string;
  /** React counterpart of bind:query; changes are reported in the originating handler. */
  onQueryChange?: (query: string) => void;
  placeholder: string;
  scope: 'agents' | 'context' | 'files' | 'workspaces';
  placement?: 'header' | 'toolbar';
  onKeydown?: (event: KeyboardEvent) => void;
}

export function SidebarExpandableSearch({
  query = '',
  onQueryChange,
  placeholder,
  scope,
  placement = 'header',
  onKeydown,
}: SidebarExpandableSearchProps) {
  // Like a Svelte bindable prop, query remains locally writable without a parent binding.
  const [search, setSearch] = useState({ propQuery: query, query, expanded: Boolean(query) });
  if (search.propQuery !== query) {
    setSearch({ propQuery: query, query, expanded: Boolean(query) || search.expanded });
  }
  const currentQuery = search.propQuery !== query ? query : search.query;
  const expanded = search.expanded || (search.propQuery !== query && Boolean(query));
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'input' | 'trigger' | null>(null);

  function expand() {
    pendingFocus.current = 'input';
    setSearch((current) => ({ ...current, expanded: true }));
  }

  function close(restoreFocus: boolean) {
    pendingFocus.current = restoreFocus ? 'trigger' : null;
    setSearch((current) => ({ ...current, query: '', expanded: false }));
    onQueryChange?.('');
  }

  function changeQuery(value: string) {
    setSearch((current) => ({
      ...current,
      query: value,
      expanded: Boolean(value) || current.expanded,
    }));
    onQueryChange?.(value);
  }

  const closeOnEscape = useEffectEvent(() => close(true));
  useLayoutEffect(() => {
    if (!expanded) return;
    return pushEscapeLayer(() => closeOnEscape());
  }, [expanded]);

  const handleKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape') onKeydown?.(event);
  });
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // Preserve the native event/currentTarget and caller propagation control.
    input.addEventListener('keydown', handleKeydown);
    return () => input.removeEventListener('keydown', handleKeydown);
  }, [expanded]);

  useLayoutEffect(() => {
    // The source awaits tick() before focusing a newly mounted input or trigger.
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    if (focus === 'input') inputRef.current?.focus();
    if (focus === 'trigger') triggerRef.current?.focus();
  }, [expanded]);

  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        placement === 'header' && 'sidebar-search--header',
        placement === 'toolbar' || expanded ? 'flex-1' : 'shrink-0',
      )}
      data-sidebar-search={scope}
    >
      {expanded ? (
        <div className="relative w-full min-w-0" data-sidebar-search-expanded={scope}>
          <SidebarActionIcon icon="search" />
          <Input
            ref={inputRef}
            value={currentQuery}
            onChange={(event) => changeQuery(event.currentTarget.value)}
            type="search"
            aria-label={placeholder}
            placeholder={placeholder}
            className="h-7 min-w-0 bg-transparent! py-0 pl-7 pr-7 text-xs shadow-none! placeholder:text-muted-foreground!"
            noFocusStyle
            onBlur={() => {
              if (!currentQuery) close(false);
            }}
            data-sidebar-search-input={scope}
          />
          <span className="absolute right-0 top-0">
            <SidebarHeaderAction
              icon="close"
              data-sidebar-search-clear={scope}
              label={m.workspace_sidebarSearch_clear_ariaLabel()}
              onClick={() => {
                changeQuery('');
                inputRef.current?.focus();
              }}
            />
          </span>
        </div>
      ) : (
        <SidebarHeaderAction
          ref={triggerRef}
          icon="search"
          label={placeholder}
          className={cn(
            'focus-visible:outline-solid',
            scope === 'files' && 'text-muted-foreground!',
          )}
          onClick={expand}
        />
      )}
    </div>
  );
}
