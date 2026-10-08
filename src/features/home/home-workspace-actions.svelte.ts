import { goto } from '$app/navigation';
import { tick } from 'svelte';
import { dismissibleWorkspaceReasons } from '$shared/utils/workspace-attention-reminder';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import { togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  requestDismissWorkspaceAttention,
  requestArchiveWorkspace,
  requestUnarchiveWorkspace,
  requestDeleteWorkspace,
} from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { store } from '$store/renderer/store';
import { WorkspaceStatusEnum, type Workspace, type AttentionReminderReason } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import {
  getSidebarContextPosition,
  type SidebarContextPosition,
  type SidebarMenuEntry,
} from '$lib/components/ui/sidebar-context-menu/types';
import {
  faBellSlash,
  faThumbtack,
  faBoxArchive,
  faBoxOpen,
  faTrash,
  faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';

interface HomeWorkspaceActionsOptions {
  root: () => HTMLElement | null;
  selectedId: () => string | null;
  pinnedIds: () => readonly string[];
  expandPinned: () => void;
  consumerId: string;
  dismissalRequestId: () => string | undefined;
}

/** UI-local menus and focus; mutations and their outcomes remain Redux-owned. */
export function createHomeWorkspaceActions(options: HomeWorkspaceActionsOptions) {
  type ReminderMenuSnapshot = {
    reasons: AttentionReminderReason[];
    principalContext: string | null;
  };
  function captureReminderMenu(workspace: Workspace): ReminderMenuSnapshot {
    return {
      reasons: dismissibleWorkspaceReasons(workspace),
      principalContext: selectPrincipalActionContext.select(store.state),
    };
  }
  const overflowSnapshots = $state<Record<string, ReminderMenuSnapshot>>({});
  let contextMenu = $state<
    (SidebarContextPosition & { workspace: Workspace; reminder: ReminderMenuSnapshot }) | null
  >(null);
  const dismissalUid = options.consumerId;
  let dismissalSequence = 0;
  let pendingDismissal = $state<{
    workspaceId: string;
    requestId: string;
    sourceRow: HTMLElement | null;
    sourceMenu: HTMLElement | null;
  } | null>(null);
  let retainedDismissedSelection = $state<string | null>(null);
  function dismissReminder(workspace: Workspace, snapshot: ReminderMenuSnapshot) {
    if (!snapshot.principalContext) return;
    contextMenu = null;
    const requestId = `${dismissalUid}:${++dismissalSequence}`;
    const source = options
      .root()
      ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspace.id)}"]`);
    pendingDismissal = {
      workspaceId: workspace.id,
      requestId,
      sourceRow: source?.closest<HTMLElement>('[role="option"]') ?? source ?? null,
      sourceMenu: document.activeElement?.closest<HTMLElement>('[role="menu"]') ?? null,
    };
    if (options.selectedId() === workspace.id) retainedDismissedSelection = workspace.id;
    store.dispatch(
      requestDismissWorkspaceAttention(
        workspace.id,
        snapshot.reasons,
        snapshot.principalContext,
        requestId,
      ),
    );
  }
  $effect(() => {
    const pending = pendingDismissal;
    if (!pending || options.dismissalRequestId() !== pending.requestId) return;
    pendingDismissal = null;
    void tick().then(() => {
      const row = options
        .root()
        ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(pending.workspaceId)}"]`);
      const target = row?.closest<HTMLElement>('[role="option"]') ?? row;
      const active = document.activeElement;
      const ownsFocus =
        active &&
        (pending.sourceRow?.contains(active) ||
          target?.contains(active) ||
          pending.sourceMenu?.contains(active));
      const removedRowLostFocus =
        active === document.body && pending.sourceRow && !pending.sourceRow.isConnected;
      if (!ownsFocus && !removedRowLostFocus) return;
      const fallback = Array.from(
        options
          .root()
          ?.querySelectorAll<HTMLElement>(
            '[data-home-status-filters] button[aria-pressed="true"], [data-home-status-filter] [role="combobox"]',
          ) ?? [],
      ).find((element) => element.getClientRects().length > 0);
      (target ?? fallback)?.focus();
    });
  });
  function showWorkspaceMenu(event: MouseEvent | KeyboardEvent, workspace: Workspace) {
    const position = getSidebarContextPosition(event);
    if (!position) return;
    contextMenu = {
      ...position,
      returnFocus: position.returnFocus?.closest(
        '[role="option"], [data-home-workspace]',
      ) as HTMLElement | null,
      workspace,
      reminder: captureReminderMenu(workspace),
    };
  }
  function workspaceMenu(
    workspace: Workspace,
    snapshot = captureReminderMenu(workspace),
  ): SidebarMenuEntry[] {
    const pinned = options.pinnedIds().includes(workspace.id);
    const items: SidebarMenuEntry[] = [
      {
        id: 'open',
        label: m.home_open_workspace(),
        icon: faArrowUpRightFromSquare,
        onClick: () => {
          contextMenu = null;
          store.dispatch(openWorkspaceTab(workspace.id));
          void goto(`/workspace/${encodeURIComponent(workspace.id)}`);
        },
      },
      {
        id: 'pin',
        label: pinned ? m.workspace_card_unpin_ariaLabel() : m.workspace_card_pin_ariaLabel(),
        icon: faThumbtack,
        onClick: () => {
          contextMenu = null;
          store.dispatch(togglePinWorkspace(workspace.id));
          if (!pinned) options.expandPinned();
          void tick().then(() =>
            options
              .root()
              ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(workspace.id)}"]`)
              ?.closest<HTMLElement>('[role="option"], button')
              ?.focus(),
          );
        },
      },
    ];
    if (snapshot.reasons.length && snapshot.principalContext)
      items.push({
        id: 'dismiss-attention',
        label: m.workspace_card_dismissForNow_label(),
        icon: faBellSlash,
        onClick: () => dismissReminder(workspace, snapshot),
      });
    if (!selectHidesOwnerWorkspaceActions.select(store.state, workspace.id)) {
      const archived = workspace.status === WorkspaceStatusEnum.Archived;
      items.push(
        { type: 'separator' },
        {
          id: 'archive',
          label: archived
            ? m.ui_workspaceActions_unarchiveSpace_label()
            : m.workspace_card_archive_label(),
          icon: archived ? faBoxOpen : faBoxArchive,
          onClick: () => {
            contextMenu = null;
            store.dispatch(
              archived
                ? requestUnarchiveWorkspace(workspace.id)
                : requestArchiveWorkspace(workspace.id),
            );
          },
        },
        {
          id: 'delete',
          label: m.workspace_card_deleteSpace_label(),
          icon: faTrash,
          destructive: true,
          onClick: () => {
            contextMenu = null;
            store.dispatch(requestDeleteWorkspace(workspace.id));
          },
        },
      );
    }
    return items;
  }
  return {
    get contextMenu() {
      return contextMenu;
    },
    set contextMenu(value) {
      contextMenu = value;
    },
    get retainedSelection() {
      return retainedDismissedSelection;
    },
    clearRetainedSelection() {
      retainedDismissedSelection = null;
    },
    showMenu: showWorkspaceMenu,
    menu: workspaceMenu,
    overflowMenu(workspace: Workspace) {
      return workspaceMenu(workspace, overflowSnapshots[workspace.id]);
    },
    setOverflowOpen(workspace: Workspace, open: boolean) {
      if (open) overflowSnapshots[workspace.id] = captureReminderMenu(workspace);
      else delete overflowSnapshots[workspace.id];
    },
  };
}
