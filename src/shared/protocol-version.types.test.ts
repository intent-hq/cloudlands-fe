// protocol-version-ok-file: cap snippets that must not compile are the subject under test.
/**
 * Compile-time guarantee behind `ProtocolVersion` (intent-hq/intent#7206,
 * #7248): a protocol cap must not type-check. `*.test.ts` files are excluded
 * from `pnpm check`, so `@ts-expect-error` here would prove nothing; instead
 * each snippet is compiled with the TypeScript API against the real helper.
 */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HELPER = path.resolve(__dirname, 'protocol-version.ts');
const SNIPPET = path.resolve(__dirname, '__protocol-version-snippet__.ts');

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2023.d.ts'],
  skipLibCheck: true,
  types: [],
};

const PRELUDE = `import { parseProtocolVersion, protocolVersionAtLeast, formatProtocolVersion, type ProtocolVersion } from ${JSON.stringify(HELPER.replace(/\.ts$/, ''))};
declare const version: ProtocolVersion;
declare const maybe: ProtocolVersion | null;
declare const raw: string;
void parseProtocolVersion; void protocolVersionAtLeast; void formatProtocolVersion; void maybe; void raw;
`;

/** Semantic diagnostics for `body` compiled against the real helper. */
function diagnosticsFor(body: string): string[] {
  const source = PRELUDE + body;
  const host = ts.createCompilerHost(OPTIONS, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (file) => (path.resolve(file) === SNIPPET ? source : readFile(file));
  host.fileExists = (file) => path.resolve(file) === SNIPPET || ts.sys.fileExists(file);
  host.getSourceFile = (file, language, onError, shouldCreate) =>
    path.resolve(file) === SNIPPET
      ? ts.createSourceFile(file, source, language, true)
      : getSourceFile(file, language, onError, shouldCreate);
  const program = ts.createProgram([SNIPPET], OPTIONS, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('ProtocolVersion has no cap-shaped operations', () => {
  it('compiles the sanctioned arrival-parse → minimum gate → display path', () => {
    expect(
      diagnosticsFor(`
        const parsed = parseProtocolVersion(raw);
        const ok: boolean = protocolVersionAtLeast(parsed, 15, 0);
        const shown: string = parsed ? formatProtocolVersion(parsed) : '';
        void ok; void shown;
      `),
    ).toEqual([]);
  });

  it.each([
    ['a raw string into the gate', `protocolVersionAtLeast(raw, 15);`],
    ['an exact pin with ===', `const pinned = version === '14.0'; void pinned;`],
    ['an upper bound with <', `const capped = version < 15; void capped;`],
    ['a lower bound with >=', `const floor = version >= 14; void floor;`],
    ['string splitting', `version.split('.');`],
    ['regex testing', `/^14\\./.test(version);`],
    ['parseInt', `parseInt(version, 10);`],
    ['a switch on known versions', `switch (version) { case '14.0': break; }`],
    ['assigning to a string', `const text: string = version; void text;`],
    ['assigning a raw string', `const forged: ProtocolVersion = raw; void forged;`],
  ])('rejects %s', (_label, body) => {
    expect(diagnosticsFor(body).length).toBeGreaterThan(0);
  });
});
