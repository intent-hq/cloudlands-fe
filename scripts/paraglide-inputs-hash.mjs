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
//
// The digest is taken BEFORE compiling and persisted only if the inputs still
// hash the same afterwards: an edit that lands while the compiler runs may or
// may not be reflected in the outputs, so such a run leaves no sidecar and the
// next generation (or the preview's unplugin fallback) picks the edit up.
//
// Run directly (`pnpm run generate:i18n`), it compiles the project with the
// same options as `paraglide-js compile --output-structure locale-modules`;
// `--if-stale` skips the compile while the recorded hash still matches, so
// gates that merely need the outputs on disk (knip) stay cheap.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PARAGLIDE_INPUTS_HASH_FILE = '.inputs.sha256';
export const PARAGLIDE_OUTPUT_STRUCTURE = 'locale-modules';
const GENERATED_OUTPUTS = ['messages.js', 'runtime.js'];
const MAX_GENERATE_ATTEMPTS = 3;

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

/**
 * Run `compile` and record the inputs' digest next to its outputs. Returns
 * false (and leaves no sidecar) when the inputs changed while compiling.
 */
export async function compileWithInputsHash({ projectDir, messagesDir, outdir, compile }) {
  const sidecar = join(outdir, PARAGLIDE_INPUTS_HASH_FILE);
  rmSync(sidecar, { force: true });
  const digest = hashParaglideInputs({ projectDir, messagesDir });
  await compile();
  if (hashParaglideInputs({ projectDir, messagesDir }) !== digest) return false;
  writeFileSync(sidecar, `${digest}\n`);
  return true;
}

/** `compileWithInputsHash`, retried while edits keep landing mid-compile. */
export async function generateParaglide({ maxAttempts = MAX_GENERATE_ATTEMPTS, ...options }) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await compileWithInputsHash(options)) return true;
  }
  return false;
}

export function canReuseGeneratedParaglide({ projectDir, messagesDir, outdir }) {
  const sidecar = join(outdir, PARAGLIDE_INPUTS_HASH_FILE);
  const outputs = GENERATED_OUTPUTS.map((file) => join(outdir, file));
  if (!existsSync(sidecar) || outputs.some((file) => !existsSync(file))) return false;
  const recorded = readFileSync(sidecar, 'utf8').trim();
  return recorded.length > 0 && recorded === hashParaglideInputs({ projectDir, messagesDir });
}

/** `generateParaglide`, skipped when `ifStale` is set and the outputs are current. */
export async function ensureGeneratedParaglide({ ifStale = false, ...options }) {
  if (ifStale && canReuseGeneratedParaglide(options)) return true;
  return generateParaglide(options);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const projectDir = join(rootDir, 'project.inlang');
  const outdir = join(rootDir, 'src/shared/paraglide');
  const ok = await ensureGeneratedParaglide({
    ifStale: process.argv.includes('--if-stale'),
    projectDir,
    messagesDir: join(rootDir, 'messages'),
    outdir,
    compile: async () => {
      const { compile } = await import('@inlang/paraglide-js');
      return compile({ project: projectDir, outdir, outputStructure: PARAGLIDE_OUTPUT_STRUCTURE });
    },
  });
  if (!ok) {
    console.error('[generate:i18n] messages kept changing while compiling; rerun generate:i18n');
    process.exit(1);
  }
}
