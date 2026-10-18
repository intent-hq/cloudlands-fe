import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseVersionPin } from './fetch-sidecar-lib.mjs';
import { OUTPUT_FILE, PIN_FILE, parseVersionModule } from './sync-intentd-protocol-version.mjs';

// Offline guard for the test fixtures' CURRENT_PROTOCOL_VERSION: the generated module
// records the intentd pin it was read from, and that pin must still be the one in
// intentd.version. auto-pin-intentd regenerates the module with every pin bump; this
// catches a hand-edited pin (the emergency-release path) that skipped the sync, which
// would leave fake hellos on the previous daemon's protocol (intent-hq/intent#7206).
const FIX_HINT = 'Run `node scripts/sync-intentd-protocol-version.mjs` and commit the result.';

export function checkProtocolPin(root = process.cwd()) {
  const pin = parseVersionPin(fs.readFileSync(path.join(root, PIN_FILE), 'utf8'));
  const modulePath = path.join(root, OUTPUT_FILE);
  if (!fs.existsSync(modulePath)) return { ok: false, message: `${OUTPUT_FILE} is missing. ${FIX_HINT}` };
  const recorded = parseVersionModule(fs.readFileSync(modulePath, 'utf8'));
  if (!recorded) {
    return { ok: false, message: `${OUTPUT_FILE} is not in the generated format. ${FIX_HINT}` };
  }
  if (recorded.pin !== pin) {
    return {
      ok: false,
      message: `${OUTPUT_FILE} was generated for intentd ${recorded.pin}, but ${PIN_FILE} pins ${pin}. ${FIX_HINT}`,
    };
  }
  return {
    ok: true,
    message: `${OUTPUT_FILE} matches ${PIN_FILE} ${pin} (protocol ${recorded.version}).`,
  };
}

export function main(argv = process.argv.slice(2), root = process.cwd()) {
  if (argv.length) {
    console.error(`Unknown argument(s): ${argv.join(' ')}\nUsage: node scripts/check-intentd-protocol-pin.mjs`);
    return 2;
  }
  try {
    const result = checkProtocolPin(root);
    (result.ok ? console.log : console.error)(result.message);
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(`check-intentd-protocol-pin: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
