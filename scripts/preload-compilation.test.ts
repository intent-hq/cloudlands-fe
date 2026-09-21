// @vitest-environment node
// @verify-changed-triggers: tsconfig.preload.json, src/preload/package.json, src/preload/index.template.ts, package.json
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it('compiles the preload to CommonJS and exposes its bridge in an Electron sandbox', () => {
  const root = process.cwd();
  const output = mkdtempSync(path.join(tmpdir(), 'preload-compilation-'));
  try {
    const config = path.join(output, 'tsconfig.json');
    writeFileSync(
      config,
      JSON.stringify({
        extends: path.join(root, 'tsconfig.preload.json'),
        compilerOptions: {
          outDir: output,
          tsBuildInfoFile: path.join(output, 'preload.tsbuildinfo'),
          noEmitOnError: true,
        },
        include: [path.join(root, 'src/preload/index.template.ts')],
        exclude: [],
      }),
    );
    const require = createRequire(import.meta.url);
    const compilerPackage = require.resolve('@typescript/native/package.json');
    const compiler = path.join(path.dirname(compilerPackage), 'bin/tsc');
    const result = spawnSync(process.execPath, [compiler, '-p', config], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status, `${result.error ?? ''}${result.stdout}${result.stderr}`).toBe(0);

    const exposeInMainWorld = vi.fn();
    const getPathForFile = vi.fn(() => '/workspace/dropped.txt');
    runInNewContext(readFileSync(path.join(output, 'preload/index.template.js'), 'utf8'), {
      exports: {},
      require: (id: string) => {
        if (id !== 'electron') throw new Error(`Unexpected preload dependency: ${id}`);
        return {
          contextBridge: { exposeInMainWorld },
          ipcRenderer: {},
          webUtils: { getPathForFile },
        };
      },
      process: { platform: 'linux', arch: 'x64', versions: {} },
      console,
    });
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, bridge] = exposeInMainWorld.mock.calls[0];
    expect(name).toBe('electronAPI');
    const file = {};
    expect(bridge.getPathForFile(file)).toBe('/workspace/dropped.txt');
    expect(getPathForFile).toHaveBeenCalledWith(file);
    getPathForFile.mockImplementationOnce(() => {
      throw new Error('Not a file');
    });
    expect(bridge.getPathForFile(file)).toBe('');
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
