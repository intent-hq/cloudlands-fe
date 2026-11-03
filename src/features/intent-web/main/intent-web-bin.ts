// Entry point of the published @intent-hq/web package (bundled by
// scripts/build-intent-web-package.mjs). The bundle sits in bin/ and the web
// build in web/, both at the package root.
import { fileURLToPath } from 'node:url';
import { runIntentWeb } from './intent-web-cli';

declare const __INTENT_WEB_TAILCAT_VERSION__: string;

try {
  await runIntentWeb(process.argv.slice(2), {
    webRoot: fileURLToPath(new URL('../web', import.meta.url)),
    pinnedTailcatVersion: __INTENT_WEB_TAILCAT_VERSION__,
  });
} catch (error) {
  console.error(`intent-web: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
