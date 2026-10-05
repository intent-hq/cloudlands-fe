// Test-only constructor for the five exact Monaco ?worker aliases in vitest.config.ts.
// No worker is started and no Monaco diff, tokenization, or language results are simulated.
export default class MonacoWorker extends EventTarget implements Worker {
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  onerror: Worker['onerror'] = null;

  postMessage(_message: unknown, _options?: Transferable[] | StructuredSerializeOptions): void {
    // Intentionally inert: importing or mounting an editor must not start background work.
  }

  terminate(): void {
    // There is no underlying worker to dispose.
  }
}
