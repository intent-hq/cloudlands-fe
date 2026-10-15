import { KebabIcon } from '@/components/icons/kebab-icon';
import { getEffectiveShortcut, useEffectiveShortcut } from '@/lib/effective-shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { formatShortcut, isMacPlatform } from '$lib/utils/shortcuts';
import {
  getPanelOrder,
  getHorizontalPanelColumnDefaultWidths,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-tabless';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { RobotIcon, TextAlignLeftIcon, TerminalIcon, GlobeIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { ResourceIconTile } from '@/components/shared/resource-icon-tile';
import { store } from '@/store';
import {
  selectDesktopLayout,
  selectDesktopRecentlyClosed,
  selectDesktopLastPanelClose,
} from '@/store/desktop/desktop-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import type {
  PanelLayoutNode,
  PanelState,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-types';
import {
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  focusPanel,
  setActiveTab,
  splitPanel,
  closePanel,
  closeTab,
  closeFocusedPanelTab,
  reopenClosedTab,
  reopenClosedPanelColumn,
  openBlankWorkingPanel,
  selectNextTab,
  selectPreviousTab,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { toggleSidebar } from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import {
  getPanelCanvasWidths,
  getPanelPreferredWidths,
} from '$lib/components/layout/panel-system/panel-canvas-width';
import { m } from '$shared/paraglide/messages.js';
import { DesktopResizeHandle } from './desktop-resize-handle';
import { DesktopNotePreview } from './desktop-note-preview';

export function DesktopPanels({
  workspaceId,
  active,
  onUnavailable,
}: {
  workspaceId: string;
  active: boolean;
  onUnavailable: (title: string) => void;
}) {
  const layout = selectDesktopLayout(workspaceId).value;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    store.dispatch(panelLayoutScopeMounted(workspaceId));
    return () => {
      store.dispatch(panelLayoutScopeUnmounted(workspaceId));
    };
  }, [workspaceId]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth - 12));
    observer.observe(element);
    setWidth(element.clientWidth - 12);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[role="dialog"],[role="menu"]')
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        !authority ||
        selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) !== authority
      )
        return;
      const matches = (id: Parameters<typeof getEffectiveShortcut>[0]) =>
        matchesShortcut(event, getEffectiveShortcut(id), isMacPlatform());
      const globalPanelKey = [
        'panel.focus-next-column',
        'panel.focus-previous-column',
        'panel.next-pane',
        'panel.previous-pane',
        'panel.create-column-right',
      ].some((id) => matches(id as Parameters<typeof getEffectiveShortcut>[0]));
      if (
        !globalPanelKey &&
        target?.closest('input,textarea,[contenteditable=true],.monaco-editor,.xterm')
      )
        return;
      const current = selectDesktopLayout.select(store.state, workspaceId);
      let action;
      if (matches('panel.toggle-sidebar')) action = toggleSidebar();
      else if (matches('navigation.new-tab')) action = openBlankWorkingPanel(workspaceId);
      else if (matches('navigation.close-tab')) action = closeFocusedPanelTab(workspaceId);
      else if (matches('panel.next-pane')) action = selectNextTab(workspaceId);
      else if (matches('panel.previous-pane')) action = selectPreviousTab(workspaceId);
      else if (matches('panel.create-column-right') && current.focusedPanelId)
        action = splitPanel(workspaceId, current.focusedPanelId, 'horizontal');
      else if (matches('panel.focus-next-column') || matches('panel.focus-previous-column')) {
        const ids = getPanelOrder(current.root);
        const index = ids.indexOf(current.focusedPanelId ?? '');
        const target = ids[index + (matches('panel.focus-next-column') ? 1 : -1)];
        if (target) action = focusPanel(workspaceId, target);
      }
      if (action) {
        event.preventDefault();
        store.dispatch(action);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [workspaceId, active, authority]);
  const defaults = layout.root
    ? getHorizontalPanelColumnDefaultWidths(layout.root, layout.panels, width)
    : [];
  const rootSizes =
    layout.root?.type === 'split' && layout.root.direction === 'horizontal'
      ? layout.root.sizes
      : null;
  const preferredWidths = getPanelPreferredWidths(
    defaults,
    rootSizes,
    layout.canvasWidth,
    layout.canvasWidthSource,
  );
  const canvas = getPanelCanvasWidths(
    width,
    preferredWidths,
    'viewport',
    layout.canvasWidth,
    layout.canvasWidthSource,
  );
  return (
    <div ref={viewport} className="desktop-panel-viewport" data-testid="panel-workspace-inset">
      <div className="desktop-panel-canvas" style={{ width: canvas.defaultWidth || '100%' }}>
        {layout.root && (
          <PanelNode
            node={
              layout.root.type === 'panel'
                ? { type: 'split', direction: 'horizontal', children: [layout.root], sizes: [100] }
                : layout.root
            }
            path={[]}
            rootWidths={canvas.panelWidths}
            workspaceId={workspaceId}
            panels={layout.panels}
            focusedPanelId={layout.focusedPanelId}
            active={active}
            onUnavailable={onUnavailable}
          />
        )}
      </div>
    </div>
  );
}
function PanelNode({
  rootWidths,
  node,
  path,
  workspaceId,
  panels,
  focusedPanelId,
  active,
  onUnavailable,
}: {
  onUnavailable: (title: string) => void;
  rootWidths?: number[];
  node: PanelLayoutNode;
  path: number[];
  workspaceId: string;
  panels: Record<string, PanelState>;
  focusedPanelId: string | null;
  active: boolean;
}) {
  if (node.type === 'panel') {
    const panel = panels[node.panelId];
    return panel ? (
      <DesktopPanel
        panel={panel}
        workspaceId={workspaceId}
        focused={focusedPanelId === panel.id}
        active={active}
        onUnavailable={onUnavailable}
      />
    ) : null;
  }
  return (
    <div className={`desktop-panel-split ${node.direction}`}>
      {node.children.map((child, index) => (
        <Fragment key={child.type === 'panel' ? child.panelId : JSON.stringify([...path, index])}>
          <div
            className="desktop-split-child"
            style={{
              flex:
                rootWidths && node.direction === 'horizontal'
                  ? `0 0 ${rootWidths[index]}px`
                  : `${node.sizes[index]} 1 0`,
            }}
          >
            <PanelNode
              node={child}
              path={[...path, index]}
              workspaceId={workspaceId}
              panels={panels}
              focusedPanelId={focusedPanelId}
              active={active}
              onUnavailable={onUnavailable}
            />
          </div>
          {index < node.children.length - 1 && (
            <DesktopResizeHandle
              kind="split"
              active={active}
              workspaceId={workspaceId}
              path={path}
              sizes={node.sizes}
              index={index}
              vertical={node.direction === 'vertical'}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
function DesktopPanel({
  panel,
  workspaceId,
  focused,
  active,
  onUnavailable,
}: {
  onUnavailable: (title: string) => void;
  panel: PanelState;
  workspaceId: string;
  focused: boolean;
  active: boolean;
}) {
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const dispatch = (action: Parameters<typeof store.dispatch>[0]) => {
    if (
      active &&
      authority &&
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority &&
      selectDesktopLayout.select(store.state, workspaceId).panels[panel.id]
    )
      store.dispatch(action);
  };
  const newPanelShortcut = useEffectiveShortcut('navigation.new-tab');
  const reopenShortcut = useEffectiveShortcut('navigation.reopen-tab');
  const sidebarShortcut = useEffectiveShortcut('panel.toggle-sidebar');
  const recent = selectDesktopRecentlyClosed(workspaceId).value;
  const lastClose = selectDesktopLastPanelClose(workspaceId).value;
  const reopen = () =>
    dispatch(
      lastClose?.kind === 'column'
        ? reopenClosedPanelColumn(workspaceId)
        : reopenClosedTab(workspaceId),
    );
  const tab = panel.tabs.find((item) => item.id === panel.activeTabId);
  const element = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (active && focused) element.current?.focus({ preventScroll: true });
  }, [active, focused, panel.id]);
  return (
    <section
      ref={element}
      tabIndex={-1}
      className={`desktop-panel ${tab ? 'populated' : ''}`}
      data-panel-id={panel.id}
      data-panel-focused={focused}
      aria-label={m.layout_panel_ariaLabel()}
      onPointerDownCapture={() => {
        if (!focused) dispatch(focusPanel(workspaceId, panel.id));
      }}
      onFocusCapture={() => {
        if (!focused) dispatch(focusPanel(workspaceId, panel.id));
      }}
    >
      <header className="desktop-panel-header">
        {tab && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="plain" wrapContent={false} className="desktop-panel-picker">
                <ResourceIconTile kind="note" />
                <span className="truncate">{tab.title}</span>
                <svg
                  viewBox="0 0 8 14"
                  fill="none"
                  className="desktop-panel-picker-caret text-muted-foreground"
                  aria-hidden="true"
                >
                  <path
                    d="M6.532 4 4.332 1.067C3.932.533 3.132.533 2.732 1.067L.532 4M.532 10 2.732 12.933C3.132 13.467 3.932 13.467 4.332 12.933L6.532 10"
                    stroke="currentColor"
                    strokeWidth="1.33"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              {panel.tabs.map((item) => (
                <Menu.CommandItem
                  key={item.id}
                  label={item.title}
                  onSelect={() => dispatch(setActiveTab(workspaceId, item.id, panel.id))}
                />
              ))}
            </Menu.Content>
          </Menu.Root>
        )}
        <div className="flex-1" />
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label={m.ui_breadcrumb_more_label()}
              data-testid="panel-actions-trigger"
            >
              <KebabIcon />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            {tab?.type === 'note' && (
              <>
                <Menu.Sub>
                  <Menu.SubTrigger>
                    {m.ui_viewSettings_noteViewMode_label()}
                    <span className="ml-auto text-subtle">
                      {m.ui_viewSettings_renderedPreview_label()}
                    </span>
                  </Menu.SubTrigger>
                  <Menu.SubContent>
                    <Menu.RadioGroup value="preview">
                      <Menu.RadioItem
                        value="editor"
                        onSelect={() => onUnavailable(m.ui_viewSettings_editor_label())}
                        closeOnSelect
                      >
                        {m.ui_viewSettings_editor_label()}
                      </Menu.RadioItem>
                      <Menu.RadioItem value="preview" closeOnSelect>
                        {m.ui_viewSettings_renderedPreview_label()}
                      </Menu.RadioItem>
                    </Menu.RadioGroup>
                  </Menu.SubContent>
                </Menu.Sub>
                <Menu.Separator />
              </>
            )}
          </Menu.Content>
        </Menu.Root>
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={
            tab
              ? m.layout_panelTabBar_closePane_ariaLabel()
              : m.layout_panelTabBar_closePanel_label()
          }
          data-testid="panel-close-button"
          onClick={() => {
            if (tab) dispatch(closeTab(workspaceId, tab.id, panel.id));
            else dispatch(closePanel(workspaceId, panel.id));
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
            <path
              d="M3.5 3.5 6.5 6.5C7.328 7.328 7.328 8.672 6.5 9.5L3.5 12.5M12.5 12.5 9.5 9.5C8.672 8.672 8.672 7.328 9.5 6.5L12.5 3.5"
              stroke="currentColor"
              strokeWidth="1.33"
            />
          </svg>
        </Button>
      </header>
      <div className="desktop-panel-content">
        {panel.tabs.map((item) => (
          <div
            key={item.id}
            className="desktop-panel-tab-content"
            hidden={item.id !== panel.activeTabId}
            inert={item.id !== panel.activeTabId}
          >
            {item.type === 'note' && item.noteId ? (
              <DesktopNotePreview workspaceId={workspaceId} noteId={item.noteId} tabId={item.id} />
            ) : (
              <output className="p-6 text-subtle">{m.desktop_shell_unported_description()}</output>
            )}
          </div>
        ))}
        {!tab && (
          <div className="desktop-panel-empty" data-panel-empty-state>
            <div className="w-full max-w-xs type-caption">
              <div className="flex flex-col gap-0.5">
                {[
                  { label: m.layout_panelEmptyState_agent_label(), Icon: RobotIcon },
                  { label: m.layout_panelEmptyState_note_label(), Icon: TextAlignLeftIcon },
                  { label: m.layout_panelEmptyState_terminal_label(), Icon: TerminalIcon },
                  { label: m.layout_panelEmptyState_browser_label(), Icon: GlobeIcon },
                ].map(({ label, Icon }) => (
                  <Button
                    key={label}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    onClick={() => onUnavailable(label)}
                  >
                    <Icon size={14} />
                    {m.layout_panelEmptyState_newItem_tooltip({ label })}
                  </Button>
                ))}
              </div>
              {recent.length > 0 && (
                <div className="mt-5 flex flex-col">
                  {recent.slice(0, 5).map((item) => (
                    <Button
                      key={item.tab.id}
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() =>
                        dispatch(reopenClosedTab(workspaceId, undefined, item.tab.id, panel.id))
                      }
                    >
                      {item.tab.title}
                    </Button>
                  ))}
                </div>
              )}
              <div className="mt-5 flex flex-col text-subtle">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-between"
                  onClick={() => dispatch(splitPanel(workspaceId, panel.id, 'horizontal'))}
                >
                  {m.layout_panelEmptyState_newPanel_label()}
                  <kbd>{formatShortcut(newPanelShortcut)}</kbd>
                </Button>
                <Button variant="ghost" size="sm" className="justify-between" onClick={reopen}>
                  {m.layout_panelEmptyState_reopenClosed_label()}
                  <kbd>{formatShortcut(reopenShortcut)}</kbd>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-between"
                  onClick={() => dispatch(toggleSidebar())}
                >
                  {m.layout_panelEmptyState_toggleSidebar_label()}
                  <kbd>{formatShortcut(sidebarShortcut)}</kbd>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
