import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The update-channel persistence saga is the ONLY renderer call site of
// `autoUpdateClient.setChannel`. UI surfaces (the Settings channel selector, settings
// proposals) dispatch `setUpdateChannel` and let the saga persist it: a direct
// `setChannel` there duplicates the saga's write on every user change
// (intent-hq/monorepo#1672). `update-channel-regression.test.ts` proves the
// exactly-once write through the real store; this gate keeps the call-site
// discipline that proof relies on.
export const SCRIPT_PATH = 'scripts/check-update-channel-writer.mjs';
export const SCAN_ROOT = 'src';
export const WRITER_CALL = 'autoUpdateClient.setChannel';
export const DISPATCH_CALL = 'setUpdateChannel(';
export const WRITER_PATH =
  'src/store/renderer/slices/user-preferences/sagas/update-channel-saga.ts';
// UI surfaces that change the channel; each must dispatch the Redux action.
export const DISPATCH_SITES = Object.freeze([
  'src/routes/(app)/settings/+page.svelte',
  'src/lib/components/chat/proposals/settings-proposal-actions.ts',
]);

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', 'paraglide']);
const SCANNED_EXTENSIONS = new Set(['.ts', '.svelte']);
const TEST_PATH_PATTERN = /(?:^|\/)__tests__\/|\.(?:test|spec)\.ts$/;

const normalize = (value) => value.split(path.sep).join('/').replace(/^\.\//, '');

export const isScannedPath = (filePath) =>
  SCANNED_EXTENSIONS.has(path.posix.extname(filePath)) && !TEST_PATH_PATTERN.test(filePath);

// `{ hits, missingWriter, missingDispatch }` over `{ path, content }` files: non-writer
// files that call `setChannel`, whether the writer still does, and dispatch sites that
// no longer dispatch (or are gone).
export function checkUpdateChannelWriter(files) {
  const byPath = new Map(files.map((file) => [normalize(file.path), file.content]));
  const hits = [];
  for (const [filePath, content] of byPath) {
    if (!isScannedPath(filePath) || filePath === WRITER_PATH) continue;
    content.split('\n').forEach((text, index) => {
      if (text.includes(WRITER_CALL))
        hits.push({ path: filePath, line: index + 1, text: text.trim() });
    });
  }
  const missingWriter = !byPath.get(WRITER_PATH)?.includes(WRITER_CALL);
  const missingDispatch = DISPATCH_SITES.filter(
    (site) => !byPath.get(site)?.includes(DISPATCH_CALL),
  );
  return { hits, missingWriter, missingDispatch };
}

export function collectSourceFiles(root, directory = path.join(root, SCAN_ROOT)) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...collectSourceFiles(root, absolute));
    } else if (entry.isFile()) {
      const relative = normalize(path.relative(root, absolute));
      if (isScannedPath(relative)) {
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
      }
    }
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { hits, missingWriter, missingDispatch } = checkUpdateChannelWriter(
    collectSourceFiles(process.cwd()),
  );
  if (hits.length || missingWriter || missingDispatch.length) {
    const lines = [];
    if (hits.length) {
      lines.push(`\`${WRITER_CALL}\` outside the persistence saga (${WRITER_PATH}):`);
      lines.push(...hits.map((hit) => `  ${hit.path}:${hit.line}\n    ${hit.text}`));
      lines.push(
        '  Dispatch `setUpdateChannel(channel)` instead; the saga persists it exactly once',
        '  (intent-hq/monorepo#1672).',
      );
    }
    if (missingWriter) {
      lines.push(
        `${WRITER_PATH} no longer calls \`${WRITER_CALL}\`; update WRITER_PATH in ${SCRIPT_PATH}.`,
      );
    }
    if (missingDispatch.length) {
      lines.push(`Channel UI that must dispatch \`${DISPATCH_CALL}\`:`);
      lines.push(...missingDispatch.map((site) => `  ${site}`));
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log(
    'update-channel writer check passed: the persistence saga is the only setChannel caller.',
  );
}
