// @vitest-environment node
// @verify-changed-triggers: scripts/mac-update-feed.mjs, package.json, pnpm-lock.yaml
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareMacUpdateFeed, validateMacUpdateFeed } from './mac-update-feed.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump } = updaterRequire('js-yaml');
const directories: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'intent-mac-feed-'));
  directories.push(root);
  const directory = join(root, 'release-mac-arm64');
  mkdirSync(directory);
  const files = ['zip', 'dmg'].map((extension) => {
    const url = `Intent-2.219.7-arm64${extension === 'zip' ? '-mac' : ''}.${extension}`;
    const data = Buffer.from(`fixture arm64 ${extension}`);
    writeFileSync(join(directory, url), data);
    return { url, sha512: createHash('sha512').update(data).digest('base64'), size: data.length };
  });
  const path = join(directory, 'latest-mac.yml');
  writeFileSync(
    path,
    dump({
      version: '2.219.7',
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseDate: '2026-10-16T12:00:00.000Z',
      releaseName: 'Apple Silicon',
      releaseNotes: 'Signed native build',
      minimumSystemVersion: '13.0.0',
      stagingPercentage: 50,
    }),
  );
  return { root, path };
}

function edit(path: string, change: (info: any) => void) {
  const info = load(readFileSync(path, 'utf8'));
  change(info);
  writeFileSync(path, dump(info));
}
function cli(args: string[]) {
  return spawnSync(process.execPath, ['scripts/mac-update-feed.mjs', ...args], {
    encoding: 'utf8',
  });
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('Apple Silicon update feed validation', () => {
  it('retains release and rollout metadata while validating archive bytes', async () => {
    const input = fixture();
    edit(input.path, (info) => {
      info.size = info.files[0].size;
      info.files[0].blockMapSize = 123;
      info.sha2 = createHash('sha256')
        .update(readFileSync(join(dirname(input.path), info.path)))
        .digest('hex');
    });
    const info = await prepareMacUpdateFeed(input.path);
    expect(info).toMatchObject({
      version: '2.219.7',
      path: 'Intent-2.219.7-arm64-mac.zip',
      releaseName: 'Apple Silicon',
      releaseNotes: 'Signed native build',
      minimumSystemVersion: '13.0.0',
      stagingPercentage: 50,
      files: [{ blockMapSize: 123 }, {}],
    });
    expect(info.sha2).toMatch(/^[a-f0-9]{64}$/);
    await expect(validateMacUpdateFeed(input.path)).resolves.toEqual(info);
  });

  it('writes deterministically and validates final upload assets', async () => {
    const input = fixture();
    const output = join(input.root, 'publish', 'latest-mac.yml');
    const args = ['--arm64', input.path, '--output', output];
    expect(cli(args)).toMatchObject({ status: 0 });
    const first = readFileSync(output, 'utf8');
    expect(cli(args)).toMatchObject({ status: 0 });
    expect(readFileSync(output, 'utf8')).toBe(first);
    for (const file of load(first).files)
      copyFileSync(join(dirname(input.path), file.url), join(dirname(output), file.url));
    expect(cli(['--validate', output]).status).toBe(0);
    writeFileSync(join(dirname(output), load(first).files[0].url), 'corrupt');
    expect(cli(['--validate', output]).status).toBe(1);
  });

  it.each([
    [
      'version',
      (info: any) => {
        info.version = 'banana';
      },
      /version/,
    ],
    [
      'date',
      (info: any) => {
        info.releaseDate = 'yesterday';
      },
      /releaseDate/,
    ],
    [
      'missing ZIP',
      (info: any) => {
        info.files.shift();
        delete info.path;
        delete info.sha512;
      },
      /ZIP/,
    ],
    [
      'missing files',
      (info: any) => {
        delete info.files;
      },
      /files/,
    ],
    [
      'duplicate',
      (info: any) => {
        info.files.push(info.files[0]);
      },
      /Duplicate/,
    ],
    [
      'second ZIP',
      (info: any) => {
        info.files.push({ ...info.files[0], url: 'Other-arm64.zip' });
      },
      /ZIP/,
    ],
    [
      'Intel architecture',
      (info: any) => {
        info.files[0].url = 'Intent-x64-mac.zip';
      },
      /architecture/,
    ],
    [
      'ambiguous architecture',
      (info: any) => {
        info.files[0].url = 'Intent-arm64-x64.zip';
      },
      /architecture/,
    ],
    [
      'substring ambiguity',
      (info: any) => {
        info.files[0].url = 'alarm64-Intent-x64.zip';
      },
      /architecture/,
    ],
    [
      'no architecture',
      (info: any) => {
        info.files[0].url = 'Intent-mac.zip';
      },
      /architecture/,
    ],
    [
      'missing size',
      (info: any) => {
        delete info.files[0].size;
      },
      /size/,
    ],
    [
      'wrong size',
      (info: any) => {
        info.files[0].size++;
      },
      /size/,
    ],
    [
      'hash encoding',
      (info: any) => {
        info.files[0].sha512 = 'abc';
      },
      /sha512/,
    ],
    [
      'wrong hash',
      (info: any) => {
        info.files[0].sha512 = Buffer.alloc(64).toString('base64');
        delete info.path;
        delete info.sha512;
      },
      /sha512/,
    ],
    [
      'legacy path',
      (info: any) => {
        info.path = 'Other-arm64.zip';
      },
      /legacy/,
    ],
    [
      'legacy hash',
      (info: any) => {
        info.sha512 = 'incorrect';
      },
      /legacy/,
    ],
    [
      'legacy size',
      (info: any) => {
        info.size = info.files[0].size + 1;
      },
      /legacy.*size/,
    ],
    [
      'legacy sha2',
      (info: any) => {
        info.sha2 = 'incorrect';
      },
      /sha2/,
    ],
    [
      'per-file sha2',
      (info: any) => {
        info.files[0].sha2 = 'incorrect';
      },
      /sha2/,
    ],
  ])('rejects %s', async (_name, mutate, error) => {
    const input = fixture();
    edit(input.path, mutate as (info: any) => void);
    await expect(prepareMacUpdateFeed(input.path)).rejects.toThrow(error as RegExp);
  });

  it.each([
    '../Intent-arm64.zip',
    '/Intent-arm64.zip',
    'https://other/Intent-arm64.zip',
    'Intent%20-arm64.zip',
    'Intent arm64.zip',
    'Intent-arm64.zip?x=1',
    'Intent\\arm64.zip',
  ])('rejects unsafe filename %s', async (name) => {
    const input = fixture();
    edit(input.path, (info) => {
      info.files[0].url = name;
    });
    await expect(prepareMacUpdateFeed(input.path)).rejects.toThrow(/Unsafe/);
  });

  it('rejects missing and symlinked assets', async () => {
    const input = fixture();
    const archive = join(dirname(input.path), 'Intent-2.219.7-arm64-mac.zip');
    rmSync(archive);
    await expect(prepareMacUpdateFeed(input.path)).rejects.toThrow(/ENOENT/);
    symlinkSync(input.path, archive);
    await expect(prepareMacUpdateFeed(input.path)).rejects.toThrow(/regular file/);
  });

  it('rejects duplicate keys, multiple YAML documents, and empty documents', async () => {
    const input = fixture();
    const original = readFileSync(input.path, 'utf8');
    for (const content of [
      original + '\nversion: 2.219.7\n',
      original + '\n---\nversion: 2.219.7\n',
      '',
    ]) {
      writeFileSync(input.path, content);
      await expect(prepareMacUpdateFeed(input.path)).rejects.toThrow();
    }
  });

  it('preserves the output on failure and refuses source overwrite', () => {
    const input = fixture();
    const output = join(input.root, 'latest-mac.yml');
    writeFileSync(output, 'previous feed');
    edit(input.path, (info) => {
      info.version = 'invalid';
    });
    expect(cli(['--arm64', input.path, '--output', output]).status).toBe(1);
    expect(readFileSync(output, 'utf8')).toBe('previous feed');
    edit(input.path, (info) => {
      info.version = '2.219.7';
    });
    const before = readFileSync(input.path, 'utf8');
    expect(cli(['--arm64', input.path, '--output', input.path]).status).toBe(1);
    expect(readFileSync(input.path, 'utf8')).toBe(before);
  });

  it.each(
    [
      [],
      ['--wat'],
      ['--arm64', 'a'],
      ['--validate', 'a', '--arm64', 'b'],
      ['--arm64', 'a', '--arm64', 'b', '--output', 'd'],
      ['--arm64', 'a', '--x64', 'b', '--output', 'd'],
    ].map((args) => ({ args })),
  )('rejects unsupported CLI arguments $args', ({ args }) => {
    const result = cli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});
