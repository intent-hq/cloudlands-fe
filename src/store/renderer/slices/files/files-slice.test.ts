import { describe, expect, it } from 'vitest';
import { fileSnapshot } from '$features/file/utils/file-content';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  emptyFilesWorkspaceState,
  fileSaveOperationQueued,
  fileSaveOperationStarted,
  fileSaveOperationSettled,
  filesReducer,
  initialState,
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from './files-slice';
import { selectFileContent, selectFileIsDirty, selectOriginalFileContent } from './files-selectors';

const WS_ID = 'ws-1';
const PATH = 'src/app.ts';
const ABS_PATH = '/repo/src/app.ts';
const OTHER_WS_ID = 'ws-2';
const OTHER_PATH = 'src/other.ts';
const OTHER_ABS_PATH = '/repo/src/other.ts';

describe('filesReducer', () => {
  it.each([false, true])(
    'keeps a failed preview retry read-only until a complete read succeeds (truncated=%s)',
    (truncated) => {
      let state = filesReducer(
        initialState,
        loadFileContentSucceeded(
          WS_ID,
          PATH,
          ABS_PATH,
          {
            kind: 'read-only-text',
            content: 'prefix',
            bytesRead: 6,
            totalBytes: truncated ? 99 : 6,
          },
          truncated,
        ),
      );
      state = filesReducer(
        state,
        loadFileContentRequested(WS_ID, PATH, ABS_PATH, { readOnlyPreview: true }),
      );
      state = filesReducer(state, loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'connection lost'));
      const failed = getItem(state.byWorkspaceId[WS_ID].files, PATH);
      expect(failed).toMatchObject({
        kind: 'read-only-text',
        originalContent: 'prefix',
        localContent: null,
        bytesRead: 6,
        totalBytes: truncated ? 99 : 6,
        truncated,
        loading: false,
        error: 'connection lost',
      });
      expect(fileSnapshot(failed)).toBeUndefined();
      expect(
        filesReducer(
          state,
          updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'stale draft' }),
        ),
      ).toBe(state);
      for (const content of [
        { kind: 'editable-text', content: 'old save' } as const,
        { kind: 'restorable-snapshot', content: 'old undo', isBinary: false } as const,
      ]) {
        state = filesReducer(state, saveFileContentSucceeded(WS_ID, PATH, content));
        expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toMatchObject({
          kind: 'read-only-text',
          originalContent: 'prefix',
          localContent: null,
          truncated,
        });
        expect(fileSnapshot(getItem(state.byWorkspaceId[WS_ID].files, PATH))).toBeUndefined();
      }
      state = filesReducer(state, loadFileContentRequested(WS_ID, PATH, ABS_PATH));
      expect(fileSnapshot(getItem(state.byWorkspaceId[WS_ID].files, PATH))).toBeUndefined();
      state = filesReducer(
        state,
        loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
          kind: 'editable-text',
          content: 'complete document',
        }),
      );
      expect(fileSnapshot(getItem(state.byWorkspaceId[WS_ID].files, PATH))).toEqual({
        kind: 'restorable-snapshot',
        content: 'complete document',
        isBinary: false,
      });
    },
  );

  it('restores a readable binary snapshot without admitting text edits', () => {
    const snapshot = { kind: 'restorable-snapshot', content: '\b\u0001', isBinary: true } as const;
    const restored = filesReducer(initialState, saveFileContentSucceeded(WS_ID, PATH, snapshot));
    expect(restored.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'restorable-snapshot',
      isBinary: true,
      originalContent: '\b\u0001',
      localContent: '\b\u0001',
      lastUpdated: 1,
    });
    expect(
      filesReducer(
        restored,
        updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'replacement' }),
      ),
    ).toBe(restored);
  });

  it('keeps a newer text draft when a text snapshot restore finishes', () => {
    const loaded = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'disk' }),
    );
    const edited = filesReducer(
      loaded,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'new draft' }),
    );
    const restored = filesReducer(
      edited,
      saveFileContentSucceeded(WS_ID, PATH, {
        kind: 'restorable-snapshot',
        content: 'restored',
        isBinary: false,
      }),
    );
    expect(restored.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'restored',
      localContent: 'new draft',
      lastUpdated: 1,
    });
  });

  it('returns the initial state', () => {
    expect(filesReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('tracks file loading state and loaded content', () => {
    const loadingState = filesReducer(
      initialState,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    );
    expect(loadingState.byWorkspaceId[WS_ID].files.map[PATH]).toEqual({
      ...emptyFilesWorkspaceState.files.map[PATH],
      path: PATH,
      absolutePath: ABS_PATH,
      kind: 'preview-only',
      originalContent: null,
      localContent: null,
      lastUpdated: 0,
      loading: true,
      saving: false,
      error: null,
      isBinary: false,
      truncated: false,
      notFoundCandidates: null,
    });

    const loadedState = filesReducer(
      loadingState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'restorable-snapshot',
        content: 'hello',
        isBinary: true,
      }),
    );
    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'restorable-snapshot',
      originalContent: 'hello',
      localContent: 'hello',
      lastUpdated: 0,
      loading: false,
      isBinary: true,
      truncated: false,
    });
  });

  it('stores truncated state from loaded content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(
        WS_ID,
        PATH,
        ABS_PATH,
        { kind: 'editable-text', content: 'partial' },
        true,
      ),
    );

    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'partial',
      localContent: 'partial',
      truncated: true,
    });

    const reloadingState = filesReducer(
      loadedState,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    );
    expect(reloadingState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      loading: true,
      truncated: false,
    });
  });

  it('updates both original and local content when load completes without user edits', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'X' }),
    );
    state = filesReducer(
      state,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'Z' }),
    );

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Z');
    expect(entry?.originalContent).toBe('Z');
  });

  it('sets both original and local content on first load', () => {
    const state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'Z' }),
    );

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Z');
    expect(entry?.originalContent).toBe('Z');
  });

  it('preserves user edits when load completes while edits are pending', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'X' }),
    );
    state = filesReducer(
      state,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'Y' }),
    );
    state = filesReducer(state, loadFileContentRequested(WS_ID, PATH, ABS_PATH));
    state = filesReducer(
      state,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'Z' }),
    );

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Y');
    expect(entry?.originalContent).toBe('Z');
  });

  it('stores load errors and clears content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'hello' }),
    );
    const failedState = filesReducer(
      loadedState,
      loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'boom'),
    );

    expect(failedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'preview-only',
      originalContent: null,
      localContent: null,
      loading: false,
      error: 'boom',
      truncated: false,
      notFoundCandidates: null,
    });
  });

  it('stores not-found candidates from a failed load', () => {
    const candidates = ['packages/a/docs/guide.md', 'packages/b/docs/guide.md'];
    const failedState = filesReducer(
      initialState,
      loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'boom', candidates),
    );

    expect(failedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      error: 'boom',
      notFoundCandidates: candidates,
    });
  });

  it('clears not-found candidates on reload and on success', () => {
    const candidates = ['packages/a/docs/guide.md'];
    const failedState = filesReducer(
      initialState,
      loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'boom', candidates),
    );

    const reloadingState = filesReducer(
      failedState,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    );
    expect(reloadingState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      loading: true,
      notFoundCandidates: null,
    });

    const loadedState = filesReducer(
      failedState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'hello' }),
    );
    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'hello',
      notFoundCandidates: null,
    });
  });

  it('tracks dirty content through selectors', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );

    expect(selectFileIsDirty.select({ files: loadedState } as any, WS_ID, PATH)).toBe(false);
    expect(selectFileIsDirty.select({ files: editedState } as any, WS_ID, PATH)).toBe(true);
  });

  it('exposes local edits separately from disk-backed original content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'disk' }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'unsaved' }),
    );

    expect(selectFileContent.select({ files: editedState } as any, WS_ID, PATH)).toBe('unsaved');
    expect(selectOriginalFileContent.select({ files: editedState } as any, WS_ID, PATH)).toBe(
      'disk',
    );
  });

  it('captures original content on first edit', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );

    expect(editedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'original',
      localContent: 'edited',
    });
  });

  it('does not change original content on later edits', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const firstEditedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );
    const secondEditedState = filesReducer(
      firstEditedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited again' }),
    );

    expect(secondEditedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'original',
      localContent: 'edited again',
    });
  });

  it('does not touch original content when updating local content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );

    const entry = getItem(editedState.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('edited');
    expect(entry?.originalContent).toBe('original');
  });

  it('clears original content when edits revert to the baseline', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );
    const revertedState = filesReducer(
      editedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'original' }),
    );

    expect(revertedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'original',
      localContent: 'original',
    });
  });

  it('returns the same state when setting content to the current value', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );

    expect(
      filesReducer(
        loadedState,
        updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'original' }),
      ),
    ).toBe(loadedState);
  });

  it('removes only the requested file content entry from the requested workspace', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'primary',
      }),
    );
    state = filesReducer(
      state,
      loadFileContentSucceeded(WS_ID, OTHER_PATH, OTHER_ABS_PATH, {
        kind: 'editable-text',
        content: 'other',
      }),
    );
    state = filesReducer(
      state,
      loadFileContentSucceeded(OTHER_WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'other workspace',
      }),
    );

    const nextState = filesReducer(state, removeFileContentEntry(WS_ID, PATH));

    expect(removeFileContentEntry.type).toBe('files/removeFileContentEntry');
    expect(getItem(nextState.byWorkspaceId[WS_ID].files, PATH)).toBeUndefined();
    expect(getItem(nextState.byWorkspaceId[WS_ID].files, OTHER_PATH)?.localContent).toBe('other');
    expect(nextState.byWorkspaceId[OTHER_WS_ID]).toBe(state.byWorkspaceId[OTHER_WS_ID]);
    expect(getItem(nextState.byWorkspaceId[OTHER_WS_ID].files, PATH)?.localContent).toBe(
      'other workspace',
    );
  });

  it('preserves the state reference when removing a missing file content entry', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );

    expect(filesReducer(loadedState, removeFileContentEntry(WS_ID, OTHER_PATH))).toBe(loadedState);
    expect(filesReducer(loadedState, removeFileContentEntry(OTHER_WS_ID, PATH))).toBe(loadedState);
  });

  it('marks save lifecycle and updates original content on success', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );
    const savingState = filesReducer(
      editedState,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'edited' }),
    );
    expect(savingState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'original',
      localContent: 'edited',
      saving: true,
      error: null,
    });

    const savedState = filesReducer(
      savingState,
      saveFileContentSucceeded(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );
    expect(savedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      kind: 'editable-text',
      originalContent: 'edited',
      localContent: 'edited',
      lastUpdated: 1,
      saving: false,
    });
  });

  it('preserves user edits when save succeeds after additional in-flight edits', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'A' }),
    );
    state = filesReducer(
      state,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'A' }),
    );
    state = filesReducer(
      state,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'B' }),
    );
    state = filesReducer(
      state,
      saveFileContentSucceeded(WS_ID, PATH, { kind: 'editable-text', content: 'A' }),
    );

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('B');
    expect(entry?.originalContent).toBe('A');
    expect(entry?.saving).toBe(false);
  });

  it('marks save failures without discarding edited content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, {
        kind: 'editable-text',
        content: 'original',
      }),
    );
    const editedState = filesReducer(
      loadedState,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'edited' }),
    );
    const savingState = filesReducer(
      editedState,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'edited' }),
    );
    const failedState = filesReducer(
      savingState,
      saveFileContentFailed(WS_ID, PATH, 'save failed'),
    );

    expect(failedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      localContent: 'edited',
      saving: false,
      error: 'save failed',
    });
  });

  it('clears workspace state on workspace unmount', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'hello' }),
    );

    expect(
      filesReducer(loadedState, workspaceUnmounted(WS_ID)).byWorkspaceId[WS_ID],
    ).toBeUndefined();
  });
});

