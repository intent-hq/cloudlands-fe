import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { m } from '$shared/paraglide/messages.js';
import { fileContentKey } from '$features/file/utils/file-content-key';
import { appClient } from '$lib/client';
import { runSaga, stdChannel } from 'redux-saga';
import { pdfPreviewSaga } from '$store/renderer/slices/pdf-preview/sagas/pdf-preview-saga';
import { filesReadSaga } from '$store/renderer/slices/files/sagas/files-read-saga';
import { loadFileContentSucceeded } from '$store/renderer/slices/files/files-slice';
import { invoke } from '$lib/electron-bridge';
import { notify } from '$lib/components/patterns/notify';

vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));
import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type { FileNode } from '$shared/types';

vi.mock('$features/file/components/PdfViewer.svelte', async () => ({
  default: (await import('../../file/__tests__/MockPdfViewer.svelte')).default,
}));

const {
  actionMocks,
  createMockSelector,
  dispatchMock,
  applyExternalFileContentToMockState,
  mockReduxState,
  resetMockReduxState,
} = vi.hoisted(() => {
  type FileEntry = {
    localContent: string | null;
    originalContent: string | null;
    loading: boolean;
    saving: boolean;
    error: string | null;
    isBinary: boolean;
    lastUpdated: number;
    notFoundCandidates?: string[] | null;
  };

  type ActiveSelector = { update: () => void };
  const activeSelectors: ActiveSelector[] = [];

  const mockReduxState = {
    workspace: {
      id: 'ws-1',
      worktreePath: '/repo',
      repositoryPath: '/repo',
    },
    preview: null as null | {
      id: string;
      requestId: string;
      status: string;
      url: string | null;
      error: string | null;
    },
    files: {} as Record<string, FileEntry>,
    fileTrackingChanges: [] as unknown[],
    lineWrapping: true,
    diffIndicators: false,
  };

  function resetMockReduxState() {
    activeSelectors.splice(0, activeSelectors.length);
    mockReduxState.workspace = {
      id: 'ws-1',
      worktreePath: '/repo',
      repositoryPath: '/repo',
    };
    mockReduxState.files = {
      'src/main.ts': {
        localContent: 'console.log("loaded");',
        originalContent: 'console.log("loaded");',
        loading: false,
        saving: false,
        error: null,
        isBinary: false,
        lastUpdated: 0,
      },
    };
    mockReduxState.preview = null;
    mockReduxState.fileTrackingChanges = [];
    mockReduxState.lineWrapping = true;
    mockReduxState.diffIndicators = false;
  }

  function applyExternalFileContentToMockState(path: string, content: string) {
    const entry = mockReduxState.files[path];
    if (!entry) throw new Error(`Missing mock file entry for ${path}`);
    const hasPendingEdits =
      entry.localContent !== null && entry.localContent !== entry.originalContent;
    mockReduxState.files[path] = {
      ...entry,
      localContent: hasPendingEdits ? entry.localContent : content,
      originalContent: content,
      lastUpdated: entry.lastUpdated + 1,
    };
    flushMockSelectors();
  }

  function flushMockSelectors() {
    for (const selector of [...activeSelectors]) selector.update();
  }

  function isReadable(
    value: unknown,
  ): value is { subscribe: (run: (value: unknown) => void) => () => void } {
    return !!value && typeof value === 'object' && 'subscribe' in value;
  }

  function createMockSelector<T>(getter: (...args: unknown[]) => T) {
    const selector = (...args: unknown[]) => ({
      subscribe(run: (value: T) => void) {
        const argValues = [...args];
        const update = () => run(getter(...argValues));
        const subscriptions = args.flatMap((arg, index) =>
          isReadable(arg)
            ? [
                arg.subscribe((value) => {
                  argValues[index] = value;
                  update();
                }),
              ]
            : [],
        );

        const activeSelector = { update };
        activeSelectors.push(activeSelector);
        if (subscriptions.length === 0) update();

        return () => {
          const selectorIndex = activeSelectors.indexOf(activeSelector);
          if (selectorIndex >= 0) activeSelectors.splice(selectorIndex, 1);
          subscriptions.forEach((unsubscribe) => unsubscribe());
        };
      },
    });

    selector.select = (_state: unknown, ...args: unknown[]) => getter(...args);
    selector.effect = (..._args: unknown[]) => undefined;
    selector.withStore = () => selector;
    return selector;
  }

  function makeAction(type: string) {
    const action = vi.fn((...args: unknown[]) => ({ type, payload: args }));
    action.type = type;
    action.toString = () => type;
    return action;
  }

  const actionMocks = {
    loadFileContentRequested: makeAction('files/loadFileContentRequested'),
    saveFileContentRequested: makeAction('files/saveFileContentRequested'),
    updateFileContent: makeAction('files/updateFileContent'),
    deleteFileWithUndoRequested: makeAction('files/deleteFileWithUndoRequested'),
    removeFileContentEntry: makeAction('files/removeFileContentEntry'),
    updateFileTabPath: makeAction('panelLayout/updateFileTabPath'),
  };

  const dispatchMock = vi.fn((action: { type: string; payload?: unknown[] }) => {
    if (action.type === 'pdfPreview/requested') {
      const [id, requestId] = action.payload as [string, string];
      mockReduxState.preview = { id, requestId, status: 'loading', url: null, error: null };
      flushMockSelectors();
    }
    if (action.type === 'pdfPreview/ready') {
      const [id, requestId, url] = action.payload as [string, string, string];
      if (mockReduxState.preview?.id === id && mockReduxState.preview.requestId === requestId)
        mockReduxState.preview = { id, requestId, status: 'ready', url, error: null };
      flushMockSelectors();
    }
    if (action.type === 'pdfPreview/released') {
      mockReduxState.preview = null;
      flushMockSelectors();
    }
    if (action.type === 'files/loadFileContentSucceeded') {
      const [, path, , content, isBinary] = action.payload as [
        string,
        string,
        string,
        string,
        boolean,
      ];
      mockReduxState.files[path] = {
        localContent: content,
        originalContent: content,
        loading: false,
        saving: false,
        error: null,
        isBinary,
        lastUpdated: 1,
      };
      flushMockSelectors();
    }
    if (action.type === 'files/loadFileContentFailed') {
      const [, path, , error] = action.payload as [string, string, string, string];
      mockReduxState.files[path] = {
        localContent: null,
        originalContent: null,
        loading: false,
        saving: false,
        error,
        isBinary: false,
        lastUpdated: 1,
      };
      flushMockSelectors();
    }
    if (action.type === 'files/updateFileContent') {
      const [, path, content] = action.payload as [string, string, string];
      mockReduxState.files[path] = {
        ...mockReduxState.files[path],
        localContent: content,
      };
      flushMockSelectors();
    }
    if (action.type === 'files/saveFileContentRequested') {
      const [, path] = action.payload as [string, string];
      mockReduxState.files[path] = {
        ...mockReduxState.files[path],
        saving: true,
      };
      flushMockSelectors();
    }
    return action;
  });

  resetMockReduxState();

  return {
    actionMocks,
    applyExternalFileContentToMockState,
    createMockSelector,
    dispatchMock,
    mockReduxState,
    resetMockReduxState,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { initialState } = await import('$store/renderer/slices/git/git-slice');

  return createAppStoreMockModule({
    state: () => ({ git: initialState }),
    dispatch: dispatchMock,
  });
});

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
});

vi.mock('$store/renderer/slices/pdf-preview/pdf-preview-selectors', () => ({
  selectPdfPreview: createMockSelector(() => mockReduxState.preview),
}));

