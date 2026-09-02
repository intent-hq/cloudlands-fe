import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readWsUrlDefine(mode: string, wsUrl: string): string {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ mode: process.env.TEST_VITE_MODE });
    process.stdout.write(JSON.stringify(config.define));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTENT_BUILD_TARGET: 'web',
      TEST_VITE_MODE: mode,
      VITE_INTENTD_WS_URL: wsUrl,
    },
  });
  return output;
}

function readPluginNames({
  uiPreview,
  canReuse,
  mode = 'development',
}: {
  uiPreview: boolean;
  canReuse: boolean;
  mode?: string;
}): string[] {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig(
      { command: 'serve', mode: ${JSON.stringify(mode)} },
      { canReuseGeneratedParaglide: () => ${JSON.stringify(canReuse)} },
    );
    process.stdout.write(JSON.stringify(config.plugins.map((plugin) => plugin.name)));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTENT_BUILD_TARGET: 'web',
      INTENT_UI_PREVIEW: uiPreview ? '1' : '0',
    },
  });
  return JSON.parse(output);
}

function readParaglideReuseDecision(
  outputPaths: string[],
  inputPaths: string[],
  mtimes: Record<string, number>,
  existing: string[] = outputPaths,
): boolean {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import { canReuseGeneratedParaglide } from ${JSON.stringify(configUrl)};
    const outputPaths = ${JSON.stringify(outputPaths)};
    const inputPaths = ${JSON.stringify(inputPaths)};
    const mtimes = ${JSON.stringify(mtimes)};
    const existing = ${JSON.stringify(existing)};
    const result = canReuseGeneratedParaglide({
      outputPaths,
      inputPaths,
      existsSync: (file) => existing.includes(file),
      statSync: (file) => ({ mtimeMs: mtimes[file] ?? 0 }),
    });
    process.stdout.write(JSON.stringify(result));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
  );
}

describe('production web Vite configuration', () => {
  it('does not expose the configured WebSocket URL through a static define', () => {
    const define = readWsUrlDefine(
      'production',
      'wss://user:password@daemon.example/rpc?token=build-secret#fragment',
    );

    expect(JSON.parse(define)['process.env.VITE_INTENTD_WS_URL']).toBe('""');
    expect(define).not.toContain('build-secret');
  });

  it('keeps the Vite URL fallback for local web development', () => {
    const define = JSON.parse(readWsUrlDefine('development', 'ws://127.0.0.1:5181/rpc'));

    expect(define['process.env.VITE_INTENTD_WS_URL']).toBe('"ws://127.0.0.1:5181/rpc"');
  });

  it('reuses generated messages for the UI preview when the output is fresh', () => {
    expect(readPluginNames({ uiPreview: true, canReuse: true })).toContain(
      'reuse-generated-paraglide',
    );
  });

  it('never reuses stale generated messages even for the UI preview', () => {
    const plugins = readPluginNames({ uiPreview: true, canReuse: false });
    expect(plugins).not.toContain('reuse-generated-paraglide');
    expect(plugins).toContain('unplugin-paraglide-js');
  });

  it.each(['development', 'test'])('uses full compilation in %s mode outside preview', (mode) => {
    const plugins = readPluginNames({ uiPreview: false, canReuse: true, mode });
    expect(plugins).toContain('unplugin-paraglide-js');
    expect(plugins).not.toContain('reuse-generated-paraglide');
  });
});

describe('canReuseGeneratedParaglide (pure decision logic)', () => {
  // The isolated Node process uses injected paths and stats. It does not read
  // generated files, so each state is independent of checkout mtimes.
  const outputPaths = ['/fixture/paraglide/messages.js', '/fixture/paraglide/runtime.js'];
  const inputPaths = ['/fixture/project.inlang/settings.json', '/fixture/messages/en.json'];

  it('reuses output when every output is at least as new as every input (fresh)', () => {
    const mtimes = {
      [outputPaths[0]]: 200,
      [outputPaths[1]]: 250,
      [inputPaths[0]]: 100,
      [inputPaths[1]]: 150,
    };
    expect(readParaglideReuseDecision(outputPaths, inputPaths, mtimes)).toBe(true);
  });

  it('reuses output when the oldest output exactly matches the newest input (boundary)', () => {
    const mtimes = {
      [outputPaths[0]]: 200,
      [outputPaths[1]]: 300,
      [inputPaths[0]]: 100,
      [inputPaths[1]]: 200,
    };
    expect(readParaglideReuseDecision(outputPaths, inputPaths, mtimes)).toBe(true);
  });

  it('refuses reuse when any input is newer than the oldest output (stale)', () => {
    const mtimes = {
      [outputPaths[0]]: 100,
      [outputPaths[1]]: 250,
      [inputPaths[0]]: 100,
      [inputPaths[1]]: 300,
    };
    expect(readParaglideReuseDecision(outputPaths, inputPaths, mtimes)).toBe(false);
  });

  it('refuses reuse when a required output file is missing entirely', () => {
    const mtimes = {
      [outputPaths[0]]: 500,
      [outputPaths[1]]: 500,
      [inputPaths[0]]: 100,
      [inputPaths[1]]: 100,
    };
    expect(readParaglideReuseDecision(outputPaths, inputPaths, mtimes, [])).toBe(false);
  });

  it('refuses reuse when only part of the required output set exists (partial)', () => {
    const mtimes = {
      [outputPaths[1]]: 500,
      [inputPaths[0]]: 100,
      [inputPaths[1]]: 100,
    };
    expect(readParaglideReuseDecision(outputPaths, inputPaths, mtimes, [outputPaths[1]])).toBe(
      false,
    );
  });
});
