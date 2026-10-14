import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';
import { transformAsync } from '@babel/core';
import { defineProject } from 'vitest/config';
import rootConfig from '../../vitest.config';

// Resolve Babel's plugin from this app, where the production transform is installed.
const requireFromReactApp = createRequire(import.meta.url);
const signalsTransformPath = requireFromReactApp.resolve('@preact/signals-react-transform');
const reactAppRoot = fileURLToPath(new URL('./', import.meta.url)).replaceAll('\\', '/');

function reactSignalsTestPlugin() {
  return {
    name: 'intent-react-signals-test',
    enforce: 'pre' as const,
    async transform(code: string, id: string) {
      const filename = id.split('?')[0].replaceAll('\\', '/');
      if (
        id.includes('\0') ||
        !filename.startsWith(reactAppRoot) ||
        /(?:^|\/)node_modules\//.test(filename) ||
        !/\.tsx?$/.test(filename)
      ) {
        return null;
      }
      const result = await transformAsync(code, {
        filename,
        cwd: reactAppRoot,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        sourceFileName: filename,
        parserOpts: {
          sourceType: 'module',
          allowAwaitOutsideFunction: true,
          plugins: filename.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
        },
        plugins: [signalsTransformPath],
      });
      if (result?.code == null) {
        throw new Error(`React signals transform returned no code for ${filename}`);
      }
      return { code: result.code, map: result.map ? JSON.stringify(result.map) : null };
    },
  };
}

// Run through the root config (optionally --project=react). The root project
// owns global temp-dir setup/teardown exactly once, including React-only runs.
export default defineProject(async (env) => {
  const shared = await rootConfig(env);
  // Worker limits belong to the root runner, including its CLI override. Copying
  // maxWorkers here pins this project to the default and breaks combined runs.
  const {
    projects: _projects,
    globalSetup: _globalSetup,
    maxWorkers: _maxWorkers,
    ...test
  } = shared.test ?? {};
  const aliases = shared.resolve?.alias;
  if (!Array.isArray(aliases)) {
    throw new Error('React unit tests require the canonical root alias list');
  }

  return {
    ...shared,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [...(shared.plugins ?? []), reactSignalsTestPlugin()],
    // Babel sees typed JSX first; the runner's esbuild then strips types and
    // emits React's automatic JSX runtime, without Vite 8 or Fast Refresh hooks.
    esbuild: { jsx: 'automatic' as const, jsxImportSource: 'react' },
    test: {
      ...test,
      name: 'react',
      // Vitest supplies the config directory as Vite's inline root; its test
      // root takes precedence and keeps canonical setup paths repo-relative.
      root: fileURLToPath(new URL('../../', import.meta.url)),
      include: ['apps/react/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
      exclude: test.exclude?.filter((pattern) => pattern !== 'apps/react/**'),
    },
    resolve: {
      ...shared.resolve,
      // Keep canonical source-fixture aliases and external mocks. Only @ changes
      // app ownership; no Store, reducer, saga, or selector is redirected.
      alias: aliases.map((entry) =>
        entry.find === '@'
          ? { ...entry, replacement: fileURLToPath(new URL('./src', import.meta.url)) }
          : entry,
      ),
    },
    css: { postcss: { plugins: [] } },
  };
});
