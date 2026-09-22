// Loads the real module (no vi.mock) so the `monaco-editor/**/*.worker?worker`
// subpath imports must resolve through the runner's alias table
// (intent-hq/intent#5623).
import { afterEach, describe, expect, it } from 'vitest';

type MonacoEnvironmentLike = {
  getWorker: (moduleId: string, label: string) => Partial<Worker>;
};

describe('monaco-workers under Vitest', () => {
  afterEach(() => {
    delete (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment;
  });

  it('configures the worker environment without a module resolution error', async () => {
    const { configureMonacoWorkers } = await import('./monaco-workers');

    await expect(configureMonacoWorkers()).resolves.toBeUndefined();

    const env = (globalThis as { MonacoEnvironment?: MonacoEnvironmentLike }).MonacoEnvironment;
    expect(env).toBeDefined();
    for (const label of ['json', 'css', 'html', 'typescript', 'plaintext']) {
      const worker = env!.getWorker('', label);
      expect(typeof worker.postMessage).toBe('function');
      expect(typeof worker.terminate).toBe('function');
      // A real (stubbed) Worker instance, not the inline fallback getWorker returns
      // when constructing the worker module fails.
      expect(typeof worker.addEventListener).toBe('function');
    }
  });
});
