import { fileURLToPath, URL } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { intentdBridgePlugin } from '../../scripts/vite-plugin-intentd-bridge.mjs';

export default defineConfig(({ command, mode, isPreview }) => {
  const isDevServer = command === 'serve' && !isPreview;
  const useIntentdBridge =
    isDevServer && process.env.INTENT_DEV_DAEMON_BRIDGE === '1' && process.platform !== 'win32';
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  const browserWsUrl = isDevServer
    ? env.VITE_INTENTD_WS_URL || (useIntentdBridge ? '/intentd/ws' : '')
    : '';

  return {
    publicDir: '../../static',
    plugins: [
      ...(useIntentdBridge ? [intentdBridgePlugin() as Plugin] : []),
      ...(browserWsUrl
        ? [
            {
              name: 'intent-react-dev-runtime-config',
              configureServer(server) {
                server.middlewares.use((request, response, next) => {
                  if (request.url?.split('?')[0] !== '/runtime-config.js') return next();
                  response.setHeader('Content-Type', 'application/javascript');
                  response.setHeader('Cache-Control', 'no-store');
                  response.end(
                    'globalThis.__INTENT_RUNTIME_CONFIG__ ??= Object.freeze(' +
                      JSON.stringify({ intentdWsUrl: browserWsUrl }) +
                      ');',
                  );
                });
              },
            } satisfies Plugin,
          ]
        : []),
      tanstackStart({
        spa: {
          enabled: true,
          // app://workspaces serves index.html for navigation. Ship dist/client
          // with the same asset-first, index fallback contract at desktop cutover.
          prerender: { outputPath: '/index.html' },
        },
      }),
      react(),
      babel({ include: /\.tsx?$/, plugins: ['module:@preact/signals-react-transform'] }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        $shared: fileURLToPath(new URL('../../src/shared', import.meta.url)),
        $lib: fileURLToPath(new URL('../../src/lib', import.meta.url)),
        '$features/providers/host-execution-errors': fileURLToPath(
          new URL('../../src/features/providers/host-execution-errors.ts', import.meta.url),
        ),
        '$features/agent/services/node-execution': fileURLToPath(
          new URL('../../src/features/agent/services/node-execution.ts', import.meta.url),
        ),
      },
      dedupe: ['react', 'react-dom', '@preact/signals-react'],
    },
    // The reference app's PostCSS configuration must not run in this renderer.
    css: { postcss: { plugins: [] } },
    server: { host: '127.0.0.1', port: Number(process.env.DEV_PORT || 5174), strictPort: true },
    preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  };
});
