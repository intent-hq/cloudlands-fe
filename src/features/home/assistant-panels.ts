import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { appClient } from '$lib/client';
import { isAuthUrl } from '$shared/utils/link-helpers';
import { parseIntentLink } from '$lib/utils/workspaces-link-handler';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { applyNoteUpdated } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import {
  selectPanelLayoutWorkspace,
  selectHiddenTabs,
} from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import {
  initializeLayout,
  openTab,
  panelLayoutScopeMounted,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { upsertSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-slice';

/** The Assistant owns one content stack, using the normal persisted workspace layout. */
export const ASSISTANT_CONTENT_PANEL_ID = 'assistant-content';
import { assistantPanelLayoutId } from '$shared/assistant-panel-layout';
import {
  selectChiefActiveAgentId,
  selectChiefThreads,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';

export const selectAssistantPanelLayoutId = store.createSelector((state) => {
  const threads = selectChiefThreads.select(state);
  const selectedId = selectChiefActiveAgentId.select(state);
  const thread =
    threads.find((item) => item.agentId === selectedId) ??
    threads.find((item) => item.isActive) ??
    threads.find((item) => item.messageCount > 0) ??
    threads[0];
  return assistantPanelLayoutId(thread?.agentId ?? null);
});

const latestOpenRequests = new Map<string, number>();
interface AssistantContentOptions {
  preserveFocus?: boolean;
  background?: boolean;
  agentId?: string;
  layoutId?: string;
}
function nextOpenRequest(layoutId: string) {
  const request = (latestOpenRequests.get(layoutId) ?? 0) + 1;
  latestOpenRequests.set(layoutId, request);
  return request;
}

async function restoreAssistantLayout(layoutId: string) {
  store.dispatch(panelLayoutScopeMounted(layoutId));
  if (selectPanelLayoutWorkspace.select(store.state, layoutId).restoreStatus !== 'pending') return;
  await new Promise<void>((resolve) => {
    const subscription = selectPanelLayoutWorkspace
      .withStore(store)(layoutId)
      .subscribe((layout) => {
        if (layout.restoreStatus !== 'pending') {
          resolve();
          queueMicrotask(() => subscription());
        }
      });
  });
}

function showContent(
  tab: Omit<PanelTab, 'id'>,
  options: AssistantContentOptions,
  layoutId: string,
) {
  const layout = selectPanelLayoutWorkspace.select(store.state, layoutId);
  if (
    !layout.panels[ASSISTANT_CONTENT_PANEL_ID] ||
    Object.keys(layout.panels).some((id) => id !== ASSISTANT_CONTENT_PANEL_ID)
  ) {
    const contentPanel = layout.panels[ASSISTANT_CONTENT_PANEL_ID];
    const tabs = Object.values(layout.panels).flatMap((panel) =>
      panel.tabs.filter((item) => item.type !== 'agent' || item.workspaceId !== CHIEF_WORKSPACE_ID),
    );
    const activeTabId = tabs.some((item) => item.id === contentPanel?.activeTabId)
      ? (contentPanel?.activeTabId ?? null)
      : (tabs.at(-1)?.id ?? null);
    // Assistant chat is retained outside the content layout. Older saved chat
    // columns would otherwise absorb the content stack during width cleanup.
    store.dispatch(
      initializeLayout(layoutId, {
        root: { type: 'panel', panelId: ASSISTANT_CONTENT_PANEL_ID },
        panels: {
          [ASSISTANT_CONTENT_PANEL_ID]: {
            id: ASSISTANT_CONTENT_PANEL_ID,
            tabs,
            activeTabId,
          },
        },
        focusedPanelId:
          layout.focusedPanelId === ASSISTANT_CONTENT_PANEL_ID ? ASSISTANT_CONTENT_PANEL_ID : null,
        hiddenTabs: selectHiddenTabs.select(store.state, layoutId),
      }),
    );
  }
  store.dispatch(
    openTab(
      layoutId,
      tab,
      ASSISTANT_CONTENT_PANEL_ID,
      undefined,
      true,
      undefined,
      false,
      options.background || options.preserveFocus,
      undefined,
      options.background,
    ),
  );
}

/** Shared by chat links and ws.app.ui.navigate, without replacing the Assistant conversation. */
export async function showAssistantContent(
  url: string,
  options: AssistantContentOptions = {},
): Promise<boolean> {
  try {
    return await openAssistantContent(url, options);
  } catch (error) {
    notify.error(m.ui_linkHandler_notFound_title(), {
      description: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

async function openAssistantContent(
  url: string,
  options: AssistantContentOptions,
): Promise<boolean> {
  const workspaceMatch = /^(?:\/workspace\/|intent:\/\/local\/workspace\/)([^/?#]+)\/?$/.exec(url);
  const agentMatch = /^intent:\/\/local\/([^/?#]+)\/agent\/([^/?#]+)$/.exec(url);
  const info = url.startsWith('intent://') ? parseIntentLink(url) : null;
  const browserLink = /^https?:\/\//.test(url) && !isAuthUrl(url);
  if (
    !workspaceMatch &&
    !agentMatch &&
    !browserLink &&
    !(info?.valid && ['file', 'message', 'note', 'task'].includes(info.type))
  )
    return false;
  if (workspaceMatch && [CHIEF_WORKSPACE_ID, 'new'].includes(workspaceMatch[1])) return false;
  const threads = selectChiefThreads.select(store.state);
  const layoutId = options.agentId
    ? assistantPanelLayoutId(options.agentId)
    : options.background
      ? threads.length === 1
        ? assistantPanelLayoutId(threads[0].agentId)
        : null
      : (options.layoutId ?? selectAssistantPanelLayoutId.select(store.state));
  // Older events have no sender; multiple threads make their destination ambiguous.
  if (!layoutId) return true;
  const request = nextOpenRequest(layoutId);
  await restoreAssistantLayout(layoutId);
  if (request !== latestOpenRequests.get(layoutId)) return true;
  if (workspaceMatch) {
    const workspaceId = workspaceMatch[1];
    const workspace = await appClient.workspaces.get(workspaceId);
    if (request !== latestOpenRequests.get(layoutId)) return true;
    if (!workspace) {
      notify.error(m.workspace_loader_notFound_title());
      return true;
    }
    store.dispatch(setWorkspaceEntity(workspace));
    showContent(
      { type: 'workspace', title: workspace.title, workspaceId, closable: true },
      options,
      layoutId,
    );
    return true;
  }
  if (agentMatch)
    return showAssistantAgent(agentMatch[1], agentMatch[2], options, layoutId, request);
  if (browserLink) {
    const { resolveBrowserLinkForOpen } = await import('$lib/utils/browser-link-open');
    const resolved = await resolveBrowserLinkForOpen(url);
    if (request !== latestOpenRequests.get(layoutId)) return true;
    showContent(
      {
        type: 'browser',
        title: new URL(url).hostname,
        browserUrl: resolved.url,
        browserRequestedUrl: resolved.requestedUrl,
        workspaceId: CHIEF_WORKSPACE_ID,
        closable: true,
      },
      options,
      layoutId,
    );
    return true;
  }
  if (!info?.valid) return false;
  const targetWorkspaceId = info.workspaceId ?? CHIEF_WORKSPACE_ID;
  if (info.type === 'file') {
    const workspace = await appClient.workspaces.get(targetWorkspaceId);
    if (request !== latestOpenRequests.get(layoutId)) return true;
    if (!workspace) {
      notify.error(m.workspace_loader_notFound_title());
      return true;
    }
    store.dispatch(setWorkspaceEntity(workspace));
    showContent(
      {
        type: 'file',
        title: info.resourceId.split('/').at(-1) ?? info.resourceId,
        filePath: info.resourceId,
        workspaceId: targetWorkspaceId,
        closable: true,
        data: { line: info.line, filePathIsLiteral: true },
      },
      options,
      layoutId,
    );
    return true;
  }
  if (info.type === 'message' && info.agentId) {
    return showAssistantAgent(
      targetWorkspaceId,
      info.agentId,
      options,
      layoutId,
      request,
      info.resourceId,
    );
  }
  if (info.type !== 'note' && info.type !== 'task') return false;
  const workspaceId = info.workspaceId ?? CHIEF_WORKSPACE_ID;
  const note = await appClient.notes.get(info.resourceId, workspaceId);
  if (request !== latestOpenRequests.get(layoutId)) return true;
  if (!note || String(note.workspaceId) !== workspaceId) {
    notify.error(m.ui_linkHandler_notFound_title(), {
      description: m.ui_linkHandler_noteNotFound_error({ noteId: info.resourceId, workspaceId }),
    });
    return true;
  }
  store.dispatch(applyNoteUpdated(workspaceId, String(note.id), note));
  const existingViewMode =
    store.state.transientUi.byWorkspaceId[workspaceId]?.noteViewModeByNoteId[String(note.id)];
  if (!options.background || existingViewMode === undefined)
    store.dispatch(setNoteViewMode(workspaceId, String(note.id), 'preview'));
  showContent(
    { type: 'note', title: note.title, noteId: String(note.id), workspaceId, closable: true },
    options,
    layoutId,
  );
  return true;
}

async function showAssistantAgent(
  workspaceId: string,
  agentId: string,
  options: AssistantContentOptions,
  layoutId: string,
  request: number,
  messageId?: string,
): Promise<boolean> {
  const agent = await appClient.agents.get(
    agentId,
    workspaceId === CHIEF_WORKSPACE_ID ? undefined : workspaceId,
  );
  if (workspaceId === CHIEF_WORKSPACE_ID && agent) workspaceId = String(agent.workspaceId);
  const workspace =
    workspaceId === CHIEF_WORKSPACE_ID ? null : await appClient.workspaces.get(workspaceId);
  if (request !== latestOpenRequests.get(layoutId)) return true;
  if (
    (!workspace && workspaceId !== CHIEF_WORKSPACE_ID) ||
    !agent ||
    String(agent.workspaceId) !== workspaceId
  ) {
    notify.error(m.ui_linkHandler_notFound_title());
    return true;
  }
  if (workspace) store.dispatch(setWorkspaceEntity(workspace));
  store.dispatch(upsertSession(agent));
  showContent(
    { type: 'agent', title: agent.name ?? agentId, agentId, workspaceId, closable: true },
    options,
    layoutId,
  );
  if (messageId && !options.background) {
    const { openMessage } = await import('$lib/utils/open-message');
    void openMessage({ workspaceId, agentId, messageId, contentAlreadyOpen: true });
  }
  return true;
}
