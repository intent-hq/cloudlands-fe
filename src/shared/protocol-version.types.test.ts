// protocol-version-ok-file: cap snippets that must not compile are the subject under test.
/**
 * Compile-time guarantee behind `ProtocolVersion` (intent-hq/intent#7206,
 * #7248): a protocol cap must not type-check. `*.test.ts` files are excluded
 * from `pnpm check`, so `@ts-expect-error` here would prove nothing; instead
 * every snippet is compiled with the TypeScript API against the real helper,
 * in one program (one virtual file per case), and must fail with the specific
 * diagnostic the brand causes — an unrelated error cannot pass a case.
 */
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HELPER = path.resolve(__dirname, 'protocol-version.ts');

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

const PRELUDE = `import { parseProtocolVersion, protocolVersionAtLeast, protocolVersionBelow, type ProtocolVersion } from ${JSON.stringify(HELPER.replace(/\.ts$/, ''))};
declare const version: ProtocolVersion;
declare const raw: string;
void parseProtocolVersion; void protocolVersionAtLeast; void protocolVersionBelow; void version; void raw;
`;

/** Sanctioned use: parse at arrival, then ask only "at least" / "proven below". */
const ALLOWED = `
const parsed = parseProtocolVersion(raw);
const ok: boolean = protocolVersionAtLeast(parsed, 15, 0);
const old: boolean = protocolVersionBelow(parsed, 10, 3);
void ok; void old;
`;

/** [label, snippet, expected TypeScript diagnostic code]. */
const REJECTED: ReadonlyArray<readonly [string, string, number]> = [
  ['a raw string into the gate', `protocolVersionAtLeast(raw, 15);`, 2345],
  ['an exact pin with ===', `const pinned = version === '14.0'; void pinned;`, 2367],
  ['an upper bound with <', `const capped = version < 15; void capped;`, 2365],
  ['a lower bound with >=', `const floor = version >= 14; void floor;`, 2365],
  ['string splitting', `version.split('.');`, 2339],
  ['regex testing', `/^14\\./.test(version);`, 2345],
  ['parseInt', `parseInt(version, 10);`, 2345],
  ['a switch on known versions', `switch (version) { case '14.0': break; }`, 2678],
  ['assigning to a string', `const text: string = version; void text;`, 2322],
  ['assigning a raw string', `const forged: ProtocolVersion = raw; void forged;`, 2322],
];

const snippetPath = (index: number | 'allowed') =>
  path.resolve(__dirname, `__protocol-version-snippet-${index}__.ts`);

/** Diagnostic codes per virtual snippet file, from a single compile. */
function compileSnippets(): Map<string, number[]> {
  const sources = new Map<string, string>([[snippetPath('allowed'), PRELUDE + ALLOWED]]);
  REJECTED.forEach(([, body], index) => sources.set(snippetPath(index), PRELUDE + body));
  const host = ts.createCompilerHost(OPTIONS, true);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const virtual = (file: string) => sources.get(path.resolve(file));
  host.readFile = (file) => virtual(file) ?? readFile(file);
  host.fileExists = (file) => virtual(file) !== undefined || ts.sys.fileExists(file);
  host.getSourceFile = (file, language, onError, shouldCreate) => {
    const source = virtual(file);
    return source !== undefined
      ? ts.createSourceFile(file, source, language, true)
      : getSourceFile(file, language, onError, shouldCreate);
  };
  const program = ts.createProgram([...sources.keys()], OPTIONS, host);
  const codes = new Map<string, number[]>();
  for (const file of sources.keys()) {
    const sourceFile = program.getSourceFile(file);
    codes.set(
      file,
      [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ].map((diagnostic) => diagnostic.code),
    );
  }
  return codes;
}

describe('ProtocolVersion has no cap-shaped operations', () => {
  const codes = compileSnippets();

  it('compiles the sanctioned arrival-parse → minimum gate path', () => {
    expect(codes.get(snippetPath('allowed'))).toEqual([]);
  });

  it.each(REJECTED.map(([label, , code], index) => ({ label, code, index })))(
    'rejects $label (TS$code)',
    ({ code, index }) => {
      expect(codes.get(snippetPath(index))).toEqual([code]);
    },
  );
});