vi.mock('$store/renderer/slices/files/files-selectors', () => ({
  selectFileContent: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.localContent ?? null) : null,
  ),
  selectFileLoading: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.loading ?? false) : false,
  ),
  selectFileSaving: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.saving ?? false) : false,
  ),
  selectFileError: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.error ?? null) : null,
  ),
  selectFileIsBinary: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.isBinary ?? false) : false,
  ),
  selectFileIsDirty: createMockSelector((_wsId: string, path: string | null | undefined) => {
    const entry = path ? mockReduxState.files[path] : undefined;
    return entry ? entry.localContent !== entry.originalContent : false;
  }),
  selectFileLastUpdated: createMockSelector((_wsId: string, path: string | null | undefined) =>
    path ? (mockReduxState.files[path]?.lastUpdated ?? 0) : 0,
  ),
  selectFileNotFoundCandidates: createMockSelector(
    (_wsId: string, path: string | null | undefined) =>
      path ? (mockReduxState.files[path]?.notFoundCandidates ?? null) : null,
  ),
}));

vi.mock('$store/renderer/slices/files/files-slice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/files/files-slice')>()),
  ...actionMocks,
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: createMockSelector((wsId: string) =>
    wsId === mockReduxState.workspace.id ? mockReduxState.workspace : undefined,
  ),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectFileTrackingChanges: createMockSelector(() => mockReduxState.fileTrackingChanges),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: createMockSelector(() => mockReduxState.lineWrapping),
  selectDiffIndicators: createMockSelector(() => mockReduxState.diffIndicators),
}));

vi.mock('$store/renderer/slices/ui-layout/ui-layout-slice', () => ({
  toggleLineWrapping: () => ({ type: 'uiLayout/toggleLineWrapping', payload: [] }),
  toggleDiffIndicators: () => ({ type: 'uiLayout/toggleDiffIndicators', payload: [] }),
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: (workspaceId: string, tabId: string) => ({
    type: 'panelLayout/closeTab',
    payload: [workspaceId, tabId],
  }),
  updateFileTabPath: actionMocks.updateFileTabPath,
}));

vi.mock('$store/renderer/slices/workspace-navigation/workspace-navigation-slice', () => ({
  openWorkspaceDiff: (...args: unknown[]) => ({
    type: 'workspaceNavigation/openWorkspaceDiff',
    payload: args,
  }),
}));

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockCodeEditor.svelte')).default,
}));

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockMarkdownViewer.svelte')).default,
}));

vi.mock('$lib/components/editor/FileViewer.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockFileViewer.svelte')).default,
}));

vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockOpenComboButton.svelte')).default,
}));

