/** Real native window lifecycle with synthetic pixels; never starts Intent or a daemon. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { build } from 'vite';

const output = resolve(process.argv[2] || 'test-results/right-dock-native');
const root = await mkdtemp(join(tmpdir(), 'intent-dock-smoke-'));
await mkdir(output, { recursive: true });
try {
  const entry = join(root, 'entry.ts');
  await writeFile(
    entry,
    [`export * from ${JSON.stringify(resolve('src/main/dock-window.ts'))};`].join('\n'),
  );
  await build({
    configFile: false,
    logLevel: 'error',
    plugins: [
      {
        name: 'isolated-dock-native-smoke',
        enforce: 'pre',
        resolveId(id) {
          if (id.endsWith('/connections-store')) return '\0smoke-connections';
          if (id.endsWith('/shared/logger')) return '\0smoke-logger';
        },
        load(id) {
          if (id === '\0smoke-connections')
            return 'export async function getActiveId() { return "synthetic-backend"; }';
          if (id === '\0smoke-logger')
            return 'export class Logger { info() {} debug() {} warn() {} error() {} }';
        },
        transform(code, id) {
          if (id.endsWith('/dock-window.ts')) {
            // Placeholder pages do not have renderer code or IPC. Omit only the
            // preload path; all BrowserWindow behavior is the production module.
            return code.replace(/preload: path\.join\(__dirname, '[^']+'\),/g, '');
          }
        },
      },
    ],
    build: {
      ssr: entry,
      outDir: root,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['electron'],
        output: { format: 'es', entryFileNames: 'native.mjs' },
      },
    },
  });
  const env = Object.fromEntries(
    ['PATH', 'TMPDIR', 'DISPLAY', 'XAUTHORITY', 'SYSTEMROOT'].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
  const result = await new Promise((resolveExit, reject) => {
    const child = spawn(
      electron,
      [resolve('test/fixtures/right-dock-native/main.cjs'), root, output],
      {
        env: { ...env, DD_TRACE_ENABLED: 'false' },
        stdio: 'inherit',
      },
    );
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code ?? 1);
    });
  });
  process.exitCode = result;
} finally {
  await rm(root, { recursive: true, force: true });
}
