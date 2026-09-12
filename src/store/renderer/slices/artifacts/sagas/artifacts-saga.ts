import type { ArtifactChatItem } from '../artifacts-types';
import {
  loadArtifact,
  saveArtifact,
  createArtifact,
  artifactSelectionToContextItem,
} from '$features/artifacts/service';
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { readArtifactImage, artifactImageContextItems } from '$features/artifacts/image-context';
import {
  artifactImagesRequested,
  artifactImageResolved,
  artifactLoadRequested,
  artifactSaveRequested,
  artifactCreateRequested,
  artifactCaptureRequested,
  artifactSelectionQueued,
} from '../artifacts-slice';
import { selectArtifactImages } from '../artifacts-selectors';

const inFlight = new Map<string, Promise<string>>();
function readImage(workspaceId: string, source: string): Promise<string> {
  const key = JSON.stringify([workspaceId, source]);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const next = readArtifactImage(workspaceId, source)
    .then((image) => `data:${image.mimeType};base64,${image.data}`)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, next);
  return next;
}

export function* loadArtifactImages(
  action: ReturnType<typeof artifactImagesRequested>,
): SagaGenerator<void> {
  const [workspaceId, sources] = action.payload;
  if (!workspaceId) return;
  for (const source of new Set(sources)) {
    const cached = yield* selectArtifactImages.effect(workspaceId);
    if (cached[source]?.dataUrl) continue;
    try {
      const dataUrl = yield* call(readImage, workspaceId, source);
      yield* put(artifactImageResolved(workspaceId, source, { dataUrl, failed: false }));
    } catch {
      yield* put(artifactImageResolved(workspaceId, source, { failed: true }));
    }
  }
}

function* loadArtifactWorker(
  action: ReturnType<typeof artifactLoadRequested>,
): SagaGenerator<void> {
  try {
    yield* put(action.success(yield* call(loadArtifact, ...action.payload)));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}
function* saveArtifactWorker(
  action: ReturnType<typeof artifactSaveRequested>,
): SagaGenerator<void> {
  try {
    yield* put(action.success(yield* call(saveArtifact, ...action.payload)));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}
function* createArtifactWorker(
  action: ReturnType<typeof artifactCreateRequested>,
): SagaGenerator<void> {
  try {
    yield* put(action.success(yield* call(createArtifact, ...action.payload)));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}
function* captureArtifactWorker(
  action: ReturnType<typeof artifactCaptureRequested>,
): SagaGenerator<void> {
  try {
    const [workspaceId, target, document, selection, source, comment] = action.payload;
    const item = artifactSelectionToContextItem(document, selection, source, comment);
    const images = yield* call(artifactImageContextItems, workspaceId, item);
    yield* put(
      artifactSelectionQueued(
        workspaceId,
        target,
        [item, ...images].map((context) => ({
          id: context.id,
          type: context.type === 'file' ? 'file' : 'selection',
          label: context.label,
          description: context.description,
          content: context.content,
          metadata: context === item ? (item.metadata as ArtifactChatItem['metadata']) : undefined,
          imageData: context.imageData,
          imageMimeType: context.imageMimeType,
        })),
      ),
    );
    yield* put(action.success());
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* artifactsSaga(): SagaGenerator<void> {
  yield* takeEvery(artifactImagesRequested, loadArtifactImages);
  yield* takeEvery(artifactLoadRequested, loadArtifactWorker);
  yield* takeEvery(artifactSaveRequested, saveArtifactWorker);
  yield* takeEvery(artifactCreateRequested, createArtifactWorker);
  yield* takeEvery(artifactCaptureRequested, captureArtifactWorker);
}
