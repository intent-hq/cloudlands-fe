// @vitest-environment node
// @verify-changed-triggers: vite.config.mjs, package.json, pnpm-lock.yaml
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('answers Vim mode queries and continues parsing in the production bundle', () => {
  const configUrl = pathToFileURL(resolve('vite.config.mjs')).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import configure from ${JSON.stringify(configUrl)};
        import { build } from 'vite';
        import { JSDOM } from 'jsdom';
        const config = configure({ command: 'build', mode: 'production' });
        const result = await build({
          configFile: false,
          logLevel: 'silent',
          esbuild: config.esbuild,
          build: {
            ...config.build,
            write: false,
            sourcemap: false,
            rollupOptions: {
              input: 'node_modules/@xterm/xterm/lib/xterm.mjs',
              preserveEntrySignatures: 'strict',
              output: { format: 'es' },
            },
          },
        });
        const code = result.output.find(item => item.type === 'chunk').code;
        const dom = new JSDOM();
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        const pending = [];
        globalThis.setTimeout = callback => pending.push(callback);
        let terminal;
        try {
          const { Terminal } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
          terminal = new Terminal({ cols: 80, rows: 24 });
          const replies = [];
          terminal.onData(data => replies.push(data));
          terminal.write('\\x1b[4$p\\x1b[?2004$p\\x1b[?2004h\\x1b[?2004$p\\x1b[?2026$p');
          while (pending.length) pending.shift()();
          terminal.write('editor exited');
          while (pending.length) pending.shift()();
          const text = terminal.buffer.active.getLine(0).translateToString(true);
          process.stdout.write(JSON.stringify({ replies, text }));
        } finally {
          terminal?.dispose();
          dom.window.close();
        }
      `,
    ],
    { encoding: 'utf8', env: { ...process.env, INTENT_BUILD_TARGET: 'web' } },
  );

  expect(JSON.parse(output)).toEqual({
    replies: ['\x1b[4;2$y', '\x1b[?2004;2$y', '\x1b[?2004;1$y', '\x1b[?2026;2$y'],
    text: 'editor exited',
  });
});
