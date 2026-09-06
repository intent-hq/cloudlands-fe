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

function readPluginNames(uiPreview: boolean): string[] {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ command: 'serve', mode: 'development' });
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

function readProxySnapshot({
  command = 'serve',
  mode = 'development',
  buildTarget = 'web',
  proxyTarget = '',
  wsUrl = '',
} = {}) {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const script = `
    import createViteConfig from ${JSON.stringify(configUrl)};
    const config = createViteConfig({ command: process.env.TEST_VITE_COMMAND, mode: process.env.TEST_VITE_MODE });
    const proxy = config.server.proxy?.['/intentd-ws'];
    process.stdout.write(JSON.stringify({
      pluginNames: config.plugins.map((plugin) => plugin.name),
      proxy: proxy && {
        target: proxy.target,
        ws: proxy.ws,
        changeOrigin: proxy.changeOrigin,
        rewrittenPath: proxy.rewrite('/intentd-ws/rpc'),
      },
      browserMockDefine: config.define['import.meta.env.VITE_ENABLE_BROWSER_MOCK'] ?? null,
    }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INTENT_BUILD_TARGET: buildTarget,
      INTENTD_WS_PROXY_TARGET: proxyTarget,
      TEST_VITE_COMMAND: command,
      TEST_VITE_MODE: mode,
      VITE_INTENTD_WS_URL: wsUrl,
    },
  });
  return JSON.parse(output);
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

  it('reuses current generated messages only for the UI preview', () => {
    expect(readPluginNames(true)).toContain('reuse-generated-paraglide');
    expect(readPluginNames(false)).toContain('unplugin-paraglide-js');
  });

  it('proxies the same-origin intentd websocket only for web development', () => {
    const config = readProxySnapshot({ proxyTarget: 'ws://127.0.0.1:51337' });

    expect(config.proxy).toEqual({
      target: 'ws://127.0.0.1:51337',
      ws: true,
      changeOrigin: false,
      rewrittenPath: '/ws/rpc',
    });
    expect(config.pluginNames).toContain('dev-intentd-runtime-config');
    expect(config.browserMockDefine).toBeNull();
  });

  it('does not install the same-origin intentd websocket proxy in production builds', () => {
    const config = readProxySnapshot({
      command: 'build',
      mode: 'production',
      proxyTarget: 'ws://127.0.0.1:51337',
    });

    expect(config.proxy).toBeUndefined();
    expect(config.pluginNames).not.toContain('dev-intentd-runtime-config');
  });

  it('keeps existing browser websocket development behavior when the proxy is unset', () => {
    const config = readProxySnapshot({ wsUrl: 'ws://127.0.0.1:5181/rpc' });

    expect(config.proxy).toBeUndefined();
    expect(config.pluginNames).not.toContain('dev-intentd-runtime-config');
    expect(config.browserMockDefine).toBeNull();
  });
});
