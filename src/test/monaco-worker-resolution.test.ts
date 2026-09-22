import { afterEach, describe, expect, it, vi } from 'vitest';
import * as monacoApiStub from '../__mocks__/monaco-editor';
import MonacoWorker from '../__mocks__/monaco-worker';

const workerImports = [
  ['editor', () => import('monaco-editor/editor/editor.worker?worker')],
  ['json', () => import('monaco-editor/language/json/json.worker?worker')],
  ['css', () => import('monaco-editor/language/css/css.worker?worker')],
  ['html', () => import('monaco-editor/language/html/html.worker?worker')],
  ['typescript', () => import('monaco-editor/language/typescript/ts.worker?worker')],
] as const;

describe('test-only Monaco worker resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(workerImports)('resolves the %s worker constructor', async (_label, load) => {
    const { default: WorkerConstructor } = await load();
    expect(WorkerConstructor).toBe(MonacoWorker);

    const worker = new WorkerConstructor();
    const onMessage = vi.fn();
    const onError = vi.fn();
    worker.onmessage = onMessage;
    worker.onerror = onError;
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    worker.postMessage({ method: 'computeDiff' });
    await Promise.resolve();
    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    expect(() => {
      worker.terminate();
      worker.terminate();
    }).not.toThrow();
  });

  it('keeps the bare API stub through the real worker module', async () => {
    const bareMonaco = await import('monaco-editor');
    const { monaco } = await import('../lib/utils/monaco-workers');

    expect(bareMonaco.editor).toBe(monacoApiStub.editor);
    expect(monaco.editor).toBe(monacoApiStub.editor);
    expect(monaco.KeyMod).toBe(monacoApiStub.KeyMod);
    expect(monaco.KeyCode).toBe(monacoApiStub.KeyCode);
    const model = monaco.editor.createModel('test model', 'plaintext');
    expect(model.getValue()).toBe('test model');
    model.dispose();
  });

  it('constructs workers through production configuration without fallback', async () => {
    // Avoid installing the development-only console/rejection filter in this suite.
    vi.stubEnv('DEV', false);
    vi.stubGlobal('MonacoEnvironment', undefined);
    const { configureMonacoWorkers } = await import('../lib/utils/monaco-workers');
    await configureMonacoWorkers();

    const { MonacoEnvironment } = self as typeof self & {
      MonacoEnvironment: { getWorker: (moduleId: string, label: string) => Worker };
    };
    for (const label of ['editor', 'json', 'css', 'html', 'typescript']) {
      const worker = MonacoEnvironment.getWorker('', label);
      const nextWorker = MonacoEnvironment.getWorker('', label);
      expect(worker).toBeInstanceOf(MonacoWorker);
      expect(nextWorker).toBeInstanceOf(MonacoWorker);
      expect(nextWorker).not.toBe(worker);
      worker.terminate();
      nextWorker.terminate();
    }
  });
});
