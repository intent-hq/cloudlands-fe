/**
 * Removes host-level Node instrumentation from an environment object so that
 * child processes spawned by tests start clean: `NODE_OPTIONS` (any host
 * preload, e.g. Datadog single-step APM's `--require dd-trace/init`) and every
 * `DD_*` variable the injected tracer reads. Pure: mutates only the passed
 * object and returns the removed key names.
 */
export function scrubHostNodeInjection(env: NodeJS.ProcessEnv): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (key === 'NODE_OPTIONS' || key.startsWith('DD_')) {
      delete env[key];
      removed.push(key);
    }
  }
  return removed;
}
