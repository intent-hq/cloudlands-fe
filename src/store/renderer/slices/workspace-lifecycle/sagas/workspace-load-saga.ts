import { workspaceClient } from '../../workspace/utils/workspace.client';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { appClient } from '$lib/client';
import {
  selectIsWorkspaceSessionLive,
  selectWorkspaceLoadState,
} from '../workspace-lifecycle-selectors';
import { createWorkspaceLoadSaga } from './workspace-load-saga-factory';

// Compatibility binding for the existing root saga until the Svelte renderer is retired.
export const workspaceLoadSaga = createWorkspaceLoadSaga({
  admission: { kind: 'source' },
  workspaceClient,
  appClient,
  selectWorkspaceById,
  selectIsWorkspaceSessionLive,
  selectWorkspaceLoadState,
});
