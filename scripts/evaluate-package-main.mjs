/**
 * Evaluate package inspection callbacks with the original Node ESM loader.
 * Playwright's inspector evaluation context has no dynamic-import callback.
 * Node's main loader preserves the app's cached modules and asynchronous imports.
 *
 * @template Result, [Argument=undefined]
 * @param {import('@playwright/test').ElectronApplication} application
 * @param {(electron: typeof import('electron'), argument: Argument) => Result} callback
 * @param {Argument} [argument]
 * @returns {Promise<Awaited<Result>>}
 */
export function evaluatePackageMain(application, callback, argument) {
  return application.evaluate(
    (electron, { source, argument }) => {
      const vm = process.getBuiltinModule('node:vm');
      const inspect = vm.runInThisContext(`(${source})`, {
        filename: 'isolated-package-inspection.js',
        importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
      });
      return inspect(electron, argument);
    },
    { source: callback.toString(), argument },
  );
}