describe('explicit file save operation facts', () => {
  const operation = {
    requestId: 'save-1',
    workspaceId: WS_ID,
    path: PATH,
    absolutePath: ABS_PATH,
    authority: 'view-1',
    status: 'queued' as const,
  };
  it('keeps the current acknowledgement while a serialized save waits, then claims the next transport', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'old' }),
    );
    state = filesReducer(
      state,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'first' }),
    );
    const first = { ...operation, serialize: true };
    const second = { ...first, requestId: 'save-2' };
    state = filesReducer(state, fileSaveOperationQueued(first));
    state = filesReducer(state, fileSaveOperationStarted(first.requestId));
    state = filesReducer(
      state,
      updateFileContent(WS_ID, PATH, { kind: 'editable-text', content: 'second' }),
    );
    const firstEntry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    state = filesReducer(state, fileSaveOperationQueued(second));
    expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toBe(firstEntry);
    state = filesReducer(
      state,
      saveFileContentSucceeded(
        WS_ID,
        PATH,
        { kind: 'editable-text', content: 'first' },
        first.requestId,
      ),
    );
    state = filesReducer(state, fileSaveOperationSettled(first.requestId, 'succeeded'));
    expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toMatchObject({
      originalContent: 'first',
      localContent: 'second',
    });
    state = filesReducer(state, fileSaveOperationStarted(second.requestId));
    expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toMatchObject({
      saveRequestId: second.requestId,
      saving: true,
    });
    expect(filesReducer(state, fileSaveOperationStarted(second.requestId))).toBe(state);
    state = filesReducer(
      state,
      saveFileContentSucceeded(
        WS_ID,
        PATH,
        { kind: 'editable-text', content: 'second' },
        second.requestId,
      ),
    );
    state = filesReducer(state, fileSaveOperationSettled(second.requestId, 'succeeded'));
    expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toMatchObject({
      originalContent: 'second',
      localContent: 'second',
      saving: false,
    });
  });

  it('does not recreate a departed cache entry when a serialized receipt starts', () => {
    let state = filesReducer(
      initialState,
      fileSaveOperationQueued({ ...operation, serialize: true }),
    );
    state = filesReducer(state, workspaceUnmounted(WS_ID));
    state = filesReducer(state, fileSaveOperationStarted(operation.requestId));
    expect(state.byWorkspaceId[WS_ID]).toBeUndefined();
    expect(getItem(state.saveOperations!, operation.requestId)?.status).toBe('running');
  });

  it.each(['workspace', 'file'] as const)(
    'retains settlement across %s cleanup without recreating the departed file',
    (cleanup) => {
      let state = filesReducer(
        initialState,
        loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'old' }),
      );
      state = filesReducer(state, fileSaveOperationQueued(operation));
      state = filesReducer(state, fileSaveOperationStarted(operation.requestId));
      state = filesReducer(
        state,
        cleanup === 'workspace' ? workspaceUnmounted(WS_ID) : removeFileContentEntry(WS_ID, PATH),
      );
      state = filesReducer(
        state,
        fileSaveOperationSettled(operation.requestId, 'uncertain', 'timeout'),
      );
      if (cleanup === 'workspace') expect(state.byWorkspaceId[WS_ID]).toBeUndefined();
      else expect(getItem(state.byWorkspaceId[WS_ID].files, PATH)).toBeUndefined();
      expect(state.saveOperations?.map['save-1']).toMatchObject({
        status: 'uncertain',
        error: 'timeout',
      });
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    },
  );

  it('ignores duplicate, unknown, and already settled operation transitions by reference', () => {
    const queued = filesReducer(initialState, fileSaveOperationQueued(operation));
    expect(filesReducer(queued, fileSaveOperationQueued(operation))).toBe(queued);
    expect(filesReducer(queued, fileSaveOperationStarted('missing'))).toBe(queued);
    expect(filesReducer(queued, fileSaveOperationSettled('missing', 'failed'))).toBe(queued);
    const settled = filesReducer(queued, fileSaveOperationSettled('save-1', 'cancelled'));
    expect(filesReducer(settled, fileSaveOperationStarted('save-1'))).toBe(settled);
    expect(filesReducer(settled, fileSaveOperationSettled('save-1', 'succeeded'))).toBe(settled);
  });

  it('cannot apply an earlier request result to a later save or a failed read', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, { kind: 'editable-text', content: 'old' }),
    );
    state = filesReducer(state, fileSaveOperationQueued({ ...operation, requestId: 'save-2' }));
    expect(
      filesReducer(
        state,
        saveFileContentSucceeded(
          WS_ID,
          PATH,
          { kind: 'editable-text', content: 'stale' },
          'save-1',
        ),
      ),
    ).toBe(state);
    expect(filesReducer(state, saveFileContentFailed(WS_ID, PATH, 'stale error', 'save-1'))).toBe(
      state,
    );
    state = filesReducer(state, loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'not available'));
    expect(
      filesReducer(
        state,
        saveFileContentSucceeded(
          WS_ID,
          PATH,
          { kind: 'editable-text', content: 'stale' },
          'save-2',
        ),
      ),
    ).toBe(state);
  });
});

