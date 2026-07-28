#!/usr/bin/env node
// generate-pseudo-locale.mjs — regenerate messages/en-XA.json from
// messages/en.json (see pseudo-locale-lib.mjs for the transform). Runs as
// part of `pnpm run generate:i18n`; the output is gitignored.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { writePseudoCatalog } from './pseudo-locale-lib.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = writePseudoCatalog(rootDir);
console.log(`Pseudo-locale catalog written: ${outPath}`);
