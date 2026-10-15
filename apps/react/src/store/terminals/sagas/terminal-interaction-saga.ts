import { createTerminalInteractionSaga } from '../../../../../../src/store/renderer/slices/terminals/sagas/terminal-interaction-saga-factory';
import {
  getTerminalOperation,
  getTerminalRead,
} from '../../../../../../src/store/renderer/slices/terminals/terminals-projections';
import { store } from '@/store';
import { selectTerminalContext } from '../terminals-selectors';
import { createWorkspaceTerminalClient } from '@/features/terminals/terminal-runtime';
import { m } from '$shared/paraglide/messages.js';

export const terminalInteractionSaga = createTerminalInteractionSaga({
  context: (workspaceId) => selectTerminalContext.select(store.state, workspaceId),
  viewId: (workspaceId) => getTerminalRead(store.state, workspaceId)?.viewId,
  operation: (id) => getTerminalOperation(store.state, id),
  client: createWorkspaceTerminalClient,
  dispatch: (action) => store.dispatch(action),
  error: () => m.workspace_client_accessChanged_error(),
});
