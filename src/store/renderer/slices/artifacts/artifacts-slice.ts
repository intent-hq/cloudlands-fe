import type { LoadedArtifact } from '$features/artifacts/service';
import type {
  ArtifactDocument,
  ArtifactSelection,
  ArtifactSelectionSnapshot,
} from '$shared/types/visual-artifact';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  ArtifactImageState,
  ArtifactsState,
  ArtifactsWorkspaceState,
  ArtifactChatItem,
} from './artifacts-types';

export const emptyArtifactsWorkspaceState: ArtifactsWorkspaceState = { pending: {}, images: {} };
export const initialState: ArtifactsState = { byWorkspaceId: {} };
const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptyArtifactsWorkspaceState,
);
export const artifactSelectionQueued = createAction<
  [workspaceId: string, targetAgentId: string, items: ArtifactChatItem[]]
>('artifacts/selectionQueued');
export const artifactSelectionConsumed = createAction<
  [workspaceId: string, targetAgentId: string, itemId: string]
>('artifacts/selectionConsumed');
export const artifactsReducer = createReducer<ArtifactsState>(initialState);
artifactsReducer.with(
  artifactSelectionQueued,
  (state, { payload: [workspaceId, targetAgentId, items] }) => {
    if (!workspaceId || !targetAgentId || !items.length) return state;
    const ws = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...ws,
      pending: {
        ...ws.pending,
        [items[0].id]: {
          targetAgentId,
          items: items.map((item) => ({
            ...item,
            metadata: item.metadata ? JSON.parse(JSON.stringify(item.metadata)) : undefined,
          })),
        },
      },
    });
  },
);
artifactsReducer.with(
  artifactSelectionConsumed,
  (state, { payload: [workspaceId, targetAgentId, itemId] }) => {
    const ws = getWorkspaceState(state, workspaceId);
    if (ws.pending[itemId]?.targetAgentId !== targetAgentId) return state;
    const pending = { ...ws.pending };
    delete pending[itemId];
    return setWorkspaceState(state, workspaceId, { ...ws, pending });
  },
);
artifactsReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);

export const artifactImagesRequested = createAction<[workspaceId: string, sources: string[]]>(
  'artifacts/imagesRequested',
);
export const artifactImageResolved =
  createAction<[workspaceId: string, source: string, image: ArtifactImageState]>(
    'artifacts/imageResolved',
  );
artifactsReducer.with(artifactImagesRequested, (state, { payload: [workspaceId] }) => {
  if (!workspaceId || state.byWorkspaceId[workspaceId]) return state;
  return setWorkspaceState(state, workspaceId, getWorkspaceState(state, workspaceId));
});
artifactsReducer.with(artifactImageResolved, (state, { payload: [workspaceId, source, image] }) => {
  const ws = state.byWorkspaceId[workspaceId];
  if (!ws) return state;
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    images: { ...ws.images, [source]: image },
  });
});

export const artifactLoadRequested = createAsyncAction<
  [workspaceId: string, noteId: string, artifactId: string],
  LoadedArtifact
>('artifacts/load', 'artifacts/loadRequested');
export const artifactSaveRequested = createAsyncAction<
  [workspaceId: string, noteId: string, loaded: LoadedArtifact, document: ArtifactDocument],
  LoadedArtifact
>('artifacts/save', 'artifacts/saveRequested');
export const artifactCreateRequested = createAsyncAction<
  [workspaceId: string, document: ArtifactDocument],
  { noteId: string; artifactId: string }
>('artifacts/create', 'artifacts/createRequested');
export const artifactCaptureRequested = createAsyncAction<
  [
    workspaceId: string,
    targetAgentId: string,
    document: ArtifactDocument,
    selection: ArtifactSelection,
    source: ArtifactSelectionSnapshot['source'],
    comment: string,
  ],
  void
>('artifacts/capture', 'artifacts/captureRequested');
