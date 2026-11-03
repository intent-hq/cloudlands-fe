#!/usr/bin/env node
// Runs `vite build`, applying a default Node heap cap only when the caller has
// not already set one. An externally exported NODE_OPTIONS containing
// --max-old-space-size (or the V8 underscore alias --max_old_space_size, e.g.
// the release workflow's 12288 MB gate) passes through untouched; plain local
// builds get DEFAULT_HEAP_FLAG.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// The desktop renderer build (`pnpm run build:renderer`) peaked at ~5.8 GB of
// V8 heap (~5.7 GB live after a full GC, ~7.5 GB RSS) on cloudlands-fe main
// 2.275.1, and OOMed at the previous 4608 MB default. The peak is the same on
// 8 and 32 cores, so a CI runner predicts a developer machine. 8192 leaves
// ~40% headroom. The intent-pr.yml build-web job builds the renderer with no
// NODE_OPTIONS, i.e. under this default, so outgrowing it fails CI instead of
// silently breaking every local build. Raise it, with headroom, when it does.
const DEFAULT_HEAP_FLAG = '--max-old-space-size=8192';
const HEAP_FLAG_PATTERN = /--max[-_]old[-_]space[-_]size=?\S*/;

const inherited = process.env.NODE_OPTIONS ?? '';
const inheritedHeapFlag = HEAP_FLAG_PATTERN.exec(inherited)?.[0];
const nodeOptions = inheritedHeapFlag
  ? inherited
  : [inherited, DEFAULT_HEAP_FLAG].filter(Boolean).join(' ');

// V8 aborts (SIGABRT) when the heap cap is exhausted. Say so plainly: the
// fatal error scrolls past easily, and `... | tail` can even hide the failure.
function abortHint() {
  const cap = inheritedHeapFlag
    ? `${inheritedHeapFlag} from NODE_OPTIONS`
    : `default ${DEFAULT_HEAP_FLAG} (scripts/vite-build.mjs)`;
  return (
    `If the output above says "JavaScript heap out of memory", the build outgrew its ${cap}.\n` +
    'Retry with a larger cap, e.g. NODE_OPTIONS=--max-old-space-size=12288, and raise ' +
    'DEFAULT_HEAP_FLAG in scripts/vite-build.mjs if the default is too small.\n'
  );
}

const require = createRequire(import.meta.url);
const vitePackagePath = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePackagePath), require(vitePackagePath).bin.vite);
const child = spawn(process.execPath, [viteBin, 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
child.on('exit', (code, signal) => {
  if (signal) {
    const message =
      `vite build terminated by ${signal}\n` + (signal === 'SIGABRT' ? abortHint() : '');
    // Wait for piped stderr to flush before exiting, even with a slow reader.
    process.stderr.write(message, () => process.exit(1));
  } else {
    process.exit(code ?? 1);
  }
});
