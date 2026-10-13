import * as fs from 'node:fs';
import path from 'node:path';

/** Preserve progress before awaiting package code, including code that never settles. */
export function createPackageProbe(output, evidence) {
  let completed = false;
  const persist = () => {
    fs.writeFileSync(
      path.join(output, 'isolation.json'),
      JSON.stringify({ ...evidence, passed: completed && evidence.passed, completed }, null, 2),
      {
        mode: 0o600,
      },
    );
  };
  const checkpoint = (label, state) => {
    evidence.probe = { label, state, at: new Date().toISOString() };
    persist();
    console.log(`[isolated-package] ${label}: ${state}`);
  };
  const run = async (label, operation, timeoutMs = 60_000) => {
    checkpoint(label, 'started');
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
      checkpoint(label, 'completed');
      return result;
    } catch (error) {
      evidence.probeFailure ??= { label, error: String(error?.stack ?? error) };
      checkpoint(label, 'failed');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  persist();
  const finish = () => {
    completed = true;
    persist();
  };
  return { run, checkpoint, persist, finish };
}
