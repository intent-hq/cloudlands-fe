import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

describe('dev launcher macOS bundle safety', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/dev-launcher.mjs'), 'utf-8');

  it('never modifies Electron.app signed resources to label a dev instance', () => {
    expect(source).not.toContain('Electron.app/Contents/Info.plist');
    expect(source).not.toContain('patchElectronPlist');
    expect(source).not.toContain('writeFileSync');
  });

  it('passes the dev name through the environment for in-app labeling', () => {
    expect(source).toContain("process.env.DEV_NAME = devName || ''");
  });
});

describe('dev Electron child lifecycle', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/dev-electron.js'), 'utf-8');
  const libSource = readFileSync(join(process.cwd(), 'scripts/dev-electron-lib.mjs'), 'utf-8');
  const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')).scripts;

  it('reports native signal termination as a failed dev process', () => {
    expect(source).toContain("electron.on('exit', (code, signal)");
    expect(source).toContain('if (signal)');
    expect(source).toContain('process.exit(1)');
    expect(source).toContain('process.exit(code ?? 1)');
  });

  it('probes the renderer port without requiring a root HTTP route', () => {
    // The wait-on target list is built by buildWaitOnTargets (see
    // scripts/dev-electron-lib.test.ts for its full contract): a TCP probe of
    // the listener — never HTTP `/`, which 404s by design — plus an HTTP probe
    // of the generated SvelteKit client (intent-hq/monorepo#3524).
    expect(source).toContain('buildWaitOnTargets(devPort,');
    expect(libSource).toContain('`tcp:127.0.0.1:${devPort}`');
    expect(libSource).not.toContain('`http://127.0.0.1:${devPort}`');
  });

  it('stops the renderer when either Electron dev process fails', () => {
    expect(scripts['dev:base']).toContain('node scripts/dev-stack.mjs');
    expect(scripts['dev:base']).toContain('--long "pnpm run dev:electron"');
    expect(scripts['dev:cdp:base']).toContain('node scripts/dev-stack.mjs');
    expect(scripts['dev:cdp:base']).toContain('--long "pnpm run dev:electron:cdp"');
  });
});