vi.mock('$lib/components/ui/skeleton', () => ({
  Skeleton: 'div',
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

import FileTabTypeHarness from './__tests__/mocks/MockFileTabTypeHarness.svelte';

const fileTab: PanelTab = {
  id: 'tab-1',
  type: 'file',
  title: 'main.ts',
  closable: true,
  filePath: 'src/main.ts',
};

describe('FileTabType Redux integration', () => {
  beforeEach(() => {
    resetMockReduxState();
    vi.clearAllMocks();
    vi.mocked(backendRequest).mockImplementation(async (method) =>
      method === 'file.stat' ? { isFile: true } : { files: [] },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderFileTab(tab: PanelTab = fileTab) {
    return render(FileTabTypeHarness, {
      props: {
        tab,
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      },
    });
  }

  const fileNode = (name: string): FileNode => ({ name, path: name, type: 'file' });

  function startFileReads() {
    const channel = stdChannel();
    const dispatch = dispatchMock.getMockImplementation()!;
    dispatchMock.mockImplementation((action) => {
      const result = dispatch(action);
      channel.put(action);
      return result;
    });
    const task = runSaga({ channel, dispatch: dispatchMock }, filesReadSaga);
    return async () => {
      cleanup();
      task.cancel();
      await task.toPromise();
      dispatchMock.mockImplementation(dispatch);
    };
  }

  it.each(['report.xlsx', 'report.xslx', 'data.unknown', 'archive.zip', 'extensionless'])(
    'offers original-byte download for %s through the live client and read saga',
    async (name) => {
      const path = `.intent/artifacts/${name}`;
      vi.mocked(backendRequest).mockRejectedValue(
        new BackendError({
          code: 'INTERNAL_ERROR',
          rpcCode: -32603,
          message: 'Internal error',
          data: { code: 'INTERNAL_ERROR', detail: 'stream did not contain valid UTF-8' },
        }),
      );
      vi.mocked(invoke).mockResolvedValue({ success: true });
      const stop = startFileReads();
      try {
        renderFileTab({ ...fileTab, filePath: `/repo/${path}` });
        expect(await screen.findByText(m.editor_fileViewer_binary_label())).toBeTruthy();
        expect(screen.queryByTestId('code-editor')).toBeNull();
        expect(screen.queryByText(m.files_read_notFound_error())).toBeNull();
        expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
        await fireEvent.click(
          screen.getByRole('button', { name: m.layout_fileTab_downloadFile_label() }),
        );
        expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
          workspaceId: 'ws-1',
          path,
          fileName: name,
        });
        expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
      } finally {
        await stop();
      }
    },
  );

  it.each(['data.pb', 'extensionless', 'data.unknown'])(
    'offers Download for UTF-8 binary control bytes in %s',
    async (name) => {
      const path = `.intent/artifacts/${name}`;
      vi.mocked(backendRequest).mockResolvedValue('\b\u0001');
      vi.mocked(invoke).mockResolvedValue({ success: true });
      const stop = startFileReads();
      try {
        renderFileTab({ ...fileTab, filePath: path });
        expect(await screen.findByText(m.editor_fileViewer_binary_label())).toBeTruthy();
        expect(screen.queryByTestId('code-editor')).toBeNull();
        await fireEvent.click(
          screen.getByRole('button', { name: m.layout_fileTab_downloadFile_label() }),
        );
        expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
          workspaceId: 'ws-1',
          path,
          fileName: name,
        });
      } finally {
        await stop();
      }
    },
  );

  it.each(
    ['data.pb', 'data.unknown', 'extensionless'].flatMap((name) =>
      [
        { kind: 'sparse', content: '\n\u0005Hello' },
        { kind: 'beyond sample', content: 'a'.repeat(8192) + '\u0005Hello' },
      ].map((sample) => ({ name, ...sample })),
    ),
  )('offers original Download for $kind binary controls in $name', async ({ name, content }) => {
    const path = `.intent/artifacts/${name}`;
    vi.mocked(backendRequest).mockResolvedValue(content);
    vi.mocked(invoke).mockResolvedValue({ success: true });
    const stop = startFileReads();
    try {
      renderFileTab({ ...fileTab, filePath: path });
      expect(await screen.findByText(m.editor_fileViewer_binary_label())).toBeTruthy();
      expect(screen.queryByTestId('code-editor')).toBeNull();
      await fireEvent.click(
        screen.getByRole('button', { name: m.layout_fileTab_downloadFile_label() }),
      );
      expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
        workspaceId: 'ws-1',
        path,
        fileName: name,
      });
      expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it('keeps a binary download pending, allows cancellation and reports a retry failure', async () => {
    const path = '.intent/artifacts/report.xlsx';
    mockReduxState.files[path] = {
      localContent: '',
      originalContent: '',
      loading: false,
      saving: false,
      error: null,
      isBinary: true,
      lastUpdated: 1,
    };
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderFileTab({ ...fileTab, filePath: path });
    const button = await screen.findByRole('button', {
      name: m.layout_fileTab_downloadFile_label(),
    });
    await fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ success: false, canceled: true });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    expect(notify.error).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('disconnected'));
    await fireEvent.click(button);
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(m.layout_fileTab_downloadFailed_error()),
    );
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('keeps a registered-root binary read-only without a primary-workspace download', async () => {
    vi.mocked(backendRequest).mockRejectedValue(
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Internal error',
        data: { code: 'INTERNAL_ERROR', detail: 'stream did not contain valid UTF-8' },
      }),
    );
    const stop = startFileReads();
    try {
      renderFileTab({
        ...fileTab,
        filePath: '/external/report.xlsx',
        data: { gitRootId: 'root-external', gitRootPath: '/external' },
      });
      expect(await screen.findByText(m.editor_fileViewer_binary_label())).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: m.layout_fileTab_downloadFile_label() }),
      ).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
      expect(backendRequest).toHaveBeenCalledWith('file.read', {
        workspaceId: 'ws-1',
        path: 'report.xlsx',
        gitRootId: 'root-external',
      });
    } finally {
      await stop();
    }
  });

  it.each([
    ['No such file or directory (os error 2)', m.files_read_notFound_error()],
    ['Permission denied (os error 13)', 'Internal error: Permission denied (os error 13)'],
    ['Connection closed', 'Internal error: Connection closed'],
  ])('preserves the file-read error panel: %s', async (message, expected) => {
    vi.spyOn(appClient.files, 'explorerTree').mockResolvedValue(null);
    vi.spyOn(appClient.files, 'listDirectory').mockResolvedValue([]);
    vi.mocked(backendRequest).mockRejectedValue(
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Internal error',
        data: { detail: message },
      }),
    );
    const stop = startFileReads();
    try {
      renderFileTab({ ...fileTab, filePath: '.intent/artifacts/report.xlsx' });
      expect(await screen.findByText(expected)).toBeTruthy();
      expect(screen.queryByText(m.editor_fileViewer_binary_label())).toBeNull();
      expect(
        screen.queryByRole('button', { name: m.layout_fileTab_downloadFile_label() }),
      ).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it('reads an untracked file from an external registered root', async () => {
    renderFileTab({
      ...fileTab,
      filePath: '/external/repo/new.md',
      data: { gitRootId: 'root-external', gitRootPath: '/external/repo' },
    });
    await waitFor(() =>
      expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
        fileTab.workspaceId ?? 'ws-1',
        fileContentKey('/external/repo/new.md', 'root-external'),
        '/external/repo/new.md',
        { gitRoot: { id: 'root-external', relativePath: 'new.md' } },
      ),
    );
  });

  it.each(['/repo/packages', '/external'])(
    'loads root-scoped Markdown under %s through the read saga and live client',
    async (parentPath) => {
      vi.mocked(backendRequest).mockImplementation(async (method, params) => {
        if (method !== 'file.read') throw new Error(`Unexpected request: ${method}`);
        const request = params as { path: string; gitRootId?: string };
        if (request.path !== 'new.md') throw new Error(`Wrong path: ${request.path}`);
        if (request.gitRootId === 'root-a') return '# Secondary root A';
        if (request.gitRootId === 'root-b') return '# Secondary root B';
        return '# Primary root';
      });
      const channel = stdChannel();
      const dispatch = dispatchMock.getMockImplementation()!;
      dispatchMock.mockImplementation((action) => {
        const result = dispatch(action);
        channel.put(action);
        return result;
      });
      const task = runSaga({ channel, dispatch: dispatchMock }, filesReadSaga);
      const rootTab = (id: string): PanelTab => ({
        ...fileTab,
        filePath: `${parentPath}/${id}/new.md`,
        data: { gitRootId: `root-${id}`, gitRootPath: `${parentPath}/${id}` },
      });
      try {
        const view = renderFileTab(rootTab('a'));
        await waitFor(() =>
          expect(screen.getByTestId('markdown-viewer').textContent).toBe('# Secondary root A'),
        );
        expect(backendRequest).toHaveBeenCalledWith('file.read', {
          workspaceId: 'ws-1',
          path: 'new.md',
          gitRootId: 'root-a',
        });
        expect(dispatchMock).toHaveBeenCalledWith(
          loadFileContentSucceeded(
            'ws-1',
            fileContentKey(`${parentPath}/a/new.md`, 'root-a'),
            `${parentPath}/a/new.md`,
            '# Secondary root A',
            false,
            false,
          ),
        );
        await view.rerender({
          tab: rootTab('b'),
          workspaceId: 'ws-1',
          isActive: true,
          isPanelFocused: true,
        });
        await waitFor(() =>
          expect(screen.getByTestId('markdown-viewer').textContent).toBe('# Secondary root B'),
        );
        expect(backendRequest).toHaveBeenLastCalledWith('file.read', {
          workspaceId: 'ws-1',
          path: 'new.md',
          gitRootId: 'root-b',
        });
        expect(
          mockReduxState.files[fileContentKey(`${parentPath}/a/new.md`, 'root-a')].localContent,
        ).toBe('# Secondary root A');
        expect(
          vi.mocked(backendRequest).mock.calls.filter(([method]) => method === 'file.read'),
        ).toHaveLength(2);
      } finally {
        cleanup();
        task.cancel();
        await task.toPromise();
        dispatchMock.mockImplementation(dispatch);
      }
    },
  );

  it.each([
    ['png', 'image/png'],
    ['mp4', 'video/mp4'],
  ])(
    'previews an external-root %s through scoped chunks and releases its Blob',
    async (extension, mimeType) => {
      const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:root-media');
      const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      vi.mocked(backendRequest).mockImplementation(async (method) => {
        if (method === 'file.readChunk') return { content: 'AAEC', bytesRead: 3, size: 3 };
        throw new Error(`Unexpected request: ${method}`);
      });
      const channel = stdChannel();
      const dispatch = dispatchMock.getMockImplementation()!;
      dispatchMock.mockImplementation((action) => {
        const result = dispatch(action);
        channel.put(action);
        return result;
      });
      const task = runSaga({ channel, dispatch: dispatchMock }, pdfPreviewSaga);
      try {
        const view = renderFileTab({
          ...fileTab,
          filePath: `/external/repo/new.${extension}`,
          data: { gitRootId: 'root-a', gitRootPath: '/external/repo' },
        });
        await waitFor(() =>
          expect(screen.getByTestId('file-viewer').getAttribute('data-source-url')).toBe(
            'blob:root-media',
          ),
        );
        expect(backendRequest).toHaveBeenCalledWith('file.readChunk', {
          workspaceId: 'ws-1',
          path: `new.${extension}`,
          gitRootId: 'root-a',
          offset: 0,
          length: 1048576,
        });
        expect(createUrl.mock.calls[0][0]).toMatchObject({ type: mimeType, size: 3 });
        expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
        view.unmount();
        expect(revokeUrl).toHaveBeenCalledWith('blob:root-media');
      } finally {
        cleanup();
        task.cancel();
        await task.toPromise();
        dispatchMock.mockImplementation(dispatch);
      }
    },
  );

  it('passes root-relative PDF identity to the bounded PDF viewer', async () => {
    renderFileTab({
      ...fileTab,
      filePath: '/external/repo/new.pdf',
      data: { gitRootId: 'root-a', gitRootPath: '/external/repo' },
    });
    const viewer = await screen.findByTestId('pdf-viewer');
    expect(viewer.getAttribute('data-file-path')).toBe('new.pdf');
    expect(viewer.getAttribute('data-git-root-id')).toBe('root-a');
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('keeps root-scoped code read-only and separate from a workspace draft at the same path', async () => {
    const path = '/repo/packages/a/new.ts';
    const key = fileContentKey(path, 'root-a');
    const entry = { loading: false, saving: false, error: null, isBinary: false, lastUpdated: 1 };
    mockReduxState.files[path] = {
      ...entry,
      originalContent: 'disk',
      localContent: 'workspace draft',
    };
    mockReduxState.files[key] = {
      ...entry,
      originalContent: 'root content',
      localContent: 'root content',
    };
    const view = renderFileTab({
      ...fileTab,
      filePath: path,
      data: { gitRootId: 'root-a', gitRootPath: '/repo/packages/a' },
    });
    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    expect(editor.value).toBe('root content');
    expect(editor.readOnly).toBe(true);
    await fireEvent.input(editor, { target: { value: 'attempted edit' } });
    await fireEvent.keyDown(window, { key: 's', ctrlKey: true, metaKey: true });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(
      screen.queryByRole('menuitem', { name: m.layout_fileTab_deleteFile_tooltip() }),
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: m.layout_fileTab_downloadFile_label() }),
    ).toBeNull();
    view.unmount();
    expect(actionMocks.updateFileContent).not.toHaveBeenCalled();
    expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    expect(actionMocks.deleteFileWithUndoRequested).not.toHaveBeenCalled();
    expect(mockReduxState.files[path].localContent).toBe('workspace draft');
  });

  it('does not allow a scoped file tab to escape the selected root', async () => {
    renderFileTab({
      ...fileTab,
      filePath: '/external/other/new.md',
      data: { gitRootId: 'root-a', gitRootPath: '/external/a' },
    });
    expect(await screen.findByText(m.layout_fileTab_outsideWorkspace_label())).toBeTruthy();
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
  });

  it('dispatches delete intent with the current draft and immutable workspace/tab identity', async () => {
    renderFileTab();
    const editor = await screen.findByTestId('code-editor');
    await fireEvent.input(editor, { target: { value: 'unsaved draft' } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.layout_fileTab_deleteFile_tooltip() }),
    );
    expect(actionMocks.deleteFileWithUndoRequested).toHaveBeenCalledWith('ws-1', 'src/main.ts', {
      absolutePath: '/repo/src/main.ts',
      tabId: 'tab-1',
      content: 'unsaved draft',
    });
  });

  it.each(['valid', 'invalid'] as const)(
    'preserves the %s binary snapshot in panel delete intent',
    async (kind) => {
      const content = kind === 'valid' ? '\b\u0001' : null;
      if (kind === 'valid') vi.mocked(backendRequest).mockResolvedValue(content);
      else
        vi.mocked(backendRequest).mockRejectedValue(
          new BackendError({
            code: 'INTERNAL_ERROR',
            rpcCode: -32603,
            message: 'Internal error',
            data: { detail: 'stream did not contain valid UTF-8' },
          }),
        );
      const stop = startFileReads();
      try {
        renderFileTab();
        await screen.findByText(m.editor_fileViewer_binary_label());
        await fireEvent.click(screen.getByRole('button', { name: 'Panel actions' }));
        await fireEvent.click(
          screen.getByRole('menuitem', { name: m.layout_fileTab_deleteFile_tooltip() }),
        );
        expect(actionMocks.deleteFileWithUndoRequested).toHaveBeenCalledWith(
          'ws-1',
          'src/main.ts',
          {
            absolutePath: '/repo/src/main.ts',
            tabId: 'tab-1',
            content,
          },
        );
      } finally {
        await stop();
      }
    },
  );

  it('flushes the old workspace and root when switching an edited tab to another workspace', async () => {
    const view = renderFileTab();
    await fireEvent.input(await screen.findByTestId('code-editor'), {
      target: { value: 'old workspace draft' },
    });
    mockReduxState.workspace = { id: 'ws-2', worktreePath: '/other', repositoryPath: '/other' };
    await view.rerender({
      tab: fileTab,
      workspaceId: 'ws-2',
      isActive: true,
      isPanelFocused: true,
    });
    expect(actionMocks.saveFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
      'old workspace draft',
    );
  });
  const directoryNode = (name: string): FileNode => ({ name, path: name, type: 'directory' });

  function mockIgnoredArtifacts() {
    return vi
      .spyOn(appClient.files, 'listDirectory')
      .mockImplementation(async (_workspaceId, path) => {
        if (path === '.demo-artifacts') {
          return [directoryNode('20260824T234627Z-frontend-preview')];
        }
        if (path === '.demo-artifacts/20260824T234627Z-frontend-preview') {
          return [
            fileNode('frontend-preview.png'),
            fileNode('frontend-preview.gif'),
            fileNode('frontend-preview.webm'),
          ];
        }
        return [];
      });
  }

  async function downloadFromMenu() {
    if (!screen.queryByRole('menuitem', { name: m.layout_fileTab_downloadFile_label() })) {
      await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    }
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.layout_fileTab_downloadFile_label() }),
    );
  }

  it.each([
    ['docs/Quarterly report #1.PDF', 'docs/Quarterly report #1.PDF', 'Quarterly report #1.PDF'],
    ['/repo/images/café.png', 'images/café.png', 'café.png'],
    ['src/main.ts', 'src/main.ts', 'main.ts'],
    ['archive.zip', 'archive.zip', 'archive.zip'],
  ])('downloads persisted %s through the workspace route', async (filePath, path, fileName) => {
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      data: { filePath: '/Downloads/' + fileName },
    });
    renderFileTab({ ...fileTab, filePath });
    if (filePath.endsWith('.png')) await screen.findByTestId('file-viewer');
    await downloadFromMenu();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
      workspaceId: 'ws-1',
      path,
      fileName,
    });
    expect(notify.error).not.toHaveBeenCalled();
  });

  it.each([
    '../secret.txt',
    '/repo-other/file.txt',
    '/repo/../secret.txt',
    '~/secret.txt',
    'dir//file.txt',
    'C:secret.txt',
    'bad\0.txt',
    '/repo',
  ])('rejects invalid download target %s', async (filePath) => {
    renderFileTab({ ...fileTab, filePath });
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    expect(
      screen.queryByRole('menuitem', { name: m.layout_fileTab_downloadFile_label() }),
    ).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps cancellation quiet and allows another download', async () => {
    vi.mocked(invoke).mockResolvedValue({ success: false, canceled: true });
    renderFileTab();
    await downloadFromMenu();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await downloadFromMenu();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('disables repeat requests while the native download is pending', async () => {
    let finish!: (result: unknown) => void;
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderFileTab();
    await downloadFromMenu();
    await downloadFromMenu();
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ success: false, canceled: true });
    await waitFor(() =>
      expect(
        screen
          .getByRole('menuitem', { name: m.layout_fileTab_downloadFile_label() })
          .getAttribute('aria-disabled'),
      ).not.toBe('true'),
    );
  });

  it('waits for a shortened media path to resolve before downloading', async () => {
    vi.mocked(backendRequest).mockImplementation(() => new Promise(() => {}));
    renderFileTab({ ...fileTab, filePath: 'preview.png' });
    await downloadFromMenu();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['response', 'rejection'])('shows a download error after an IPC %s', async (kind) => {
    if (kind === 'response')
      vi.mocked(invoke).mockResolvedValue({
        success: false,
        error: { code: 'DOWNLOAD_FAILED', message: 'Transfer failed for main.ts' },
      });
    else vi.mocked(invoke).mockRejectedValue(new Error('bridge unavailable'));
    renderFileTab();
    await downloadFromMenu();
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        kind === 'response'
          ? 'Transfer failed for main.ts'
          : m.layout_fileTab_downloadFailed_error(),
      ),
    );
  });

  it('groups editor presentation toggles into one view settings menu', async () => {
    renderFileTab();

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));

    expect(screen.queryByTestId('open-combo-button')).toBeNull();
    expect(
      screen
        .getByRole('menuitem', { name: m.layout_fileTab_deleteFile_tooltip() })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Wrap lines' })).toBeTruthy();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Diff indicators' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Wrap lines' }));
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'uiLayout/toggleLineWrapping',
      payload: [],
    });

    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Diff indicators' }));
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'uiLayout/toggleDiffIndicators',
      payload: [],
    });
  });

  it.each([
    ['src/main.js', 'main.js', 'javascript'],
    ['src/App.jsx', 'App.jsx', 'javascript'],
    ['src/main.ts', 'main.ts', 'typescript'],
    ['src/App.tsx', 'App.tsx', 'typescript'],
    ['src/config.json', 'config.json', 'json'],
    ['src/tsconfig.jsonc', 'tsconfig.jsonc', 'json'],
    ['src/styles.css', 'styles.css', 'css'],
    ['src/styles.scss', 'styles.scss', 'scss'],
    ['src/styles.less', 'styles.less', 'less'],
    ['public/index.html', 'index.html', 'html'],
    ['public/feed.xml', 'feed.xml', 'xml'],
    ['config/app.yaml', 'app.yaml', 'yaml'],
    ['scripts/setup.sh', 'setup.sh', 'bash'],
    ['notes/unknown.custom', 'unknown.custom', 'text'],
  ])(
    'passes %s to CodeEditor with expected editor language',
    async (filePath, title, expectedLanguage) => {
      mockReduxState.files[filePath] = {
        localContent: 'export const loaded = true;',
        originalContent: 'export const loaded = true;',
        loading: false,
        saving: false,
        error: null,
        isBinary: false,
        lastUpdated: 0,
      };

      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title, filePath });

      const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
      await waitFor(() => expect(editor.getAttribute('data-file-name')).toBe(filePath));
      expect(editor.getAttribute('data-language')).toBe(expectedLanguage);
    },
  );

  it('loads a relative file before the workspace root has hydrated', async () => {
    mockReduxState.workspace = {
      id: 'other-workspace',
      worktreePath: '/other-repo',
      repositoryPath: '/other-repo',
    };

    renderFileTab();

    await waitFor(() =>
      expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
        'ws-1',
        'src/main.ts',
        'src/main.ts',
      ),
    );
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/loadFileContentRequested',
      payload: ['ws-1', 'src/main.ts', 'src/main.ts'],
    });
  });

  it('renders markdown files in a read-only preview by default', async () => {
    mockReduxState.files['README.md'] = {
      localContent: '# Project',
      originalContent: '# Project',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({ ...fileTab, id: 'tab-readme', title: 'README.md', filePath: 'README.md' });

    const preview = await screen.findByTestId('markdown-viewer');
    expect(preview.textContent).toBe('# Project');
    expect(preview.getAttribute('data-workspace-id')).toBe('ws-1');
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(screen.queryByTestId('file-viewer')).toBeNull();

    dispatchMock.mockClear();
    await fireEvent.input(preview, { target: { textContent: '# Attempted preview edit' } });
    await fireEvent.keyDown(preview, { key: 'x' });
    await fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(actionMocks.updateFileContent).not.toHaveBeenCalled();
    expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/updateFileContent' }),
    );
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/saveFileContentRequested' }),
    );
    expect((await screen.findByTestId('header-state')).getAttribute('data-dirty')).toBe('false');
  });

  it('opens markdown line targets in the source editor', async () => {
    mockReduxState.files['README.md'] = {
      localContent: '# Project',
      originalContent: '# Project',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({
      ...fileTab,
      id: 'tab-readme',
      title: 'README.md',
      filePath: 'README.md',
      data: { line: 42, jumpTimestamp: 1 },
    });

    const editor = await screen.findByTestId('code-editor');
    expect(editor.getAttribute('data-jump-to-line')).toBe('42');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
  });

  it('switches an open markdown preview to source for a new jump request', async () => {
    mockReduxState.files['README.md'] = {
      localContent: '# Project',
      originalContent: '# Project',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };
    const markdownTab = {
      ...fileTab,
      id: 'tab-readme',
      title: 'README.md',
      filePath: 'README.md',
    };
    const view = renderFileTab(markdownTab);
    expect(await screen.findByTestId('markdown-viewer')).toBeTruthy();

    await view.rerender({
      tab: { ...markdownTab, data: { line: 17, jumpTimestamp: 2 } },
      workspaceId: 'ws-1',
      isActive: true,
      isPanelFocused: true,
    });

    const editor = await screen.findByTestId('code-editor');
    expect(editor.getAttribute('data-jump-to-line')).toBe('17');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
  });

  it('updates the read-only markdown preview for repeated external content while clean', async () => {
    mockReduxState.files['README.md'] = {
      localContent: '# Project',
      originalContent: '# Project',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({ ...fileTab, id: 'tab-readme', title: 'README.md', filePath: 'README.md' });

    const preview = await screen.findByTestId('markdown-viewer');
    await waitFor(() => expect(preview.textContent).toBe('# Project'));

    applyExternalFileContentToMockState('README.md', '# Project\n\nexternal marker');

    await waitFor(() => expect(preview.textContent).toBe('# Project\n\nexternal marker'));

    applyExternalFileContentToMockState('README.md', '# Project\n\nsecond external marker');

    await waitFor(() => expect(preview.textContent).toBe('# Project\n\nsecond external marker'));
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(actionMocks.updateFileContent).not.toHaveBeenCalled();
  });

  it('switches markdown preview off for editing and back on without preview updates', async () => {
    mockReduxState.files['README.md'] = {
      localContent: '# Project',
      originalContent: '# Project',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({ ...fileTab, id: 'tab-readme', title: 'README.md', filePath: 'README.md' });

    expect(await screen.findByTestId('markdown-viewer')).toBeTruthy();
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Markdown Preview' }));

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await fireEvent.input(editor, { target: { value: '# Local draft' } });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/updateFileContent',
      payload: ['ws-1', 'README.md', '# Local draft'],
    });

    await fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Markdown Preview' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('markdown-viewer').textContent).toBe('# Local draft'),
    );
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(actionMocks.updateFileContent).toHaveBeenCalledTimes(1);
  });

  it('keeps SVG files in FileViewer while preserving the XML language mapping', async () => {
    mockReduxState.files['public/icon.svg'] = {
      localContent: '<svg viewBox="0 0 1 1" />',
      originalContent: '<svg viewBox="0 0 1 1" />',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({ ...fileTab, id: 'tab-svg', title: 'icon.svg', filePath: 'public/icon.svg' });

    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer.getAttribute('data-file-path')).toBe('public/icon.svg');
    expect(viewer.getAttribute('data-language')).toBe('xml');
    expect(viewer.getAttribute('data-is-binary')).toBe('false');
    expect(screen.queryByTestId('code-editor')).toBeNull();
  });

  it.each(['docs/my report #1%.pdf', '/repo/docs/my report #1%.pdf'])(
    'passes the exact contained PDF path %s to its viewer',
    async (filePath) => {
      renderFileTab({ ...fileTab, filePath });
      const viewer = await screen.findByTestId('pdf-viewer');
      expect(viewer.getAttribute('data-workspace-id')).toBe('ws-1');
      expect(viewer.getAttribute('data-file-path')).toBe('docs/my report #1%.pdf');
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    },
  );

  it.each(['../secret.pdf', '/elsewhere/secret.pdf', 'docs/../secret.pdf'])(
    'does not read a PDF outside the workspace: %s',
    async (filePath) => {
      renderFileTab({ ...fileTab, filePath });
      await waitFor(() => expect(screen.queryByTestId('pdf-viewer')).toBeNull());
      expect(backendRequest).not.toHaveBeenCalled();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    },
  );

  it('defers inactive PDFs and releases their viewer when switching tabs', async () => {
    const tab = { ...fileTab, filePath: 'report.pdf' };
    const view = render(FileTabTypeHarness, { tab, workspaceId: 'ws-1', isActive: false });
    expect(backendRequest).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-viewer')).toBeNull();
    await view.rerender({ tab, workspaceId: 'ws-1', isActive: true });
    await screen.findByTestId('pdf-viewer');
    await view.rerender({ tab, workspaceId: 'ws-1', isActive: false });
    expect(screen.queryByTestId('pdf-viewer')).toBeNull();
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
  });

  it('opens a binary PDF without dispatching the UTF-8 reader', async () => {
    renderFileTab({ ...fileTab, id: 'tab-pdf', title: 'report.PDF', filePath: 'docs/report.PDF' });
    await waitFor(() => expect(screen.queryByTestId('code-editor')).toBeNull());
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    expect(await screen.findByTestId('pdf-viewer')).toBeTruthy();
  });

  it('keeps allowlisted binary images in FileViewer without a text read', async () => {
    mockReduxState.files['assets/logo.png'] = {
      localContent: '',
      originalContent: '',
      loading: false,
      saving: false,
      error: null,
      isBinary: true,
      lastUpdated: 0,
    };

    renderFileTab({ ...fileTab, id: 'tab-png', title: 'logo.png', filePath: 'assets/logo.png' });

    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer.getAttribute('data-file-path')).toBe('assets/logo.png');
    expect(viewer.getAttribute('data-source-url')).toBe('workspace-file://ws-1/assets/logo.png');
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    expect(screen.queryByTestId('code-editor')).toBeNull();
  });

  it.each([
    [
      '20260824T234627Z-frontend-preview/frontend-preview.png',
      '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.png',
    ],
    [
      'frontend-preview.webm',
      '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.webm',
    ],
    [
      'frontend-preview.gif',
      '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.gif',
    ],
  ])(
    'retargets noncanonical media %s before rendering its final binary URL',
    async (requestedPath, resolvedPath) => {
      const list = mockIgnoredArtifacts();
      vi.mocked(backendRequest).mockImplementation(async (method, params) => {
        if (method === 'file.stat') {
          if ((params as { path: string }).path === resolvedPath) return { isFile: true };
          throw new Error('not found');
        }
        return { files: [] };
      });
      const tab = {
        ...fileTab,
        id: `tab-${requestedPath}`,
        title: requestedPath,
        filePath: requestedPath,
      };
      const view = renderFileTab(tab);

      await waitFor(() =>
        expect(actionMocks.updateFileTabPath).toHaveBeenCalledWith(
          'ws-1',
          requestedPath,
          resolvedPath,
          tab.id,
        ),
      );
      expect(screen.queryByTestId('file-viewer')).toBeNull();

      await view.rerender({
        tab: { ...tab, title: resolvedPath.split('/').pop(), filePath: resolvedPath },
        workspaceId: 'ws-1',
        isActive: true,
        isPanelFocused: true,
      });

      const viewer = await screen.findByTestId('file-viewer');
      expect(viewer.getAttribute('data-file-path')).toBe(resolvedPath);
      expect(viewer.getAttribute('data-source-url')).toBe(`workspace-file://ws-1/${resolvedPath}`);
      vi.mocked(invoke).mockResolvedValue({ success: true });
      await downloadFromMenu();
      expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
        workspaceId: 'ws-1',
        path: resolvedPath,
        fileName: resolvedPath.split('/').pop(),
      });
      expect(actionMocks.updateFileTabPath).toHaveBeenCalledTimes(1);
      expect(list.mock.calls.every(([workspaceId]) => workspaceId === 'ws-1')).toBe(true);
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    },
  );

  it('preserves an exact root-level media file without suffix retargeting', async () => {
    const list = vi.spyOn(appClient.files, 'listDirectory');
    renderFileTab({ ...fileTab, id: 'tab-root-png', title: 'logo.png', filePath: 'logo.png' });

    expect((await screen.findByTestId('file-viewer')).getAttribute('data-source-url')).toBe(
      'workspace-file://ws-1/logo.png',
    );
    expect(backendRequest).toHaveBeenCalledWith('file.stat', {
      workspaceId: 'ws-1',
      path: 'logo.png',
    });
    expect(list).not.toHaveBeenCalled();
    expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
  });

  it.each(['../preview.png', 'src/../../preview.webm'])(
    'does not resolve or text-read traversal media path %s',
    async (filePath) => {
      const list = vi.spyOn(appClient.files, 'listDirectory');
      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title: filePath, filePath });

      expect(await screen.findByText(m.layout_fileTab_preparing_label())).toBeTruthy();
      expect(backendRequest).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
      expect(screen.queryByTestId('file-viewer')).toBeNull();
    },
  );

  it.each(['missing', 'ambiguous', 'truncated'])(
    'does not retarget a %s media resolution result',
    async (outcome) => {
      vi.mocked(backendRequest).mockRejectedValue(new Error('not found'));
      vi.spyOn(appClient.files, 'listDirectory').mockImplementation(async (_workspaceId, path) => {
        if (outcome === 'missing') return [];
        if (outcome === 'truncated' && path === '.demo-artifacts') {
          return Array.from({ length: 257 }, (_, index) => fileNode(`capture-${index}.png`));
        }
        if (path === '.demo-artifacts') return [directoryNode('one'), directoryNode('two')];
        if (path === '.demo-artifacts/one' || path === '.demo-artifacts/two') {
          return [fileNode('preview.png')];
        }
        return [];
      });

      renderFileTab({
        ...fileTab,
        id: `tab-${outcome}`,
        title: 'preview.png',
        filePath: 'preview.png',
      });

      expect((await screen.findByTestId('file-viewer')).getAttribute('data-source-url')).toBe(
        'workspace-file://ws-1/preview.png',
      );
      expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
    },
  );

  it('ignores a late exact-path result after the media tab changes', async () => {
    let finishOldStat!: () => void;
    vi.mocked(backendRequest).mockImplementation(async (method, params) => {
      const path = (params as { path: string }).path;
      if (method === 'file.stat' && path === 'old.png') {
        await new Promise<void>((resolve) => {
          finishOldStat = resolve;
        });
        throw new Error('not found');
      }
      return { isFile: true };
    });
    const view = renderFileTab({
      ...fileTab,
      id: 'tab-race',
      title: 'old.png',
      filePath: 'old.png',
    });
    await waitFor(() => expect(finishOldStat).toBeTypeOf('function'));

    await view.rerender({
      tab: { ...fileTab, id: 'tab-race', title: 'current.webm', filePath: 'current.webm' },
      workspaceId: 'ws-2',
      isActive: true,
      isPanelFocused: true,
    });
    finishOldStat();

    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer.getAttribute('data-source-url')).toBe('workspace-file://ws-2/current.webm');
    expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
  });

  it.each([
    [
      '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.png',
      'workspace-file://ws-1/.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.png',
    ],
    ['artifacts/my clip.webp', 'workspace-file://ws-1/artifacts/my%20clip.webp'],
    ['.demo-artifacts/run/preview.mp4', 'workspace-file://ws-1/.demo-artifacts/run/preview.mp4'],
    [
      '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.webm',
      'workspace-file://ws-1/.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.webm',
    ],
  ])(
    'renders trusted workspace media %s without a UTF-8 file.read',
    async (filePath, sourceUrl) => {
      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title: filePath, filePath });

      const viewer = await screen.findByTestId('file-viewer');
      expect(viewer.getAttribute('data-source-url')).toBe(sourceUrl);
      expect(actionMocks.updateFileTabPath).not.toHaveBeenCalled();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'files/loadFileContentRequested' }),
      );
      expect(screen.queryByTestId('code-editor')).toBeNull();
    },
  );

  it('routes an absolute in-workspace video through its workspace-relative media URL', async () => {
    renderFileTab({
      ...fileTab,
      id: 'tab-absolute-video',
      title: 'preview.webm',
      filePath: '/repo/.demo-artifacts/run/preview.webm',
    });

    const viewer = await screen.findByTestId('file-viewer');
    expect(viewer.getAttribute('data-source-url')).toBe(
      'workspace-file://ws-1/.demo-artifacts/run/preview.webm',
    );
    expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
  });

  it('does not route unsupported media extensions through workspace-file', async () => {
    renderFileTab({
      ...fileTab,
      id: 'tab-unsupported-video',
      title: 'preview.mov',
      filePath: 'artifacts/preview.mov',
    });

    await waitFor(() =>
      expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
        'ws-1',
        'artifacts/preview.mov',
        '/repo/artifacts/preview.mov',
      ),
    );
    expect(screen.queryByTestId('file-viewer')).toBeNull();
  });

  it('renders Redux file content, dispatches edits, and saves current content', async () => {
    renderFileTab();

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('console.log("loaded");'));

    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
    );
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/loadFileContentRequested',
      payload: ['ws-1', 'src/main.ts', '/repo/src/main.ts'],
    });

    dispatchMock.mockClear();

    await fireEvent.input(editor, { target: { value: 'console.log("edited");' } });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/updateFileContent',
      payload: ['ws-1', 'src/main.ts', 'console.log("edited");'],
    });

    const headerState = await screen.findByTestId('header-state');
    await waitFor(() => expect(headerState.getAttribute('data-dirty')).toBe('true'));

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    const saveStatus = await screen.findByRole('menuitem', {
      name: m.ui_saveIndicator_autoSaving_tooltip(),
    });
    expect(saveStatus.getAttribute('aria-disabled')).toBe('true');

    dispatchMock.mockClear();
    await fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/saveFileContentRequested',
      payload: ['ws-1', 'src/main.ts', '/repo/src/main.ts', 'console.log("edited");'],
    });
  });

  it('updates the visible open editor when external content is applied while clean', async () => {
    renderFileTab();

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('console.log("loaded");'));

    applyExternalFileContentToMockState('src/main.ts', 'console.log("external");');

    await waitFor(() => expect(editor.value).toBe('console.log("external");'));
    expect(editor.getAttribute('data-external-content-version')).toBe('1');
  });

  it('keeps local dirty editor content when external content is applied', async () => {
    renderFileTab();

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await fireEvent.input(editor, { target: { value: 'console.log("local draft");' } });

    applyExternalFileContentToMockState('src/main.ts', 'console.log("external");');

    await waitFor(() => expect(editor.value).toBe('console.log("local draft");'));
    expect(mockReduxState.files['src/main.ts']).toMatchObject({
      localContent: 'console.log("local draft");',
      originalContent: 'console.log("external");',
    });
  });

  it('reflects dirty and saving Redux selector state in the save UI and header state', async () => {
    mockReduxState.files['src/main.ts'] = {
      ...mockReduxState.files['src/main.ts'],
      localContent: 'console.log("dirty");',
      saving: true,
    };

    renderFileTab();

    const headerState = await screen.findByTestId('header-state');
    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));
    const saveStatus = await screen.findByRole('menuitem', {
      name: m.ui_saveIndicator_saving_tooltip(),
    });

    await waitFor(() => {
      expect(saveStatus.getAttribute('aria-disabled')).toBe('true');
      expect(headerState.getAttribute('data-dirty')).toBe('true');
      expect(headerState.getAttribute('data-saving')).toBe('true');
    });
  });

  // Out-of-workspace handling: absolute paths outside the workspace root
  // (worktreePath || repositoryPath = '/repo') render a dedicated warning
  // instead of dispatching loadFileContentRequested (the file.read trigger).
  it.each([
    ['/Users/dev/.claude/projects/memory/MEMORY.md'],
    // Sibling directory sharing the root as a name prefix must NOT count as inside.
    ['/repository/src/main.ts'],
  ])(
    'renders the warning and requests no read for out-of-workspace absolute path %s',
    async (filePath) => {
      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title: 'outside', filePath });

      expect(await screen.findByText(m.layout_fileTab_outsideWorkspace_label())).toBeTruthy();
      expect(screen.getByText(filePath)).toBeTruthy();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'files/loadFileContentRequested' }),
      );
      expect(screen.queryByTestId('code-editor')).toBeNull();
      expect(screen.queryByTestId('markdown-file-editor')).toBeNull();
      expect(screen.queryByTestId('save-indicator')).toBeNull();
    },
  );

  it('loads absolute paths under the workspace root normally', async () => {
    mockReduxState.files['/repo/src/inside.ts'] = {
      localContent: 'export const inside = true;',
      originalContent: 'export const inside = true;',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({
      ...fileTab,
      id: 'tab-inside-abs',
      title: 'inside.ts',
      filePath: '/repo/src/inside.ts',
    });

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('export const inside = true;'));
    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      '/repo/src/inside.ts',
      '/repo/src/inside.ts',
    );
    expect(screen.queryByText(m.layout_fileTab_outsideWorkspace_label())).toBeNull();
  });

  it('loads slash-form UNC paths under a UNC root normally despite casing differences', async () => {
    mockReduxState.workspace = {
      id: 'ws-1',
      worktreePath: '//Server/Share/repo',
      repositoryPath: '//Server/Share/repo',
    };
    mockReduxState.files['//server/share/repo/src/main.ts'] = {
      localContent: 'export const unc = true;',
      originalContent: 'export const unc = true;',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({
      ...fileTab,
      id: 'tab-unc',
      title: 'main.ts',
      filePath: '//server/share/repo/src/main.ts',
    });

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('export const unc = true;'));
    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      '//server/share/repo/src/main.ts',
      '//server/share/repo/src/main.ts',
    );
    expect(screen.queryByText(m.layout_fileTab_outsideWorkspace_label())).toBeNull();
  });

  it('loads Windows-absolute in-root paths at their exact path without double-joining', async () => {
    mockReduxState.workspace = {
      id: 'ws-1',
      worktreePath: 'C:/repo',
      repositoryPath: 'C:/repo',
    };
    mockReduxState.files['C:/repo/src/x.ts'] = {
      localContent: 'export const win = true;',
      originalContent: 'export const win = true;',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({
      ...fileTab,
      id: 'tab-win-abs',
      title: 'x.ts',
      filePath: 'C:/repo/src/x.ts',
    });

    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('export const win = true;'));
    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      'C:/repo/src/x.ts',
      'C:/repo/src/x.ts',
    );
    expect(screen.queryByText(m.layout_fileTab_outsideWorkspace_label())).toBeNull();
  });

  it.each([
    // Different drive, and a drive-letter sibling sharing the root name prefix.
    ['D:/other/x.ts'],
    ['C:/repository/src/x.ts'],
  ])(
    'renders the warning and requests no read for out-of-root Windows-absolute path %s',
    async (filePath) => {
      mockReduxState.workspace = {
        id: 'ws-1',
        worktreePath: 'C:/repo',
        repositoryPath: 'C:/repo',
      };

      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title: 'outside', filePath });

      expect(await screen.findByText(m.layout_fileTab_outsideWorkspace_label())).toBeTruthy();
      expect(screen.getByText(filePath)).toBeTruthy();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
      expect(screen.queryByTestId('code-editor')).toBeNull();
    },
  );

  it('loads a tilde-prefixed filename in the workspace root as an ordinary file', async () => {
    mockReduxState.files['~$report.docx'] = {
      localContent: 'lock',
      originalContent: 'lock',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
      lastUpdated: 0,
    };

    renderFileTab({
      ...fileTab,
      id: 'tab-lockfile',
      title: '~$report.docx',
      filePath: '~$report.docx',
    });

    await screen.findByTestId('code-editor');
    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      '~$report.docx',
      '/repo/~$report.docx',
    );
    expect(screen.queryByText(m.layout_fileTab_outsideWorkspace_label())).toBeNull();
  });

  // Tilde paths cannot be expanded in the renderer (no Node APIs), so they are
  // classified as out-of-workspace and never dispatched as a doomed file.read.
  it.each([['~/.claude/projects/memory/MEMORY.md'], ['~\\notes\\scratch.md'], ['~']])(
    'renders the warning and requests no read for tilde path %s',
    async (filePath) => {
      renderFileTab({ ...fileTab, id: `tab-${filePath}`, title: 'tilde', filePath });

      expect(await screen.findByText(m.layout_fileTab_outsideWorkspace_label())).toBeTruthy();
      expect(screen.getByText(filePath)).toBeTruthy();
      expect(actionMocks.loadFileContentRequested).not.toHaveBeenCalled();
      expect(dispatchMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'files/loadFileContentRequested' }),
      );
      expect(screen.queryByTestId('code-editor')).toBeNull();
      expect(screen.queryByTestId('markdown-file-editor')).toBeNull();
      expect(screen.queryByTestId('save-indicator')).toBeNull();
    },
  );

  it('loads relative paths normally with no out-of-workspace warning', async () => {
    renderFileTab();

    await screen.findByTestId('code-editor');
    expect(actionMocks.loadFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
    );
    expect(screen.queryByText(m.layout_fileTab_outsideWorkspace_label())).toBeNull();
  });

  // Not-found error panel: always shows the attempted relative path; when the
  // read saga recorded suffix-resolution candidates, renders a clickable
  // "Did you mean" list that retargets the tab to the chosen candidate.
  function errorFileEntry(overrides: Partial<(typeof mockReduxState.files)[string]> = {}) {
    return {
      localContent: null,
      originalContent: null,
      loading: false,
      saving: false,
      error: 'File not found',
      isBinary: false,
      lastUpdated: 0,
      notFoundCandidates: [] as string[],
      ...overrides,
    };
  }

  it('shows the attempted path without candidates when suffix resolution found none', async () => {
    mockReduxState.files['src/app.ts'] = errorFileEntry();

    renderFileTab({ ...fileTab, id: 'tab-err', title: 'app.ts', filePath: 'src/app.ts' });

    expect(await screen.findByText(m.layout_fileTab_errorLoading_label())).toBeTruthy();
    expect(screen.getByText('File not found')).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.queryByText(m.layout_fileTab_didYouMean_label())).toBeNull();
    expect(screen.queryByRole('button', { name: /src\// })).toBeNull();
  });

  it('renders clickable candidates and retargets the tab on click', async () => {
    const candidates = ['packages/a/src/app.ts', 'packages/b/src/app.ts'];
    mockReduxState.files['src/app.ts'] = errorFileEntry({ notFoundCandidates: candidates });

    renderFileTab({ ...fileTab, id: 'tab-err', title: 'app.ts', filePath: 'src/app.ts' });

    expect(await screen.findByText(m.layout_fileTab_didYouMean_label())).toBeTruthy();
    expect(screen.getByText('src/app.ts')).toBeTruthy();

    const candidateButton = screen.getByRole('button', { name: 'packages/b/src/app.ts' });
    dispatchMock.mockClear();
    await fireEvent.click(candidateButton);

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/removeFileContentEntry',
      payload: ['ws-1', 'src/app.ts'],
    });
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'panelLayout/updateFileTabPath',
      payload: ['ws-1', 'src/app.ts', 'packages/b/src/app.ts', 'tab-err'],
    });
  });

  it('caps the rendered candidate list at five entries', async () => {
    const candidates = [1, 2, 3, 4, 5, 6, 7].map((i) => `packages/p${i}/src/app.ts`);
    mockReduxState.files['src/app.ts'] = errorFileEntry({ notFoundCandidates: candidates });

    renderFileTab({ ...fileTab, id: 'tab-err', title: 'app.ts', filePath: 'src/app.ts' });

    await screen.findByText(m.layout_fileTab_didYouMean_label());
    expect(screen.getAllByRole('button', { name: /packages\/p[0-9]+\/src\/app\.ts/ })).toHaveLength(
      5,
    );
    expect(screen.getByRole('button', { name: 'packages/p5/src/app.ts' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'packages/p6/src/app.ts' })).toBeNull();
  });

  it('leaves auto-save scheduling to filesWriteSaga instead of a local debounce', async () => {
    renderFileTab();
    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('console.log("loaded");'));

    vi.useFakeTimers();
    try {
      dispatchMock.mockClear();
      await fireEvent.input(editor, { target: { value: 'console.log("edited");' } });
      expect(actionMocks.updateFileContent).toHaveBeenCalledWith(
        'ws-1',
        'src/main.ts',
        'console.log("edited");',
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending dirty edit through the write saga when the tab unmounts', async () => {
    const { unmount } = renderFileTab();
    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('console.log("loaded");'));

    await fireEvent.input(editor, { target: { value: 'console.log("edited");' } });
    expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    dispatchMock.mockClear();

    unmount();

    const saveDispatches = dispatchMock.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'files/saveFileContentRequested');
    expect(saveDispatches).toEqual([
      {
        type: 'files/saveFileContentRequested',
        payload: ['ws-1', 'src/main.ts', '/repo/src/main.ts', 'console.log("edited");'],
      },
    ]);
  });

  it.each(['\b\u0001', null])(
    'does not flush a draft after a binary reread (%s)',
    async (content) => {
      vi.mocked(backendRequest).mockResolvedValue('ordinary text');
      const stop = startFileReads();
      try {
        const view = renderFileTab();
        const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
        await waitFor(() => expect(editor.value).toBe('ordinary text'));
        await fireEvent.input(editor, { target: { value: 'unsaved draft' } });
        if (content === null)
          vi.mocked(backendRequest).mockRejectedValue(
            new BackendError({
              code: 'INTERNAL_ERROR',
              rpcCode: -32603,
              message: 'Internal error',
              data: { detail: 'stream did not contain valid UTF-8' },
            }),
          );
        else vi.mocked(backendRequest).mockResolvedValue(content);
        dispatchMock(
          actionMocks.loadFileContentRequested('ws-1', 'src/main.ts', '/repo/src/main.ts'),
        );
        await screen.findByText(m.editor_fileViewer_binary_label());
        expect(screen.queryByTestId('code-editor')).toBeNull();
        await fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        view.unmount();
        expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
      } finally {
        await stop();
      }
    },
  );

  it('does not issue a save when a clean tab unmounts', async () => {
    const { unmount } = renderFileTab();
    const editor = await screen.findByTestId<HTMLTextAreaElement>('code-editor');
    await waitFor(() => expect(editor.value).toBe('console.log("loaded");'));

    dispatchMock.mockClear();
    unmount();

    expect(actionMocks.saveFileContentRequested).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'files/saveFileContentRequested' }),
    );
  });
});