describe('bounded save receipt retention', () => {
  const operation = {
    requestId: 'save',
    workspaceId: WS_ID,
    path: PATH,
    absolutePath: ABS_PATH,
    authority: 'view-1',
    status: 'queued' as const,
  };
  it('keeps only the latest known settled receipt for repeated saves under one authority', () => {
    let state = initialState;
    for (let index = 0; index < 12; index++) {
      const requestId = `save-${index}`;
      state = filesReducer(state, fileSaveOperationQueued({ ...operation, requestId }));
      state = filesReducer(state, fileSaveOperationStarted(requestId));
      state = filesReducer(
        state,
        fileSaveOperationSettled(requestId, index % 2 ? 'failed' : 'succeeded'),
      );
      expect(state.saveOperations?.ids).toEqual([requestId]);
    }
    state = filesReducer(
      state,
      fileSaveOperationQueued({ ...operation, requestId: 'declined', status: 'cancelled' }),
    );
    expect(state.saveOperations?.ids).toEqual(['declined']);
  });

  it('retains running and uncertain outcomes when newer requests are declined', () => {
    let state = filesReducer(initialState, fileSaveOperationQueued(operation));
    state = filesReducer(state, fileSaveOperationStarted('save'));
    state = filesReducer(
      state,
      fileSaveOperationQueued({ ...operation, requestId: 'declined-1', status: 'cancelled' }),
    );
    expect(state.saveOperations?.map.save.status).toBe('running');
    state = filesReducer(state, fileSaveOperationSettled('save', 'uncertain'));
    expect(state.saveOperations?.ids).toEqual(['save']);
    state = filesReducer(
      state,
      fileSaveOperationQueued({ ...operation, requestId: 'declined-2', status: 'cancelled' }),
    );
    state = filesReducer(
      state,
      fileSaveOperationQueued({ ...operation, requestId: 'declined-3', status: 'cancelled' }),
    );
    expect(state.saveOperations?.ids).toEqual(['save', 'declined-3']);
    expect(state.saveOperations?.map.save.status).toBe('uncertain');
  });

  it('does not retire another resource or authority receipt', () => {
    let state = filesReducer(
      initialState,
      fileSaveOperationQueued({
        ...operation,
        requestId: 'other-path',
        path: OTHER_PATH,
        absolutePath: OTHER_ABS_PATH,
        status: 'failed',
      }),
    );
    state = filesReducer(
      state,
      fileSaveOperationQueued({
        ...operation,
        requestId: 'other-authority',
        authority: 'view-2',
        status: 'succeeded',
      }),
    );
    state = filesReducer(state, fileSaveOperationQueued({ ...operation, status: 'cancelled' }));
    expect(state.saveOperations?.ids).toEqual(['other-path', 'other-authority', 'save']);
  });
});
