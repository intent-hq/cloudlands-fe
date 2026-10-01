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
import { mergeMacUpdateFeeds, validateMacUpdateFeed } from './mac-update-feed.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump } = updaterRequire('js-yaml');
const { MacUpdater } = updaterRequire('./MacUpdater');
const { resolveFiles, findFile, parseUpdateInfo } = updaterRequire('./providers/Provider');
const directories: string[] = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'intent-mac-feed-'));
  directories.push(root);
  const paths = { arm64: '', x64: '' };
  for (const arch of ['arm64', 'x64'] as const) {
    const directory = join(root, `release-mac-${arch}`);
    mkdirSync(directory);
    const files = ['zip', 'dmg'].map((extension) => {
      const url = `Intent-2.191.0-${arch}${extension === 'zip' ? '-mac' : ''}.${extension}`;
      const data = Buffer.from(`fixture ${arch} ${extension}`);
      writeFileSync(join(directory, url), data);
      return { url, sha512: createHash('sha512').update(data).digest('base64'), size: data.length };
    });
    paths[arch] = join(directory, 'latest-mac.yml');
    writeFileSync(
      paths[arch],
      dump({
        version: '2.191.0',
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        releaseDate: arch === 'arm64' ? '2026-09-30T12:00:00.000Z' : '2026-09-30T13:00:00.000Z',
        releaseName: 'Intel and Apple Silicon',
        releaseNotes: 'Signed native builds',
        minimumSystemVersion: '13.0.0',
        stagingPercentage: 50,
      }),
    );
  }
  return { root, ...paths };
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

