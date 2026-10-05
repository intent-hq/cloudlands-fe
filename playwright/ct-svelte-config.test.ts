// @verify-changed-triggers: playwright-ct.config.ts, svelte.config.js
// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('component-test Svelte compiler configuration', () => {
  it('retains the app component API when Vite is rooted in the CT template', () => {
    const root = resolve(__dirname, '..');
    const configUrl = pathToFileURL(resolve(root, 'playwright-ct.config.ts')).href;
    const script = `
      import config from ${JSON.stringify(configUrl)};
      import appConfig from './svelte.config.js';
      import { resolveConfig } from 'vite';
      import { svelte } from '@sveltejs/vite-plugin-svelte';

      const configured = config.use.ctViteConfig;
      const userConfig = typeof configured === 'function' ? await configured() : configured;
      const resolved = await resolveConfig({
        ...userConfig,
        root: ${JSON.stringify(resolve(root, 'playwright'))},
        configFile: false,
        plugins: userConfig.plugins?.length ? userConfig.plugins : [svelte()],
        logLevel: 'silent',
      }, 'build', 'production');
      const compiler = resolved.plugins.find(plugin => plugin.api?.options?.compilerOptions);
      process.stdout.write(JSON.stringify({
        app: appConfig.compilerOptions.compatibility,
        ct: compiler?.api.options.compilerOptions.compatibility ?? null,
      }));
    `;
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: root, encoding: 'utf8', timeout: 20_000 },
    );
    const options = JSON.parse(output);
    expect(options.app).toEqual({ componentApi: 4 });
    expect(options.ct).toEqual(options.app);
  });
});
