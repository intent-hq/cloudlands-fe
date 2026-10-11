// Source: patterns/action-menu/ActionMenu.svelte. One model for overflow and pointer invocation.
import * as React from 'react';
import * as Menu from '@/components/ui/menu';
import { Button } from '@/components/ui/button';
import { ShortcutChip } from '@/components/ui/kbd';
import { resolveActions } from './actions';
import type { ActionDefinition, ActionHandler, ResolvedAction } from './types';

let closeActiveMenu: (() => void) | null = null;
export interface ActionMenuProps {
  actions: readonly ActionDefinition[];
  onAction?: ActionHandler;
  trigger?: (state: {
    props: React.ComponentProps<typeof Menu.Trigger>;
    open: boolean;
  }) => React.ReactElement;
  contextMenu?: { x: number; y: number; returnFocus?: HTMLElement | null };
  onOpenChange?: (open: boolean) => void;
  ariaLabel: string;
  open?: boolean;
  defaultOpen?: boolean;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom' | 'left' | 'right';
  dir?: 'ltr' | 'rtl';
  className?: string;
}
function focusCandidates() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]'),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[data-action-menu-owner],[aria-hidden="true"],[inert],[hidden]'),
  );
}
function ItemContent({ action }: { action: ResolvedAction }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{action.label}</span>
        {action.disabledReason && (
          <span className="block text-muted-foreground" aria-hidden="true">
            {action.disabledReason}
          </span>
        )}
      </span>
      {action.shortcut && (
        <span className="ml-5 flex h-lh shrink-0 items-center" aria-hidden="true">
          <ShortcutChip>{action.shortcut}</ShortcutChip>
        </span>
      )}
    </>
  );
}
function ActionItems({
  entries,
  disabled = false,
  owner,
  onAction,
  onKeyDown,
}: {
  entries: readonly ResolvedAction[];
  disabled?: boolean;
  owner: string;
  onAction?: ActionHandler;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  return entries.map((entry, index) => {
    const action = disabled ? { ...entry, disabled: true } : entry;
    const unavailable = action.disabled || action.disabledReason !== undefined;
    const reasonId = action.disabledReason ? `${owner}-${action.id}-reason` : undefined;
    const IconComponent = action.icon;
    const leading = IconComponent && (
      <IconComponent
        size={16}
        className={action.destructive ? 'size-4 text-current' : 'size-4 text-muted-foreground'}
      />
    );
    const shared = {
      disabled: unavailable,
      'aria-describedby': reasonId,
      'data-action-id': action.id,
      textValue: action.label,
    };
    const select = (event: Event) => {
      if (!unavailable) onAction?.(action.id, event);
    };
    let item: React.ReactNode;
    if (action.kind === 'label')
      item = (
        <Menu.Group>
          <Menu.Label icon={action.icon}>{action.label}</Menu.Label>
        </Menu.Group>
      );
    else if (action.kind === 'section')
      item = (
        <Menu.Group aria-label={action.label}>
          <Menu.Label icon={action.icon}>{action.label}</Menu.Label>
          <ActionItems
            entries={action.children}
            disabled={unavailable}
            owner={owner}
            onAction={onAction}
            onKeyDown={onKeyDown}
          />
        </Menu.Group>
      );
    else if (action.kind === 'radio-group')
      item = (
        <Menu.RadioGroup value={action.value} aria-label={action.label}>
          <Menu.Label icon={action.icon}>{action.label}</Menu.Label>
          <ActionItems
            entries={action.children}
            disabled={unavailable}
            owner={owner}
            onAction={onAction}
            onKeyDown={onKeyDown}
          />
        </Menu.RadioGroup>
      );
    else if (action.children?.length)
      item = (
        <Menu.Sub>
          <Menu.SubTrigger {...shared} icon={action.icon}>
            <ItemContent action={action} />
          </Menu.SubTrigger>
          <Menu.SubContent
            collisionPadding={8}
            data-action-menu-owner={owner}
            onKeyDown={onKeyDown}
          >
            <ActionItems
              entries={action.children}
              owner={owner}
              onAction={onAction}
              onKeyDown={onKeyDown}
            />
          </Menu.SubContent>
        </Menu.Sub>
      );
    else if (action.kind === 'radio')
      item = (
        <Menu.RadioItem
          {...shared}
          value={action.value}
          leading={leading}
          closeOnSelect={action.closeOnSelect ?? false}
          onSelect={select}
        >
          <ItemContent action={action} />
        </Menu.RadioItem>
      );
    else if (action.checked !== undefined)
      item = (
        <Menu.CheckboxItem
          {...shared}
          checked={action.checked}
          indeterminate={action.kind === 'checkbox' && action.indeterminate}
          leading={leading}
          closeOnSelect={action.closeOnSelect ?? false}
          onSelect={select}
        >
          <ItemContent action={action} />
        </Menu.CheckboxItem>
      );
    else
      item = (
        <Menu.Item
          {...shared}
          leading={leading}
          destructive={action.destructive}
          closeOnSelect={action.closeOnSelect ?? true}
          onSelect={select}
        >
          <ItemContent action={action} />
        </Menu.Item>
      );
    const previous = entries[index - 1];
    const separator =
      index > 0 &&
      (action.group !== previous?.group ||
        action.kind === 'section' ||
        action.kind === 'radio-group' ||
        previous?.kind === 'section' ||
        previous?.kind === 'radio-group');
    return (
      <React.Fragment key={action.id}>
        {separator && <Menu.Separator />}
        {item}
        {reasonId && (
          <span id={reasonId} className="sr-only">
            {action.disabledReason}
          </span>
        )}
      </React.Fragment>
    );
  });
}
export function ActionMenu({
  actions,
  onAction,
  trigger,
  contextMenu,
  onOpenChange,
  ariaLabel,
  open: controlled,
  defaultOpen = false,
  align = 'start',
  side = 'bottom',
  dir,
  className,
}: ActionMenuProps) {
  const [local, setLocal] = React.useState(defaultOpen);
  const open = controlled ?? local;
  const owner = React.useId();
  const invoking = React.useRef<HTMLElement | null>(null);
  const fallback = React.useRef<HTMLElement[]>([]);
  const content = React.useRef<HTMLDivElement | null>(null);
  const tabDismissed = React.useRef(false);
  const previousContext = React.useRef<ActionMenuProps['contextMenu']>(undefined);
  const latest = React.useRef({ onOpenChange });
  React.useLayoutEffect(() => {
    latest.current = { onOpenChange };
  });
  const changeOpen = React.useCallback((next: boolean) => {
    setLocal(next);
    latest.current.onOpenChange?.(next);
  }, []);
  const close = React.useCallback(() => changeOpen(false), [changeOpen]);
  React.useLayoutEffect(() => {
    if (!contextMenu) {
      previousContext.current = undefined;
      return;
    }
    const { x, y, returnFocus } = contextMenu;
    const previous = previousContext.current;
    if (previous?.x === x && previous?.y === y && previous?.returnFocus === returnFocus) return;
    previousContext.current = { x, y, returnFocus };
    invoking.current =
      returnFocus ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const source = invoking.current;
    const candidates = focusCandidates();
    fallback.current = [
      ...candidates.filter(
        (element) =>
          source &&
          Boolean(source.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
      ...candidates
        .filter(
          (element) =>
            source &&
            Boolean(source.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING),
        )
        .reverse(),
    ];
    tabDismissed.current = false;
    changeOpen(true);
  }, [contextMenu, changeOpen]);
  React.useEffect(() => {
    if (!open) return;
    const previous = closeActiveMenu;
    closeActiveMenu = close;
    if (previous && previous !== close) previous();
    return () => {
      if (closeActiveMenu === close) closeActiveMenu = null;
    };
  }, [open, close]);
  const restoreContextFocus = (event: Event) => {
    if (!contextMenu) return;
    event.preventDefault();
    if (tabDismissed.current) return;
    const active = document.activeElement;
    if (
      active !== document.body &&
      active !== content.current &&
      !(
        active instanceof Element &&
        active.closest('[data-action-menu-owner]')?.getAttribute('data-action-menu-owner') === owner
      )
    )
      return;
    const target = invoking.current?.isConnected
      ? invoking.current
      : fallback.current.find(
          (element) =>
            element.isConnected &&
            !element.matches(':disabled') &&
            !element.closest('[hidden],[inert],[aria-hidden="true"]'),
        );
    target?.focus({ preventScroll: true });
  };
  const handleContextKeydown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!contextMenu || event.key !== 'Tab' || event.defaultPrevented) return;
    event.preventDefault();
    const source = invoking.current;
    const candidates = focusCandidates().filter((element) => element.getClientRects().length > 0);
    const ordered = event.shiftKey ? candidates.reverse() : candidates;
    const next = source?.isConnected
      ? ordered.find(
          (element) =>
            element !== source &&
            Boolean(
              source.compareDocumentPosition(element) &
              (event.shiftKey
                ? Node.DOCUMENT_POSITION_PRECEDING
                : Node.DOCUMENT_POSITION_FOLLOWING),
            ),
        )
      : undefined;
    tabDismissed.current = true;
    close();
    requestAnimationFrame(() =>
      (next ?? (source?.isConnected ? source : null))?.focus({ preventScroll: true }),
    );
  };
  return (
    <Menu.Root open={open} onOpenChange={changeOpen} dir={dir} modal={false}>
      <Menu.Trigger asChild>
        {contextMenu ? (
          <Button
            type="button"
            aria-label={ariaLabel}
            aria-hidden="true"
            tabIndex={-1}
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          />
        ) : (
          (trigger?.({ props: {}, open }) ?? <Button aria-label={ariaLabel}>{ariaLabel}</Button>)
        )}
      </Menu.Trigger>
      <Menu.Content
        ref={content}
        alignIconColumn
        align={align}
        side={side}
        sideOffset={contextMenu ? 0 : 4}
        collisionPadding={8}
        aria-label={ariaLabel}
        data-action-menu-owner={owner}
        onCloseAutoFocus={restoreContextFocus}
        onKeyDown={handleContextKeydown}
        className={className}
      >
        <ActionItems
          entries={resolveActions(actions)}
          owner={owner}
          onAction={onAction}
          onKeyDown={handleContextKeydown}
        />
      </Menu.Content>
    </Menu.Root>
  );
}
