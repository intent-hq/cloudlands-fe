import { tick } from 'svelte';
import { dismissibleWorkspaceReasons } from '$shared/utils/workspace-attention-reminder';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import { requestDismissWorkspaceAttention } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import { store } from '$store/renderer/store';
import type { Workspace, AttentionReminderReason } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import {
  getSidebarContextPosition,
  type SidebarContextPosition,
  type SidebarMenuEntry,
} from '$lib/components/ui/sidebar-context-menu/types';
import { faBellSlash } from '@fortawesome/free-solid-svg-icons';
import { createHomeWorkspaceMenu } from './home-workspace-menu';

interface HomeWorkspaceActionsOptions {
  root: () => HTMLElement | null;
  selectedId: () => string | null;
  pinnedIds: () => readonly string[];
  expandPinned: () => void;
  consumerId: string;
  dismissalRequestId: () => string | undefined;
  onOpen: (id: string) => void;
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
    const items = createHomeWorkspaceMenu(workspace, {
      pinned,
      onOpen: options.onOpen,
      onClose: () => (contextMenu = null),
      expandPinned: options.expandPinned,
      getHomeElement: options.root,
    });
    if (snapshot.reasons.length && snapshot.principalContext)
      items.splice(2, 0, {
        id: 'dismiss-attention',
        label: m.workspace_card_dismissForNow_label(),
        icon: faBellSlash,
        onClick: () => dismissReminder(workspace, snapshot),
      });
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
