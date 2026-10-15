import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const f = vi.hoisted(() => ({
  create: vi.fn(),
  theme: vi.fn(),
  dispose: vi.fn(),
  disposeModel: vi.fn(),
  disposeSelection: vi.fn(),
  position: vi.fn(),
  reveal: vi.fn(),
  focus: vi.fn(),
  options: vi.fn(),
  command: vi.fn(),
  text: 'one\ntwo\nthree\n',
  selection: null as null | ((event: any) => void),
  focused: true,
}));
vi.mock('@/components/patterns/screen', () => ({ LoadingState: () => null }));
vi.mock('$lib/utils/monaco-theme', () => ({
  defineMonacoThemes: () => {},
  getActiveMonacoThemeName: () => 'app-custom',
  revertMonacoTheme: () => {},
}));
vi.mock('$lib/utils/monaco-workers', () => ({
  configureMonacoWorkers: async () => {},
  ensureMonacoInitialized: async () => {},
  monaco: {
    Uri: { file: (path: string) => path },
    KeyMod: { CtrlCmd: 1 },
    KeyCode: { KeyS: 2 },
    editor: {
      setTheme: f.theme,
      createModel: () => ({
        dispose: f.disposeModel,
        getValue: () => f.text,
        getLineCount: () => 4,
        getValueInRange: () => 'two',
        onDidChangeContent: () => ({ dispose: () => {} }),
      }),
      create: (_host: unknown, { model }: any) => {
        f.create();
        return {
          dispose: f.dispose,
          getModel: () => model,
          updateOptions: f.options,
          addCommand: f.command,
          setPosition: f.position,
          revealPositionInCenterIfOutsideViewport: f.reveal,
          focus: f.focus,
          hasTextFocus: () => f.focused,
          onDidChangeCursorSelection: (fn: any) => {
            f.selection = fn;
            return { dispose: f.disposeSelection };
          },
        };
      },
    },
  },
}));
import { CodeEditor } from './code-editor';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const base = {
  value: 'one\ntwo\nthree\n',
  path: 'workspace/a.ts/tab',
  language: 'typescript',
  dark: false,
  fontFamily: 'monospace',
  readOnly: false,
  onChange: () => {},
  onSave: () => {},
  fill: true,
  fileName: 'a.ts',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  f.focused = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it('retains its model across repeated line jumps, parking and wrap changes and disposes owned resources', async () => {
  await act(async () => root.render(<CodeEditor {...base} line={2} jumpTimestamp={1} />));
  expect(f.theme).toHaveBeenLastCalledWith('app-custom');
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.position).toHaveBeenLastCalledWith({ lineNumber: 2, column: 1 });
  await act(async () =>
    root.render(<CodeEditor {...base} line={3} jumpTimestamp={2} active={false} />),
  );
  expect(f.position).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.render(<CodeEditor {...base} line={3} jumpTimestamp={2} lineWrapping={false} />),
  );
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.position).toHaveBeenLastCalledWith({ lineNumber: 3, column: 1 });
  expect(f.options).toHaveBeenLastCalledWith(expect.objectContaining({ wordWrap: 'off' }));
  // The desktop's configured shortcut owner handles Save; public browser defaults remain separate.
  expect(f.command).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(f.dispose).toHaveBeenCalledTimes(1);
  expect(f.disposeModel).toHaveBeenCalledTimes(1);
  expect(f.disposeSelection).toHaveBeenCalledTimes(1);
});
it('reports only focused active selection and preserves it when the pane is parked', async () => {
  const selections: unknown[] = [];
  const listener = (e: Event) => selections.push((e as CustomEvent).detail);
  window.addEventListener('editor:selection-change', listener);
  try {
    await act(async () => root.render(<CodeEditor {...base} />));
    f.selection!({ selection: { isEmpty: () => false } });
    expect(selections).toEqual([
      { text: 'two', file: 'a.ts', language: 'typescript', source: 'monaco' },
    ]);
    await act(async () => root.render(<CodeEditor {...base} active={false} />));
    f.selection!({ selection: { isEmpty: () => true } });
    expect(selections).toHaveLength(1);
  } finally {
    window.removeEventListener('editor:selection-change', listener);
  }
});
