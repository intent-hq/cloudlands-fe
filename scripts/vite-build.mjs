#!/usr/bin/env node
// Runs `vite build`, applying a default Node heap cap only when the caller has
// not already set one. An externally exported NODE_OPTIONS containing
// --max-old-space-size (or the V8 underscore alias --max_old_space_size, e.g.
// the release workflow's 12288 MB gate) passes through untouched; plain local
// builds keep the 4608 MB default.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const DEFAULT_HEAP_FLAG = '--max-old-space-size=4608';

const inherited = process.env.NODE_OPTIONS ?? '';
const nodeOptions = /--max[-_]old[-_]space[-_]size/.test(inherited)
  ? inherited
  : [inherited, DEFAULT_HEAP_FLAG].filter(Boolean).join(' ');

const require = createRequire(import.meta.url);
const vitePackagePath = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePackagePath), require(vitePackagePath).bin.vite);
const child = spawn(process.execPath, [viteBin, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
