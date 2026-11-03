import { call, put, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { groupBrowserTabsByOwner } from '$lib/components/workspace/sidebar-browser-groups';
import { getRunningScriptBrowserTarget } from '$features/scripts/utils/running-script-browser-target';
import { createLogger } from '$lib/utils/client-logger';
import { resolveBrowserLinkForOpen } from '$lib/utils/browser-link-open';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { m } from '$shared/paraglide/messages.js';
import type { FileNode } from '$shared/types';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { focusBrowserTabRequested, openAgentTabRequested } from '../../app-layout/app-layout-slice';
import { selectEffectiveFileExplorerWorkspacePath } from '../../file-explorer/file-explorer-selectors';
import { markNoteRead } from '../../note-read-tracking/note-read-tracking-slice';
import {
  selectFocusedPanelId,
  selectHiddenTabs,
  selectPanels,
} from '../../panel-layout/panel-layout-selectors';
import { openTab, openTabInRightmostColumnRequested } from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectWorkspaceScriptEntries } from '../../scripts/scripts-selectors';
import {
  openFirstPanelTerminalRequested,
  setTerminalPlacement,
} from '../../terminals/terminals-slice';
import {
  resolveExistingWorkspaceDefaultAgent,
  selectAllWorkspaceAgents,
} from '../../workspace-agents/workspace-agents-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectSpec } from '../../workspace-notes/workspace-notes-selectors';
import {
  selectIsPlainFolderWorkspace,
  selectIsWorkspaceCollaborator,
  selectWorkspaceParticipationContext,
  selectWorkspaceSavedScriptContext,
} from '../../workspace/workspace-selectors';
import {
  activateSidebarSectionRequested,
  cancelSidebarSectionNavigation,
} from '../sidebar-nav-slice';

const logger = createLogger('SidebarSectionNavigation');

function* defaultFile(workspaceId: string, context: string): SagaGenerator<string | undefined> {
  const directories = ['.'];
  for (let directory = directories.shift(); directory; directory = directories.shift()) {
    if (context !== (yield* selectWorkspaceParticipationContext.effect(workspaceId))) return;
    const entries: FileNode[] = yield* call(
      [appClient.files, appClient.files.listDirectory],
      workspaceId,
      directory,
    );
    const files = entries.filter((entry) => entry.type === 'file');
    const file =
      (directory === '.' ? files.find((entry) => /^readme(?:\..+)?$/i.test(entry.name)) : null) ??
      files[0];
    const relativePath = (name: string) => (directory === '.' ? name : `${directory}/${name}`);
    if (file) return relativePath(file.name);
    directories.push(
      ...entries
        .filter((entry) => entry.type === 'directory')
        .map((entry) => relativePath(entry.name)),
    );
  }
}

function* openContent(layoutId: string, tab: Omit<PanelTab, 'id'>): SagaGenerator<void> {
  const panelId = yield* selectFocusedPanelId.effect(layoutId);
  yield* put(
    panelId
      ? openTab(layoutId, tab, panelId, undefined, true)
      : openTabInRightmostColumnRequested(layoutId, tab, { force: true }),
  );
}

type NavigationAction =
  | ReturnType<typeof activateSidebarSectionRequested>
  | ReturnType<typeof cancelSidebarSectionNavigation>
  | ReturnType<typeof workspaceUnmounted>;

