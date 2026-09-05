import type { GenericAction } from '@augmentcode/themis/types';
import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import {
  isWorkspaceCommandPayload,
  type WorkspaceCommandPayload,
} from '$shared/ipc/workspace-command-payloads';
import { createLogger } from '$lib/utils/client-logger';
import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { navigateToNewWorkspace } from '$features/new-workspace/route/new-workspace-navigation';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { browserTabZoomRequested } from '../../browser/browser-slice';
import type { BrowserZoomAction } from '../../browser/browser-types';
import { createNoteRequested } from '../../note-read-tracking/note-read-tracking-slice';
import {
  selectActiveTabInPanel,
  selectFocusedPanelId,
} from '../../panel-layout/panel-layout-selectors';
import {
  closeActiveTab,
  openTabInRightmostColumnRequested,
  reopenClosedTab,
  selectNextTab,
  selectPreviousTab,
} from '../../panel-layout/panel-layout-slice';
import { createTerminalRequested } from '../../terminals/terminals-slice';
import { createAgentRequested } from '../../workspace-agents/workspace-agents-slice';

const logger = createLogger('MenuIpcSaga');
const bufferPolicy = {
  kind: 'lossless' as const,
  rationale: 'Discrete menu commands must retain arrival order and must not be dropped.',
};
let running = false;

function* navigate(path: string | null): SagaGenerator<void> {
  if (typeof path !== 'string' || path.length === 0) return;
  if (path === '/?create=true' || path === '/workspace/new') {
    yield* call(navigateToNewWorkspace);
    return;
  }
  try {
    yield* call(navigateToRoute, path);
  } catch (error) {
    logger.warn('Failed to navigate from menu IPC', { path, error });
  }
}

interface DeepLinkAction {
  type: 'open' | 'create' | 'clone' | 'settings';
  params?: Record<string, string>;
}

function* deepLink(action: DeepLinkAction | null): SagaGenerator<void> {
  if (!action || !['open', 'create', 'clone', 'settings'].includes(action.type)) return;
  const params = action.params ?? {};
  if (action.type === 'open') {
    if (params.id) yield* call(navigateToRoute, `/workspace/${params.id}`);
    return;
  }
  if (action.type === 'settings') {
    yield* call(navigateToRoute, '/settings');
    return;
  }
  yield* call(navigateToNewWorkspace, {
    prefill: {
      ...(params.title ? { title: params.title } : {}),
      ...(params.repo ? { githubUrl: params.repo } : {}),
      ...(params.branch ? { branch: params.branch } : {}),
    },
  });
}

function* putForWorkspace(
  data: WorkspaceCommandPayload | null,
  makeAction: (workspaceId: string) => GenericAction,
): SagaGenerator<void> {
  if (isWorkspaceCommandPayload(data)) yield* put(makeAction(data.workspaceId));
}

function* newAgent(data: WorkspaceCommandPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  const focusInTerminal = yield* call(isFocusInTerminal);
  if (focusInTerminal) {
    yield* call(() => dispatchWindowEvent('workspace:new-terminal', { workspaceId }));
    return;
  }
  yield* put(createAgentRequested(workspaceId));
}

function* newBrowser(data: WorkspaceCommandPayload | null): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  yield* put(
    openTabInRightmostColumnRequested(workspaceId, {
      type: 'browser',
      title: 'Browser',
      browserUrl: 'about:blank',
      closable: true,
    }),
  );
}

function* zoom(
  data: WorkspaceCommandPayload | null,
  action: BrowserZoomAction,
): SagaGenerator<void> {
  if (!isWorkspaceCommandPayload(data)) return;
  const workspaceId = data.workspaceId;
  const panelId = yield* selectFocusedPanelId.effect(workspaceId);
  if (!panelId) return;
  const tab = yield* selectActiveTabInPanel.effect(workspaceId, panelId);
  if (tab?.type === 'browser') yield* put(browserTabZoomRequested(workspaceId, tab.id, action));
}

export function* menuIpcSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
  const options = { bufferPolicy };
  try {
    const tasks: Task[] = [
      yield* takeEveryFromElectronChannel<string | null>('navigate', navigate, options),
      yield* takeEveryFromElectronChannel<DeepLinkAction | null>('deep-link', deepLink, options),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:new-agent',
        newAgent,
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:new-note',
        function* (data) {
          yield* putForWorkspace(data, createNoteRequested);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:new-terminal',
        function* (data) {
          yield* putForWorkspace(data, createTerminalRequested);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:new-browser',
        newBrowser,
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:close-tab',
        function* (data) {
          yield* putForWorkspace(data, closeActiveTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:reopen-closed-tab',
        function* (data) {
          yield* putForWorkspace(data, reopenClosedTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:select-previous-tab',
        function* (data) {
          yield* putForWorkspace(data, selectPreviousTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:select-next-tab',
        function* (data) {
          yield* putForWorkspace(data, selectNextTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:zoom-in',
        function* (data) {
          yield* zoom(data, 'in');
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:zoom-out',
        function* (data) {
          yield* zoom(data, 'out');
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<WorkspaceCommandPayload | null>(
        'menu:reset-zoom',
        function* (data) {
          yield* zoom(data, 'reset');
        },
        options,
      ),
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
