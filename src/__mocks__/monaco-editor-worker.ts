// Test-only stub for the `monaco-editor/**/*.worker?worker` subpath imports in
// src/lib/utils/monaco-workers.ts. Vite's `?worker` modules default-export a Worker
// constructor; this no-op keeps the module graph resolvable under jsdom, where the
// `monaco-editor` alias would otherwise point those subpaths at files that do not exist.

class MonacoWorkerStub {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }
}

export default MonacoWorkerStub;
