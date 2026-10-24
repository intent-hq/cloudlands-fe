/** Proof-only continuation of one retained, signed package; never rebuilds or installs it. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANUAL149 = Object.freeze({
  repository: 'intent-hq/cloudlands-fe',
  repositoryId: 1283687685,
  run: 38344567519,
  attempt: 1,
  artifact: 11789692140,
  archiveBytes: 1024701212,
  archiveSha256: '1210ef7e636277545e747fe5ee45df164f9e9b8c02508ec3347d8803d36ba200',
  dmgSha256: '61ebe0d81e4fc3be53a8af750a1c2e4a2fd197e38ff7b6627ec89631f7656c98',
  frontendSha: '9c72970e02a60635c894d0cc2958864a8fdac55e',
  backendSha: '2b48fe711f0cc25fe184fddd80afac2b6db7f97b',
  buildId: 'manual-38344567519-1',
});

export function replayVerificationArgs(dmg) {
  return [
    'scripts/verify-isolated-macos-package.mjs',
    dmg,
    'isolated-package-proof',
    MANUAL149.backendSha,
    MANUAL149.frontendSha,
    '14.0',
  ];
}

export function validateReplayMetadata(run, artifact, jobs, now = Date.now()) {
  const pin = MANUAL149;
  assert.equal(run.id, pin.run);
  assert.equal(run.run_attempt, pin.attempt);
  assert.equal(run.run_number, 149);
  assert.equal(run.repository?.full_name, pin.repository);
  assert.equal(run.repository?.id, pin.repositoryId);
  assert.equal(run.head_repository?.id, pin.repositoryId);
  assert.equal(run.head_sha, pin.frontendSha);
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.path, '.github/workflows/manual-signed-build.yml');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'failure'); // Original isolation failure remains a failure.
  assert.equal(artifact.id, pin.artifact);
  assert.equal(artifact.name, 'manual-macos-dmg-arm64');
  assert.equal(artifact.expired, false);
  assert.ok(Date.parse(artifact.expires_at) > now, 'Artifact expired');
  assert.equal(artifact.size_in_bytes, pin.archiveBytes);
  assert.equal(artifact.digest, `sha256:${pin.archiveSha256}`);
  assert.equal(artifact.workflow_run?.id, pin.run);
  assert.equal(artifact.workflow_run?.repository_id, pin.repositoryId);
  assert.equal(artifact.workflow_run?.head_repository_id, pin.repositoryId);
  assert.equal(artifact.workflow_run?.head_sha, pin.frontendSha);
  const builds = jobs.jobs.filter((job) => job.name === 'macOS (Apple Silicon)');
  assert.equal(builds.length, 1);
  assert.equal(builds[0].id, 115122868748);
  assert.equal(builds[0].run_id, pin.run);
  assert.equal(builds[0].status, 'completed');
  assert.equal(builds[0].conclusion, 'success');
}

export function fileDigest(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// Do not extract arbitrary ZIP paths, symlinks, or extra payloads. The destination is ours.
export function extractSingleDmg(archive, destination) {
  execFileSync(
    'python3',
    [
      '-c',
      `
import pathlib, shutil, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) != 1:
        raise ValueError('Expected exactly one DMG member')
    entry = entries[0]
    name = pathlib.PurePosixPath(entry.filename)
    if len(name.parts) != 1 or name.name != 'Intent GitLab Test-2.215.7-manual.149-arm64.dmg':
        raise ValueError('Unexpected DMG member')
    mode = entry.external_attr >> 16
    if stat.S_IFMT(mode) not in (0, stat.S_IFREG) or entry.file_size > 2 * 1024**3:
        raise ValueError('Unsafe DMG member')
    with archive.open(entry) as source, open(sys.argv[2], 'xb') as target:
        shutil.copyfileobj(source, target, length=1024*1024)
`,
      archive,
      destination,
    ],
    { timeout: 120_000, killSignal: 'SIGKILL', stdio: 'pipe' },
  );
}

async function main() {
  assert.equal(process.env.GITHUB_REPOSITORY, MANUAL149.repository);
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(process.env.RUNNER_TEMP);
  const output = 'isolated-replay-provenance';
  fs.mkdirSync(output, { mode: 0o700 });
  const api = (endpoint) =>
    JSON.parse(
      execFileSync('gh', ['api', endpoint], {
        encoding: 'utf8',
        timeout: 30_000,
        killSignal: 'SIGKILL',
        maxBuffer: 2 * 1024 * 1024,
      }),
    );
  const base = `repos/${MANUAL149.repository}/actions`;
  const run = api(`${base}/runs/${MANUAL149.run}/attempts/${MANUAL149.attempt}`);
  const artifact = api(`${base}/artifacts/${MANUAL149.artifact}`);
  const jobs = api(`${base}/runs/${MANUAL149.run}/attempts/${MANUAL149.attempt}/jobs?per_page=100`);
  validateReplayMetadata(run, artifact, jobs);
  fs.writeFileSync(
    path.join(output, 'source.json'),
    JSON.stringify(
      {
        verifierSha: process.env.GITHUB_SHA,
        package: MANUAL149,
        run,
        artifact,
        jobs,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'isolated-replay-'));
  const archive = path.join(directory, 'package.zip');
  const fd = fs.openSync(archive, 'wx', 0o600);
  try {
    execFileSync('gh', ['api', `${base}/artifacts/${MANUAL149.artifact}/zip`], {
      stdio: ['ignore', fd, 'pipe'],
      timeout: 180_000,
      killSignal: 'SIGKILL',
    });
  } finally {
    fs.closeSync(fd);
  }
  assert.equal(fs.statSync(archive).size, MANUAL149.archiveBytes);
  assert.equal(fileDigest(archive), MANUAL149.archiveSha256);
  const dmg = path.join(directory, 'package.dmg');
  extractSingleDmg(archive, dmg);
  assert.equal(fileDigest(dmg), MANUAL149.dmgSha256);
  const result = spawnSync(process.execPath, replayVerificationArgs(dmg), {
    stdio: 'inherit',
    timeout: 15 * 60_000,
    killSignal: 'SIGKILL',
    env: { ...process.env, ISOLATED_REPLAY_BUILD_ID: MANUAL149.buildId },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  const proof = JSON.parse(fs.readFileSync('isolated-package-proof/isolation.json', 'utf8'));
  assert.equal(proof.passed, true);
  assert.equal(proof.completed, true);
  assert.equal(proof.frontendSha, MANUAL149.frontendSha);
  assert.equal(proof.backendSha, MANUAL149.backendSha);
  assert.equal(proof.dmgSha256, MANUAL149.dmgSha256);
  assert.equal(proof.plist?.build, MANUAL149.buildId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
