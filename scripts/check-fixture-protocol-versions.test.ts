// @verify-changed-triggers: src/**, package.json

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TOKEN,
  FILE_ESCAPE_TOKEN,
  findFixtureProtocolVersionHits,
  findLiteralVersions,
  isFixturePath,
} from './check-fixture-protocol-versions.mjs';

const file = (path: string, lines: string[]) => ({ path, content: lines.join('\n') });
const hitLines = (files: Array<{ path: string; content: string }>) =>
  findFixtureProtocolVersionHits(files).map((hit: { line: number }) => hit.line);

const scriptPath = join(process.cwd(), 'scripts/check-fixture-protocol-versions.mjs');

function runGate(cwd: string) {
  try {
    const output = execFileSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output };
  } catch (error) {
    const err = error as { status?: number; stderr?: string };
    return { exitCode: err.status ?? 1, output: err.stderr ?? '' };
  }
}

describe('findLiteralVersions', () => {
  it.each([
    ["server: { protocolVersion: '14.0', capabilities: {} }", ['14.0']],
    ['"protocolVersion": "15.0",', ['15.0']],
    ["result: { protocol_version: '2' }", ['2']],
    ["state.daemonHealth.stats.protocolVersion = '5.1';", ['5.1']],
    ["function hello({ protocolVersion = '10.4' } = {}) {", ['10.4']],
    ['protocolVersion: `13.10`,', ['13.10']],
  ])('flags a literal fixture value: %s', (line, expected) => {
    expect(findLiteralVersions(line)).toEqual(expected);
  });

  it.each([
    'server: { protocolVersion: CURRENT_PROTOCOL_VERSION },',
    "expect(protocolVersionAtLeast('10.10', 10, 4)).toBe(true);",
    "if (stats.protocolVersion === '14.0') return;",
    "const parsed = protocolVersion => '14.0';",
    "server: { protocolVersion: 'test' },",
    "export const CURRENT_PROTOCOL_VERSION = '15.0';",
  ])('ignores non-fixture or non-literal values: %s', (line) => {
    expect(findLiteralVersions(line)).toEqual([]);
  });
});

describe('isFixturePath', () => {
  it.each([
    'src/lib/components/chat/__tests__/MonitoredScriptsRow.test.ts',
    'src/features/script-monitor/script-monitor-service.test.ts',
    'src/features/script-monitor/script-monitor.fixture.ts',
    'src/store/renderer/slices/daemon-health/daemon-health.test-fixtures.ts',
    'src/__mocks__/protocol-adapter.ts',
    'src/test/fixtures/principal-state.ts',
  ])('scans %s', (path) => expect(isFixturePath(path)).toBe(true));

  it.each([
    'src/features/backend/main/protocol-compat.ts',
    'src/lib/components/layout/daemon-status-indicator.preview.ts',
    'src/test/current-protocol-version.ts',
  ])('skips %s', (path) => expect(isFixturePath(path)).toBe(false));
});

describe('findFixtureProtocolVersionHits', () => {
  const test = 'src/features/x/x.test.ts';

  it('reports a reintroduced literal hello default (intent-hq/intent#7206)', () => {
    const hits = findFixtureProtocolVersionHits([
      file(test, [
        'const hello = {',
        "  server: { protocolVersion: '14.0', capabilities: {} },",
        '};',
      ]),
    ]);
    expect(hits).toEqual([
      {
        path: test,
        line: 2,
        matches: ['14.0'],
        text: "server: { protocolVersion: '14.0', capabilities: {} },",
      },
    ]);
  });

  it('accepts a reasoned escape on the line or the comment line above', () => {
    expect(
      hitLines([
        file(test, [
          `stats.protocolVersion = '5.1'; // ${ESCAPE_TOKEN}: legacy effort wire`,
          `// ${ESCAPE_TOKEN}: too old for sourceControl auth`,
          "for (const stats of [{ protocolVersion: '10.4' }]) {}",
        ]),
      ]),
    ).toEqual([]);
  });

  it('rejects an escape without a reason, inside a string, or above a code line', () => {
    expect(
      hitLines([
        file(test, [
          `stats.protocolVersion = '5.1'; // ${ESCAPE_TOKEN}:`,
          `const note = '${ESCAPE_TOKEN}: x'; stats.protocolVersion = '5.1';`,
          `const a = 1; // ${ESCAPE_TOKEN}: reason for a, not the next line`,
          "stats.protocolVersion = '5.1';",
        ]),
      ]),
    ).toEqual([1, 2, 4]);
  });

  it('honours a reasoned file-level escape only in the first lines', () => {
    const body = ["stats.protocolVersion = '2.0';"];
    expect(
      hitLines([file(test, [`// ${FILE_ESCAPE_TOKEN}: major comparison suite`, ...body])]),
    ).toEqual([]);
    expect(hitLines([file(test, [`// ${FILE_ESCAPE_TOKEN}:`, ...body])])).toEqual([2]);
    const late = [...Array(10).fill('// filler'), `// ${FILE_ESCAPE_TOKEN}: too late`, ...body];
    expect(hitLines([file(test, late)])).toEqual([12]);
  });

  it('does not accept the protocol-version-ok escape of the prose lint', () => {
    expect(
      hitLines([file(test, ["stats.protocolVersion = '5.1'; // protocol-version-ok: other lint"])]),
    ).toEqual([1]);
  });

  it('ignores literals outside test and fixture files', () => {
    expect(
      hitLines([file('src/features/x/x.ts', ["const fallback = { protocolVersion: '14.0' };"])]),
    ).toEqual([]);
  });
});

describe('CLI', () => {
  function withTree(files: Record<string, string>, run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-protocol-versions-'));
    try {
      for (const [name, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), content);
      }
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('fails on the pre-#3476 MonitoredScriptsRow hello and names the fix', () => {
    withTree(
      {
        'src/lib/components/chat/__tests__/MonitoredScriptsRow.test.ts':
          "const hello = { server: { protocolVersion: '14.0', capabilities: { scriptMonitors: 2 } } };\n",
      },
      (dir) => {
        const { exitCode, output } = runGate(dir);
        expect(exitCode).toBe(1);
        expect(output).toContain('MonitoredScriptsRow.test.ts:1: 14.0');
        expect(output).toContain('CURRENT_PROTOCOL_VERSION');
      },
    );
  });

  it('passes when fixtures use the shared constant', () => {
    withTree(
      {
        'src/lib/x.test.ts':
          'const hello = { server: { protocolVersion: CURRENT_PROTOCOL_VERSION } };\n',
      },
      (dir) => expect(runGate(dir).exitCode).toBe(0),
    );
  });

  it('passes on the committed tree', () => {
    const { exitCode, output } = runGate(process.cwd());
    expect(output).not.toContain('Literal protocolVersion');
    expect(exitCode).toBe(0);
  });

  it('is wired into lint:architecture', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts['lint:fixture-protocol-versions']).toBe(
      'node scripts/check-fixture-protocol-versions.mjs',
    );
    expect(scripts['lint:architecture']).toContain('lint:fixture-protocol-versions');
    expect(scripts['lint:architecture']).toContain('lint:intentd-protocol-pin');
  });
});