function* activate(action: NavigationAction): SagaGenerator<void> {
  if (action.type !== activateSidebarSectionRequested.type) return;
  const [workspaceId, sectionId, layoutId = workspaceId] = action.payload;
  const context = yield* selectWorkspaceParticipationContext.effect(workspaceId);
  if (!context) return;
  if (sectionId === 'changes' && (yield* selectIsPlainFolderWorkspace.effect(workspaceId))) return;
  const collaborator = yield* selectIsWorkspaceCollaborator.effect(workspaceId);
  if (collaborator && sectionId === 'browser') return;
  if (
    collaborator &&
    sectionId === 'shell' &&
    !(yield* selectWorkspaceSavedScriptContext.effect(workspaceId))
  )
    return;

  try {
    switch (sectionId) {
      case 'agents': {
        const agents = yield* selectAllWorkspaceAgents.effect(workspaceId);
        const main = resolveExistingWorkspaceDefaultAgent(agents, workspaceId);
        if (main)
          yield* put(
            openAgentTabRequested(workspaceId, {
              agentId: main.id,
              panelLayoutId: layoutId,
              sourcePanelId: (yield* selectFocusedPanelId.effect(layoutId)) ?? undefined,
            }),
          );
        break;
      }
      case 'context': {
        const spec = yield* selectSpec.effect(workspaceId);
        yield* openContent(layoutId, {
          type: 'note',
          noteId: SPEC_NOTE_ID,
          title: spec?.title ?? SPEC_NOTE_ID,
          workspaceId,
          closable: true,
        });
        yield* put(markNoteRead(workspaceId, SPEC_NOTE_ID));
        break;
      }
      case 'changes':
        yield* openContent(layoutId, {
          type: 'local-changes',
          title: m.layout_presetExecutor_allChanges_title(),
          workspaceId,
          closable: true,
        });
        break;
      case 'files': {
        const path = yield* defaultFile(workspaceId, context);
        if (path && context === (yield* selectWorkspaceParticipationContext.effect(workspaceId))) {
          // Absolute when the workspace path is known, so the file tree can select and reveal it.
          const root = (yield* selectEffectiveFileExplorerWorkspacePath.effect(
            workspaceId,
          )).replace(/\/+$/, '');
          yield* openContent(layoutId, {
            type: 'file',
            filePath: root ? `${root}/${path}` : path,
            title: path.slice(path.lastIndexOf('/') + 1),
            workspaceId,
            closable: true,
          });
        }
        break;
      }
      case 'browser': {
        const panels = yield* selectPanels.effect(layoutId);
        const hidden = yield* selectHiddenTabs.effect(layoutId);
        const agents = yield* selectAllWorkspaceAgents.effect(workspaceId);
        const visible = Object.values(panels).flatMap((panel) =>
          panel.tabs
            .filter((tab) => tab.type === 'browser')
            .map((tab) => ({ tab, panelId: panel.id, active: panel.activeTabId === tab.id })),
        );
        const first = groupBrowserTabsByOwner(visible, hidden, agents)[0]?.entries[0];
        if (first) {
          yield* put(focusBrowserTabRequested(layoutId, first.tab.id));
        } else {
          const target = getRunningScriptBrowserTarget(
            yield* selectWorkspaceScriptEntries.effect(workspaceId),
          );
          if (target) {
            const resolved = yield* call(resolveBrowserLinkForOpen, target.url);
            if (context !== (yield* selectWorkspaceParticipationContext.effect(workspaceId))) break;
            yield* openContent(layoutId, {
              type: 'browser',
              browserUrl: resolved.url,
              browserRequestedUrl: resolved.requestedUrl,
              title: target.name,
              workspaceId,
              closable: true,
            });
          }
        }
        break;
      }
      case 'shell': {
        if (collaborator) {
          const script = (yield* selectWorkspaceScriptEntries.effect(workspaceId))[0];
          if (script) {
            yield* openContent(layoutId, {
              type: 'terminal',
              scriptId: script.id,
              title: script.name,
              workspaceId,
              closable: true,
            });
            yield* put(setTerminalPlacement(workspaceId, script.id, 'panel'));
          }
        } else {
          yield* put(
            openFirstPanelTerminalRequested(
              workspaceId,
              (yield* selectFocusedPanelId.effect(layoutId)) ?? undefined,
            ),
          );
        }
        break;
      }
    }
  } catch (error) {
    logger.error('Failed to open sidebar section', error);
  }
}

export function* sidebarSectionNavigationSaga(): SagaGenerator<void> {
  yield* takeLatestInContext(
    [activateSidebarSectionRequested, cancelSidebarSectionNavigation, workspaceUnmounted],
    (action: NavigationAction) => action.payload[0],
    activate,
  );
}
