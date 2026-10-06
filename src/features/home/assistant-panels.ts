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
import { initializeLayout, openTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

/** The Assistant owns one content stack, using the normal persisted workspace layout. */
export const ASSISTANT_CONTENT_PANEL_ID = 'assistant-content';
let latestOpenRequest = 0;

function showContent(tab: Omit<PanelTab, 'id'>, preserveFocus: boolean) {
  const layout = selectPanelLayoutWorkspace.select(store.state, CHIEF_WORKSPACE_ID);
  if (!layout.panels[ASSISTANT_CONTENT_PANEL_ID]) {
    const contentRoot = { type: 'panel' as const, panelId: ASSISTANT_CONTENT_PANEL_ID };
    store.dispatch(
      initializeLayout(CHIEF_WORKSPACE_ID, {
        root: Object.keys(layout.panels).length
          ? {
              type: 'split',
              direction: 'horizontal',
              children: [layout.root, contentRoot],
              sizes: [50, 50],
            }
          : contentRoot,
        panels: {
          ...layout.panels,
          [ASSISTANT_CONTENT_PANEL_ID]: {
            id: ASSISTANT_CONTENT_PANEL_ID,
            tabs: [],
            activeTabId: null,
          },
        },
        focusedPanelId: layout.focusedPanelId,
        hiddenTabs: selectHiddenTabs.select(store.state, CHIEF_WORKSPACE_ID),
      }),
    );
  }
  store.dispatch(
    openTab(
      CHIEF_WORKSPACE_ID,
      tab,
      ASSISTANT_CONTENT_PANEL_ID,
      undefined,
      true,
      undefined,
      false,
      preserveFocus,
    ),
  );
}

/** Shared by chat links and ws.app.ui.navigate, without replacing the Assistant conversation. */
export async function showAssistantContent(url: string, preserveFocus = false): Promise<boolean> {
  if (/^https?:\/\//.test(url)) {
    if (isAuthUrl(url)) return false;
    const request = ++latestOpenRequest;
    const { resolveBrowserLinkForOpen } = await import('$lib/utils/browser-link-open');
    const resolved = await resolveBrowserLinkForOpen(url);
    if (request !== latestOpenRequest) return true;
    showContent(
      {
        type: 'browser',
        title: new URL(url).hostname,
        browserUrl: resolved.url,
        browserRequestedUrl: resolved.requestedUrl,
        workspaceId: CHIEF_WORKSPACE_ID,
        closable: true,
      },
      preserveFocus,
    );
    return true;
  }
  if (!url.startsWith('intent://')) return false;
  const info = parseIntentLink(url);
  if (!info.valid || (info.type !== 'note' && info.type !== 'task')) return false;
  const request = ++latestOpenRequest;
  const workspaceId = info.workspaceId ?? CHIEF_WORKSPACE_ID;
  const note = await appClient.notes.get(info.resourceId, workspaceId);
  if (request !== latestOpenRequest) return true;
  if (!note || String(note.workspaceId) !== workspaceId) {
    notify.error(m.ui_linkHandler_notFound_title(), {
      description: m.ui_linkHandler_noteNotFound_error({ noteId: info.resourceId, workspaceId }),
    });
    return true;
  }
  store.dispatch(applyNoteUpdated(workspaceId, String(note.id), note));
  showContent(
    { type: 'note', title: note.title, noteId: String(note.id), workspaceId, closable: true },
    preserveFocus,
  );
  return true;
}
