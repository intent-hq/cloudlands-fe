import { call, delay, put, race, take, takeEvery } from 'typed-redux-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  videoPreviewRequested,
  videoPreviewReleased,
  videoPreviewReady,
  videoPreviewFailed,
} from '../video-preview-slice';

async function readPreview(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    return { error: response.status === 415 ? ('unsupported' as const) : ('network' as const) };
  return { blob: await response.blob() };
}

function* preparePreview(action: ReturnType<typeof videoPreviewRequested>) {
  const [id, workspaceId, source] = action.payload;
  const controller = new AbortController();
  let url: string | undefined;
  const isReleased = (next: { type: string; payload?: unknown }) =>
    Array.isArray(next.payload) &&
    ((next.type === videoPreviewReleased.type && next.payload[0] === id) ||
      (next.type === workspaceUnmounted.type && next.payload[0] === workspaceId));
  try {
    const result = yield* race({
      response: call(readPreview, source, controller.signal),
      released: take(isReleased),
      timeout: delay(45_000),
    });
    if (result.released) return;
    if (!result.response?.blob) {
      yield* put(videoPreviewFailed(id, result.response?.error ?? 'unsupported'));
      return;
    }
    // Binary data lives in the browser's Blob store; Redux holds only a revocable URL.
    url = URL.createObjectURL(result.response.blob);
    yield* put(videoPreviewReady(id, url));
    yield* take(isReleased);
  } catch {
    yield* put(videoPreviewFailed(id, 'network'));
  } finally {
    controller.abort();
    if (url) URL.revokeObjectURL(url);
  }
}

export function* videoPreviewSaga() {
  yield* takeEvery(videoPreviewRequested, preparePreview);
}
