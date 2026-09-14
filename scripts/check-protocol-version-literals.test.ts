import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ESCAPE_TOKEN,
  findProtocolVersionLiteralHits,
  findProtocolVersionLiterals,
} from './check-protocol-version-literals.mjs';

const sourceFile = (path: string, lines: string[]) => ({ path, content: lines.join('\n') });

const scriptPath = join(process.cwd(), 'scripts/check-protocol-version-literals.mjs');

function withTree(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'protocol-version-literals-'));
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

function runGate(cwd: string, args: string[] = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('protocol version literal scanner', () => {
  it.each([
    ['a v-prefixed literal next to `protocol`', '// added in protocol v10.1', ['v10.1']],
    ['a bare literal next to `protocol`', "it('maps identity (protocol 9.4)', () => {", ['9.4']],
    ['a pre- range next to `daemon`', '// Pre-9.13 daemon: no key is minted.', ['9.13']],
    ['a literal next to `daemon`', ' * reads (PROTOCOL §5.6, v6.15) served daemon-side', ['v6.15']],
    ['a literal next to `intentd`', '// intentd 2.5 unsloth.status payload', ['2.5']],
    ['a capitalised keyword', '/** Daemon-served count (§5.5 v8.2). */', ['v8.2']],
    ['a literal after a section reference', '// PROTOCOL.md §5.14 (v7.0) shape', ['v7.0']],
    ['a hyphen-joined literal', '// pre-PROTOCOL-4.1 sidecar', ['4.1']],
  ])('flags %s', (_name, line, matches) => {
    expect(findProtocolVersionLiterals(line)).toEqual(matches);
  });

  it.each([
    ['a section reference', '// see PROTOCOL §5.14 for the payload'],
    ['a section reference on the file name', '// PROTOCOL.md §6.3 owns this shape'],
    ['a spaced section reference', '// PROTOCOL § 6.3 owns this shape'],
    ['a section range', ' * FE-only: no daemon/protocol involvement. See PROTOCOL.md §1.1–2.3'],
    ['JSON-RPC 2.0', '// the daemon speaks JSON-RPC 2.0 over the socket'],
    ['the toon-format spec', '// daemon output follows toon-format v0.5'],
    ['an elapsed time', '// daemon clock skew ~3.5s is tolerated'],
    ['an elapsed time with a unit word', '// intentd restarts within 2.5 seconds'],
    ['three-part semver', "// requires intentd 2.17.0 or the protocol package '0.1.0'"],
    ['a longer number', '// daemon buffer is 100.5 or protocol id 1234.5'],
    ['an identifier segment', '// daemon fields foo1.2 and x9.4 are identifiers'],
    ['a literal on a line without a keyword', '// added in v10.1 with the new field'],
    ['a keyword substring', '// protocols v10.1 and subdaemon 9.4'],
  ])('does not flag %s', (_name, line) => {
    expect(findProtocolVersionLiterals(line)).toEqual([]);
  });

  it('honours the escape token anywhere on the line', () => {
    expect(findProtocolVersionLiterals(`// protocol v10.1 baseline // ${ESCAPE_TOKEN}`)).toEqual(
      [],
    );
    expect(findProtocolVersionLiterals(`// ${ESCAPE_TOKEN}: protocol v10.1`)).toEqual([]);
  });

  it('reports one hit per line with every distinct literal, path, and line number', () => {
    const files = [
      sourceFile('src/lib/context-api.ts', [
        'export const x = 1;',
        ' * (`file.getAttachmentInfo`, PROTOCOL §5.9, v6.12) by UUID, or (v9.13) by',
        '// a pre-10.0 daemon persisted bytes; a 10.0 daemon serves text',
      ]),
      sourceFile('src/features/Widget.svelte', ['<!-- protocol 9.4 identity -->']),
      sourceFile('src/main/index.js', ['// intentd v7.5 retired rows']),
      sourceFile('src/shared/util.mjs', ['// daemon 8.2+ default read']),
    ];
    expect(findProtocolVersionLiteralHits(files)).toEqual([
      {
        path: 'src/lib/context-api.ts',
        line: 2,
        matches: ['v6.12', 'v9.13'],
        text: '* (`file.getAttachmentInfo`, PROTOCOL §5.9, v6.12) by UUID, or (v9.13) by',
      },
      {
        path: 'src/lib/context-api.ts',
        line: 3,
        matches: ['10.0'],
        text: '// a pre-10.0 daemon persisted bytes; a 10.0 daemon serves text',
      },
      {
        path: 'src/features/Widget.svelte',
        line: 1,
        matches: ['9.4'],
        text: '<!-- protocol 9.4 identity -->',
      },
      {
        path: 'src/main/index.js',
        line: 1,
        matches: ['v7.5'],
        text: '// intentd v7.5 retired rows',
      },
      {
        path: 'src/shared/util.mjs',
        line: 1,
        matches: ['8.2'],
        text: '// daemon 8.2+ default read',
      },
    ]);
  });

  it('ignores files outside the scanned extensions and the generated preload entry', () => {
    const files = [
      sourceFile('src/lib/notes.md', ['protocol v10.1']),
      sourceFile('src/lib/data.json', ['"protocol v10.1"']),
      sourceFile('src/preload/index.ts', ['// protocol v10.1']),
    ];
    expect(findProtocolVersionLiteralHits(files)).toEqual([]);
  });
});

describe('protocol version literal scanner CLI', () => {
  const HIT = 'export const a = 1;\n// added in protocol v10.1\n';
  const CLEAN = '// added with `agent.getMessageBlock` (PROTOCOL §5.5)\n';

  it('lists every hit as file:line with the remediation hint and exits 1', () => {
    withTree(
      {
        'src/lib/a.ts': HIT,
        'src/features/B.svelte': '<!-- pre-9.13 daemon -->\n',
        'src/node_modules/pkg/index.js': HIT,
        'src/shared/paraglide/messages.js': HIT,
        'src/lib/README.md': HIT,
        'scripts/outside.ts': HIT,
      },
      (dir) => {
        const result = runGate(dir);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('src/lib/a.ts:2: v10.1');
        expect(result.output).toContain('src/features/B.svelte:1: 9.13');
        expect(result.output).not.toContain('node_modules');
        expect(result.output).not.toContain('paraglide');
        expect(result.output).not.toContain('README.md');
        expect(result.output).not.toContain('scripts/outside.ts');
        expect(result.output).toMatch(/method or field name/);
        expect(result.output).toContain('agent.getMessageBlock');
        expect(result.output).toContain(`// ${ESCAPE_TOKEN}`);
      },
    );
  });

  it('prints the same report under --print-hits', () => {
    withTree({ 'src/lib/a.ts': HIT }, (dir) => {
      expect(runGate(dir, ['--print-hits'])).toEqual(runGate(dir));
    });
  });

  it('passes a tree whose only literals are escaped or reference sections', () => {
    withTree(
      {
        'src/lib/a.ts': CLEAN,
        'src/lib/b.ts': `// protocol v10.1 baseline // ${ESCAPE_TOKEN}\n`,
        'src/lib/c.ts': '// JSON-RPC 2.0 to the daemon, toon-format v0.5, ~3.5s skew\n',
      },
      (dir) => {
        const result = runGate(dir);
        expect(result).toMatchObject({ exitCode: 0 });
        expect(result.output).toContain('3 src/ files');
      },
    );
  });

  it('rejects unknown arguments', () => {
    withTree({ 'src/lib/a.ts': CLEAN }, (dir) => {
      const result = runGate(dir, ['--baseline']);
      expect(result.exitCode).toBe(2);
      expect(result.output).toContain('--baseline');
    });
  });
});
