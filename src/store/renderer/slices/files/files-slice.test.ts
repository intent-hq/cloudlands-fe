import { describe, expect, it } from 'vitest';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearLegacyFileDeleteOperation,
  deleteLegacyFileRequested,
  emptyFilesWorkspaceState,
  filesReducer,
  initialState,
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
  resolveWorkspaceMediaRequested,
  resolveWorkspaceMediaSucceeded,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  searchFileNamesFailed,
  searchFileNamesRequested,
  searchFileNamesSucceeded,
  updateFileContent,
} from './files-slice';
import {
  selectFileContent,
  selectFileIsDirty,
  selectLegacyFileDeleteOperation,
  selectOriginalFileContent,
} from './files-selectors';

const WS_ID = 'ws-1';
const PATH = 'src/app.ts';
const ABS_PATH = '/repo/src/app.ts';
const OTHER_WS_ID = 'ws-2';
const OTHER_PATH = 'src/other.ts';
const OTHER_ABS_PATH = '/repo/src/other.ts';

describe('filesReducer', () => {
  it('returns the initial state', () => {
    expect(filesReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('tracks keyed file searches and ignores stale completion', () => {
    const requested = filesReducer(
      initialState,
      searchFileNamesRequested(WS_ID, 'palette', 'app', 50, 150),
    );
    const stale = filesReducer(
      requested,
      searchFileNamesSucceeded(WS_ID, 'palette', 'old', ['old.ts']),
    );
    expect(stale).toBe(requested);

    const succeeded = filesReducer(
      requested,
      searchFileNamesSucceeded(WS_ID, 'palette', 'app', ['src/app.ts']),
    );
    expect(succeeded.byWorkspaceId[WS_ID].fileNameSearches.palette).toEqual({
      pattern: 'app',
      files: ['src/app.ts'],
      loading: false,
      error: null,
    });

    const failed = filesReducer(
      requested,
      searchFileNamesFailed(WS_ID, 'palette', 'app', 'offline'),
    );
    expect(failed.byWorkspaceId[WS_ID].fileNameSearches.palette).toEqual({
      pattern: 'app',
      files: [],
      loading: false,
      error: 'offline',
    });
  });

  it('tracks correlated file deletion settlement and ignores stale results', () => {
    const first = deleteLegacyFileRequested(WS_ID, PATH, 'tab-1', 'request-1');
    const latest = deleteLegacyFileRequested(WS_ID, PATH, 'tab-1', 'request-2');
    first.promise.catch(() => undefined);
    latest.promise.catch(() => undefined);
    let state = filesReducer(initialState, first);
    state = filesReducer(state, latest);

    const stale = filesReducer(state, first.success(undefined));
    expect(stale).toBe(state);
    expect(selectLegacyFileDeleteOperation.select({ files: state } as any, WS_ID, 'tab-1')).toEqual(
      {
        requestId: 'request-2',
        path: PATH,
        status: 'loading',
        error: null,
      },
    );

    const succeeded = filesReducer(state, latest.success(undefined));
    expect(
      selectLegacyFileDeleteOperation.select({ files: succeeded } as any, WS_ID, 'tab-1'),
    ).toEqual({
      requestId: 'request-2',
      path: PATH,
      status: 'success',
      error: null,
    });

    state = filesReducer(state, latest.failure(new Error('permission denied')));
    expect(selectLegacyFileDeleteOperation.select({ files: state } as any, WS_ID, 'tab-1')).toEqual(
      {
        requestId: 'request-2',
        path: PATH,
        status: 'error',
        error: 'permission denied',
      },
    );
    expect(filesReducer(state, clearLegacyFileDeleteOperation(WS_ID, 'tab-1', 'request-1'))).toBe(
      state,
    );
    state = filesReducer(state, clearLegacyFileDeleteOperation(WS_ID, 'tab-1', 'request-2'));
    expect(
      selectLegacyFileDeleteOperation.select({ files: state } as any, WS_ID, 'tab-1'),
    ).toBeUndefined();
  });

  it('tracks media resolution without accepting stale paths', () => {
    const requested = filesReducer(
      initialState,
      resolveWorkspaceMediaRequested(WS_ID, 'tab-1', 'preview.png', 'preview.png', 'tab-1'),
    );
    const stale = filesReducer(
      requested,
      resolveWorkspaceMediaSucceeded(WS_ID, 'tab-1', 'old.png', 'old.png'),
    );
    expect(stale).toBe(requested);

    const succeeded = filesReducer(
      requested,
      resolveWorkspaceMediaSucceeded(WS_ID, 'tab-1', 'preview.png', 'preview.png'),
    );
    expect(succeeded.byWorkspaceId[WS_ID].mediaResolutions['tab-1']).toEqual({
      requestedPath: 'preview.png',
      resolvedPath: 'preview.png',
      loading: false,
      error: null,
    });
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'hello', true),
    );
    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'partial', false, true),
    );

    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'X', false),
    );
    state = filesReducer(state, loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'Z', false));

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Z');
    expect(entry?.originalContent).toBe('Z');
  });

  it('sets both original and local content on first load', () => {
    const state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'Z', false),
    );

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Z');
    expect(entry?.originalContent).toBe('Z');
  });

  it('preserves user edits when load completes while edits are pending', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'X', false),
    );
    state = filesReducer(state, updateFileContent(WS_ID, PATH, 'Y'));
    state = filesReducer(state, loadFileContentRequested(WS_ID, PATH, ABS_PATH));
    state = filesReducer(state, loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'Z', false));

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('Y');
    expect(entry?.originalContent).toBe('Z');
  });

  it('stores load errors and clears content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'hello', false),
    );
    const failedState = filesReducer(
      loadedState,
      loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'boom'),
    );

    expect(failedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'hello', false),
    );
    expect(loadedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'hello',
      notFoundCandidates: null,
    });
  });

  it('tracks dirty content through selectors', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));

    expect(selectFileIsDirty.select({ files: loadedState } as any, WS_ID, PATH)).toBe(false);
    expect(selectFileIsDirty.select({ files: editedState } as any, WS_ID, PATH)).toBe(true);
  });

  it('exposes local edits separately from disk-backed original content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'disk', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'unsaved'));

    expect(selectFileContent.select({ files: editedState } as any, WS_ID, PATH)).toBe('unsaved');
    expect(selectOriginalFileContent.select({ files: editedState } as any, WS_ID, PATH)).toBe(
      'disk',
    );
  });

  it('captures original content on first edit', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));

    expect(editedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'original',
      localContent: 'edited',
    });
  });

  it('does not change original content on later edits', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const firstEditedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));
    const secondEditedState = filesReducer(
      firstEditedState,
      updateFileContent(WS_ID, PATH, 'edited again'),
    );

    expect(secondEditedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'original',
      localContent: 'edited again',
    });
  });

  it('does not touch original content when updating local content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));

    const entry = getItem(editedState.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('edited');
    expect(entry?.originalContent).toBe('original');
  });

  it('clears original content when edits revert to the baseline', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));
    const revertedState = filesReducer(editedState, updateFileContent(WS_ID, PATH, 'original'));

    expect(revertedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'original',
      localContent: 'original',
    });
  });

  it('returns the same state when setting content to the current value', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );

    expect(filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'original'))).toBe(loadedState);
  });

  it('removes only the requested file content entry from the requested workspace', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'primary', false),
    );
    state = filesReducer(
      state,
      loadFileContentSucceeded(WS_ID, OTHER_PATH, OTHER_ABS_PATH, 'other', false),
    );
    state = filesReducer(
      state,
      loadFileContentSucceeded(OTHER_WS_ID, PATH, ABS_PATH, 'other workspace', false),
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );

    expect(filesReducer(loadedState, removeFileContentEntry(WS_ID, OTHER_PATH))).toBe(loadedState);
    expect(filesReducer(loadedState, removeFileContentEntry(OTHER_WS_ID, PATH))).toBe(loadedState);
  });

  it('marks save lifecycle and updates original content on success', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));
    const savingState = filesReducer(
      editedState,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'edited'),
    );
    expect(savingState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'original',
      localContent: 'edited',
      saving: true,
      error: null,
    });

    const savedState = filesReducer(savingState, saveFileContentSucceeded(WS_ID, PATH, 'edited'));
    expect(savedState.byWorkspaceId[WS_ID].files.map[PATH]).toMatchObject({
      originalContent: 'edited',
      localContent: 'edited',
      lastUpdated: 1,
      saving: false,
    });
  });

  it('preserves user edits when save succeeds after additional in-flight edits', () => {
    let state = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'A', false),
    );
    state = filesReducer(state, saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'A'));
    state = filesReducer(state, updateFileContent(WS_ID, PATH, 'B'));
    state = filesReducer(state, saveFileContentSucceeded(WS_ID, PATH, 'A'));

    const entry = getItem(state.byWorkspaceId[WS_ID].files, PATH);
    expect(entry?.localContent).toBe('B');
    expect(entry?.originalContent).toBe('A');
    expect(entry?.saving).toBe(false);
  });

  it('marks save failures without discarding edited content', () => {
    const loadedState = filesReducer(
      initialState,
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'original', false),
    );
    const editedState = filesReducer(loadedState, updateFileContent(WS_ID, PATH, 'edited'));
    const savingState = filesReducer(
      editedState,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'edited'),
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
      loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'hello', false),
    );

    expect(
      filesReducer(loadedState, workspaceUnmounted(WS_ID)).byWorkspaceId[WS_ID],
    ).toBeUndefined();
  });
});
