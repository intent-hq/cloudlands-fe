import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runIntentWeb } from '../src/features/intent-web/main/intent-web-cli.ts';

const source = fs.readFileSync(new URL('./fetch-tailcat.cjs', import.meta.url), 'utf8');
const pinnedTailcatVersion = source.match(/const TAILCAT_VERSION = '([^']+)'/)?.[1];
if (!pinnedTailcatVersion) throw new Error('Cannot read pinned tailcat version');
await runIntentWeb(process.argv.slice(2), {
  webRoot: fileURLToPath(new URL('../dist/web', import.meta.url)),
  pinnedTailcatVersion,
});
