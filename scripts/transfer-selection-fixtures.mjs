import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const monorepoFixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../docs/protocol/fixtures/transfer-selection',
);

function requiredPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty path`);
  }
  return path.resolve(value);
}

async function readRequiredJson(file) {
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(
      `required transfer-selection fixture ${file} could not be read (${error.code}); set TRANSFER_SELECTION_FIXTURE_ROOT to the shared monorepo fixture directory`,
      { cause: error },
    );
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`invalid JSON in required transfer-selection fixture ${file}`);
  }
}

// Connected runs supply the freshly emitted response path. Component CI supplies
// an explicit monorepo fixture root and consumes its checked-in golden. Neither
// mode invents sessions or silently skips when the shared contract is absent.
// Preserve the monorepo layout: docs/protocol/fixtures/transfer-selection and
// scripts/check-transfer-selection-contract.mjs must come from the same checkout.
// An explicitly empty root/output is invalid; only an unset value uses defaults.
export async function loadTransferSelectionFixtures({
  fixtureRoot = process.env.TRANSFER_SELECTION_FIXTURE_ROOT ?? monorepoFixtures,
  generated = process.env.TRANSFER_SELECTION_GENERATED,
  validatorPath,
  expectedSource = {},
} = {}) {
  const root = requiredPath(fixtureRoot, 'TRANSFER_SELECTION_FIXTURE_ROOT');
  const generatedPath = requiredPath(
    generated === undefined ? path.join(root, 'public-sessions.json') : generated,
    'TRANSFER_SELECTION_GENERATED',
  );
  const validator = requiredPath(
    validatorPath === undefined
      ? path.resolve(root, '../../../../scripts/check-transfer-selection-contract.mjs')
      : validatorPath,
    'validatorPath',
  );
  let shared;
  try {
    // Use Node's loader for the shared Node validator, including under jsdom.
    // Vite otherwise interprets its file URLs as renderer assets/modules.
    shared = require(validator);
  } catch (error) {
    throw new Error(
      `required transfer-selection validator ${validator} could not be loaded; set TRANSFER_SELECTION_FIXTURE_ROOT to the shared monorepo fixture directory`,
      { cause: error },
    );
  }
  const contract = await readRequiredJson(path.join(root, 'contract.json'));
  const artifact = await readRequiredJson(generatedPath);
  shared.assertGenerated(contract, artifact, expectedSource);
  return { contract, artifact, paths: { root, generated: generatedPath, validator } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadTransferSelectionFixtures()
    .then(({ artifact }) => console.info(JSON.stringify(artifact.provenance)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
