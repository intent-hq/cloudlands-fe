import { delimiter } from 'node:path';

// Datadog's injected library loads sitecustomize.py at Python startup, then
// propagates its ddtrace/bootstrap path to descendants. The launcher opt-out
// does not undo either path when it was already inherited by the test worker.
const HOST_PYTHON_INJECTION =
  /(?:^|\/)datadog-apm-library-python(?:\/|$)|(?:^|\/)ddtrace\/bootstrap\/?$/;

/** Remove only known Python startup instrumentation from a test-child env.
 * Preserve ordinary import paths, including relative/empty entries and order.
 * Mutates only the supplied object and returns the removed path entries.
 */
export function scrubHostPythonInjection(env: NodeJS.ProcessEnv): string[] {
  if (env.PYTHONPATH === undefined) return [];
  const removed: string[] = [];
  const kept = env.PYTHONPATH.split(delimiter).filter((entry) => {
    if (!HOST_PYTHON_INJECTION.test(entry.replaceAll('\\', '/'))) return true;
    removed.push(entry);
    return false;
  });
  if (removed.length > 0) {
    if (kept.length > 0) env.PYTHONPATH = kept.join(delimiter);
    else delete env.PYTHONPATH;
  }
  return removed;
}
