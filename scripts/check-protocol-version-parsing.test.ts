import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TOKEN,
  HELPER_PATH,
  findProtocolVersionParsingHits,
  isHandParsedProtocolVersion,
} from './check-protocol-version-parsing.mjs';

const scriptPath = join(process.cwd(), 'scripts/check-protocol-version-parsing.mjs');

function runGate(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'protocol-version-parsing-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    try {
      const output = execFileSync(process.execPath, [scriptPath], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { exitCode: 0, output };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('isHandParsedProtocolVersion', () => {
  it.each([
    // The protocol-14 cap that hid script lists and monitors (intent-hq/intent#7206).
    "!/^14\\.\\d+(?:\\.\\d+)?$/.test(hello.server?.protocolVersion ?? '') ||",
    "typeof protocolVersion === 'string' ? protocolVersion.match(/^(\\d+)\\.(\\d+)$/) : null;",
    "const [major] = protocolVersion.split('.');",
    "if (protocolVersion.startsWith('15.')) return true;",
    "return server.protocolVersion === '15.0';",
    "if ('14.0' !== hello.protocolVersion) return;",
    'const major = Number(protocolVersion.trim().slice(0, 2));',
    'const major = parseInt(state.protocol_version, 10);',
    'const pattern = new RegExp(`^${protocolMajor}\\\\.`);',
    // Review follow-ups: numeric caps on the helper, allowlists, pins, case labels, aliases.
    'if (protocolMajor(hello.server.protocolVersion) === 15) return true;',
    'return protocolMajor(protocolVersion) <= 15;',
    "if (['14.0', '15.0'].includes(protocolVersion)) return true;",
    "assert.equal(hello.server?.protocolVersion, '13.3');",
    "switch (protocolVersion) { case '15.0': return true; }",
    '/^\\d+(?:\\.\\d+)*$/.test(protocol.trim()) &&',
  ])('flags %s', (line) => {
    expect(isHandParsedProtocolVersion(line)).toBe(true);
  });

  it.each([
    'return protocolVersionAtLeast(protocolVersion, 11, 1);',
    "protocolVersion: typeof result?.protocolVersion === 'string' ? result.protocolVersion : null,",
    "      protocolVersion: '2024-11-05',",
    'const local = protocolMajor(localVersion);',
    '// protocolVersion.match(/^14\\./) is how the cap crept in',
    ' * `protocolVersion.split(".")` — prose in a doc comment',
    "const parts = url.split('/');",
    "logger.warn('Blocked dangerous protocol navigation', { url: url.substring(0, 100) });",
    "const secure = new URL(target).protocol.startsWith('https');",
    "const label = (protocolVersion: string) => 'unknown';",
    `if (protocolVersion.startsWith('15.')) return true; // ${ESCAPE_TOKEN}: fixture for a migration shim`,
  ])('allows %s', (line) => {
    expect(isHandParsedProtocolVersion(line)).toBe(false);
  });

  it('requires a reason on the escape comment', () => {
    expect(isHandParsedProtocolVersion(`protocolVersion.split('.'); // ${ESCAPE_TOKEN}:`)).toBe(
      true,
    );
  });
});

describe('findProtocolVersionParsingHits', () => {
  const offending = "const ok = /^14\\./.test(protocolVersion ?? '');";
  it('reports the path and line of each hit in scanned source', () => {
    expect(
      findProtocolVersionParsingHits([
        { path: 'src/lib/client/live/a.ts', content: `const x = 1;\n${offending}` },
        { path: 'src/lib/b.svelte', content: offending },
      ]),
    ).toEqual([
      { path: 'src/lib/client/live/a.ts', line: 2, text: offending },
      { path: 'src/lib/b.svelte', line: 1, text: offending },
    ]);
  });

  it.each([
    HELPER_PATH,
    'src/lib/a.test.ts',
    'src/lib/__tests__/a.ts',
    'src/features/x/x.fixture.ts',
    'src/lib/components/x/x.preview.svelte',
    'src/lib/components/x/x.preview.ts',
    'src/preload/index.ts',
    'src/lib/a.json',
  ])('skips %s', (path) => {
    expect(findProtocolVersionParsingHits([{ path, content: offending }])).toEqual([]);
  });
});

describe('CLI', () => {
  it('fails with the offending location and the remedy', () => {
    const result = runGate({
      'src/features/scripts/client.ts':
        "export const ok = (v: string) => /^14\\./.test(v ?? '') && v === v; const protocolVersion = '';\nexport const bad = /^14\\./.test(protocolVersion);\n",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('src/features/scripts/client.ts:2:');
    expect(result.output).toContain('protocolVersionAtLeast');
  });

  it('passes a tree that gates through the helper', () => {
    const result = runGate({
      'src/features/scripts/client.ts':
        "import { protocolVersionAtLeast } from '$shared/protocol-version';\nexport const ok = (protocolVersion: string) => protocolVersionAtLeast(protocolVersion, 11, 1);\n",
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Protocol version parsing valid');
  });
});
