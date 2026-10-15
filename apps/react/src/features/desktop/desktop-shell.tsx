import { KebabIcon } from '@/components/icons/kebab-icon';
import { resolveWorkspaceReopenTarget } from '../../../../../src/features/workspace/utils/workspace-reopen-target';
import { WORKSPACE_TAB_MOTION_DURATION_MS } from '$lib/components/layout/titlebar-geometry';
import { getEffectiveShortcut } from '@/lib/effective-shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { isMacPlatform } from '$lib/utils/shortcuts';
import { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  HouseIcon,
  XIcon,
  PlusIcon,
  TextAlignLeftIcon,
  HardDrivesIcon,
  FoldersIcon,
  RobotIcon,
  CodeIcon,
  GlobeIcon,
  TerminalIcon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ContentDialog } from '@/components/patterns/confirm/content-dialog';
import { IntentNavigationIcon } from '@/components/icons/intent-navigation-icon';
import { DesktopHome } from './desktop-home';
import { ListContainer, ListItem } from '@/components/ui/list';
import { WorkspaceStatusIcon } from '@/components/workspace/workspace-status-icon';
import { resolveWorkspaceStatusState } from '$lib/components/workspace/utils/workspace-status-presentation';
import { WorkspaceTabFlare } from '@/components/layout/workspace-tab-flare';
import { ResourceIconTile } from '@/components/shared/resource-icon-tile';
import { WorkspaceSidebarRail } from '@/components/workspace/sidebar/workspace-sidebar-rail';
import { SidebarHeaderAction } from '@/components/workspace/sidebar/sidebar-header-action';
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
import { store } from '@/store';
import {
  selectDesktopLastPanelClose,
  selectDesktopDaemonStatus,
  selectDesktopLayout,
  selectDesktopNotes,
  selectDesktopWorkspaces,
} from '@/store/desktop/desktop-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  selectCurrentWorkspaceTabId,
  selectLastClosedWorkspaceTab,
  selectActiveWorkspaceIds,
  selectWorkspaceTabOrder,
  selectWorkspaceTabsHydrated,
} from '@/store/tab-state/tab-state-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectMultiSelectSidebarSelectedTabIds } from '@/store/sidebar-nav/sidebar-nav-selectors';
import {
  selectIsCollapsed,
  selectSidebarWidth,
  selectSidebarSide,
  selectResizablePanelSize,
} from '@/store/ui-layout/ui-layout-selectors';
import {
  reopenLastClosedWorkspaceTab,
  openWorkspaceTab,
  closeWorkspaceTab,
} from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import { setMultiSelectSidebarSelectedTabs } from '../../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { requestResizablePanelSize } from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import { compareToPinnedVersion } from '$shared/intentd-version-compare';
import { toggleSidebar } from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import {
  reopenClosedPanelColumn,
  reopenClosedTab,
  openTab,
  openTabInAdjacentOrSplit,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { filterContextNotes } from '$lib/components/workspace/sidebar/sidebar-search';
import {
  createWorkspaceSurfaceRetentionState,
  reconcileWorkspaceSurfaces,
} from '../../../../../src/routes/(app)/workspace/[id]/workspace-surface-retention';
import { m } from '$shared/paraglide/messages.js';
import { DesktopPanels } from './desktop-panels';
import { DesktopResizeHandle } from './desktop-resize-handle';
import './desktop-shell.css';

/** Desktop chrome follows the mounted Svelte workspace tree, not the browser directory. */
export function DesktopShell() {
  const { workspaceId } = useParams({ strict: false }) as { workspaceId?: string };
  const navigate = useNavigate();
  const daemon = selectDesktopDaemonStatus().value;
  const health = daemon.health;
  const daemonVersion = daemon.stats?.version ?? daemon.transport?.daemonVersion;
  const comparison =
    daemonVersion && daemon.transport?.pinnedVersion
      ? compareToPinnedVersion(daemonVersion, daemon.transport.pinnedVersion)
      : null;
  const versionMismatch = comparison === 'older' || comparison === 'newer';
  const diskLow =
    daemon.stats?.workspacesDiskAvailableBytes !== undefined &&
    daemon.stats.workspacesDiskTotalBytes !== undefined &&
    daemon.stats.workspacesDiskTotalBytes > 0 &&
    daemon.stats.workspacesDiskAvailableBytes / daemon.stats.workspacesDiskTotalBytes < 0.1;
  const daemonLabel =
    health === 'healthy'
      ? versionMismatch
        ? m.layout_daemonStatus_healthyVersionMismatch_label()
        : m.layout_daemonStatus_healthy_label()
      : health === 'degraded'
        ? m.layout_daemonStatus_degraded_label()
        : m.layout_daemonStatus_down_label();
  const workspaces = selectDesktopWorkspaces().value;
  const order = selectWorkspaceTabOrder().value;
  const openIds = selectActiveWorkspaceIds().value;
  const hydrated = selectWorkspaceTabsHydrated().value;
  const admission = selectAdmittedWorkspaceReadContext(workspaceId ?? '').value;
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [retention, setRetention] = useState(createWorkspaceSurfaceRetentionState);
  const surfaces = useRef<HTMLDivElement>(null);
  const route = workspaceId ?? '';
  const nextRetention = reconcileWorkspaceSurfaces(retention, {
    activeWorkspaceId: route,
    openWorkspaceIds: openIds,
    workspaceEntityIds: workspaces.map((workspace) => workspace.id),
  });
  if (JSON.stringify(nextRetention) !== JSON.stringify(retention)) setRetention(nextRetention);
  useLayoutEffect(() => {
    if (route && hydrated && admission) store.dispatch(openWorkspaceTab(route));
  }, [route, hydrated, admission]);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && surfaces.current?.contains(focused)) focused.blur();
  }, [route]);
  const open = useCallback(
    (id: string) => {
      if (!selectWorkspaceById.select(store.state, id)) return;
      store.dispatch(openWorkspaceTab(id));
      void navigate({ to: '/workspace/$workspaceId', params: { workspaceId: id } });
    },
    [navigate],
  );

  function close(id: string) {
    store.dispatch(closeWorkspaceTab(id));
    if (route === id) {
      const next = selectWorkspaceTabOrder.select(store.state).at(-1);
      if (next) open(next);
      else void navigate({ to: '/workspace' });
    }
  }
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[role="dialog"],[role="menu"]')
      )
        return;
      if (matchesShortcut(event, getEffectiveShortcut('navigation.reopen-tab'), isMacPlatform())) {
        const panel = route ? selectDesktopLastPanelClose.select(store.state, route) : null;
        const closedWorkspace = selectLastClosedWorkspaceTab.select(store.state);
        const target = resolveWorkspaceReopenTarget(route || null, panel, closedWorkspace);
        if (
          (target === 'column' || target === 'tab') &&
          selectAdmittedWorkspaceReadContext.select(store.state, route)
        ) {
          event.preventDefault();
          store.dispatch(
            target === 'column' ? reopenClosedPanelColumn(route) : reopenClosedTab(route),
          );
        } else if (target === 'workspace') {
          event.preventDefault();
          store.dispatch(reopenLastClosedWorkspaceTab());
          const id = selectCurrentWorkspaceTabId.select(store.state);
          if (id) open(id);
        }
        return;
      }
      const next = matchesShortcut(
        event,
        getEffectiveShortcut('global.next-space'),
        isMacPlatform(),
      );
      const previous = matchesShortcut(
        event,
        getEffectiveShortcut('global.previous-space'),
        isMacPlatform(),
      );
      if (!next && !previous) return;
      const ids = selectWorkspaceTabOrder.select(store.state);
      if (!ids.length) return;
      const index = ids.indexOf(route);
      const target = ids[(index + (next ? 1 : -1) + ids.length) % ids.length];
      if (target) {
        event.preventDefault();
        open(target);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [route, open]);
  return (
    <div className="desktop-app" data-testid="desktop-app-ready">
      <header className="desktop-titlebar">
        <div className="desktop-titlebar-tabs">
          <span className="desktop-titlebar-drag" />
          <Button
            variant="ghost"
            size="icon-compact"
            className="desktop-home-tab"
            aria-label={m.home_navigation_label()}
            onClick={() => void navigate({ to: '/workspace' })}
          >
            <HouseIcon size={16} />
          </Button>
          <div
            className="desktop-workspace-tabs"
            role="tablist"
            aria-label={m.home_tab_workspaces()}
          >
            {order.map((id) => {
              const workspace = workspaces.find((item) => item.id === id);
              if (!workspace) return null;
              return (
                <div
                  key={id}
                  className={`desktop-workspace-tab ${route === id ? 'active' : ''}`}
                  data-workspace-tab={id}
                >
                  <WorkspaceTabFlare
                    side="leading"
                    visible={route === id}
                    durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
                  />
                  <Button
                    role="tab"
                    aria-selected={route === id}
                    variant="plain"
                    onClick={() => open(id)}
                    wrapContent={false}
                    className="desktop-workspace-tab-title"
                  >
                    <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
                    <WorkspaceStatusIcon
                      status={resolveWorkspaceStatusState(workspace)}
                      size={14}
                      decorative
                    />
                    <span className="desktop-workspace-tab-close-space" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="plain"
                    size="icon-compact"
                    aria-label={m.layout_workspaceTabStrip_close_ariaLabel({
                      name: workspace.title,
                    })}
                    title={workspace.title}
                    onClick={() => close(id)}
                    data-workspace-tab-close={id}
                  >
                    <XIcon size={12} />
                  </Button>
                  <WorkspaceTabFlare
                    side="trailing"
                    visible={route === id}
                    durationMs={WORKSPACE_TAB_MOTION_DURATION_MS}
                  />
                </div>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="icon-compact"
            className="desktop-new-workspace"
            aria-label={m.layout_sidebarNav_newWorkspace_title()}
            onClick={() => setUnavailable(m.home_new_workspace())}
          >
            <PlusIcon size={16} />
          </Button>
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label={daemonLabel}
          className={`desktop-daemon-status ${
            health === 'down'
              ? 'text-danger'
              : health === 'degraded' || versionMismatch || diskLow
                ? 'text-warning'
                : ''
          }`}
          onClick={() => setUnavailable(daemonLabel)}
        >
          <HardDrivesIcon size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-compact"
          className="desktop-settings"
          aria-label={m.layout_sidebarNav_settings_label()}
          onClick={() => setUnavailable(m.layout_sidebarNav_settings_label())}
        >
          <IntentNavigationIcon name="settings" />
        </Button>
      </header>
      <main className="desktop-workspace-frame">
        {!route && <DesktopHome onOpen={open} onUnavailable={setUnavailable} />}
        <div ref={surfaces} className="desktop-surfaces" hidden={!route}>
          {nextRetention.surfaces
            .filter((surface) => surface.workspaceId)
            .map((surface) => (
              <div
                key={surface.generation}
                className="desktop-retained-surface"
                inert={surface.workspaceId !== route}
                aria-hidden={surface.workspaceId !== route}
                style={{
                  opacity: surface.workspaceId === route ? 1 : 0,
                  pointerEvents: surface.workspaceId === route ? undefined : 'none',
                }}
                data-retained-workspace={surface.workspaceId}
              >
                <DesktopWorkspace
                  workspaceId={surface.workspaceId}
                  active={surface.workspaceId === route}
                  onUnavailable={setUnavailable}
                />
              </div>
            ))}
        </div>
      </main>
      <ContentDialog
        open={unavailable !== null}
        onOpenChange={(open) => {
          if (!open) setUnavailable(null);
        }}
        title={unavailable ?? ''}
        description={m.desktop_shell_unported_description()}
      />
    </div>
  );
}

function DesktopWorkspace({
  workspaceId,
  active,
  onUnavailable,
}: {
  workspaceId: string;
  active: boolean;
  onUnavailable: (title: string) => void;
}) {
  const workspace = selectWorkspaceById(workspaceId).value;
  const normalWidth = selectSidebarWidth().value;
  const storedWidth = selectResizablePanelSize('workspace-left-panel-width').value;
  const width = storedWidth ?? normalWidth;
  const side = selectSidebarSide().value;
  useLayoutEffect(() => {
    store.dispatch(requestResizablePanelSize('workspace-left-panel-width'));
  }, []);
  const collapsed = selectIsCollapsed().value;
  const selected = selectMultiSelectSidebarSelectedTabIds(workspaceId).value;
  const notes = selectDesktopNotes(workspaceId).value;
  const layout = selectDesktopLayout(workspaceId).value;
  const admitted = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const [query, setQuery] = useState('');
  const contextOpen = selected.includes('context');
  const titles = [
    m.workspace_multiSelectSidebar_agentsTab_label(),
    m.workspace_multiSelectSidebar_contextTab_label(),
    m.workspace_multiSelectSidebar_changesTab_label(),
    m.workspace_multiSelectSidebar_filesTab_label(),
    m.workspace_multiSelectSidebar_browserTab_label(),
    m.workspace_multiSelectSidebar_shellTab_label(),
  ];
  const icons = [RobotIcon, TextAlignLeftIcon, CodeIcon, FoldersIcon, GlobeIcon, TerminalIcon];
  function showContext() {
    store.dispatch(setMultiSelectSidebarSelectedTabs(workspaceId, contextOpen ? [] : ['context']));
  }
  function openNote(id: string, adjacent: boolean) {
    if (
      !admitted ||
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) !== admitted
    )
      return;
    const note = selectDesktopNotes.select(store.state, workspaceId).find((item) => item.id === id);
    if (!note) return;
    const tab = {
      type: 'note' as const,
      title: note.title,
      closable: true,
      workspaceId,
      noteId: id,
    };
    store.dispatch(
      adjacent
        ? openTabInAdjacentOrSplit(workspaceId, tab, layout.focusedPanelId ?? undefined)
        : openTab(workspaceId, tab),
    );
  }
  if (!workspace) return null;
  return (
    <div
      className={`desktop-workspace-page sidebar-${side}`}
      aria-label={m.workspace_layout_ariaLabel()}
    >
      {collapsed ? (
        <div className="w-12 shrink-0">
          <WorkspaceSidebarRail onExpand={() => store.dispatch(toggleSidebar())} />
        </div>
      ) : (
        <aside className="desktop-sidebar" style={{ width }}>
          <div className="desktop-sidebar-header">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-xl leading-7 truncate flex-1">{workspace.title}</h1>
              <Button
                variant="ghost"
                size="icon-compact"
                aria-label={m.workspace_progressCard_actions_ariaLabel()}
                onClick={() => onUnavailable(m.workspace_progressCard_actions_ariaLabel())}
              >
                <KebabIcon />
              </Button>
            </div>
            <div className="text-ui text-subtle flex gap-2">
              <span>{workspace.repositoryName}</span>
              <span>{workspace.branch}</span>
            </div>
          </div>
          <div className="desktop-sidebar-fill" />
          {contextOpen ? (
            <section className="desktop-context-card">
              <div className="desktop-context-heading">
                <h2 className="text-ui font-semibold flex-1">{titles[1]}</h2>
                <SidebarExpandableSearch
                  scope="context"
                  query={query}
                  onQueryChange={setQuery}
                  placeholder={m.workspace_multiSelectSidebar_searchContext_placeholder()}
                />
                <SidebarHeaderAction
                  icon="plus"
                  label={m.workspace_addContext_addContext_label()}
                  onClick={() => onUnavailable(m.workspace_addContext_addContext_label())}
                />
                <SidebarHeaderAction
                  icon="close"
                  label={m.ui_tab_close_ariaLabel()}
                  onClick={showContext}
                />
              </div>
              <p className="text-ui text-subtle leading-snug px-4">
                {m.workspace_multiSelectSidebar_contextTab_description()}
              </p>
              <div className="px-2 pt-4">
                <ListContainer>
                  {filterContextNotes(notes, query).map((note) => (
                    <ListItem
                      key={note.id}
                      title={note.title}
                      titleClass="type-body font-normal leading-(--text-body-line-height)"
                      iconSnippet={<ResourceIconTile kind="note" />}
                      active={layout.panels[layout.focusedPanelId ?? '']?.tabs.some(
                        (t) =>
                          t.id === layout.panels[layout.focusedPanelId ?? '']?.activeTabId &&
                          t.noteId === note.id,
                      )}
                      onClick={(event) => openNote(note.id, event.metaKey || event.ctrlKey)}
                    />
                  ))}
                </ListContainer>
              </div>
            </section>
          ) : (
            <div className="desktop-launchers">
              {titles.slice(0, 4).map((title, index) => (
                <Button
                  key={title}
                  className="desktop-launcher"
                  variant="outline"
                  onClick={() => (index === 1 ? showContext() : onUnavailable(title))}
                >
                  <span className="desktop-launcher-icon">
                    {index === 1 ? (
                      <ResourceIconTile kind="note" />
                    ) : (
                      icons[index] &&
                      (() => {
                        const Icon = icons[index]!;
                        return <Icon size={24} />;
                      })()
                    )}
                  </span>
                  <span>{title}</span>
                </Button>
              ))}
            </div>
          )}
          <nav
            className={`desktop-sidebar-dock ${contextOpen ? 'expanded' : ''}`}
            aria-label={m.workspace_layout_ariaLabel()}
          >
            {contextOpen && <span className="desktop-sidebar-dock-indicator" aria-hidden="true" />}
            {titles.map((title, index) => {
              const Icon = icons[index]!;
              return (
                <Button
                  key={title}
                  variant="plain"
                  size="icon-compact"
                  aria-label={index === 1 && contextOpen ? m.ui_tab_close_ariaLabel() : title}
                  aria-pressed={index === 1 && contextOpen}
                  onClick={() => (index === 1 ? showContext() : onUnavailable(title))}
                >
                  <Icon size={16} />
                </Button>
              );
            })}
          </nav>
          <DesktopResizeHandle
            kind="sidebar"
            side={side}
            workspaceId={workspaceId}
            active={active}
          />
        </aside>
      )}
      <DesktopPanels workspaceId={workspaceId} active={active} onUnavailable={onUnavailable} />
    </div>
  );
}
