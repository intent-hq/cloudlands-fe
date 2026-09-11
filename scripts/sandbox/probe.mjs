#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSandboxArgs, runSandbox } from './runner.mjs';

export function parseProbeArgs(argv) {
  const runnerArgs = [];
  let selector;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value !== '--selector') {
      runnerArgs.push(value);
      continue;
    }
    if (selector !== undefined) throw new Error('--selector may only be specified once.');
    selector = argv[index + 1];
    if (selector === undefined || selector.startsWith('--')) {
      throw new Error('--selector requires a value.');
    }
    index += 1;
  }

  return { ...parseSandboxArgs(runnerArgs), ...(selector === undefined ? {} : { selector }) };
}

export function shapeProbeOutput(options, result) {
  return {
    scene: result.slug,
    state: result.state,
    theme: options.theme,
    width: result.width,
    root: result.root,
    probes: result.probes,
  };
}

export function formatProbeOutput(output) {
  return `${JSON.stringify(output, null, 2)}\n`;
}

export async function collectSandboxProbe(options) {
  return runSandbox(options, async ({ page }) => {
    const result = await page.evaluate((selector) => {
      return window.__INTENT_PREVIEW__?.probe(selector ? { selector } : undefined) ?? null;
    }, options.selector);
    if (!result) throw new Error('The preview did not expose geometry for the component frame.');
    return shapeProbeOutput(options, result);
  });
}

async function main(argv) {
  const options = parseProbeArgs(argv);
  const output = formatProbeOutput(await collectSandboxProbe(options));
  if (!options.out) {
    process.stdout.write(output);
    return;
  }
  const outputPath = path.resolve(options.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

const directRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (directRun) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`sandbox:probe: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
