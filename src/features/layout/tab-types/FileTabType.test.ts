import { readFileSync } from 'fs';
import { join } from 'path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { m } from '$shared/paraglide/messages.js';

const {
  actionMocks,
  writeFileServiceMocks,
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
  };

  type ActiveSelector = { update: () => void };
  const activeSelectors: ActiveSelector[] = [];

  const mockReduxState = {
    workspace: {
      id: 'ws-1',
      worktreePath: '/repo',
      repositoryPath: '/repo',
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
  };

  // The component now delegates content saves to the files-write-service (which
  // owns the debounce + AppClient seam call). The service is mocked here; its
  // optimistic local update is simulated so the editor binding + dirty UI still
  // reflect edits without touching the real store/seam.
  const writeFileServiceMocks = {
    writeFileContent: vi.fn(
      (_wsId: string, path: string, _absolutePath: string, content: string) => {
        const entry = mockReduxState.files[path];
        if (entry) {
          mockReduxState.files[path] = { ...entry, localContent: content };
          flushMockSelectors();
        }
      },
    ),
    flushFileContent: vi.fn(),
  };

  const dispatchMock = vi.fn((action: { type: string; payload?: unknown[] }) => {
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
    writeFileServiceMocks,
    applyExternalFileContentToMockState,
    createMockSelector,
    dispatchMock,
    mockReduxState,
    resetMockReduxState,
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

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
}));

vi.mock('$store/renderer/slices/files/files-slice', () => actionMocks);

vi.mock('$features/files/files-write-service', () => writeFileServiceMocks);

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

vi.mock('$lib/components/editor/MarkdownFileEditor.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockMarkdownFileEditor.svelte')).default,
}));

vi.mock('$lib/components/editor/FileViewer.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockFileViewer.svelte')).default,
}));

vi.mock('$lib/components/ui/SaveIndicator.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockSaveIndicator.svelte')).default,
}));

vi.mock('$lib/components/ui/OpenComboButton.svelte', async () => ({
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
  });

  afterEach(() => {
    cleanup();
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

  it('keeps markdown files in the markdown preview instead of CodeEditor by default', async () => {
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

    expect(await screen.findByTestId('markdown-file-editor')).toBeTruthy();
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(screen.queryByTestId('file-viewer')).toBeNull();
  });

  it('updates the visible markdown editor for repeated external content while clean', async () => {
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

    const editor = await screen.findByTestId<HTMLTextAreaElement>('markdown-file-editor');
    await waitFor(() => expect(editor.value).toBe('# Project'));

    applyExternalFileContentToMockState('README.md', '# Project\n\nexternal marker');

    await waitFor(() => expect(editor.value).toBe('# Project\n\nexternal marker'));
    expect(editor.getAttribute('data-external-content-version')).toBe('1');

    applyExternalFileContentToMockState('README.md', '# Project\n\nsecond external marker');

    await waitFor(() => expect(editor.value).toBe('# Project\n\nsecond external marker'));
    expect(editor.getAttribute('data-external-content-version')).toBe('2');
    expect(screen.queryByTestId('code-editor')).toBeNull();
  });

  it('keeps local dirty markdown editor content when external content is applied', async () => {
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

    const editor = await screen.findByTestId<HTMLTextAreaElement>('markdown-file-editor');
    await fireEvent.input(editor, { target: { value: '# Local draft' } });

    applyExternalFileContentToMockState('README.md', '# External marker');

    await waitFor(() => expect(editor.value).toBe('# Local draft'));
    expect(mockReduxState.files['README.md']).toMatchObject({
      localContent: '# Local draft',
      originalContent: '# External marker',
      lastUpdated: 1,
    });
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

  it('keeps binary files in FileViewer instead of CodeEditor', async () => {
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
    expect(viewer.getAttribute('data-is-binary')).toBe('true');
    expect(screen.queryByTestId('code-editor')).toBeNull();
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
    writeFileServiceMocks.writeFileContent.mockClear();

    await fireEvent.input(editor, { target: { value: 'console.log("edited");' } });

    // Editing routes through the files-write-service (debounced content write).
    expect(writeFileServiceMocks.writeFileContent).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
      'console.log("edited");',
    );

    const saveIndicator = await screen.findByTestId('save-indicator');
    await waitFor(() => expect(saveIndicator.getAttribute('data-dirty')).toBe('true'));

    writeFileServiceMocks.writeFileContent.mockClear();
    await fireEvent.click(saveIndicator);

    // Manual save flushes immediately through the same service entry point.
    expect(writeFileServiceMocks.writeFileContent).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
      'console.log("edited");',
      { immediate: true },
    );
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

    const saveIndicator = await screen.findByTestId('save-indicator');
    const headerState = await screen.findByTestId('header-state');

    await waitFor(() => {
      expect(saveIndicator.getAttribute('data-dirty')).toBe('true');
      expect(saveIndicator.getAttribute('data-saving')).toBe('true');
      expect(saveIndicator.getAttribute('data-auto-saving')).toBe('false');
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
});

describe('FileTabType content-save wiring', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/layout/tab-types/FileTabType.svelte'),
    'utf-8',
  );

  it('delegates the debounce to the files-write-service and flushes on teardown', () => {
    // The component no longer hand-rolls a setTimeout auto-save; the debounce is
    // owned by the files-write-service (keyed by ws::path). The component routes
    // edits + manual saves through writeFileContent and flushes any pending save
    // when the file/workspace changes or the tab unmounts.
    expect(source).not.toContain('AUTO_SAVE_DELAY_MS');
    expect(source).not.toContain('autoSaveTimeoutId');
    expect(source).toContain(
      'writeFileContent(workspaceId, tab.filePath, fileAbsolutePath, content)',
    );
    expect(source).toContain(
      'writeFileContent(workspaceId, tab.filePath, fileAbsolutePath, fileContent, { immediate: true })',
    );
    expect(source).toContain('flushFileContent(wsId, filePath)');
  });
});
