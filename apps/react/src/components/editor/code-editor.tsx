import { dispatchWindowEvent } from '$lib/utils/window-events';
import { useLayoutEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { LoadingState } from '@/components/patterns/screen';
import { createUniqueMonacoModelPath } from '$lib/utils/monaco-model-uri';
import { getCodeEditorLanguage } from '$lib/utils/code-editor-policy';
import { m } from '$shared/paraglide/messages.js';

/** Bounded DOM host for the canonical Monaco engine; file state and saves belong to the host Store. */
export function CodeEditor({
  value,
  path,
  language,
  dark,
  fontFamily,
  readOnly,
  line,
  onChange,
  onSave,
  ariaLabel,
  errorLabel,
  fill = false,
  lineWrapping = true,
  jumpTimestamp,
  active = true,
  fileName,
}: {
  value: string;
  path: string;
  language: string;
  dark: boolean;
  fontFamily: string;
  readOnly: boolean;
  line?: number;
  onChange: (value: string) => void;
  onSave: () => void;
  ariaLabel?: string;
  errorLabel?: string;
  /** Source desktop host; browser preview defaults remain unchanged. */
  fill?: boolean;
  lineWrapping?: boolean;
  jumpTimestamp?: number;
  active?: boolean;
  fileName?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({
    value,
    dark,
    fontFamily,
    readOnly,
    onChange,
    onSave,
    ariaLabel,
    lineWrapping,
    active,
    fileName,
  });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  useLayoutEffect(() => {
    latest.current = {
      value,
      dark,
      fontFamily,
      readOnly,
      onChange,
      onSave,
      ariaLabel,
      lineWrapping,
      active,
      fileName,
    };
  });
  const modelLine = fill ? undefined : line;
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    let retired = false;
    const disposables: Array<{ dispose(): void }> = [];
    const cleanup = () => {
      instance.current = null;
      for (const resource of disposables.splice(0).reverse()) resource.dispose();
    };
    setPhase('loading');
    void (async () => {
      const engine = await import('$lib/utils/monaco-workers');
      await engine.configureMonacoWorkers({ filterKnownDevelopmentErrors: false });
      await engine.ensureMonacoInitialized();
      if (retired) return;
      const theme = await import('$lib/utils/monaco-theme');
      if (retired) return;
      theme.defineMonacoThemes();
      const { monaco } = engine;
      const model = monaco.editor.createModel(
        latest.current.value,
        getCodeEditorLanguage(language),
        monaco.Uri.file(createUniqueMonacoModelPath(path, crypto.randomUUID())),
      );
      disposables.push(model);
      const view = monaco.editor.create(host, {
        model,
        theme: theme.getActiveMonacoThemeName(latest.current.dark),
        fontFamily: latest.current.fontFamily,
        fontSize: 13,
        fontWeight: '500',
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: latest.current.lineWrapping ? 'on' : 'off',
        ...(fill
          ? {
              lineNumbersMinChars: 5,
              overviewRulerLanes: 0,
              fontLigatures: true,
              scrollbar: {
                vertical: 'auto' as const,
                horizontal: 'auto' as const,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10,
              },
            }
          : {}),
        scrollBeyondLastLine: false,
        readOnly: latest.current.readOnly,
        ariaLabel: latest.current.ariaLabel ?? m.workspace_fileEdit_editor_ariaLabel(),
        guides: { indentation: false },
      });
      disposables.push(view);
      instance.current = view;
      const listener = model.onDidChangeContent(() => {
        const text = model.getValue(undefined, true);
        if (text !== latest.current.value) latest.current.onChange(text);
      });
      disposables.push(listener);
      if (!fill)
        view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave());
      if (modelLine) view.revealLineInCenter(modelLine);
      if (fill)
        disposables.push(
          view.onDidChangeCursorSelection(({ selection }) => {
            if (!view.hasTextFocus() || !latest.current.active) return;
            dispatchWindowEvent('editor:selection-change', {
              text: selection.isEmpty() ? '' : model.getValueInRange(selection),
              file: latest.current.fileName,
              language,
              source: 'monaco',
            });
          }),
        );
      setPhase('ready');
    })().catch(() => {
      cleanup();
      if (!retired) setPhase('error');
    });
    return () => {
      retired = true;
      cleanup();
    };
  }, [path, language, fill, modelLine]);
  useLayoutEffect(() => {
    const model = instance.current?.getModel();
    if (model && model.getValue(undefined, true) !== value) {
      const selection = instance.current?.getSelection();
      model.setValue(value);
      if (selection) instance.current?.setSelection(selection);
    }
    instance.current?.updateOptions({
      readOnly,
      wordWrap: lineWrapping ? 'on' : 'off',
      fontFamily,
      ariaLabel: ariaLabel ?? m.workspace_fileEdit_editor_ariaLabel(),
    });
  }, [value, readOnly, fontFamily, phase, ariaLabel, lineWrapping]);
  useLayoutEffect(() => {
    let retired = false;
    void Promise.all([import('$lib/utils/monaco-theme'), import('$lib/utils/monaco-workers')]).then(
      ([theme, engine]) => {
        if (!retired && instance.current) {
          if (fill) engine.monaco.editor.setTheme(theme.getActiveMonacoThemeName(dark));
          else theme.revertMonacoTheme(dark);
        }
      },
    );
    return () => {
      retired = true;
    };
  }, [dark, phase, fill]);
  const lastJump = useRef<string | null>(null);
  useLayoutEffect(() => {
    const view = instance.current,
      model = view?.getModel();
    if (!fill || !active || !line || !view || !model) return;
    const key = JSON.stringify([path, line, jumpTimestamp]);
    if (lastJump.current === key) return;
    lastJump.current = key;
    const position = {
      lineNumber: Math.max(1, Math.min(Math.floor(line), model.getLineCount())),
      column: 1,
    };
    view.setPosition(position);
    view.revealPositionInCenterIfOutsideViewport(position, 0);
    view.focus();
  }, [fill, active, line, jumpTimestamp, path, phase]);
  return (
    <div className={fill ? 'relative h-full w-full min-w-0' : 'min-w-0'} data-editor-phase={phase}>
      {phase === 'loading' && (
        <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />
      )}
      {phase === 'error' && (
        <p role="alert">{errorLabel ?? m.workspace_fileEdit_editorFailed_error()}</p>
      )}
      <div
        ref={container}
        className={
          fill
            ? 'native-scrollbars h-full w-full min-w-0 overflow-hidden'
            : 'h-96 min-w-0 overflow-hidden rounded border border-border'
        }
        data-testid="workspace-text-editor"
      />
    </div>
  );
}
