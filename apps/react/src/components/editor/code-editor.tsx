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
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const latest = useRef({ value, dark, fontFamily, readOnly, onChange, onSave });
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  useLayoutEffect(() => {
    latest.current = { value, dark, fontFamily, readOnly, onChange, onSave };
  });
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
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        readOnly: latest.current.readOnly,
        ariaLabel: m.workspace_fileEdit_editor_ariaLabel(),
        guides: { indentation: false },
      });
      disposables.push(view);
      instance.current = view;
      const listener = model.onDidChangeContent(() => {
        const text = model.getValue(undefined, true);
        if (text !== latest.current.value) latest.current.onChange(text);
      });
      disposables.push(listener);
      view.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave());
      if (line) view.revealLineInCenter(line);
      setPhase('ready');
    })().catch(() => {
      cleanup();
      if (!retired) setPhase('error');
    });
    return () => {
      retired = true;
      cleanup();
    };
  }, [path, language, line]);
  useLayoutEffect(() => {
    const model = instance.current?.getModel();
    if (model && model.getValue(undefined, true) !== value) {
      const selection = instance.current?.getSelection();
      model.setValue(value);
      if (selection) instance.current?.setSelection(selection);
    }
    instance.current?.updateOptions({ readOnly, fontFamily });
  }, [value, readOnly, fontFamily, phase]);
  useLayoutEffect(() => {
    let retired = false;
    void import('$lib/utils/monaco-theme').then((theme) => {
      if (!retired && instance.current) theme.revertMonacoTheme(dark);
    });
    return () => {
      retired = true;
    };
  }, [dark, phase]);
  return (
    <div className="min-w-0" data-editor-phase={phase}>
      {phase === 'loading' && (
        <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />
      )}
      {phase === 'error' && <p role="alert">{m.workspace_fileEdit_editorFailed_error()}</p>}
      <div
        ref={container}
        className="h-96 min-w-0 overflow-hidden rounded border border-border"
        data-testid="workspace-text-editor"
      />
    </div>
  );
}
