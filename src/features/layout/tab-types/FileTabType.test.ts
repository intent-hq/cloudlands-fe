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
import type { PanelTab } from '$lib/store/slices/panel-layout/panel-layout-types';

const {
  actionMocks,
  createMockSelector,
  dispatchMock,
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
      },
    };
    mockReduxState.fileTrackingChanges = [];
    mockReduxState.lineWrapping = true;
    mockReduxState.diffIndicators = false;
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
    createMockSelector,
    dispatchMock,
    mockReduxState,
    resetMockReduxState,
  };
});

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  dispatch: dispatchMock,
  getReduxStore: () => ({
    getState: () => ({}),
    dispatch: dispatchMock,
  }),
}));

vi.mock('$lib/store/slices/files/files-selectors', () => ({
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
}));

vi.mock('$lib/store/slices/files/files-slice', () => actionMocks);

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: createMockSelector((wsId: string) =>
    wsId === mockReduxState.workspace.id ? mockReduxState.workspace : undefined,
  ),
}));

vi.mock('$lib/store/slices/changes/changes-selectors', () => ({
  selectFileTrackingChanges: createMockSelector(() => mockReduxState.fileTrackingChanges),
}));

vi.mock('$lib/store/slices/ui-layout/ui-layout-selectors', () => ({
  selectLineWrapping: createMockSelector(() => mockReduxState.lineWrapping),
  selectDiffIndicators: createMockSelector(() => mockReduxState.diffIndicators),
}));

vi.mock('$lib/store/slices/ui-layout/ui-layout-slice', () => ({
  toggleLineWrapping: () => ({ type: 'uiLayout/toggleLineWrapping', payload: [] }),
  toggleDiffIndicators: () => ({ type: 'uiLayout/toggleDiffIndicators', payload: [] }),
}));

vi.mock('$lib/store/slices/panel-layout/panel-layout-slice', () => ({
  closeTab: (workspaceId: string, tabId: string) => ({
    type: 'panelLayout/closeTab',
    payload: [workspaceId, tabId],
  }),
}));

vi.mock('$lib/store/slices/workspace-navigation/workspace-navigation-slice', () => ({
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
    };

    renderFileTab({ ...fileTab, id: 'tab-readme', title: 'README.md', filePath: 'README.md' });

    expect(await screen.findByTestId('markdown-file-editor')).toBeTruthy();
    expect(screen.queryByTestId('code-editor')).toBeNull();
    expect(screen.queryByTestId('file-viewer')).toBeNull();
  });

  it('keeps SVG files in FileViewer while preserving the XML language mapping', async () => {
    mockReduxState.files['public/icon.svg'] = {
      localContent: '<svg viewBox="0 0 1 1" />',
      originalContent: '<svg viewBox="0 0 1 1" />',
      loading: false,
      saving: false,
      error: null,
      isBinary: false,
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
    actionMocks.updateFileContent.mockClear();
    actionMocks.saveFileContentRequested.mockClear();

    await fireEvent.input(editor, { target: { value: 'console.log("edited");' } });

    expect(actionMocks.updateFileContent).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      'console.log("edited");',
    );
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/updateFileContent',
      payload: ['ws-1', 'src/main.ts', 'console.log("edited");'],
    });

    const saveIndicator = await screen.findByTestId('save-indicator');
    await waitFor(() => expect(saveIndicator.getAttribute('data-dirty')).toBe('true'));

    await fireEvent.click(saveIndicator);

    expect(actionMocks.saveFileContentRequested).toHaveBeenCalledWith(
      'ws-1',
      'src/main.ts',
      '/repo/src/main.ts',
      'console.log("edited");',
    );
    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'files/saveFileContentRequested',
      payload: ['ws-1', 'src/main.ts', '/repo/src/main.ts', 'console.log("edited");'],
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
});

describe('FileTabType auto-save debounce', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/layout/tab-types/FileTabType.svelte'),
    'utf-8',
  );

  it('tracks file content in the auto-save effect so each edit resets the debounce', () => {
    const autoSaveStart = source.indexOf('// Auto-save with debounce');
    const loadFileStart = source.indexOf('// Load file when path changes');
    const autoSaveBlock = source.slice(autoSaveStart, loadFileStart);

    expect(autoSaveBlock).toContain('const currentFileContent = fileContent;');
    expect(autoSaveBlock.indexOf('const currentFileContent = fileContent;')).toBeLessThan(
      autoSaveBlock.indexOf('if (isFileDirty'),
    );
    expect(autoSaveBlock).toContain('clearTimeout(autoSaveTimeoutId)');
    expect(autoSaveBlock).toContain('setTimeout(() => saveFileContent(), AUTO_SAVE_DELAY_MS)');
  });
});
