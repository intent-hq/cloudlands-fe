// @vitest-environment node
// @verify-changed-triggers: scripts/transfer-selection-fixtures.mjs, .github/workflows/intent-pr.yml
// Shared monorepo inputs are covered by the connected gate, outside this package's diff.
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTransferSelectionFixtures } from './transfer-selection-fixtures.mjs';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'transfer-selection-loader-'));
  directories.push(root);
  return root;
}

describe('transfer selection fixture loading', () => {
  it.each(['fixtureRoot', 'generated', 'validatorPath'])('rejects an empty %s', async (key) => {
    await expect(loadTransferSelectionFixtures({ [key]: '' })).rejects.toThrow(/non-empty/);
  });

  it.each(['fixtureRoot', 'generated', 'validatorPath'])(
    'rejects invalid %s values',
    async (key) => {
      for (const value of [null, false, 0, ' ']) {
        await expect(loadTransferSelectionFixtures({ [key]: value })).rejects.toThrow(/non-empty/);
      }
    },
  );

  it.each(['TRANSFER_SELECTION_FIXTURE_ROOT', 'TRANSFER_SELECTION_GENERATED'])(
    'rejects an empty %s environment override',
    async (key) => {
      vi.stubEnv(key, '');
      await expect(loadTransferSelectionFixtures()).rejects.toThrow(
        `${key} must be a non-empty path`,
      );
    },
  );

  it('fails clearly when the shared validator is missing', async () => {
    const root = await temporaryRoot();
    await expect(loadTransferSelectionFixtures({ fixtureRoot: root })).rejects.toThrow(
      /required.*validator.*TRANSFER_SELECTION_FIXTURE_ROOT/s,
    );
  });

  it('fails clearly when a required fixture is missing', async () => {
    const valid = await loadTransferSelectionFixtures();
    const root = await temporaryRoot();
    const options = {
      fixtureRoot: root,
      validatorPath: valid.paths.validator,
      generated: path.join(root, 'public-sessions.json'),
    };
    await expect(loadTransferSelectionFixtures(options)).rejects.toThrow(/required.*contract.json/);
    await writeFile(path.join(root, 'contract.json'), JSON.stringify(valid.contract));
    await expect(loadTransferSelectionFixtures(options)).rejects.toThrow(
      /required.*public-sessions.json/,
    );
  });

  it('reads a supplied response file directly and validates supplied source provenance', async () => {
    const valid = await loadTransferSelectionFixtures();
    const loaded = await loadTransferSelectionFixtures({
      generated: valid.paths.generated,
      expectedSource: {
        intentdRevision: valid.artifact.provenance.intentdRevision,
        generatorSha256: valid.artifact.provenance.generatorSha256,
      },
    });
    expect(loaded.artifact).toEqual(JSON.parse(await readFile(valid.paths.generated, 'utf8')));
    expect(loaded.artifact.cases.map((row) => row.id)).toEqual(
      loaded.contract.cases.map((row) => row.id),
    );
    await expect(
      loadTransferSelectionFixtures({ expectedSource: { intentdRevision: '0'.repeat(40) } }),
    ).rejects.toThrow(/provenance.intentdRevision/);
  });

  it('requires explicit fixtures in a standalone component checkout', async () => {
    const valid = await loadTransferSelectionFixtures();
    const root = await temporaryRoot();
    const component = path.join(root, 'component');
    const shared = path.join(root, 'shared');
    const fixtures = path.join(shared, 'docs/protocol/fixtures/transfer-selection');
    await mkdir(path.join(component, 'scripts'), { recursive: true });
    await mkdir(path.join(shared, 'scripts'), { recursive: true });
    await mkdir(fixtures, { recursive: true });
    await cp(
      'scripts/transfer-selection-fixtures.mjs',
      path.join(component, 'scripts/transfer-selection-fixtures.mjs'),
    );
    await cp(
      valid.paths.validator,
      path.join(shared, 'scripts/check-transfer-selection-contract.mjs'),
    );
    await cp(path.join(valid.paths.root, 'contract.json'), path.join(fixtures, 'contract.json'));
    await cp(valid.paths.generated, path.join(fixtures, 'public-sessions.json'));
    const env = { ...process.env };
    delete env.TRANSFER_SELECTION_FIXTURE_ROOT;
    delete env.TRANSFER_SELECTION_GENERATED;
    const run = () =>
      spawnSync(process.execPath, ['scripts/transfer-selection-fixtures.mjs'], {
        cwd: component,
        env,
        encoding: 'utf8',
      });
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('TRANSFER_SELECTION_FIXTURE_ROOT');
    env.TRANSFER_SELECTION_FIXTURE_ROOT = fixtures;
    const supplied = run();
    expect(supplied.status, supplied.stderr).toBe(0);
    expect(supplied.stdout).toContain(valid.artifact.provenance.payloadSha256);
    await rm(path.join(fixtures, 'public-sessions.json'));
    const absentGolden = run();
    expect(absentGolden.status).toBe(1);
    expect(absentGolden.stderr).toContain('public-sessions.json');
  });

  it.each(['hash', 'missing case', 'legacy alias'])(
    'rejects %s before rendering',
    async (change) => {
      const valid = await loadTransferSelectionFixtures();
      const root = await temporaryRoot();
      const generated = path.join(root, 'responses.json');
      const artifact = structuredClone(valid.artifact);
      if (change === 'hash') artifact.provenance.payloadSha256 = '0'.repeat(64);
      if (change === 'missing case') artifact.cases.pop();
      if (change === 'legacy alias') {
        artifact.cases.find((row) => row.id === 'acp:direct:codex=false').session.provider = 'acp';
      }
      // Rehash semantic corruptions: hash failures must not masquerade as coverage.
      const { hashJson } = createRequire(import.meta.url)(valid.paths.validator);
      if (change !== 'hash') artifact.provenance.payloadSha256 = hashJson(artifact.cases);
      await writeFile(generated, JSON.stringify(artifact));
      await expect(loadTransferSelectionFixtures({ generated })).rejects.toThrow(
        change === 'hash'
          ? /payloadSha256/
          : change === 'missing case'
            ? /32 cases/
            : /session.provider/,
      );
    },
  );
});
