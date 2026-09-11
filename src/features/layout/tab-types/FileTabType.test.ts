import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { m } from '$shared/paraglide/messages.js';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { FileNode } from '$shared/types';

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
    saveFileContentRequested: makeAction('files/saveFileContentRequested'),
    updateFileContent: makeAction('files/updateFileContent'),
    removeFileContentEntry: makeAction('files/removeFileContentEntry'),
    updateFileTabPath: makeAction('panelLayout/updateFileTabPath'),
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

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: dispatchMock,
  });
});

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
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
  selectFileNotFoundCandidates: createMockSelector(
    (_wsId: string, path: string | null | undefined) =>
      path ? (mockReduxState.files[path]?.notFoundCandidates ?? null) : null,
  ),
}));

vi.mock('$store/renderer/slices/files/files-slice', () => actionMocks);

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

vi.mock('$lib/components/ui/SaveIndicator.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockSaveIndicator.svelte')).default,
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

  it('groups editor presentation toggles into one view settings menu', async () => {
    renderFileTab();

    await fireEvent.click(await screen.findByRole('button', { name: 'Panel actions' }));

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
});

describe('FileTabType content-save wiring', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/features/layout/tab-types/FileTabType.svelte'),
    'utf-8',
  );

  it('delegates debounce and teardown flush ownership to filesWriteSaga', () => {
    expect(source).not.toContain('AUTO_SAVE_DELAY_MS');
    expect(source).not.toContain('autoSaveTimeoutId');
    expect(source).not.toContain("from '$features/files/files-write-service'");
    expect(source).toContain(
      'appStore.dispatch(updateFileContent(workspaceId, tab.filePath, content))',
    );
    expect(source).toContain('saveFileContentRequested(wsId, filePath, absolutePath, content)');
  });
});