describe('Mac update feed assembly', () => {
  it('combines per-job feeds deterministically, retaining metadata and Intel legacy fallback', async () => {
    const input = fixture();
    const merged = await mergeMacUpdateFeeds(input);
    expect(merged.files.map((file: any) => file.url)).toEqual([
      'Intent-2.191.0-x64-mac.zip',
      'Intent-2.191.0-x64.dmg',
      'Intent-2.191.0-arm64-mac.zip',
      'Intent-2.191.0-arm64.dmg',
    ]);
    expect(merged).toMatchObject({
      version: '2.191.0',
      path: 'Intent-2.191.0-x64-mac.zip',
      sha512: merged.files[0].sha512,
      releaseDate: '2026-09-30T13:00:00.000Z',
      releaseName: 'Intel and Apple Silicon',
      releaseNotes: 'Signed native builds',
      minimumSystemVersion: '13.0.0',
      stagingPercentage: 50,
    });
    edit(input.x64, (info) => info.files.reverse());
    edit(input.arm64, (info) => info.files.reverse());
    expect(await mergeMacUpdateFeeds(input)).toEqual(merged);
  });

  it.each([false, true])(
    'selects the correct ZIP using installed MacUpdater 6.8.9 (arm64=%s)',
    async (arm64) => {
      const input = fixture();
      const merged = await mergeMacUpdateFeeds(input);
      expect(updaterRequire('../package.json').version).toBe('6.8.9');
      const parsed = parseUpdateInfo(
        dump(merged),
        'latest-mac.yml',
        'https://updates.example/latest-mac.yml',
      );
      const resolved = resolveFiles(parsed, new URL('https://updates.example/'));
      const selected = findFile(MacUpdater.filterFilesForArch(resolved, arm64), 'zip', [
        'pkg',
        'dmg',
      ]);
      expect(selected.url.pathname).toBe(`/Intent-2.191.0-${arm64 ? 'arm64' : 'x64'}-mac.zip`);
      expect(selected.info.sha512).toBe(
        merged.files.find((file: any) => file.url === selected.info.url).sha512,
      );
    },
  );

  it('writes one feed before flattening and validates the final publish directory', async () => {
    const input = fixture();
    const output = join(input.root, 'publish', 'latest-mac.yml');
    const args = ['--arm64', input.arm64, '--x64', input.x64, '--output', output];
    expect(cli(args)).toMatchObject({ status: 0 });
    const first = readFileSync(output, 'utf8');
    expect(cli(args)).toMatchObject({ status: 0 });
    expect(readFileSync(output, 'utf8')).toBe(first);
    const merged = load(first);
    for (const file of merged.files) {
      const source = file.url.includes('arm64') ? input.arm64 : input.x64;
      copyFileSync(join(dirname(source), file.url), join(dirname(output), file.url));
    }
    await expect(validateMacUpdateFeed(output)).resolves.toEqual(merged);
    expect(cli(['--validate', output]).status).toBe(0);
    writeFileSync(join(dirname(output), merged.files[0].url), 'corrupt');
    expect(cli(['--validate', output]).status).toBe(1);
  });

  it('preserves per-file metadata and verified legacy sha2 when provided', async () => {
    const input = fixture();
    edit(input.x64, (info) => {
      info.files[0].blockMapSize = 123;
      info.sha2 = createHash('sha256')
        .update(readFileSync(join(dirname(input.x64), info.path)))
        .digest('hex');
    });
    const merged = await mergeMacUpdateFeeds(input);
    expect(merged.files[0].blockMapSize).toBe(123);
    expect(merged.sha2).toBe(load(readFileSync(input.x64, 'utf8')).sha2);
  });

  it('regenerates legacy fields when source feeds only provide modern files', async () => {
    const input = fixture();
    for (const path of [input.arm64, input.x64])
      edit(path, (info) => {
        delete info.path;
        delete info.sha512;
      });
    const merged = await mergeMacUpdateFeeds(input);
    expect(merged.path).toBe('Intent-2.191.0-x64-mac.zip');
    expect(merged.sha512).toBe(merged.files[0].sha512);
  });

  it('checks optional per-file sha2 hashes as well as sha512', async () => {
    const input = fixture();
    edit(input.arm64, (info) => {
      info.files[0].sha2 = 'incorrect';
    });
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(/sha2/);
  });

  it('preserves the verified Intel legacy size despite different per-job ZIP sizes', async () => {
    const input = fixture();
    for (const path of [input.arm64, input.x64])
      edit(path, (info) => {
        info.size = info.files[0].size;
      });
    const merged = await mergeMacUpdateFeeds(input);
    expect(merged.size).toBe(merged.files[0].size);
  });

  it('rejects legacy size inconsistent with its ZIP', async () => {
    const input = fixture();
    edit(input.x64, (info) => {
      info.size = info.files[0].size + 1;
    });
    edit(input.arm64, (info) => {
      info.size = load(readFileSync(input.x64, 'utf8')).size;
    });
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(/legacy.*size/);
  });

  it.each([
    [
      'version',
      (info: any) => {
        info.version = '2.192.0';
      },
      /version/,
    ],
    [
      'invalid version',
      (info: any) => {
        info.version = 'banana';
      },
      /version/,
    ],
    [
      'metadata',
      (info: any) => {
        info.releaseNotes = 'different';
      },
      /releaseNotes/,
    ],
    [
      'missing metadata',
      (info: any) => {
        delete info.minimumSystemVersion;
      },
      /minimumSystemVersion/,
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
        info.files.push({ ...info.files[0], url: 'Other-x64.zip' });
      },
      /ZIP/,
    ],
    [
      'wrong architecture',
      (info: any) => {
        info.files[0].url = 'Intent-arm64-mac.zip';
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
      'updater substring ambiguity',
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
        info.files[0].size += 1;
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
        info.path = 'Other-x64.zip';
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
      'legacy sha2',
      (info: any) => {
        info.sha2 = 'incorrect';
      },
      /sha2/,
    ],
  ])('rejects %s', async (_name, mutate, error) => {
    const input = fixture();
    edit(input.x64, mutate as (info: any) => void);
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(error as RegExp);
  });

  it.each([
    '../Intent-x64.zip',
    '/Intent-x64.zip',
    'https://other/Intent-x64.zip',
    'Intent%20-x64.zip',
    'Intent x64.zip',
    'Intent-x64.zip?x=1',
    'Intent\\x64.zip',
  ])('rejects unsafe filename %s', async (name) => {
    const input = fixture();
    edit(input.x64, (info) => {
      info.files[0].url = name;
    });
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(/Unsafe/);
  });

  it('rejects missing assets and symlinked assets', async () => {
    const input = fixture();
    const archive = join(dirname(input.x64), 'Intent-2.191.0-x64-mac.zip');
    rmSync(archive);
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(/ENOENT/);
    symlinkSync(input.arm64, archive);
    await expect(mergeMacUpdateFeeds(input)).rejects.toThrow(/regular file/);
  });

  it('rejects YAML duplicate keys, multiple documents, and empty documents', async () => {
    const input = fixture();
    const original = readFileSync(input.x64, 'utf8');
    for (const content of [
      original + '\nversion: 2.191.0\n',
      original + '\n---\nversion: 2.191.0\n',
      '',
    ]) {
      writeFileSync(input.x64, content);
      await expect(mergeMacUpdateFeeds(input)).rejects.toThrow();
    }
  });

  it('rejects missing or repeated architecture inputs and single-architecture combined feeds', async () => {
    const input = fixture();
    await expect(mergeMacUpdateFeeds({ arm64: input.arm64 })).rejects.toThrow(/x64/);
    await expect(mergeMacUpdateFeeds({ arm64: input.arm64, x64: input.arm64 })).rejects.toThrow(
      /distinct/,
    );
    await expect(validateMacUpdateFeed(input.x64)).rejects.toThrow(/arm64/);
  });

  it('never replaces output on validation failure or overwrites a source feed', () => {
    const input = fixture();
    const output = join(input.root, 'latest-mac.yml');
    writeFileSync(output, 'previous feed');
    const args = ['--arm64', input.arm64, '--x64', input.x64, '--output', output];
    edit(input.x64, (info) => {
      info.version = '2.192.0';
    });
    expect(cli(args).status).toBe(1);
    expect(readFileSync(output, 'utf8')).toBe('previous feed');
    edit(input.x64, (info) => {
      info.version = '2.191.0';
    });
    const before = readFileSync(input.arm64, 'utf8');
    expect(cli(['--arm64', input.arm64, '--x64', input.x64, '--output', input.arm64]).status).toBe(
      1,
    );
    expect(readFileSync(input.arm64, 'utf8')).toBe(before);
  });

  it.each(
    [
      [],
      ['--wat'],
      ['--arm64', 'a'],
      ['--validate', 'a', '--x64', 'b'],
      ['--arm64', 'a', '--arm64', 'b', '--x64', 'c', '--output', 'd'],
    ].map((args) => ({ args })),
  )('rejects incomplete or ambiguous CLI arguments $args', ({ args }) => {
    const result = cli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});
