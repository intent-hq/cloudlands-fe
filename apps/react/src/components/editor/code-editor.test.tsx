import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
const f = vi.hoisted(() => ({
  modelDispose: vi.fn(),
  viewDispose: vi.fn(),
  listenerDispose: vi.fn(),
  failure: 'create',
}));
vi.mock('@/components/patterns/screen', () => ({ LoadingState: () => null }));
vi.mock('$lib/utils/monaco-theme', () => ({
  defineMonacoThemes: () => {},
  getActiveMonacoThemeName: () => 'test',
  revertMonacoTheme: () => {},
}));
vi.mock('$lib/utils/monaco-workers', () => ({
  configureMonacoWorkers: async () => {},
  ensureMonacoInitialized: async () => {},
  monaco: {
    Uri: { file: (s: string) => s },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
    editor: {
      createModel: () => ({
        dispose: f.modelDispose,
        getValue: () => 'text',
        onDidChangeContent: () => ({ dispose: f.listenerDispose }),
      }),
      create: (_host: unknown, opts: { model: unknown }) => {
        if (f.failure === 'create') throw new Error('editor constructor failed');
        return {
          dispose: f.viewDispose,
          getModel: () => opts.model,
          updateOptions: () => {},
          addCommand: () => {
            throw new Error('command setup failed');
          },
        };
      },
    },
  },
}));
import { CodeEditor } from './code-editor';
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
it.each(['create', 'command'])(
  'disposes owned Monaco resources when %s setup fails',
  async (failure) => {
    f.failure = failure;
    f.modelDispose.mockClear();
    f.viewDispose.mockClear();
    f.listenerDispose.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        createElement(CodeEditor, {
          value: 'text',
          path: 'ws/a.txt',
          language: 'text',
          dark: false,
          fontFamily: 'monospace',
          readOnly: false,
          onChange: () => {},
          onSave: () => {},
        }),
      );
    });
    await vi.waitFor(() =>
      expect(host.querySelector('[data-editor-phase]')?.getAttribute('data-editor-phase')).toBe(
        'error',
      ),
    );
    await act(async () => root!.unmount());
    root = undefined;
    expect(f.modelDispose).toHaveBeenCalledTimes(1);
    if (failure === 'command') {
      expect(f.viewDispose).toHaveBeenCalledTimes(1);
      expect(f.listenerDispose).toHaveBeenCalledTimes(1);
    }
  },
);
