#!/usr/bin/env tsx
/**
 * Type-checks every TypeScript program the app ships, without emitting files:
 * renderer (tsconfig.json), Electron main (tsconfig.main.json) and preload
 * (tsconfig.preload.json). tsconfig.json excludes src/main and src/preload, so a
 * renderer-only check misses them.
 *
 * Usage: tsx scripts/type-check.ts [--quiet] [--project=<renderer|main|preload>]...
 *   --project  Check only the named programs. `type-check:renderer` (prebuild, CI) uses
 *              it because build:main and build:preload compile their own programs.
 *   --quiet    Print nothing on success and only the diagnostics on failure.
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

type Command = { label: string; args: string[] };
type Project = { tsconfig: string; generate: Command[] };

const PROJECTS: Record<string, Project> = {
  renderer: { tsconfig: 'tsconfig.json', generate: [] },
  main: {
    tsconfig: 'tsconfig.main.json',
    generate: [
      {
        label: 'Generate main build config',
        args: ['scripts/generate-build-config.cjs', '--if-missing'],
      },
    ],
  },
  preload: {
    tsconfig: 'tsconfig.preload.json',
    generate: [
      {
        label: 'Generate preload IPC channels',
        args: [require.resolve('tsx/cli'), 'scripts/inline-ipc-channels.ts'],
      },
    ],
  },
};

const USAGE = `Usage: tsx scripts/type-check.ts [--quiet] [--project=<${Object.keys(PROJECTS).join('|')}>]...`;

function parseArgs(argv: string[]) {
  let quiet = false;
  const selected: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') quiet = true;
    else if (arg === '--project') selected.push(argv[++i] ?? '');
    else if (arg.startsWith('--project=')) selected.push(arg.slice('--project='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const name of selected) {
    if (!(name in PROJECTS)) throw new Error(`Unknown project: ${name || '(none)'}`);
  }
  return { quiet, names: selected.length ? [...new Set(selected)] : Object.keys(PROJECTS) };
}

function run({ args }: Command): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => resolve({ code: 1, output: `${error.message}\n` }));
    child.on('close', (code, signal) =>
      resolve({ code: code ?? 1, output: signal ? `${output}Killed by ${signal}\n` : output }),
    );
  });
}

async function main() {
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const { quiet, names } = options;
  const log = (line: string) => quiet || console.log(line);

  for (const name of names) {
    for (const step of PROJECTS[name].generate) {
      const { code, output } = await run(step);
      if (code !== 0) {
        process.stderr.write(output);
        console.error(`❌ ${step.label} failed`);
        return 1;
      }
    }
  }

  log(`🔍 Type checking ${names.join(', ')}...`);
  const tsc = require.resolve('typescript/bin/tsc');
  // Independent programs: run them together so the wall time is the slowest one.
  const results = await Promise.all(
    names.map(async (name) => {
      const { tsconfig } = PROJECTS[name];
      return {
        name,
        tsconfig,
        ...(await run({ label: name, args: [tsc, '-p', tsconfig, '--noEmit'] })),
      };
    }),
  );

  // Quiet hides progress, never the diagnostics (manual signed build run 43173439392).
  const failed = results.filter((result) => result.code !== 0);
  for (const { name, tsconfig, output } of failed) {
    process.stderr.write(output || `tsc -p ${tsconfig} failed without output\n`);
    console.error(`❌ Type check failed: ${name} (${tsconfig})`);
  }
  if (failed.length) return 1;
  log('✅ Type check passed');
  return 0;
}

void main().then((code) => process.exit(code));
