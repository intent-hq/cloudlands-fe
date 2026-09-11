// paraglide-inputs-hash.mjs — content fingerprint for the generated Paraglide output.
//
// No shebang: vite.config.mjs imports this module, and Vite's config loader
// bundles it with esbuild, which rejects a shebang in an imported file.
//
// `paraglide-js compile` leaves output files whose content did not change
// untouched, so output mtimes cannot tell whether src/shared/paraglide matches
// the current messages/*.json + project.inlang/settings.json. Instead, the
// generation step records a sha256 over those inputs in a sidecar next to the
// outputs, and the UI-preview Vite config reuses the outputs only while the
// recorded hash matches the inputs on disk.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARAGLIDE_INPUTS_HASH_FILE = '.inputs.sha256';
const GENERATED_OUTPUTS = ['messages.js', 'runtime.js'];

export function paraglideInputFiles({ projectDir, messagesDir }) {
  const catalogs = readdirSync(messagesDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => join(messagesDir, file));
  return [join(projectDir, 'settings.json'), ...catalogs];
}

export function hashParaglideInputs({ projectDir, messagesDir }) {
  const hash = createHash('sha256');
  for (const file of paraglideInputFiles({ projectDir, messagesDir })) {
    hash.update(basename(file));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function writeParaglideInputsHash({ projectDir, messagesDir, outdir }) {
  const digest = hashParaglideInputs({ projectDir, messagesDir });
  writeFileSync(join(outdir, PARAGLIDE_INPUTS_HASH_FILE), `${digest}\n`);
  return digest;
}

export function canReuseGeneratedParaglide({ projectDir, messagesDir, outdir }) {
  const sidecar = join(outdir, PARAGLIDE_INPUTS_HASH_FILE);
  const outputs = GENERATED_OUTPUTS.map((file) => join(outdir, file));
  if (!existsSync(sidecar) || outputs.some((file) => !existsSync(file))) return false;
  const recorded = readFileSync(sidecar, 'utf8').trim();
  return recorded.length > 0 && recorded === hashParaglideInputs({ projectDir, messagesDir });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  writeParaglideInputsHash({
    projectDir: join(rootDir, 'project.inlang'),
    messagesDir: join(rootDir, 'messages'),
    outdir: join(rootDir, 'src/shared/paraglide'),
  });
}
