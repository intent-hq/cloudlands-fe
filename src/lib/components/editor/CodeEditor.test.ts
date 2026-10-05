// @vitest-environment jsdom

import { cleanup as cleanupDom, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get, writable, type Readable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type FakeEditor = {
    getValue: () => string;
    setValue: ReturnType<typeof vi.fn>;
    getPosition: () => null;
    setPosition: ReturnType<typeof vi.fn>;
    getModel: () => null;
    hasTextFocus: () => boolean;
    onDidChangeModelContent: ReturnType<typeof vi.fn>;
    onDidChangeCursorSelection: ReturnType<typeof vi.fn>;
    deltaDecorations: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  const editors: FakeEditor[] = [];
  const invoke = vi.fn(async () => undefined);
  const selectWorkspaceById = vi.fn();
  const state = {
    isFollowing: false,
    hostLocal: true,
    routeWorkspaceId: undefined as string | undefined,
    workspaces: {} as Record<string, { worktreePath?: string; repositoryPath?: string }>,
  };
  return { editors, invoke, selectWorkspaceById, state };
});

vi.mock('$lib/utils/monaco-workers', () => {
  const create = (_container: HTMLElement, options: { model: { value: string } }) => {
    let current = options.model.value;
    const editor = {
      getValue: () => current,
      setValue: vi.fn((next: string) => {
        current = next;
      }),
      getPosition: () => null,
      setPosition: vi.fn(),
      getModel: () => null,
      hasTextFocus: () => false,
      onDidChangeModelContent: vi.fn(),
      onDidChangeCursorSelection: vi.fn(),
      deltaDecorations: vi.fn(() => []),
      dispose: vi.fn(),
    };
    mocks.editors.push(editor);
    return editor;
  };
  return {
    monaco: {
      editor: {
        create,
        createModel: (value: string) => ({ value, dispose: vi.fn() }),
        getModel: () => null,
      },
      Uri: { file: (path: string) => ({ path }) },
    },
    ensureMonacoInitialized: vi.fn(async () => undefined),
    initializeMonaco: vi.fn(async () => undefined),
  };
});
vi.mock('$lib/utils/monaco-theme', () => ({
  defineMonacoThemes: vi.fn(),
  getActiveMonacoThemeName: vi.fn(() => 'intent-light'),
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/workspace-route-context', () => ({
  getWorkspaceRouteContext: () =>
    mocks.state.routeWorkspaceId ? { workspaceId: mocks.state.routeWorkspaceId } : null,
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('./AgentTypingAnimation.svelte', async () => ({
  default: (await import('../workspace/sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => {
  const byId = (wsId$: Readable<string>) => ({
    subscribe: (run: (value: unknown) => void) =>
      wsId$.subscribe((wsId) => run(mocks.state.workspaces[wsId])),
  });
  mocks.selectWorkspaceById.mockImplementation(byId);
  return {
    selectWorkspaceById: mocks.selectWorkspaceById,
    selectIsWorkspaceHostLocal: (wsId$: Readable<string>) => ({
      subscribe: (run: (value: boolean) => void) =>
        wsId$.subscribe(() => run(mocks.state.hostLocal)),
    }),
  };
});
vi.mock('$store/renderer/slices/user-preferences/user-preferences-selectors', () => ({
  selectCodeFontFamilyCSS: () => writable('monospace'),
}));
vi.mock('$store/renderer/slices/agent-follow/agent-follow-selectors', () => ({
  selectIsFollowing: () => writable(mocks.state.isFollowing),
}));
vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => writable(false),
}));

import CodeEditor from './CodeEditor.svelte';

const TOO_LARGE = 'x'.repeat(500 * 1024 + 1);

async function renderEditor(props: Record<string, unknown>) {
  const view = render(CodeEditor, { props });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  return view;
}

async function mountedEditor(props: Record<string, unknown>) {
  const view = await renderEditor(props);
  await waitFor(() => expect(mocks.editors).toHaveLength(1));
  return { view, editor: mocks.editors[0] };
}

describe('CodeEditor external content sync', () => {
  beforeEach(() => {
    mocks.editors.length = 0;
    mocks.invoke.mockClear();
    mocks.selectWorkspaceById.mockClear();
    mocks.state.isFollowing = false;
    mocks.state.hostLocal = true;
    mocks.state.routeWorkspaceId = undefined;
    mocks.state.workspaces = {};
  });

  it('syncs external value changes into the editor when no agent is followed', async () => {
    const { view, editor } = await mountedEditor({ value: 'one' });

    await view.rerender({ value: 'two' });
    await waitFor(() => expect(editor.setValue).toHaveBeenCalledWith('two'));
  });

  it('allows authoritative external refresh versions to sync while agent-follow mode is active', async () => {
    mocks.state.isFollowing = true;
    const { view, editor } = await mountedEditor({ value: 'one', externalContentVersion: 0 });

    await view.rerender({ value: 'echo', externalContentVersion: 0 });
    await tick();
    expect(editor.setValue).not.toHaveBeenCalled();

    await view.rerender({ value: 'refreshed', externalContentVersion: 1 });
    await waitFor(() => expect(editor.setValue).toHaveBeenCalledWith('refreshed'));

    editor.setValue.mockClear();
    await view.rerender({ value: 'echo again', externalContentVersion: 1 });
    await tick();
    expect(editor.setValue).not.toHaveBeenCalled();

    await view.rerender({ value: 'refreshed twice', externalContentVersion: 2 });
    await waitFor(() => expect(editor.setValue).toHaveBeenCalledWith('refreshed twice'));
  });
});

describe('CodeEditor file-too-large actions', () => {
  beforeEach(() => {
    mocks.editors.length = 0;
    mocks.invoke.mockClear();
    mocks.selectWorkspaceById.mockClear();
    mocks.state.isFollowing = false;
    mocks.state.hostLocal = true;
    mocks.state.routeWorkspaceId = undefined;
    mocks.state.workspaces = { 'ws-1': { worktreePath: '/repo/ws-1' } };
  });

  it('offers Open-in-VS-Code and Reveal only when the workspace host is local (monorepo#2171)', async () => {
    await renderEditor({ value: TOO_LARGE, workspaceId: 'ws-1', filePath: 'src/big.ts' });
    expect(screen.getByText('File Too Large')).toBeTruthy();
    const open = screen.getByRole('button', { name: /Open in VS Code/ });
    expect(screen.getByRole('button', { name: /Reveal in/ })).toBeTruthy();

    await fireEvent.click(open);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('vscode:openFile', {
        file: '/repo/ws-1/src/big.ts',
      }),
    );
  });

  it('hides the desktop-shell actions for a remote workspace host', async () => {
    mocks.state.hostLocal = false;
    await renderEditor({ value: TOO_LARGE, workspaceId: 'ws-1', filePath: 'src/big.ts' });

    expect(screen.getByText('File Too Large')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open in VS Code/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reveal in/ })).toBeNull();
  });

  it('hides the desktop-shell actions without a workspace or file path', async () => {
    await renderEditor({ value: TOO_LARGE, filePath: 'src/big.ts' });
    expect(screen.queryByRole('button', { name: /Open in VS Code/ })).toBeNull();
    cleanupDom();

    await renderEditor({ value: TOO_LARGE, workspaceId: 'ws-1' });
    expect(screen.queryByRole('button', { name: /Open in VS Code/ })).toBeNull();
  });

  it('resolves the workspace from the route context, not the active-workspace selector', async () => {
    mocks.state.routeWorkspaceId = 'ws-route';
    mocks.state.workspaces = { 'ws-route': { repositoryPath: '/repo/route' } };
    await renderEditor({ value: TOO_LARGE, filePath: 'src/big.ts' });

    const [workspaceId$] = mocks.selectWorkspaceById.mock.calls[0] as [Readable<string>];
    expect(get(workspaceId$)).toBe('ws-route');

    await fireEvent.click(screen.getByRole('button', { name: /Open in VS Code/ }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('vscode:openFile', {
        file: '/repo/route/src/big.ts',
      }),
    );
  });
});
