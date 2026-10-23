import { call, delay, put, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import type { FilesClient } from '$lib/client/app-client';
import { editableText } from '$features/file/utils/file-content';
import {
  emptyInlineVisualRecord,
  INLINE_VISUAL_MAX_BYTES,
  INLINE_VISUAL_MAX_SCENARIOS,
  isInlineVisualRecord,
  type InlineVisualRecord,
} from '$features/inline-html/inline-visual-types';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import {
  inlineVisualOpened,
  inlineVisualRetryRequested,
  inlineVisualLoadSettled,
  inlineVisualChanged,
  inlineVisualSaveSettled,
  inlineVisualExportRequested,
  inlineVisualExportSettled,
} from '../inline-visuals-slice';
import { inlineVisualKey } from '../inline-visuals-types';
import { selectInlineVisual } from '../inline-visuals-selectors';

export const INLINE_VISUAL_SAVE_DELAY_MS = 300;
export const INLINE_VISUAL_RECORD_MAX_BYTES =
  INLINE_VISUAL_MAX_BYTES * (INLINE_VISUAL_MAX_SCENARIOS + 1) + 8192;

type Operation = ReturnType<
  | typeof inlineVisualOpened
  | typeof inlineVisualRetryRequested
  | typeof inlineVisualChanged
  | typeof inlineVisualExportRequested
>;
const isOpen = (action: Operation): action is ReturnType<typeof inlineVisualOpened> =>
  action.type === inlineVisualOpened.type;
const isExport = (action: Operation): action is ReturnType<typeof inlineVisualExportRequested> =>
  action.type === inlineVisualExportRequested.type;
const keyFor = (action: Operation): string =>
  isOpen(action) ? inlineVisualKey(action.payload[0]) : action.payload[0];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One queue per host-derived identity. Accepted writes outlive transcript unmount. */
export function* inlineVisualsSaga(
  files: Pick<FilesClient, 'read' | 'write'> = appClient.files,
): SagaGenerator<void> {
  const savedContent: Record<string, string> = {};
  const attemptedRevision: Record<string, number> = {};

  function* operate(action: Operation): SagaGenerator<void> {
    const key = keyFor(action);
    let entry = yield* selectInlineVisual.effect(key);
    if (!entry) return;
    const exporting = isExport(action);
    let revision = entry.revision;
    const retrying = action.type === inlineVisualRetryRequested.type;
    try {
      if (entry.loaded && !exporting) {
        if (
          isOpen(action) ||
          entry.savedRevision === revision ||
          (!retrying && attemptedRevision[key] === revision)
        )
          return;
        // Root-owned delay survives preview unmount. Reselect after the wait so
        // a frame publishing every animation frame causes at most one write per window.
        yield* delay(INLINE_VISUAL_SAVE_DELAY_MS);
        const latest = yield* selectInlineVisual.effect(key);
        if (!latest?.loaded) return;
        entry = latest;
        revision = latest.revision;
        if (entry.savedRevision === revision || (!retrying && attemptedRevision[key] === revision))
          return;
        attemptedRevision[key] = revision;
      }
      const hash = yield* call(async () => {
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
        return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        );
      });
      const path = `.intent/visuals/${hash}/state.json`;
      if (!entry.loaded) {
        if (exporting) throw new Error('Load the saved visual state before exporting.');
        if (action.type === inlineVisualChanged.type || entry.status !== 'loading') return;
        const file = yield* call([files, files.read], entry.identity.workspaceId, path);
        let record = emptyInlineVisualRecord();
        if (file !== null) {
          if (file.error || file.kind !== 'editable-text' || file.truncated)
            throw new Error(file.error || 'Saved visual state is not readable JSON.');
          const raw = file.originalContent;
          if (new TextEncoder().encode(raw).length > INLINE_VISUAL_RECORD_MAX_BYTES)
            throw new Error('Saved visual state is too large.');
          const parsed: unknown = JSON.parse(raw);
          if (!isInlineVisualRecord(parsed)) throw new Error('Saved visual state is invalid.');
          record = parsed;
        }
        savedContent[key] = JSON.stringify(record);
        yield* put(inlineVisualLoadSettled(key, record));
        return;
      }
      if (exporting) {
        const record: InlineVisualRecord = action.payload[2];
        if (!isInlineVisualRecord(record)) throw new Error('Visual state is invalid.');
        if (
          new TextEncoder().encode(JSON.stringify(record)).length > INLINE_VISUAL_RECORD_MAX_BYTES
        )
          throw new Error('Visual state is too large.');
        const exportPath = `.intent/artifacts/visuals/${hash}.json`;
        const content = JSON.stringify(
          { version: 1, source: entry.identity.source, record },
          null,
          2,
        );
        const result = yield* call(
          [files, files.write],
          entry.identity.workspaceId,
          exportPath,
          editableText(content),
        );
        if (!result.success) throw new Error(result.error || 'Could not export visual state.');
        yield* put(inlineVisualExportSettled(key, action.payload[1], exportPath));
        return;
      }
      // Duplicate opens must not write. Coalesce queued changes to the latest revision.
      if (action.type === inlineVisualOpened.type || entry.savedRevision === revision) return;
      if (!isInlineVisualRecord(entry.record)) throw new Error('Visual state is invalid.');
      const content = JSON.stringify(entry.record);
      if (savedContent[key] === content) {
        yield* put(inlineVisualSaveSettled(key, revision));
        return;
      }
      if (new TextEncoder().encode(content).length > INLINE_VISUAL_RECORD_MAX_BYTES)
        throw new Error('Visual state is too large.');
      const result = yield* call(
        [files, files.write],
        entry.identity.workspaceId,
        path,
        editableText(content),
      );
      if (!result.success) throw new Error(result.error || 'Could not save visual state.');
      savedContent[key] = content;
      yield* put(inlineVisualSaveSettled(key, revision));
    } catch (error) {
      if (exporting)
        yield* put(inlineVisualExportSettled(key, action.payload[1], undefined, message(error)));
      else if (!entry.loaded) yield* put(inlineVisualLoadSettled(key, null, message(error)));
      else yield* put(inlineVisualSaveSettled(key, revision, message(error)));
    }
  }

  yield* takeEveryByContextFIFO(
    [
      inlineVisualOpened,
      inlineVisualRetryRequested,
      inlineVisualChanged,
      inlineVisualExportRequested,
    ],
    keyFor,
    operate,
    {},
  );
}
