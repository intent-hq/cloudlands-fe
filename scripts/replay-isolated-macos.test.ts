// @verify-changed-triggers: .github/workflows/manual-signed-build.yml, scripts/verify-isolated-macos-package.mjs
// @vitest-environment node
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  extractSingleDmg,
  fileDigest,
  MANUAL149,
  replayVerificationArgs,
  validateReplayMetadata,
} from './replay-isolated-macos.mjs';

const fixture = () => ({
  run: {
    id: 38344567519,
    run_attempt: 1,
    run_number: 149,
    repository: { full_name: 'intent-hq/cloudlands-fe', id: 1283687685 },
    head_repository: { id: 1283687685 },
    head_sha: '9c72970e02a60635c894d0cc2958864a8fdac55e',
    event: 'workflow_dispatch',
    path: '.github/workflows/manual-signed-build.yml',
    status: 'completed',
    conclusion: 'failure',
  },
  artifact: {
    id: 11789692140,
    name: 'manual-macos-dmg-arm64',
    expired: false,
    expires_at: '2026-10-20T04:38:42Z',
    size_in_bytes: 1024701212,
    digest: 'sha256:1210ef7e636277545e747fe5ee45df164f9e9b8c02508ec3347d8803d36ba200',
    workflow_run: {
      id: 38344567519,
      repository_id: 1283687685,
      head_repository_id: 1283687685,
      head_sha: '9c72970e02a60635c894d0cc2958864a8fdac55e',
    },
  },
  jobs: {
    jobs: [
      {
        name: 'macOS (Apple Silicon)',
        id: 115122868748,
        run_id: 38344567519,
        status: 'completed',
        conclusion: 'success',
      },
    ],
  },
});
const now = Date.parse('2026-10-13T05:00:00Z');
it('accepts the retained signed build without relabeling its failed original proof', () => {
  const { run, artifact, jobs } = fixture();
  expect(() => validateReplayMetadata(run, artifact, jobs, now)).not.toThrow();
  expect(run.conclusion).toBe('failure');
});
for (const [name, mutate] of [
  [
    'different attempt',
    (v) => {
      v.run.run_attempt = 2;
    },
  ],
  [
    'foreign repo',
    (v) => {
      v.run.repository.id = 4;
    },
  ],
  [
    'fork',
    (v) => {
      v.artifact.workflow_run.head_repository_id = 4;
    },
  ],
  [
    'different source',
    (v) => {
      v.run.head_sha = 'f'.repeat(40);
    },
  ],
  [
    'wrong workflow',
    (v) => {
      v.run.path = '.github/workflows/other.yml';
    },
  ],
  [
    'wrong artifact',
    (v) => {
      v.artifact.id++;
    },
  ],
  [
    'expired',
    (v) => {
      v.artifact.expired = true;
    },
  ],
  [
    'elapsed expiry',
    (v) => {
      v.artifact.expires_at = '2026-10-12T00:00:00Z';
    },
  ],
  [
    'wrong bytes',
    (v) => {
      v.artifact.size_in_bytes--;
    },
  ],
  [
    'wrong digest',
    (v) => {
      v.artifact.digest = 'sha256:' + '0'.repeat(64);
    },
  ],
  [
    'failed build',
    (v) => {
      v.jobs.jobs[0].conclusion = 'failure';
    },
  ],
  [
    'duplicate build',
    (v) => {
      v.jobs.jobs.push(v.jobs.jobs[0]);
    },
  ],
] as const)
  it(`rejects ${name} before download`, () => {
    const v = fixture();
    mutate(v);
    expect(() => validateReplayMetadata(v.run, v.artifact, v.jobs, now)).toThrow();
  });
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function archive(entries: { name: string; mode?: number }[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  dirs.push(dir);
  const zip = path.join(dir, 'source.zip');
  execFileSync('python3', [
    '-c',
    `import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 for e in json.loads(sys.argv[2]):
  i=zipfile.ZipInfo(e['name']);i.external_attr=e.get('mode',0o100600)<<16;z.writestr(i,b'abc')`,
    zip,
    JSON.stringify(entries),
  ]);
  return { zip, destination: path.join(dir, 'package.dmg') };
}
const name = 'Intent GitLab Test-2.215.7-manual.149-arm64.dmg';
it('extracts only the expected member and hashes the actual bytes', () => {
  const { zip, destination } = archive([{ name }]);
  extractSingleDmg(zip, destination);
  expect(fs.readFileSync(destination, 'utf8')).toBe('abc');
  expect(fileDigest(destination)).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  expect(fileDigest(destination)).not.toBe(MANUAL149.dmgSha256);
  expect(() => extractSingleDmg(zip, destination)).toThrow();
});
for (const entries of [
  [{ name: '../' + name }],
  [{ name: '/' + name }],
  [{ name, mode: 0o120777 }],
  [{ name }, { name: 'extra' }],
])
  it(`rejects unsafe archive ${JSON.stringify(entries)}`, () => {
    const { zip, destination } = archive(entries);
    expect(() => extractSingleDmg(zip, destination)).toThrow();
    expect(fs.existsSync(destination)).toBe(false);
  });

it('binds historical replay to its original identities and exact protocol', () => {
  expect(replayVerificationArgs('/owned/package.dmg')).toEqual([
    'scripts/verify-isolated-macos-package.mjs',
    '/owned/package.dmg',
    'isolated-package-proof',
    MANUAL149.backendSha,
    MANUAL149.frontendSha,
    '14.0',
  ]);
});
