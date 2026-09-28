import { call, put, race, take, takeEvery } from 'typed-redux-saga';
import { readPdf, PdfReadError } from '$features/file/services/read-pdf';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  pdfPreviewRequested,
  pdfPreviewReleased,
  pdfPreviewReady,
  pdfPreviewFailed,
} from '../pdf-preview-slice';

function* readPreview(action: ReturnType<typeof pdfPreviewRequested>) {
  const [viewId, requestId, workspaceId, path] = action.payload;
  const abort = new AbortController();
  let url: string | undefined;
  const isReleased = (next: { type: string; payload?: unknown }) =>
    (next.type === pdfPreviewReleased.type &&
      Array.isArray(next.payload) &&
      next.payload[0] === viewId &&
      next.payload[1] === requestId) ||
    (next.type === pdfPreviewRequested.type &&
      Array.isArray(next.payload) &&
      next.payload[0] === viewId) ||
    (next.type === workspaceUnmounted.type &&
      Array.isArray(next.payload) &&
      next.payload[0] === workspaceId);
  try {
    const result = yield* race({
      bytes: call(readPdf, workspaceId, path, abort.signal),
      released: take(isReleased),
    });
    if (!result.bytes) return;
    // Redux holds only the revocable URL/status; binary bytes stay in the browser's Blob store.
    url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/pdf' }));
    yield* put(pdfPreviewReady(viewId, requestId, url));
    yield* take(isReleased);
  } catch (error) {
    yield* put(
      pdfPreviewFailed(viewId, requestId, error instanceof PdfReadError ? error.reason : 'load'),
    );
  } finally {
    abort.abort();
    if (url) URL.revokeObjectURL(url);
  }
}

export function* pdfPreviewSaga() {
  yield* takeEvery(pdfPreviewRequested, readPreview);
}
