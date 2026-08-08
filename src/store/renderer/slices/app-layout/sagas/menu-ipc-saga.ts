import type { GenericAction } from '@augmentcode/themis/types';
import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
import { navigateToRoute } from '$lib/utils/navigation.client';
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
  openTab,
  reopenClosedTab,
  selectNextTab,
  selectPreviousTab,
} from '../../panel-layout/panel-layout-slice';
import { setShowCreateModal } from '../../sidebar-nav/sidebar-nav-slice';
import { createTerminalRequested } from '../../terminals/terminals-slice';
import { createAgentRequested } from '../../workspace-agents/workspace-agents-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';

const logger = createLogger('MenuIpcSaga');
const bufferPolicy = {
  kind: 'lossless' as const,
  rationale: 'Discrete menu commands must retain arrival order and must not be dropped.',
};
let running = false;

function* activeWorkspaceId(): SagaGenerator<string | null> {
  const workspaceId = yield* selectActiveWorkspaceId.effect();
  return typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null;
}

function* navigate(path: string | null): SagaGenerator<void> {
  if (typeof path !== 'string' || path.length === 0) return;
  if (path === '/?create=true' || path === '/workspace/new') {
    yield* put(setShowCreateModal(true));
    return;
  }
  try {
    yield* call(navigateToRoute, path);
  } catch (error) {
    logger.warn('Failed to navigate from menu IPC', { path, error });
  }
}

function* putForActiveWorkspace(
  makeAction: (workspaceId: string) => GenericAction,
): SagaGenerator<void> {
  const workspaceId = yield* activeWorkspaceId();
  if (workspaceId) yield* put(makeAction(workspaceId));
}

function* newAgent(): SagaGenerator<void> {
  const workspaceId = yield* activeWorkspaceId();
  if (!workspaceId) return;
  const focusInTerminal = yield* call(isFocusInTerminal);
  if (focusInTerminal) {
    yield* call(() => dispatchWindowEvent('workspace:new-terminal', { workspaceId }));
    return;
  }
  yield* put(createAgentRequested(workspaceId));
}

function* newBrowser(): SagaGenerator<void> {
  const workspaceId = yield* activeWorkspaceId();
  if (!workspaceId) return;
  yield* put(
    openTab(workspaceId, {
      type: 'browser',
      title: 'Browser',
      browserUrl: 'https://google.com',
      closable: true,
    }),
  );
}

function* zoom(action: BrowserZoomAction): SagaGenerator<void> {
  const workspaceId = yield* activeWorkspaceId();
  if (!workspaceId) return;
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
      yield* takeEveryFromElectronChannel<null>('menu:new-agent', newAgent, options),
      yield* takeEveryFromElectronChannel<null>(
        'menu:new-note',
        function* () {
          yield* putForActiveWorkspace(createNoteRequested);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:new-terminal',
        function* () {
          yield* putForActiveWorkspace(createTerminalRequested);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>('menu:new-browser', newBrowser, options),
      yield* takeEveryFromElectronChannel<null>(
        'menu:close-tab',
        function* () {
          yield* putForActiveWorkspace(closeActiveTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:reopen-closed-tab',
        function* () {
          yield* putForActiveWorkspace(reopenClosedTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:select-previous-tab',
        function* () {
          yield* putForActiveWorkspace(selectPreviousTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:select-next-tab',
        function* () {
          yield* putForActiveWorkspace(selectNextTab);
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:zoom-in',
        function* () {
          yield* zoom('in');
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:zoom-out',
        function* () {
          yield* zoom('out');
        },
        options,
      ),
      yield* takeEveryFromElectronChannel<null>(
        'menu:reset-zoom',
        function* () {
          yield* zoom('reset');
        },
        options,
      ),
    ];
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
