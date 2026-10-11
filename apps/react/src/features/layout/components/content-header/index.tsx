// Source: src/features/layout/components/content-header/ContentHeader.svelte.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CaretLeftIcon, CaretRightIcon, XIcon, type Icon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipShortcut } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { observeOverflow } from '$lib/actions/observe-overflow';
import { SHORTCUTS } from '$lib/utils/shortcuts';
import { m } from '$shared/paraglide/messages.js';
import type { BreadcrumbItem } from './types';
import './content-header.css';

export type { BreadcrumbItem } from './types';

export interface ContentHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  icon?: Icon;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  showClose?: boolean;
  onClose?: () => void;
  editableTitle?: boolean;
  onTitleChange?: (newTitle: string) => void;
  actions?: ReactNode;
  className?: string;
}

export function ContentHeader({
  title,
  subtitle,
  breadcrumbs = [],
  icon: TitleIcon,
  canGoBack = false,
  canGoForward = false,
  onNavigateBack,
  onNavigateForward,
  showClose = true,
  onClose,
  editableTitle = false,
  onTitleChange,
  actions,
  className = '',
}: ContentHeaderProps) {
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState({ title, value: title });
  // The source replaces the draft whenever the title prop changes, even while editing.
  if (draft.title !== title) setDraft({ title, value: title });
  const editedTitle = draft.title === title ? draft.value : title;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);
  // React can deliver a blur before the display view commits after Enter or Escape.
  const editing = useRef(false);

  useLayoutEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  useLayoutEffect(() => {
    if (!titleTextRef.current) return;
    const observer = observeOverflow(titleTextRef.current, setTitleOverflow);
    return () => observer?.destroy?.();
  }, [isEditingTitle]);

  function startEditingTitle() {
    if (!editableTitle) return;
    editing.current = true;
    setEditingTitle(true);
    setDraft({ title, value: title });
  }

  function saveTitle() {
    if (!editing.current) return;
    editing.current = false;
    // Compare the raw draft before trimming, exactly as ContentHeader.svelte does.
    if (editedTitle.trim() && editedTitle !== title) onTitleChange?.(editedTitle.trim());
    setEditingTitle(false);
  }

  function cancelEditingTitle() {
    editing.current = false;
    setDraft({ title, value: title });
    setEditingTitle(false);
  }

  function handleTitleKeydown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditingTitle();
    }
  }

  return (
    <div
      className={cn(
        'h-(--panel-header-height) flex items-center justify-between px-3 shrink-0',
        className,
      )}
    >
      <div className="flex items-center min-w-0 h-full gap-0">
        <div className="flex items-center min-w-0 px-2 gap-2">
          {breadcrumbs.map((crumb, index) => {
            const CrumbIcon = crumb.icon;
            const content = (
              <>
                {CrumbIcon && <CrumbIcon className="w-3 h-3 opacity-50" aria-hidden="true" />}
                <span className="truncate max-w-24">{crumb.label}</span>
              </>
            );
            return (
              <Breadcrumb key={`crumb-${index}-${crumb.label}`} crumb={crumb}>
                {content}
              </Breadcrumb>
            );
          })}

          {TitleIcon && breadcrumbs.length === 0 && (
            <TitleIcon className="w-3.5 h-3.5 text-ghost opacity-50 shrink-0" aria-hidden="true" />
          )}

          <div className="flex items-center gap-1.5 min-w-0">
            <div className="relative inline-flex min-w-0 items-center">
              {isEditingTitle ? (
                <Input
                  ref={titleInputRef}
                  type="text"
                  value={editedTitle}
                  onChange={(event) => setDraft({ title, value: event.currentTarget.value })}
                  onBlur={saveTitle}
                  onKeyDown={handleTitleKeydown}
                  noFocusStyle
                  className="content-header-edit-input relative z-10 text-sm font-medium bg-transparent hover:bg-transparent border-none outline-none focus:ring-0 px-0 min-w-[4ch] max-w-full"
                  style={{ fieldSizing: 'content' }}
                />
              ) : (
                <Button
                  className={cn(
                    'relative z-10 text-sm font-medium truncate text-left hover:opacity-80 transition-opacity',
                    editableTitle ? 'cursor-text' : 'cursor-default',
                  )}
                  onClick={startEditingTitle}
                  disabled={!editableTitle}
                  wrapContent={false}
                  title={
                    editableTitle
                      ? m.ui_contentHeader_clickToEdit_tooltip()
                      : titleOverflow
                        ? title
                        : undefined
                  }
                >
                  <span className="truncate" ref={titleTextRef}>
                    {title}
                  </span>
                </Button>
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute z-0 rounded-(--radius-small) border transition-[inset,border-color,background-color] duration-(--motion-standard) ease-(--ease-standard) motion-reduce:transition-none',
                  isEditingTitle
                    ? '-inset-x-2 -inset-y-1.5 border-ring/60 bg-background'
                    : '-inset-x-1 -inset-y-0.5 border-transparent bg-transparent',
                )}
              />
            </div>
            {subtitle && <span className="text-xs text-subtle truncate">{subtitle}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center ml-2 shrink-0">
        {actions}
        <div className="flex items-center h-full mr-1 relative border-l border-border ml-3">
          <div className="flex items-center h-full pl-3">
            <TooltipShortcut
              label={m.ui_contentHeader_goBack_tooltip()}
              shortcut={SHORTCUTS.GO_BACK.key}
              side="bottom"
              delayDuration={300}
            >
              <Button
                size="icon-xs"
                aria-label={m.ui_contentHeader_goBack_tooltip()}
                variant="ghost-light"
                onClick={() => onNavigateBack?.()}
                disabled={!canGoBack}
                className="rounded-none h-full py-2 pr-0!"
              >
                <CaretLeftIcon size="0.875em" aria-hidden="true" />
              </Button>
            </TooltipShortcut>
            <TooltipShortcut
              label={m.ui_contentHeader_goForward_tooltip()}
              shortcut={SHORTCUTS.GO_FORWARD.key}
              side="bottom"
              delayDuration={300}
            >
              <Button
                size="icon-xs"
                aria-label={m.ui_contentHeader_goForward_tooltip()}
                variant="ghost-light"
                onClick={() => onNavigateForward?.()}
                disabled={!canGoForward}
                className="rounded-none h-full py-2 pl-0!"
              >
                <CaretRightIcon size="0.875em" aria-hidden="true" />
              </Button>
            </TooltipShortcut>
          </div>
        </div>

        {showClose && onClose && (
          <TooltipShortcut
            label={m.ui_contentHeader_closePanel_tooltip()}
            side="bottom"
            delayDuration={300}
          >
            <Button
              size="icon-xs"
              variant="ghost-light"
              onClick={onClose}
              aria-label={m.ui_contentHeader_closePanel_tooltip()}
            >
              <XIcon size="0.875em" aria-hidden="true" />
            </Button>
          </TooltipShortcut>
        )}
      </div>
    </div>
  );
}

function Breadcrumb({ crumb, children }: { crumb: BreadcrumbItem; children: ReactNode }) {
  return (
    <>
      {crumb.onClick ? (
        <Button
          onClick={crumb.onClick}
          className="flex items-center gap-1.5 text-ui font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {children}
        </Button>
      ) : (
        <span className="flex items-center gap-1.5 text-ui font-medium text-muted-foreground">
          {children}
        </span>
      )}
      <div className="mx-0.5 font-medium text-xs text-subtle opacity-30">/</div>
    </>
  );
}

export default ContentHeader;
