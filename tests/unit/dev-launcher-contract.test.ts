import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildWaitOnTargets } from '../../scripts/dev-electron-lib.mjs';

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
  const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')).scripts;

  it('reports native signal termination as a failed dev process', () => {
    expect(source).toContain("electron.on('exit', (code, signal)");
    expect(source).toContain('if (signal)');
    expect(source).toContain('process.exit(1)');
    expect(source).toContain('process.exit(code ?? 1)');
  });

  it('probes the renderer port without requiring a root HTTP route', () => {
    expect(
      buildWaitOnTargets('5190', ['/repo/dist/.dev-ready-main', '/repo/dist/.dev-ready-preload']),
    ).toEqual([
      'tcp:127.0.0.1:5190',
      'http-get://127.0.0.1:5190/.svelte-kit/generated/client/nodes/0.js',
      '/repo/dist/.dev-ready-main',
      '/repo/dist/.dev-ready-preload',
    ]);
  });

  it('waits for the React sandbox and transformed client during development preview', () => {
    expect(
      buildWaitOnTargets('5190', ['/repo/dist/.dev-ready-main', '/repo/dist/.dev-ready-preload'], {
        NODE_ENV: 'development',
        INTENT_DEV_REACT: '1',
      }),
    ).toEqual([
      'tcp:127.0.0.1:5190',
      'http-get://127.0.0.1:5190/sandbox',
      'http-get://127.0.0.1:5190/@id/virtual:tanstack-start-client-entry',
      '/repo/dist/.dev-ready-main',
      '/repo/dist/.dev-ready-preload',
    ]);
  });

  it('retains Svelte readiness outside development even with React preview enabled', () => {
    expect(
      buildWaitOnTargets('5190', ['/repo/dist/.dev-ready-main', '/repo/dist/.dev-ready-preload'], {
        NODE_ENV: 'production',
        INTENT_DEV_REACT: '1',
      }),
    ).toEqual([
      'tcp:127.0.0.1:5190',
      'http-get://127.0.0.1:5190/.svelte-kit/generated/client/nodes/0.js',
      '/repo/dist/.dev-ready-main',
      '/repo/dist/.dev-ready-preload',
    ]);
  });

  it('stops the renderer when either Electron dev process fails', () => {
    expect(scripts['dev:base']).toContain('node scripts/dev-stack.mjs');
    expect(scripts['dev:base']).toContain('--long "node scripts/pnpm-run.mjs dev:electron"');
    expect(scripts['dev:cdp:base']).toContain('node scripts/dev-stack.mjs');
    expect(scripts['dev:cdp:base']).toContain(
      '--long "node scripts/pnpm-run.mjs dev:electron:cdp"',
    );
  });
});
