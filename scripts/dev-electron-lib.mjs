/**
 * Pure helpers for the dev Electron launcher (scripts/dev-electron.js).
 *
 * Kept side-effect free so the readiness-target rules are unit-testable
 * (scripts/dev-electron-lib.test.ts).
 */

/**
 * URL path of the first generated SvelteKit client node, used as the renderer
 * readiness probe.
 *
 * The SvelteKit client entry dynamically imports the generated route nodes
 * (`.svelte-kit/generated/client/nodes/*.js`). If Electron loads the window
 * while Vite's TCP listener is up but node 0 is not yet servable, the dynamic
 * import fails and the renderer can stay stuck on a 500 error page that
 * reloads do not recover from (intent-hq/monorepo#3524). Node 0 is the root
 * layout — every route imports it, so "node 0 returns 200" means the
 * generated client tree is fetchable end-to-end.
 */
export const GENERATED_CLIENT_PROBE_PATH = '/.svelte-kit/generated/client/nodes/0.js';

/**
 * Build the wait-on target list gating the Electron launch.
 *
 * Targets:
 * - the Vite TCP listener (the app has no root page, so a healthy server
 *   returns 404 on HTTP `/` — probe the listener, not the root document);
 * - an HTTP GET of the generated client node 0, which wait-on retries until
 *   it returns 2xx — i.e. until SvelteKit sync has produced the generated
 *   client and Vite can transform and serve it;
 * - the main/preload build sentinel files.
 *
 * Uses 127.0.0.1 to avoid IPv6 binding issues on Linux.
 *
 * @param {string | number} devPort Vite dev-server port
 * @param {string[]} sentinelFiles absolute paths of the build sentinels
 * @returns {string[]}
 */
export function buildWaitOnTargets(devPort, sentinelFiles) {
  return [
    `tcp:127.0.0.1:${devPort}`,
    `http-get://127.0.0.1:${devPort}${GENERATED_CLIENT_PROBE_PATH}`,
    ...sentinelFiles,
  ];
}

/**
 * Overall wait-on timeout (ms). Without one, a wedged probe (e.g. a future
 * SvelteKit upgrade relocating the generated nodes, so the http-get target
 * 404s forever) hangs the launcher silently; with it, wait-on exits non-zero
 * and prints the stuck targets. A legit cold start resolves in ~1.3 s, so a
 * 5-minute ceiling survives loaded development hosts while still detecting a
 * genuinely wedged readiness probe.
 */
export const WAIT_ON_TIMEOUT_MS = 300000;

/**
 * Resolve the wait-on timeout from the launcher environment.
 *
 * Invalid overrides fall back instead of crashing the dev launcher. The
 * warning keeps a typo visible rather than silently ignoring it.
 *
 * @param {NodeJS.ProcessEnv} env launcher environment
 * @param {(message: string) => void} warn warning sink
 * @returns {number} positive timeout in milliseconds
 */
export function resolveWaitOnTimeoutMs(env, warn = console.warn) {
  const rawValue = env.DEV_WAIT_ON_TIMEOUT_MS;
  if (rawValue === undefined) return WAIT_ON_TIMEOUT_MS;

  const normalizedValue = rawValue.trim();
  const timeoutMs = Number(normalizedValue);
  if (/^[0-9]+$/.test(normalizedValue) && Number.isSafeInteger(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  warn(
    `Invalid DEV_WAIT_ON_TIMEOUT_MS=${JSON.stringify(rawValue)}; using ${WAIT_ON_TIMEOUT_MS}ms.`,
  );
  return WAIT_ON_TIMEOUT_MS;
}

/**
 * Augment an environment for the wait-on child so the loopback http-get
 * probe always bypasses any configured HTTP proxy.
 *
 * wait-on passes its axios proxy option through unset, and axios then honors
 * HTTP_PROXY/http_proxy env vars — on a machine with a proxy configured and
 * 127.0.0.1 not in NO_PROXY, the probe would route through the proxy and
 * never succeed. The tcp: target is immune, so only the http-get probe needs
 * this.
 *
 * @param {NodeJS.ProcessEnv} env base environment (typically process.env)
 * @returns {NodeJS.ProcessEnv} copy with 127.0.0.1 appended to NO_PROXY
 */
export function buildWaitOnEnv(env) {
  return {
    ...env,
    NO_PROXY: [env.NO_PROXY ?? env.no_proxy, '127.0.0.1'].filter(Boolean).join(','),
  };
}
