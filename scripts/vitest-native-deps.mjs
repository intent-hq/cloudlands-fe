// Single source of truth for the generated modules vitest.config.ts hands to
// Node's native loader instead of transforming them (`test.server.deps.external`).
//
// The paraglide output (a ~12 MB messages/_index.js plus eight ~2.4 MB locale
// files) costs Vitest 5-7 s to transform and ship to a fork on an idle machine
// and 30 s or more under load; Node loads the same files natively in about
// 1 s. Every fork pays the first load, so a test that calls vi.resetModules()
// and then dynamically imports code that imports `m` paid it inside a hook or
// test, against the per-test timeout (cloudlands-fe#3859, cloudlands-fe#2566).
// Natively loaded modules also survive vi.resetModules(), so later reloads in
// the same fork are free.
//
// What this means for test authors:
// - vi.mock('$shared/paraglide/messages.js') still works: the mock is applied
//   where source modules import it.
// - Mocking '$shared/paraglide/runtime.js' would not reach messages.js, which
//   imports runtime.js natively. Use overwriteGetLocale/setLocale instead.
// - vi.spyOn() cannot patch these modules' exports (including `m`): native ES
//   module namespaces are not redefinable. Mock the module instead.
// - vi.resetModules() does not re-create paraglide's runtime, so its locale
//   state survives a reset: restore the locale in afterEach (each test file
//   still runs in its own fork). Modules that call overwriteGetLocale() when
//   they load ($lib/i18n/locale.ts, src/main/main-locale.ts) rebind the shared
//   getLocale each time they are re-imported after a reset, so drive the
//   locale through the most recently imported copy.

import { repoParaglidePaths } from './paraglide-inputs-hash.mjs';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Module-id patterns vitest loads natively for the package at `rootDir`: plain
 * `.js` files under the generated paraglide outdir, without a query (so
 * `?raw`/`?url` imports keep Vite's handling). Matched against resolved,
 * slash-separated module ids.
 * @param {string} rootDir
 * @returns {RegExp[]}
 */
export function nativeLoadedGeneratedModules(rootDir) {
  const outdir = repoParaglidePaths(rootDir).outdir.replaceAll('\\', '/');
  return [new RegExp(`^${escapeRegExp(outdir)}/[^?#]*\\.js$`)];
}
