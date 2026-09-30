/** Five finite actual-client cases against the separately attributed owned driver. */
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { createWriteStream, writeFileSync } from 'node:fs';
import {
  copyFile,
  cp,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  lstat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, type Plugin, type UserConfig } from 'vite';
import type { Fixture, Ready, WireRecord } from './main';
import type {
  NativeReviewInput,
  NativeReviewObservation,
  NativeReviewPreparedView,
  NativeReviewTextCommand,
} from '../../../src/shared/types/native-review-operation';

// Private companion diagnostics are evidence, never continuation authority.
const companionDiagnosticGrep =
  '^ review\\.electron\\.ts 10 UI sidebar held child close and original receipts$';
const companionDiagnosticRoot =
  '/home/clement/intent/workspaces/ideate-future/intent/.dev/slice-b/native-companion-clock-6328';
const companionDiagnosticIdentity = {
  sourceCommit: '581a3c62a784e6803301b316a2bf7f8c018efb35',
  parent: '3feca80dbdada0d334f67010a2d971c3e58cc343',
  sourceTree: '78a10bf7e11a8b0a9da4a2e07ddb580e7e234e41',
  driverBlob: '33c807f1a255ffa40a1d9fc53ec41edc249d01b7',
  sourceSha256: 'e35f1d6004d7107f35db10f246e64995aacb69bfc3d3407dbcbecde640684146',
  executableSha256: '4568a45c687cd734234d021254efe33247871f3336f06570d09c621b20afba94',
  bytes: 267856512,
  basename: 'e2e-native-review-wire-581a3c62-x86_64-unknown-linux-gnu',
};
export function companionDiagnosticMode(env: NodeJS.ProcessEnv): boolean {
  const value = env.NATIVE_REVIEW_COMPANION_DIAGNOSTIC_6328;
  if (value === undefined) return false;
  if (value !== '1' || env.NATIVE_REVIEW_UI !== '1' || env.NATIVE_REVIEW_SIDEBAR_UI !== '1')
    throw new Error('Companion diagnostic requires explicit UI and sidebar modes');
  return true;
}
export async function assertCompanionDiagnosticIdentity(
  driverSource: string,
  artifactPath: string,
) {
  if (
    driverSource !== join(companionDiagnosticRoot, 'packages/intentd') ||
    artifactPath !== join(companionDiagnosticRoot, 'artifact', companionDiagnosticIdentity.basename)
  )
    throw new Error('Unreleased diagnostic source or executable locator');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', driverSource, ...args], { encoding: 'utf8' }).trim();
  const pin = companionDiagnosticIdentity;
  if (
    git('rev-parse', 'HEAD') !== pin.sourceCommit ||
    git('rev-parse', 'HEAD^') !== pin.parent ||
    git('rev-parse', 'HEAD^{tree}') !== pin.sourceTree ||
    git('status', '--porcelain', '--untracked-files=all') !== ''
  )
    throw new Error('Diagnostic source is not the accepted clean sole-parent input');
  const fixture = 'crates/intentd/tests/e2e_native_review_wire.rs';
  if (
    git('rev-parse', 'HEAD:' + fixture) !== pin.driverBlob ||
    hash(await readFile(join(driverSource, fixture))) !== pin.sourceSha256
  )
    throw new Error('Diagnostic driver source mismatch');
  const observer = 'crates/intent-services/src/repository_admission/native_review.rs';
  if (
    git('rev-parse', 'HEAD:' + observer) !== '4f581c72785f3bf983f9bf7eb409e61ac94b58d4' ||
    git('hash-object', observer) !== '4f581c72785f3bf983f9bf7eb409e61ac94b58d4'
  )
    throw new Error('Diagnostic observer source mismatch');
  const artifact = await lstat(artifactPath);
  if (
    !artifact.isFile() ||
    artifact.isSymbolicLink() ||
    artifact.mode % 512 !== 0o555 ||
    artifact.size !== pin.bytes ||
    hash(await readFile(artifactPath)) !== pin.executableSha256
  )
    throw new Error('Diagnostic artifact mismatch');
  const contracts = [
    [
      join(companionDiagnosticRoot, 'HANDOFF.json'),
      'c30945dc3f5ca341728aceec8044c0d3023957d978f59870e29ed9b0684c2798',
    ],
    [
      join(companionDiagnosticRoot, 'CONTRACT-v1.json'),
      '5e1d773d4f5cdd98ac8a2afbe49359315b0d18798bde3353362bc64344ab7577',
    ],
    [
      join(companionDiagnosticRoot, 'qualification-contract-v3.json'),
      'd7eab6b8e449272b42a2ca68ff72034c579fe33bff925ef06a32b1a21f05e3b3',
    ],
    [
      join(companionDiagnosticRoot, 'finite-plan-v3.json'),
      'f5df33601298a00f7e043f6fb84d51e80540b1387964be9f8d8ac88b9ee921a9',
    ],
    [
      join(companionDiagnosticRoot, '../native-review-owned-cleanup/CONTROL-CONTRACT.md'),
      'cdddfbff85798cc3b071e0fa8da8f1ba16b6e57d155a9a08433d16972b176f9b',
    ],
    [
      join(companionDiagnosticRoot, '../repository-native-review-companion/COMPILED-CONTRACT.md'),
      '79412b9ae89ecb16886b186715072778f40a8a29f3bcac638d6f124ab46e3612',
    ],
  ];
  for (const [path, expected] of contracts)
    if (hash(await readFile(path)) !== expected)
      throw new Error('Diagnostic contract identity mismatch');
  const handoff = JSON.parse(await readFile(contracts[0][0], 'utf8'));
  if (
    handoff.source.head !== pin.sourceCommit ||
    handoff.source.soleParent !== pin.parent ||
    handoff.source.tree !== pin.sourceTree ||
    handoff.artifact.artifact.path !== artifactPath ||
    handoff.artifact.artifact.sha256 !== pin.executableSha256 ||
    handoff.artifact.artifact.bytes !== pin.bytes ||
    handoff.artifact.artifact.mode !== '0o555' ||
    handoff.manifest.sha256 !== '106a6a2bf4e039a523512d2b1afbac55e94b7bb10964a52bab0d7b2e82d2acf7'
  )
    throw new Error('Diagnostic handoff binding mismatch');
  return {
    pin,
    contracts,
    qualification:
      'four b908 + A-prime 3feca + B 581a; post-project comparator untested; historical pending wording unchanged',
  };
}

// Detect duplicate keys and unsafe integers before JSON.parse can discard precision or evidence.
export function companionJson(bytes: Buffer, maximum: number): any {
  if (bytes.length > maximum) throw new Error('Diagnostic JSON byte bound');
  const input = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let i = 0,
    nodes = 0;
  const ws = () => {
    while (/[ \t\r\n]/.test(input[i] ?? '') && i < input.length) i++;
  };
  const string = () => {
    const start = i++;
    while (i < input.length) {
      if (input[i++] === '"') return JSON.parse(input.slice(start, i)) as string;
      if (input[i - 1] === '\\') i++;
    }
    throw new Error('Partial diagnostic string');
  };
  const value = (depth: number): any => {
    ws();
    if (++nodes > 8192 || depth > 12) throw new Error('Diagnostic JSON structure bound');
    if (input[i] === '"') return string();
    if (input[i] === '{') {
      i++;
      ws();
      const result: Record<string, unknown> = Object.create(null);
      if (input[i] === '}') {
        i++;
        return result;
      }
      while (i < input.length) {
        ws();
        if (input[i] !== '"') throw new Error('Diagnostic object key');
        const key = string();
        ws();
        if (Object.hasOwn(result, key) || input[i++] !== ':')
          throw new Error('Duplicate diagnostic key');
        result[key] = value(depth + 1);
        ws();
        const end = input[i++];
        if (end === '}') return result;
        if (end !== ',') throw new Error('Diagnostic object boundary');
      }
    } else if (input[i] === '[') {
      i++;
      ws();
      const result: unknown[] = [];
      if (input[i] === ']') {
        i++;
        return result;
      }
      while (i < input.length) {
        result.push(value(depth + 1));
        ws();
        const end = input[i++];
        if (end === ']') return result;
        if (end !== ',') throw new Error('Diagnostic array boundary');
      }
    } else {
      for (const [literal, result] of [
        ['true', true],
        ['false', false],
        ['null', null],
      ] as const)
        if (input.startsWith(literal, i)) {
          i += literal.length;
          return result;
        }
      const numeric = /^(0|[1-9][0-9]*)/.exec(input.slice(i));
      if (numeric) {
        i += numeric[0].length;
        const result = Number(numeric[0]);
        if (!Number.isSafeInteger(result)) throw new Error('Unsafe diagnostic u64');
        return result;
      }
    }
    throw new Error('Malformed or partial diagnostic JSON');
  };
  const result = value(0);
  ws();
  if (i !== input.length) throw new Error('Trailing diagnostic JSON');
  return result;
}
export function companionKeys(value: any, keys: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new Error('Unknown or missing diagnostic fields');
}
const companionPhases = [
  'process',
  'request',
  'operation',
  'capture',
  'claim',
  'witness',
  'capacity',
  'record-capacity',
  'global-record-capacity',
  'acquire',
  'acquire-wait',
  'authority',
  'metadata',
  'source',
  'source-entered',
  'source-cancelled',
  'source-deadline',
  'git-continuity',
  'project',
  'branch',
  'read-authority',
  'read-fence',
  'read-fence-abandoned',
  'facts',
  'final-facts',
  'install',
  'body',
  'delivery',
  'public-error',
  'protected-result',
  'worker',
  'frame-deadline',
  'request-finish',
  'complete',
  'complete-normal',
  'complete-abandoned',
  'write-retire',
  'full-retire',
  'commit-witness',
  'resource-release',
];
export function readCompanionDiagnostics(raw: Buffer, final: Buffer, workerPid: number) {
  const errors: string[] = [],
    incomplete: string[] = [],
    frames: Record<string, any>[] = [];
  const streams = new Map<
    number,
    {
      first: Record<string, any>;
      last: Record<string, any>;
      active: Map<number, string>;
      seen: Set<number>;
      invalid: boolean;
      finalized: boolean;
    }
  >();
  const unsigned = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const positive = (v: unknown) => unsigned(v) && (v as number) > 0;
  const uuid = (v: unknown) =>
    v === null ||
    (typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v));
  if (!positive(workerPid) || workerPid > 0xffffffff) errors.push('worker-pid');
  if (!Buffer.from(raw.toString('utf8')).equals(raw)) errors.push('invalid-utf8');
  if (raw.length > 2048 * 1025) errors.push('fixture-byte-cap');
  const lines = raw.length <= 2048 * 1025 ? raw.toString('utf8').split('\n') : [];
  if (lines.pop() !== '') errors.push('partial-final-line');
  if (!lines.length || lines.length > 2048) errors.push('fixture-record-cap');
  for (const line of lines.slice(0, 2048)) {
    let f: Record<string, any>;
    try {
      f = companionJson(Buffer.from(line), 1024);
      companionKeys(f, [
        'version',
        'pid',
        'stream',
        'domain',
        'anchor_ms',
        'elapsed_ns',
        'sequence',
        'observed',
        'dropped',
        'span',
        'phase',
        'outcome',
        'finalized',
        'origin_stream',
        'method',
        'daemon',
        'operation',
        'capture',
      ]);
      if (
        f.version !== 1 ||
        f.pid !== workerPid ||
        !positive(f.stream) ||
        !positive(f.anchor_ms) ||
        !unsigned(f.elapsed_ns) ||
        !positive(f.sequence) ||
        !unsigned(f.observed) ||
        !unsigned(f.dropped) ||
        !(f.span === null || positive(f.span)) ||
        !(f.origin_stream === null || positive(f.origin_stream)) ||
        typeof f.finalized !== 'boolean' ||
        !companionPhases.includes(f.phase) ||
        !['enter', 'ok', 'error', 'exit', 'unwind', 'link'].includes(f.outcome) ||
        ![null, 'prepare', 'execute', 'reconcile', 'release'].includes(f.method) ||
        ![f.daemon, f.operation, f.capture].every(uuid) ||
        f.domain !== `tokio-instant:${f.pid}:${f.stream}`
      )
        throw new Error('Diagnostic frame types or identity');
    } catch {
      errors.push('malformed-frame');
      continue;
    }
    frames.push(f);
    let s = streams.get(f.stream);
    if (!s) {
      s = {
        first: f,
        last: { sequence: 0, elapsed_ns: 0 },
        active: new Map(),
        seen: new Set(),
        invalid: false,
        finalized: false,
      };
      streams.set(f.stream, s);
    }
    const immutable = [
      'domain',
      'anchor_ms',
      'origin_stream',
      'method',
      'daemon',
      'operation',
      'capture',
    ];
    let valid =
      f.sequence === s.last.sequence + 1 &&
      f.sequence <= 256 &&
      f.observed === f.sequence &&
      f.dropped === 0 &&
      !s.finalized &&
      f.elapsed_ns >= s.last.elapsed_ns &&
      immutable.every((key) => f[key] === s.first[key]);
    if (f.outcome === 'enter') {
      valid &&= f.span !== null && !f.finalized && !s.seen.has(f.span);
      if (f.sequence === 1) {
        valid &&= f.span === 1 && ['process', 'request', 'operation'].includes(f.phase);
        if (f.phase === 'process')
          valid &&= [f.method, f.origin_stream, f.daemon, f.operation, f.capture].every(
            (v) => v === null,
          );
        if (f.phase === 'request') valid &&= f.method !== null && f.origin_stream === null;
        if (f.phase === 'operation')
          valid &&= f.method === null && f.origin_stream !== null && f.operation !== null;
      } else
        valid &&=
          s.active.has(1) && f.span !== 1 && !['process', 'request', 'operation'].includes(f.phase);
      if (valid) {
        s.active.set(f.span, f.phase);
        s.seen.add(f.span);
      }
    } else if (f.outcome === 'link') valid &&= f.span === null && !f.finalized && s.active.has(1);
    else {
      valid &&= f.span !== null && s.active.get(f.span) === f.phase;
      if (f.finalized)
        valid &&=
          f.span === 1 &&
          f.phase === s.first.phase &&
          s.active.size === 1 &&
          ['exit', 'unwind'].includes(f.outcome);
      else valid &&= f.span !== 1;
      if (valid) {
        s.active.delete(f.span);
        if (f.finalized && !s.invalid) s.finalized = true;
      }
    }
    if (!valid) {
      s.invalid = true;
      errors.push(`invalid:${f.stream}:${f.sequence}`);
    }
    if (f.outcome === 'unwind') incomplete.push(`unwind:${f.stream}:${f.sequence}`);
    // Resultless non-root scopes describe only observed exit, not successful business work.
    if (f.outcome === 'exit' && !['process', 'request', 'operation', 'worker'].includes(f.phase))
      incomplete.push(`unknown-scope:${f.stream}:${f.span}`);
    s.last = f;
  }
  if (![...streams.values()].some((s) => s.first.phase === 'process' && !s.invalid))
    incomplete.push('process-unobserved');
  for (const [id, s] of streams) {
    if (s.invalid || !s.finalized || s.active.size) incomplete.push(`unfinalized:${id}`);
    if (s.first.phase === 'operation') {
      const origin = streams.get(s.first.origin_stream)?.first;
      if (
        !origin ||
        origin.phase !== 'request' ||
        origin.method !== 'prepare' ||
        origin.daemon !== s.first.daemon ||
        origin.capture !== s.first.capture
      )
        errors.push(`foreign-origin:${id}`);
    }
  }
  let summary: any = null;
  try {
    summary = companionJson(final, 65536);
    companionKeys(summary, ['collectorInstalled', 'observation']);
    companionKeys(summary.observation, ['version', 'accounting', 'report', 'complete']);
    const { accounting: a, report: r } = summary.observation;
    companionKeys(a, [
      'observed',
      'written',
      'dropped',
      'overflow',
      'io',
      'malformed',
      'unmatched',
      'finalized',
    ]);
    companionKeys(r, ['records', 'errors', 'incomplete', 'producer_observed', 'producer_dropped']);
    if (
      summary.collectorInstalled !== true ||
      summary.observation.version !== 1 ||
      typeof summary.observation.complete !== 'boolean' ||
      typeof a.finalized !== 'boolean' ||
      Object.entries(a).some(([k, v]) => k !== 'finalized' && !unsigned(v)) ||
      ![r.records, r.producer_observed, r.producer_dropped].every(unsigned) ||
      !Array.isArray(r.errors) ||
      !Array.isArray(r.incomplete) ||
      [...r.errors, ...r.incomplete].some(
        (v) =>
          typeof v !== 'string' ||
          !/^(?:fixture-cap|frame-cap|malformed|no-records|process-unobserved|invalid:[0-9]+:[0-9]+:[0-9]+|[0-9]+:[0-9]+)$/.test(
            v,
          ),
      )
    )
      throw new Error('Diagnostic summary shape');
    const observed = [...streams.values()].reduce((n, s) => n + s.last.observed, 0);
    const dropped = [...streams.values()].reduce((n, s) => n + s.last.dropped, 0);
    if (
      !Number.isSafeInteger(observed) ||
      !Number.isSafeInteger(dropped) ||
      a.observed !== lines.length ||
      a.written !== lines.length ||
      r.records !== frames.length ||
      r.producer_observed !== observed ||
      r.producer_dropped !== dropped ||
      ['dropped', 'overflow', 'io', 'malformed', 'unmatched'].some((k) => a[k] !== 0) ||
      dropped !== 0 ||
      r.errors.length ||
      r.incomplete.length
    )
      errors.push('final-accounting');
    if (!a.finalized || !summary.observation.complete) incomplete.push('collector-unfinalized');
  } catch {
    errors.push('missing-or-invalid-summary');
  }
  return {
    version: 1,
    valid: errors.length === 0,
    complete: errors.length === 0 && incomplete.length === 0,
    errors,
    incomplete,
    frames,
    summary,
    qualification:
      'same-domain elapsed only; finalization is not ready, admission, delivery observation, native settlement or owned cleanup',
  };
}

/** Run each original phase once and retain the first original rejection, including undefined. */
export async function companionPhasesOnce(
  phases: Array<{ name: string; run: () => unknown }>,
  report: (rows: Array<{ name: string; ok: boolean; error?: string }>) => unknown,
) {
  let failed = false,
    first: unknown;
  const rows: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const phase of phases) {
    try {
      await phase.run();
      rows.push({ name: phase.name, ok: true });
    } catch (error) {
      if (!failed) {
        failed = true;
        first = error;
      }
      let description = 'Unprintable original rejection';
      try {
        description = String(error);
      } catch {
        /* Observation must not prevent the original cleanup phases. */
      }
      rows.push({ name: phase.name, ok: false, error: description });
    }
  }
  try {
    await report(rows);
  } catch (error) {
    if (!failed) {
      failed = true;
      first = error;
    }
  }
  if (failed) throw first;
}

/** Reads only enumerated safe evidence; never traverses home, profile, TLS or credentials. */
export async function archiveCompanionFiles(
  directory: string,
  destination: string,
  stage: 'partial' | 'final',
) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await chmod(destination, 0o700);
  const rows: Array<Record<string, unknown>> = [];
  const names = ['companion-preparation-v1.jsonl', 'companion-preparation-v1-final.json'];
  const allowed =
    /^(?:descriptor|ready|worker|supervisor|ownership|worker-stopped|stopped|failed|allocation|driver|electron|failure|failure-packet|failure-packet-error|controller-[a-z-]+|original-supervisor-wait-observed|final-stop-observed|ui-quiescence|before-stop|after-stop|stop-inventory-before|stop-inventory-after|stop-begin|stop-finish|original-completions|sidebar-[a-z-]+)\.(?:json|jsonl|log)$/;
  const sourceStat = await lstat(directory);
  if (!sourceStat.isDirectory() || sourceStat.mode % 512 !== 0o700)
    throw new Error('Private evidence directory required');
  const entries = await readdir(directory, { withFileTypes: true });
  const selected = [
    ...new Set([...names, ...entries.map((e) => e.name).filter((n) => allowed.test(n))]),
  ];
  if (selected.length > 128) throw new Error('Diagnostic archive file bound');
  for (const name of selected) {
    try {
      const path = join(directory, name),
        stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > (names.includes(name) ? 2048 * 1025 : 32 * 1024 * 1024) ||
        (names.includes(name) && stat.mode % 512 !== 0o600)
      )
        throw new Error('Unsafe or oversized evidence file');
      const bytes = await readFile(path),
        target = join(destination, stage + '-' + name);
      await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
      rows.push({
        name,
        stage,
        bytes: bytes.length,
        sha256: hash(bytes),
        sourceMode: stat.mode % 512,
        mode: 0o600,
        regular: true,
      });
    } catch (error) {
      rows.push({ name, stage, incomplete: true, error: String(error) });
    }
  }
  record(destination, stage + '-manifest', rows);
  if (rows.some((row) => row.incomplete))
    throw new Error('Diagnostic originals missing or archive incomplete');
  return rows;
}

export function correlateCompanionDiagnostics(
  frames: Record<string, any>[],
  sourceEvidence: ReturnType<Fixture['evidence']>,
  parent: any,
) {
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ak = Object.keys(a),
      bk = Object.keys(b);
    return (
      ak.length === bk.length &&
      ak.every((k) => Object.hasOwn(b, k) && same((a as any)[k], (b as any)[k]))
    );
  };
  const one = <T>(rows: T[], name: string): T => {
    if (rows.length !== 1) throw new Error('Missing or ambiguous original ' + name);
    return rows[0];
  };
  const { completions, completionFaults } = sourceEvidence;
  if (!completions || !completionFaults) throw new Error('Original completion ledger unavailable');
  if (
    sourceEvidence.records.length > 1024 ||
    completions.length > 1024 ||
    sourceEvidence.faults.length ||
    completionFaults.length
  )
    throw new Error('Original evidence incomplete');
  const requests = sourceEvidence.records.filter(
    (r) =>
      r.direction === 'request' &&
      /^accept-changes\.(prepare|execute|reconcile|release)$/.test(r.envelope.method ?? ''),
  );
  const joined = requests.map((request) => {
    const e = request.envelope;
    const call = one(
      completions.filter(
        (c: any) =>
          c.layer === 'client' &&
          c.captured === true &&
          c.method === e.method &&
          c.socketId === request.socketId &&
          same(c.params, e.params) &&
          c.wireRequests?.length === 1 &&
          c.wireRequests[0].socketId === request.socketId &&
          c.wireRequests[0].requestId === e.id &&
          c.wireRequests[0].method === e.method,
      ),
      'captured request',
    );
    if (
      !call.clientId ||
      !call.connectionId ||
      !call.incarnationId ||
      !['fulfilled', 'rejected'].includes(call.state)
    )
      throw new Error('Original captured future not joined');
    one(
      sourceEvidence.allocations.filter(
        (a) => a.socketId === request.socketId && a.host === request.host,
      ),
      'physical allocation',
    );
    const response = one(
      sourceEvidence.records.filter(
        (r) =>
          r.direction === 'response' &&
          r.socketId === request.socketId &&
          r.host === request.host &&
          r.envelope.id === e.id,
      ),
      'wire response',
    ).envelope;
    if (
      call.state === 'fulfilled'
        ? Object.hasOwn(response, 'error') || !same(call.value, response.result)
        : !Object.hasOwn(response, 'error')
    )
      throw new Error('Original future/response mismatch');
    return { request, call, response };
  });
  const originalParent = parent?.retained?.execute;
  const p = originalParent?.reviewExecution?.preparation;
  if (
    !p ||
    originalParent.state !== 'settled' ||
    originalParent.success !== true ||
    originalParent.operationId !== p.operationId ||
    originalParent.reviewExecution.requestId !== p.operationId ||
    originalParent.reviewExecution.outcome.status !== 'not-attempted' ||
    originalParent.reviewExecution.gitReceipts.length !== 1 ||
    originalParent.reviewExecution.gitReceipts[0].stage !== 'commit' ||
    !same(parent.owner?.root, p.root)
  )
    throw new Error('Original retained parent commit prerequisite missing');
  const prepare = one(
    joined.filter(
      (j) =>
        j.request.envelope.method === 'accept-changes.prepare' &&
        j.response.result?.reviewPreparation?.operationId === p.operationId,
    ),
    'parent preparation',
  );
  const execute = one(
    joined.filter(
      (j) =>
        j.request.envelope.method === 'accept-changes.execute' &&
        j.request.envelope.params?.review?.operationId === p.operationId,
    ),
    'parent execution',
  );
  if (
    !same(execute.response.result, originalParent) ||
    !same(prepare.response.result.reviewPreparation, p) ||
    !same(prepare.request.envelope.params.review.root, p.root)
  )
    throw new Error('Parent receipt provenance mismatch');
  const parentIpc = one(
    (sourceEvidence.ipcRecords as any[]).filter(
      (c) =>
        c.channel === 'backend:native-review:prepare' &&
        c.main === true &&
        c.result?.ok === true &&
        c.result.result?.preview?.reviewPreparation?.operationId === p.operationId,
    ),
    'parent IPC owner',
  );
  if (!same(parentIpc.result.result.preview.reviewPreparation, p) || !parentIpc.result.result.id)
    throw new Error('Parent IPC preview mismatch');
  const child = one(
    joined.filter(
      (j) =>
        j.request.envelope.method === 'accept-changes.prepare' &&
        j.request.envelope.params?.review?.choice?.kind === 'afterCommit',
    ),
    'child capture',
  );
  const choice = child.request.envelope.params.review.choice;
  if (
    choice.operationId !== p.operationId ||
    !same(child.request.envelope.params.review.root, p.root) ||
    child.request.socketId !== prepare.request.socketId ||
    child.request.host !== prepare.request.host ||
    ['clientId', 'connectionId', 'incarnationId'].some((k) => child.call[k] !== prepare.call[k]) ||
    execute.request.socketId !== prepare.request.socketId
  )
    throw new Error('Child original owner mismatch');
  const childIpc = one(
    (sourceEvidence.ipcRecords as any[]).filter(
      (c) =>
        c.channel === 'backend:native-review:prepare' &&
        c.main === true &&
        c.sender === parentIpc.sender &&
        c.frame === parentIpc.frame &&
        c.args?.[0]?.companionOf === parentIpc.result.result.id &&
        same(c.args[0].root, p.root),
    ),
    'child IPC capture',
  );
  if (!Object.hasOwn(childIpc, 'result') && !Object.hasOwn(childIpc, 'rejected'))
    throw new Error('Child original IPC not joined');
  const roots = frames.filter((f) => f.sequence === 1 && f.outcome === 'enter');
  const childStream = one(
    roots.filter(
      (f) =>
        f.phase === 'request' &&
        f.method === 'prepare' &&
        f.daemon === p.scope.daemonId &&
        f.operation === p.operationId &&
        f.capture === choice.captureId,
    ),
    'child request stream',
  );
  const allocated = roots.filter(
    (f) => f.phase === 'operation' && f.origin_stream === childStream.stream,
  );
  if (
    allocated.length > 1 ||
    allocated.some((f) => f.daemon !== p.scope.daemonId || f.capture !== choice.captureId)
  )
    throw new Error('Ambiguous child allocation');
  const returned = child.response.result?.reviewPreparation;
  if (
    returned &&
    (allocated.length !== 1 ||
      returned.operationId !== allocated[0].operation ||
      !same(returned.root, p.root) ||
      returned.scope.daemonId !== p.scope.daemonId ||
      !same(childIpc.result?.result?.preview?.reviewPreparation, returned))
  )
    throw new Error('Allocated child and original returned preview differ');
  const operations = new Map<string, { daemon: string; socket: string; host: number }>();
  for (const j of joined) {
    const view = j.response.result?.reviewPreparation;
    if (view)
      operations.set(view.operationId, {
        daemon: view.scope.daemonId,
        socket: j.request.socketId,
        host: j.request.host,
      });
  }
  const used = new Set<number>();
  const links = joined.map((j) => {
    const e = j.request.envelope,
      method = e.method.slice('accept-changes.'.length),
      c = e.params?.review?.choice;
    const op =
      method === 'prepare'
        ? c?.kind === 'afterCommit'
          ? c.operationId
          : null
        : (e.params?.review?.operationId ?? e.params?.operationId);
    const actual = operations.get(op ?? j.response.result?.reviewPreparation?.operationId);
    if (!actual || actual.socket !== j.request.socketId || actual.host !== j.request.host)
      throw new Error('Foreign or unavailable daemon correlation');
    const root = one(
      roots.filter(
        (f) =>
          f.phase === 'request' &&
          f.method === method &&
          f.daemon === actual.daemon &&
          f.operation === op &&
          f.capture === (c?.kind === 'afterCommit' ? c.captureId : null),
      ),
      'request diagnostic correlation',
    );
    if (used.has(root.stream)) throw new Error('Diagnostic stream ambiguously reused');
    used.add(root.stream);
    return {
      stream: root.stream,
      daemon: root.daemon,
      operation: root.operation,
      capture: root.capture,
      socketId: j.request.socketId,
      host: j.request.host,
      requestId: e.id,
      callId: j.call.callId,
      state: j.call.state,
      publicError: Object.hasOwn(j.response, 'error'),
    };
  });
  if (roots.some((f) => f.phase === 'request' && !used.has(f.stream)))
    throw new Error('Unmatched diagnostic request');
  for (const f of roots.filter((f) => f.phase === 'operation')) {
    const request = links.find((l) => l.stream === f.origin_stream);
    if (
      !request ||
      request.daemon !== f.daemon ||
      request.capture !== f.capture ||
      (!operations.has(f.operation) && !(allocated.length === 1 && allocated[0] === f))
    )
      throw new Error('Foreign operation stream');
  }
  return {
    version: 1,
    parent: {
      operationId: p.operationId,
      daemonId: p.scope.daemonId,
      root: p.root,
      handle: parentIpc.result.result.id,
      sender: parentIpc.sender,
      frame: parentIpc.frame,
      owner: parent.owner,
    },
    child: {
      captureId: choice.captureId,
      stream: childStream.stream,
      allocatedOperationId: allocated[0]?.operation ?? null,
      returnedOperationId: returned?.operationId ?? null,
      handle: childIpc.result?.result?.id ?? null,
    },
    links,
    qualification:
      'Original wire/future/IPC joins; diagnostic ordinals are not wire IDs; public-error delivery is not protected disclosure or renderer observation',
  };
}

export async function retainCompanionBundle(directory: string, destination: string) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const visit = async (relative: string) => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const name = posix.join(relative, entry.name),
        path = join(directory, name);
      if (entry.isSymbolicLink()) throw new Error('Unexpected emitted output symlink');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        const target = join(destination, name);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
        files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
      }
      if (files.length > 4096) throw new Error('Emitted output inventory bound');
    }
  };
  await visit('');
  record(destination, 'retained-files', files);
  return files;
}

/** Private main observations are evidence, never native or renderer authority. */
function companionMainObject(value: unknown, keys?: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Missing companion main evidence object');
  if (
    keys &&
    (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
  )
    throw new Error('Unexpected companion main evidence fields');
  return value as Record<string, any>;
}
function companionMainRequire(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error('Incomplete companion main evidence: ' + reason);
}
function companionMainJournal(value: unknown) {
  const journal = companionMainObject(value, [
    'version',
    'observed',
    'retained',
    'dropped',
    'failed',
    'recordingComplete',
    'ownerCompletionObserved',
    'ownerCompletionLimit',
    'rows',
  ]);
  companionMainRequire(
    journal.version === 1 &&
      journal.ownerCompletionObserved === false &&
      journal.ownerCompletionLimit ===
        'The public client API exposes no original outer healthCheck join' &&
      journal.recordingComplete === true &&
      journal.dropped === 0 &&
      journal.failed === 0 &&
      Array.isArray(journal.rows) &&
      journal.rows.length <= 128 &&
      journal.observed === journal.rows.length &&
      journal.retained === journal.rows.length &&
      JSON.stringify(journal.rows).length <= 1_048_576,
    'journal counters, loss, bound or passive qualification',
  );
  const rows = journal.rows as Array<Record<string, any>>;
  const phases = new Set([
    'request-enter',
    'request-settled',
    'request-owner-unobserved',
    'socket-event',
    'renderer-roots-joined',
    'pool-retirement',
    'ledger-join-return',
    'pool-dispose-enter',
    'pool-dispose-return',
  ]);
  for (const [i, value] of rows.entries()) {
    const row = companionMainObject(value);
    companionMainRequire(
      row.sequence === i + 1 && phases.has(row.phase),
      'journal sequence or phase',
    );
    const callFields = ['callId', 'clientId', 'connectionId', 'incarnationId', 'socketId'];
    const fields: Record<string, string[]> = {
      'request-enter': [
        ...callFields,
        'owner',
        ...(row.owner === 'unknown' ? [] : ['module', 'line', 'column']),
      ],
      'request-settled': [...callFields, 'state'],
      'request-owner-unobserved': callFields,
      'socket-event': ['socketId', 'host', 'event'],
      'renderer-roots-joined': ['producers', 'seal'],
      'pool-retirement': [
        'ownersJoined',
        'admissionSealed',
        'outcome',
        'exclusions',
        'clients',
        'failureKinds',
      ],
      'ledger-join-return': ['producersClosed', 'pending', 'sealed', 'rows'],
      'pool-dispose-enter': ['pending'],
      'pool-dispose-return': ['result', 'ownerJoined'],
    };
    companionMainObject(row, ['sequence', 'phase', ...fields[row.phase]]);
  }
  return rows;
}

/** Serialized by the original app.evaluate, never imported into the renderer. */
function observeCompanionMainActivation() {
  const fixture = (globalThis as unknown as { nativeReviewFixture?: Fixture }).nativeReviewFixture;
  return {
    version: 1,
    pid: process.pid,
    ppid: process.ppid,
    platform: process.platform,
    ui: process.env.NATIVE_REVIEW_UI === '1',
    sidebar: process.env.NATIVE_REVIEW_SIDEBAR_UI === '1',
    diagnostic: process.env.NATIVE_REVIEW_COMPANION_DIAGNOSTIC_6328 === '1',
    ready: fixture?.ready === true,
    statusProducers: fixture?.evidence().statusProducers ?? null,
  };
}
export function assertCompanionMainActivation(value: unknown, mainPid: number, workerPid: number) {
  const row = companionMainObject(value, [
    'version',
    'pid',
    'ppid',
    'platform',
    'ui',
    'sidebar',
    'diagnostic',
    'ready',
    'statusProducers',
  ]);
  companionMainRequire(
    Number.isSafeInteger(mainPid) &&
      mainPid > 0 &&
      Number.isSafeInteger(workerPid) &&
      workerPid > 0 &&
      mainPid !== workerPid &&
      row.version === 1 &&
      row.pid === mainPid &&
      row.ppid === workerPid &&
      row.platform === 'linux' &&
      row.ui === true &&
      row.sidebar === true &&
      row.diagnostic === true &&
      row.ready === true,
    'actual main identity, mode or ready profile',
  );
  companionMainJournal(row.statusProducers);
  return {
    activated: true,
    profile: 'linux-ui-sidebar-companion',
    completion: 'not asserted',
  } as const;
}

/** Validates the original aggregate API result; no generation-to-socket identity is invented. */
export function assertCompanionMainOwnership(
  value: unknown,
  quiescence: unknown,
  activationJournal: unknown,
) {
  const source = companionMainObject(value);
  companionMainRequire(JSON.stringify(source).length <= 32 * 1024 * 1024, 'main evidence bound');
  const rows = companionMainJournal(source.statusProducers);
  const initial = companionMainJournal(activationJournal);
  companionMainRequire(
    initial.length <= rows.length &&
      initial.every((row, index) => JSON.stringify(row) === JSON.stringify(rows[index])),
    'original activation journal prefix',
  );
  const empty = (value: unknown) => Array.isArray(value) && value.length === 0;
  const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  const id = (value: unknown) =>
    typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
  companionMainRequire(
    empty(source.faults) &&
      empty(source.completionFaults) &&
      source.pending === 0 &&
      source.outstandingOriginals === 0 &&
      Array.isArray(source.completions) &&
      source.completions.length <= 1024 &&
      Array.isArray(source.records) &&
      source.records.length <= 1024 &&
      Array.isArray(source.allocations),
    'original fault-sensitive completion fence',
  );
  const allocations = new Map<string, number>();
  for (const raw of source.allocations) {
    const row = companionMainObject(raw, ['socketId', 'host', 'destroyed']);
    companionMainRequire(
      id(row.socketId) &&
        (row.host === 0 || row.host === 1) &&
        row.destroyed === true &&
        !allocations.has(row.socketId),
      'original allocation',
    );
    allocations.set(row.socketId, row.host);
  }
  companionMainRequire(
    allocations.size >= 2 && allocations.size <= 128,
    'nonempty two-host allocation inventory',
  );
  const receipt = companionMainObject(quiescence, ['producers', 'joined']);
  companionMainRequire(
    Array.isArray(receipt.producers) && receipt.producers.length === 2,
    'two original renderer producers',
  );
  const keys = new Set<string>(),
    senders = new Set<number>();
  const taskNames = [
    'connectionsSaga',
    'daemonEventsSaga',
    'principalSaga',
    'lifecycleReadSaga',
    'repositoryContextSaga',
    'gitReadSaga',
    'acceptChangesStatusSaga',
  ];
  for (const raw of receipt.producers) {
    const producer = companionMainObject(raw, ['key', 'sender', 'receipt']);
    companionMainRequire(
      ['host-A', 'local-B'].includes(producer.key) &&
        !keys.has(producer.key) &&
        positive(producer.sender) &&
        !senders.has(producer.sender),
      'renderer identity',
    );
    keys.add(producer.key);
    senders.add(producer.sender);
    const r = companionMainObject(producer.receipt);
    companionMainRequire(
      r.route?.startupSettled === true &&
        r.route.closed === true &&
        r.producersClosed === true &&
        empty(r.faults) &&
        Array.isArray(r.tasks) &&
        r.tasks.length === 7,
      'original seven-root receipt',
    );
    for (const name of taskNames)
      companionMainRequire(
        r.tasks.filter(
          (task: any) => task.name === name && task.iteratorDone === true && task.joined === true,
        ).length === 1,
        'original root join',
      );
  }
  const calls = new Map<string, Record<string, any>>(),
    settled = new Set<string>(),
    closed = new Set<string>();
  let roots = 0,
    retirement = 0,
    ledger = 0,
    closeCount = 0;
  for (const row of rows) {
    const base = ['sequence', 'phase'];
    const callFields = ['callId', 'clientId', 'connectionId', 'incarnationId', 'socketId'];
    if (row.phase === 'request-enter') {
      companionMainObject(row, [...base, ...callFields, 'owner', 'module', 'line', 'column']);
      companionMainRequire(
        !retirement &&
          callFields.every((key) => id(row[key])) &&
          allocations.has(row.socketId) &&
          !calls.has(row.callId) &&
          [
            'healthCheck',
            'captureLocalDeviceKind',
            'captureRemoteHostname',
            'performOpenBackendWindow',
          ].includes(row.owner) &&
          /^backend\.ipc(?:-[A-Za-z0-9_-]+\.js|\.ts)$/.test(row.module) &&
          /^\d+$/.test(row.line) &&
          /^\d+$/.test(row.column),
        'original status owner',
      );
      calls.set(row.callId, row);
    } else if (row.phase === 'request-settled') {
      companionMainObject(row, [...base, ...callFields, 'state']);
      const original = calls.get(row.callId);
      const matches = source.completions.filter(
        (call: any) =>
          call.layer === 'client' && call.method === 'host.status' && call.callId === row.callId,
      );
      companionMainRequire(
        !retirement &&
          original &&
          !settled.has(row.callId) &&
          row.state === 'fulfilled' &&
          matches.length === 1 &&
          matches[0].state === row.state &&
          callFields.every((key) => original[key] === row[key] && matches[0][key] === row[key]),
        'original status settlement identity',
      );
      settled.add(row.callId);
    } else if (row.phase === 'socket-event') {
      companionMainObject(row, [...base, 'socketId', 'host', 'event']);
      companionMainRequire(
        !retirement &&
          allocations.has(row.socketId) &&
          allocations.get(row.socketId) === row.host &&
          ['end', 'close'].includes(row.event),
        'original socket event',
      );
      if (row.event === 'close') {
        companionMainRequire(!closed.has(row.socketId), 'duplicate original facade close');
        closed.add(row.socketId);
      }
    } else if (row.phase === 'renderer-roots-joined') {
      companionMainObject(row, [...base, 'producers', 'seal']);
      companionMainRequire(
        !retirement && row.producers === 2 && typeof row.seal === 'boolean',
        'renderer root phase',
      );
      if (row.seal) {
        companionMainRequire(!roots, 'duplicate final root join');
        roots = row.sequence;
      }
    } else if (row.phase === 'pool-retirement') {
      companionMainObject(row, [
        ...base,
        'ownersJoined',
        'admissionSealed',
        'outcome',
        'exclusions',
        'clients',
        'failureKinds',
      ]);
      companionMainRequire(
        roots &&
          !retirement &&
          calls.size === settled.size &&
          closed.size === allocations.size &&
          row.ownersJoined === true &&
          row.admissionSealed === true &&
          row.outcome === 'clean' &&
          empty(row.exclusions) &&
          empty(row.failureKinds) &&
          Array.isArray(row.clients) &&
          row.clients.length > 0 &&
          row.clients.length <= 128,
        'original aggregate pool retirement',
      );
      const generations = new Set<number>();
      for (const raw of row.clients) {
        const client = companionMainObject(raw, [
          'generation',
          'ownersJoined',
          'outcome',
          'closes',
          'failureKinds',
        ]);
        companionMainRequire(
          positive(client.generation) &&
            !generations.has(client.generation) &&
            client.ownersJoined === true &&
            client.outcome === 'clean' &&
            empty(client.failureKinds) &&
            Array.isArray(client.closes) &&
            client.closes.length > 0 &&
            client.closes.length <= 128,
          'original client aggregate',
        );
        generations.add(client.generation);
        for (const rawClose of client.closes) {
          const close = companionMainObject(rawClose, ['destroyRequested', 'closeObserved']);
          companionMainRequire(
            close.destroyRequested === true && close.closeObserved === true,
            'original facade close join',
          );
          closeCount++;
        }
      }
      companionMainRequire(
        closeCount === closed.size,
        'aggregate close count (not an identity mapping)',
      );
      retirement = row.sequence;
    } else if (row.phase === 'ledger-join-return') {
      companionMainObject(row, [...base, 'producersClosed', 'pending', 'sealed', 'rows']);
      companionMainRequire(
        retirement &&
          !ledger &&
          row.producersClosed === true &&
          row.pending === 0 &&
          row.sealed === true &&
          row.rows === source.completions.length,
        'original sealed ledger',
      );
      const joined = companionMainObject(receipt.joined, [
        'producersClosed',
        'pending',
        'sealed',
        'rows',
      ]);
      companionMainRequire(
        ['producersClosed', 'pending', 'sealed', 'rows'].every((key) => joined[key] === row[key]),
        'original quiescence ledger receipt',
      );
      ledger = row.sequence;
    } else throw new Error('Incomplete companion main evidence: unknown owner or legacy disposal');
  }
  companionMainRequire(
    roots > 0 && retirement > roots && ledger > retirement && ledger === rows.length,
    'complete ordered final ownership evidence',
  );
  return {
    complete: true,
    scope: 'original main pool aggregate',
    privateTicketIdentity: 'not exposed',
    facadeCloses: closeCount,
    nativeStop: 'not asserted',
  } as const;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = process.env.NATIVE_REVIEW_EVIDENCE_DIR;
const executable = process.env.NATIVE_REVIEW_DRIVER;
const source = process.env.NATIVE_REVIEW_DRIVER_SOURCE;
if (!evidence || !executable || !source)
  throw new Error('Explicit evidence, pinned executable and frozen source required');
const diagnosticMode = companionDiagnosticMode(process.env);
const executableHash = diagnosticMode
  ? companionDiagnosticIdentity.executableSha256
  : 'caa06ad0c82bdde2899eae3d2fc9476003f9256c5a29e5315212fcfd28ba6f5a';
const identity = {
  sourceCommit: diagnosticMode
    ? companionDiagnosticIdentity.sourceCommit
    : '28a28e058d39533f74e46e1ce7ea15968fc6229b',
  sourceTree: diagnosticMode
    ? companionDiagnosticIdentity.sourceTree
    : 'ace95266ff66ad82020fa7014f531f8266df020d',
  executableSha256: executableHash,
  sourceSha256: '',
};
const groups = [
  ['01 routing and explicit prepared plans', ['frontend']],
  ['02 member guest and immutable claims', ['frontend', 'held-stop']],
  ['03 original history and authority retirement', ['frontend', 'held-stop']],
  ['04 admitted work and document socket lifetime', ['frontend', 'held-stop']],
  ['05 uncertain original POST without replay', ['frontend']],
] as const;
const uiGroups = [
  ['06 UI Owner explicit create and cancellation', ['frontend']],
  ['07 UI Member reuse closure and Guest denial', ['frontend', 'held-stop']],
  ['08 UI uncertain POST and original Check result', ['frontend']],
] as const;
const sidebarGroups = [
  ['09 UI sidebar staged commit and child creation', ['frontend']],
  ['10 UI sidebar held child close and original receipts', ['frontend', 'held-stop']],
  ['11 UI sidebar Member reuse and Guest refusal', ['frontend', 'held-stop']],
] as const;
const sidebarGrep =
  '(09 UI sidebar staged commit and child creation|10 UI sidebar held child close and original receipts|11 UI sidebar Member reuse and Guest refusal)$';
export function assertSidebarSelection(env: NodeJS.ProcessEnv, argv: string[]): boolean {
  const diagnostic = companionDiagnosticMode(env);
  const sidebar = env.NATIVE_REVIEW_SIDEBAR_UI === '1';
  if (env.NATIVE_REVIEW_SIDEBAR_UI !== undefined && !sidebar)
    throw new Error('Invalid sidebar mode');
  if (!sidebar) return false;
  if (env.NATIVE_REVIEW_UI !== '1') throw new Error('Sidebar requires UI mode');
  const values = (name: string) =>
    argv.flatMap((arg, i) =>
      arg === name ? [argv[i + 1]] : arg.startsWith(name + '=') ? [arg.slice(name.length + 1)] : [],
    );
  if (
    values('--grep').length !== 1 ||
    values('--grep')[0] !== (diagnostic ? companionDiagnosticGrep : sidebarGrep) ||
    argv.some(
      (arg) =>
        arg.startsWith('-g') ||
        (diagnostic &&
          (/^-[^-]/.test(arg) ||
            arg.startsWith('--project') ||
            arg.startsWith('--headed') ||
            arg.startsWith('--max-failures'))) ||
        arg.startsWith('--repeat-each') ||
        arg.startsWith('--shard') ||
        arg.startsWith('--grep-invert') ||
        arg === '--debug' ||
        arg === '--ui',
    ) ||
    values('--workers').length !== 1 ||
    values('--workers')[0] !== '1' ||
    values('--retries').length !== 1 ||
    values('--retries')[0] !== '0'
  )
    throw new Error('Exactly the three sidebar cases, one worker and no retries required');
  return true;
}
const uiMode = process.env.NATIVE_REVIEW_UI === '1';
const originalSelection =
  process.env.NATIVE_REVIEW_SIDEBAR_UI !== '1' || process.env.TEST_WORKER_INDEX === undefined
    ? process.argv.slice(2)
    : JSON.parse(process.env.NATIVE_REVIEW_SIDEBAR_SELECTION ?? 'null');
if (!Array.isArray(originalSelection) || !originalSelection.every((arg) => typeof arg === 'string'))
  throw new Error('Original CLI selection missing');
const sidebarMode = assertSidebarSelection(process.env, originalSelection);
if (sidebarMode && process.env.TEST_WORKER_INDEX === undefined) {
  if (process.env.NATIVE_REVIEW_SIDEBAR_SELECTION)
    throw new Error('Inherited CLI must originate in this runner');
  process.env.NATIVE_REVIEW_SIDEBAR_SELECTION = JSON.stringify(originalSelection);
}
let bundle: string;

/** Owns diagnostic setup only; admission closure is not cancellation. */
function createCompanionSetupOwner(failed: () => boolean, persist: (value: unknown) => void) {
  const id = randomUUID();
  const origin = process.hrtime.bigint();
  const rows: Array<{ sequence: number; elapsedNs: string; phase: string; kind: string }> = [];
  let sequence = 0;
  let dropped = 0;
  let writesFailed = 0;
  let closed = false;
  let ready = false;
  let allocated: string | undefined;
  let original: Promise<void> | undefined;
  let settlement: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  let primary: { error: unknown } | undefined;
  let child: ChildProcess | undefined;
  let childClose: Promise<void> | undefined;
  let childTerminal: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let archive: Promise<unknown> | undefined;
  let archiveState: 'unattempted' | 'pending' | 'fulfilled' | 'rejected' = 'unattempted';
  let cleanup: Promise<void> | undefined;
  let removal: 'unattempted' | 'pending' | 'fulfilled' | 'rejected' = 'unattempted';
  const snapshot = () => ({
    version: 1,
    id,
    workerPid: process.pid,
    clock: 'process.hrtime.bigint',
    originNs: origin.toString(),
    bundle: allocated ? basename(allocated) : null,
    closed,
    ready,
    settlement,
    archive: archiveState,
    removal,
    child: child
      ? { pid: child.pid ?? null, parentPid: process.pid, terminal: childTerminal ?? null }
      : null,
    sequence,
    dropped,
    writesFailed,
    complete:
      settlement === 'fulfilled' &&
      ready &&
      (!child || !!childTerminal) &&
      archiveState !== 'pending' &&
      archiveState !== 'rejected' &&
      removal === 'fulfilled' &&
      dropped === 0 &&
      writesFailed === 0,
    cancellationObserved: false,
    rows: rows.map((row) => ({ ...row })),
  });
  const observe = (phase: string, kind = 'observed') => {
    sequence++;
    if (rows.length < 128)
      rows.push({
        sequence,
        elapsedNs: (process.hrtime.bigint() - origin).toString(),
        phase,
        kind,
      });
    else dropped++;
    try {
      persist(snapshot());
    } catch {
      writesFailed++;
    }
  };
  const failureKind = (error: unknown) =>
    error instanceof Error ? 'Error' : error === null ? 'null' : typeof error;
  const admit = (phase: string) => {
    if (failed()) closed = true;
    if (closed) {
      observe(phase, 'admission-refused');
      throw new Error('Diagnostic setup admission closed');
    }
    if (dropped || writesFailed) throw new Error('Diagnostic setup evidence incomplete');
    observe(phase, 'entered');
  };
  return {
    snapshot,
    observe,
    admit,
    run(body: () => Promise<void>) {
      if (original) throw new Error('Diagnostic setup already started');
      observe('setup', 'entered');
      original = body();
      // Observe the same promise without replacing the caller's value or error.
      void original.then(
        () => {
          settlement = 'fulfilled';
          observe('setup', 'fulfilled');
        },
        (error: unknown) => {
          primary = { error };
          settlement = 'rejected';
          observe('setup', failureKind(error));
        },
      );
      return original;
    },
    allocated(path: string) {
      if (allocated) throw new Error('Diagnostic setup allocated twice');
      allocated = path;
      observe('allocation', 'fulfilled');
    },
    child(builder: ChildProcess) {
      if (child) throw new Error('Diagnostic setup child already owned');
      child = builder;
      childClose = new Promise<void>((resolveClose) => {
        builder.once('close', (code, signal) => {
          childTerminal = { code, signal };
          observe('kit-child', 'close');
          resolveClose();
        });
      });
      observe('kit-child', 'spawned');
    },
    archive(action: () => Promise<unknown>) {
      if (archive) return archive;
      archiveState = 'pending';
      observe('failure-archive', 'entered');
      archive = action();
      void archive.then(
        () => {
          archiveState = 'fulfilled';
          observe('failure-archive', 'fulfilled');
        },
        (error: unknown) => {
          archiveState = 'rejected';
          observe('failure-archive', failureKind(error));
        },
      );
      return archive;
    },
    publish() {
      admit('ready');
      ready = true;
      observe('ready', 'published');
      if (dropped || writesFailed) throw new Error('Diagnostic setup evidence incomplete');
    },
    retire(remove: (path: string) => Promise<void>) {
      if (cleanup) return cleanup;
      closed = true;
      observe('cleanup', 'admission-closed');
      cleanup = (async () => {
        if (!original) throw new Error('Diagnostic setup owner missing');
        try {
          await original;
        } catch (error) {
          primary ??= { error };
        }
        // Spawn failure can reject the setup before the actual close event.
        if (childClose) await childClose;
        if (archive) {
          try {
            await archive;
          } catch {
            // Preserve available files if failure retention itself did not finish.
          }
        }
        observe('cleanup', 'originals-joined');
        if (archiveState === 'rejected') {
          observe('cleanup', 'archive-incomplete');
          if (primary) throw primary.error;
          throw new Error('Diagnostic setup archive incomplete');
        }
        if (allocated) {
          removal = 'pending';
          observe('removal', 'entered');
          try {
            await remove(allocated);
            removal = 'fulfilled';
            observe('removal', 'fulfilled');
          } catch (error) {
            removal = 'rejected';
            observe('removal', failureKind(error));
            if (primary) throw primary.error;
            throw error;
          }
        }
        if (primary) throw primary.error;
        if (dropped || writesFailed) throw new Error('Diagnostic setup evidence incomplete');
      })();
      return cleanup;
    },
  };
}
let setupOwner: ReturnType<typeof createCompanionSetupOwner> | undefined;
let setupEvidenceReady = false;

const python = '/usr/bin/python3';
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const record = (dir: string, name: string, value: unknown) =>
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const environment = (home: string) => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_CACHE_HOME: join(home, 'cache'),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  DD_TRACE_ENABLED: 'false',
  RUST_LOG: 'error',
  INTENTD_TEST_KEEP_TMP: '1',
});
const renderer = `
import { LiveWorkspacesClient } from '${join(root, 'src/lib/client/live/live-workspaces-client.ts')}';
const client = new LiveWorkspacesClient(); const sessions = new Map(); const work = new Map(); let demand = 0; let closeRead = () => {};
window.native = { results: {}, errors: {}, retirements: [], current: null,
 async begin(key, input) { const session = await client.beginNativeReview({attemptId: key,root:input.review.root,admission:'original-fixture-document',hostContext:'original-fixture-host'},input,kind=>this.retirements.push({key,kind})); sessions.set(key,session); return session.preview; },
 start(key,command={}) { const promise = sessions.get(key).confirm(command); work.set(key,promise); promise.then(value=>this.results[key]=value,error=>this.errors[key]=String(error)); },
 async confirm(key,command={}) { const value=await sessions.get(key).confirm(command); this.results[key]=value; return value; },
 async reconcile(key) { const value=await sessions.get(key).reconcile(); this.results[key]=value; return value; },
 async release(key) { await sessions.get(key).release(); },
 async read(workspaceId) { closeRead(); this.current=null; return new Promise((resolve,reject)=> { client.observeRepositoryContext({workspaceId,binding:'fixture-read',requestId:String(++demand)}, update=> {if(update.type==='received'){this.current=update.response.context;resolve(update);} else if(update.type==='unavailable') reject(new Error('context unavailable')); else if(update.type==='retired')this.current=null;}).then(stop=>closeRead=stop,reject); }); },
 async quiesce() { await Promise.allSettled([...work.values()]); },
 async close() { closeRead(); await Promise.allSettled([...sessions.values()].map(s=>s.release())); }
};
`;
const uiRenderer = `
  import '$store/renderer/seeders/workspaces-seeder';
  import { mount, unmount } from 'svelte';
  import { all, fork, join } from 'typed-redux-saga';
  import type { Task } from 'redux-saga';
  import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
  import { store } from '$store/renderer/store';
  import { connectionsSaga } from '$store/renderer/slices/connections/sagas/connections-saga';
  import { daemonEventsSaga } from '$store/renderer/slices/workspace-events/sagas/daemon-events-saga';
  import { principalSaga } from '$store/renderer/slices/principal/sagas/principal-saga';
  import { lifecycleReadSaga } from '$store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga';
  import { repositoryContextSaga } from '$store/renderer/slices/repository-context/sagas/repository-context-saga';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import {
    selectPrincipalAdmissionContext,
    selectPrincipalSnapshot,
    selectHostRole,
  } from '$store/renderer/slices/principal/principal-selectors';
  import {
    selectWorkspaceItems,
    selectWorkspaceHostOperationContext,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectNativeReviewForOwner } from '$store/renderer/slices/repository-context/repository-context-selectors';
  import {
    nativeReviewEditRequested, nativeReviewEditEnded, nativeReviewEditCleared,
    nativeReviewCompanionRequested, nativeReviewConfirmRequested, nativeReviewObserved,
    repositoryContextDemandEnded,
  } from '$store/renderer/slices/repository-context/repository-context-slice';
  import { setPendingAutoAction } from '$store/renderer/slices/changes/changes-slice';
  import { subscribeConfirmRequests } from '$lib/components/patterns/confirm/confirm-service';

  import { gitReadSaga } from '$store/renderer/slices/git/sagas/git-read-saga';
  import { acceptChangesStatusSaga } from '$store/renderer/slices/git/sagas/accept-changes-status-saga';
  import { selectFileTrackingChanges, selectPendingAutoAction } from '$store/renderer/slices/changes/changes-selectors';
  import { appClient } from '$lib/client';
  import { IPC_CHANNELS } from '$shared/ipc-registry';


import App from '${join(root, 'test/fixtures/native-review-native/ui-renderer.svelte')}';
import '${join(root, 'src/app.css')}';
function dismissalEvidenceJournal() {
  const rows: unknown[] = [];
  let observed = 0, dropped = 0, failed = 0;
  function record(kind: string, value: unknown) {
    observed++;
    try {
      const row = JSON.parse(JSON.stringify({sequence:observed,kind,value}));
      if (rows.length >= 128 || JSON.stringify([...rows,row]).length > 1_048_576) { dropped++; return; }
      rows.push(row);
    } catch { failed++; }
  }
  function snapshot() {
    return {version:1,observed,retained:rows.length,dropped,failed,complete:dropped===0&&failed===0,rows:JSON.parse(JSON.stringify(rows))};
  }
  function incomplete(kind: string) { failed++; record(kind,null); }
  return {record,snapshot,incomplete};
}
export function start() {
const target = document.getElementById('ui');
if (!target) throw new Error('Original UI mount target missing');
const sidebarMode = ${JSON.stringify(sidebarMode)};
const diagnosticEvidence = ${JSON.stringify(diagnosticMode)};
const dismissalEvidence = dismissalEvidenceJournal();
const diagnosticActionTypes = new Set([setPendingAutoAction.type,nativeReviewEditRequested.type,nativeReviewEditEnded.type,nativeReviewEditCleared.type,nativeReviewCompanionRequested.type,nativeReviewConfirmRequested.type,nativeReviewObserved.type,repositoryContextDemandEnded.type]);
let stopConfirmationObservation: (() => unknown) | null = diagnosticEvidence ? subscribeConfirmRequests(request => dismissalEvidence.record('confirmation', request ? {id:request.id,kind:request.kind} : null)) : null;
  const faults: string[] = [];
  const queueObservations: unknown[] = [];
  let observing = true;
  if (sidebarMode) store.addMiddleware(() => next => function (action) {
    if (!observing || typeof action !== 'object' || action === null || !('type' in action) || typeof action.type !== 'string' || !(diagnosticEvidence ? diagnosticActionTypes.has(action.type) : ['changes/setPendingAutoAction','repositoryContext/nativeReviewEditRequested','repositoryContext/nativeReviewCompanionRequested','repositoryContext/nativeReviewConfirmRequested','repositoryContext/nativeReviewEditEnded'].includes(action.type))) return next(action);
    let input: unknown;
    try { input = JSON.parse(JSON.stringify(action)); } catch (error) { if (diagnosticEvidence) dismissalEvidence.incomplete('action-input-unobserved'); else faults.push('Unobserved queue input: ' + String(error)); }
    if (diagnosticEvidence) {
      try { dismissalEvidence.record('action-before', {input,attempts:attemptProjection()}); } catch { dismissalEvidence.incomplete('action-before-unobserved'); }
    }
    let result: unknown;
    try { result = next(action); } catch (error) {
      if (diagnosticEvidence) dismissalEvidence.record('action-threw', {type:action.type});
      throw error;
    }
    try {
      const row = {input, attempts: attemptProjection(), queue: workspaceProjection()};
      if (diagnosticEvidence) dismissalEvidence.record('action-after', row);
      if (queueObservations.length >= 128 || JSON.stringify([...queueObservations, row]).length > 1_048_576) throw new Error('Queue observation bound');
      queueObservations.push(row);
    } catch (error) { if (diagnosticEvidence) dismissalEvidence.incomplete('action-after-unobserved'); else faults.push('Unobserved queue result: ' + String(error)); }
    return result;
  });
const component = mount(App, {target, props:{sidebar:sidebarMode}});
let closing: Promise<unknown> | null = null;
  const tasks: Array<{
    name: string;
    task: Task;
    iteratorDone: boolean;
    joined: boolean;
    done: Promise<void>;
  }> = [];
  let rootStarted!: () => void;
  const started = new Promise<void>((resolve) => (rootStarted = resolve));
  function* roots() {
    for (const saga of [
      connectionsSaga,
      daemonEventsSaga,
      principalSaga,
      lifecycleReadSaga,
      repositoryContextSaga,
      ...(sidebarMode ? [gitReadSaga, acceptChangesStatusSaga] : []),
    ]) {
      let finish!: () => void;
      const row = {
        name: saga.name,
        task: null as unknown as Task,
        iteratorDone: false,
        joined: false,
        done: new Promise<void>((resolve) => (finish = resolve)),
      };
      row.task = yield* fork(function* originalRoot() {
        try {
          yield* saga();
        } catch (error) {
          faults.push(saga.name + ': ' + String(error));
          throw error;
        } finally {
          // Reached only after the delegated production iterator's finally has completed.
          row.iteratorDone = true;
          finish();
        }
      });
      tasks.push(row);
    }
    rootStarted();
    yield* all(tasks.map((row) => join(row.task)));
  }
  const stopRoot = store.runSaga(roots);
  const api = window.electronAPI;
  if (!api) throw new Error('The original generated Electron preload is required');
  const buffered: any[] = [];
  let snapshotDone = false;
  let statusClosed = false;
  function applyStatus(payload: any, snapshot: boolean) {
    store.dispatch(
      connectionStatusChanged(payload.status, payload.transport, {
        sidecarGaveUp: payload.sidecarGaveUp,
        sidecarStartupFailed: payload.sidecarStartupFailed,
        reason: snapshot ? payload.sidecarStartupFailedReason : payload.reason,
        reconnectAttempts: payload.reconnectAttempts,
        connectionLimited: payload.connectionLimited,
        connectionLimitRetryAfterMs: payload.connectionLimitRetryAfterMs,
        daemonUpdateDisconnectedAt: payload.daemonUpdateDisconnectedAt,
      }),
    );
  }
  // Listener-first, original snapshot then buffered transitions; no fabricated healthy status.
  const statusListener = api.on(IPC_CHANNELS.BACKEND.STATUS, (payload: any) => {
    if (!snapshotDone) buffered.push(payload);
    else if (!statusClosed) applyStatus(payload, false);
  });
  const bootstrap = api.invoke(IPC_CHANNELS.BACKEND.GET_STATUS).then(
    (value) => {
      if (!statusClosed) {
        applyStatus(value, true);
        for (const payload of buffered) applyStatus(payload, false);
      }
      buffered.length = 0;
      snapshotDone = true;
    },
    (error) => {
      faults.push('Original status snapshot: ' + String(error));
      throw error;
    },
  );
  function attemptProjection() {
    return (store.state.repositoryContext.nativeReviewAttempts ? getItems(store.state.repositoryContext.nativeReviewAttempts) : []).map(row => ({
      owner: row.owner, publicView: selectNativeReviewForOwner.select(store.state, row.owner),
      ...(sidebarMode ? {attemptId:row.attemptId,status:row.status,closed:row.status === 'closed',retained:row.observation,preview:row.preview} : {}),
    }));
  }
  function workspaceProjection() {
    return selectWorkspaceItems.select(store.state).map(row => ({id:row.id,baseRef:row.baseRef,changes:selectFileTrackingChanges.select(store.state,String(row.id)),queue:selectPendingAutoAction.select(store.state,String(row.id))}));
  }
  function snapshot(includeEvidence = true) {
    const state = store.state;
    return {
      faults,
      ...(diagnosticEvidence && includeEvidence ? {dismissalEvidence:dismissalEvidence.snapshot()} : {}),
      role: selectHostRole.select(state),
      admission: selectPrincipalAdmissionContext.select(state),
      hasReceivedList: state.connections.hasReceivedList,
      windowBackendId: state.connections.windowBackendId,
      subscriptionGeneration: state.workspaceEvents.subscriptionGeneration,
      workspaceLoaded: state.workspace.hasLoaded,
      workspaceAdmission: state.workspace.loadedPrincipalContext,
      workspaces: selectWorkspaceItems.select(state).map((row) => ({
        id: row.id,
        hostContext: selectWorkspaceHostOperationContext.select(state, row.id),
      })),
      attempts: JSON.parse(JSON.stringify(attemptProjection())),
      ...(sidebarMode ? {sidebar:JSON.parse(JSON.stringify(workspaceProjection())),queueObservations:JSON.parse(JSON.stringify(queueObservations))} : {}),
    };
  }
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try {
      await component.dismiss(); // Actual child onDestroy ends the original owner/demand.
      statusClosed = true;
      api.offById(IPC_CHANNELS.BACKEND.STATUS, statusListener);
      await bootstrap;
      await started;
      for (const row of tasks) row.task.cancel();
      await Promise.all(
        tasks.map(async (row) => {
          await row.done;
          await row.task.toPromise();
          row.joined = true;
        }),
      );
      const final = snapshot();
      observing = false;
      stopRoot();
      await unmount(component);
      return {
        producersClosed: statusClosed && snapshotDone,
        faults,
        final,
        tasks: tasks.map(({ name, iteratorDone, joined }) => ({ name, iteratorDone, joined })),
      };
      } finally {
        if (diagnosticEvidence && stopConfirmationObservation) {
          const originalStop = stopConfirmationObservation;
          stopConfirmationObservation = null;
          try { originalStop(); dismissalEvidence.record('confirmation-unsubscribed', null); } catch { dismissalEvidence.incomplete('confirmation-unsubscribe-failed'); }
        }
      }
    })();
    return closing;
  }

const lifetime = {snapshot,close,async dismiss(){
  try {
    await component.dismiss();
    const returned = snapshot(!diagnosticEvidence);
    if (diagnosticEvidence) dismissalEvidence.record('dismiss-return', returned);
    return returned;
  } catch (error) {
    if (diagnosticEvidence) {
      try { dismissalEvidence.record('dismiss-threw', {name:error instanceof Error ? error.name : typeof error,message:error instanceof Error ? error.message : null}); } catch { dismissalEvidence.incomplete('dismiss-error-unobserved'); }
    }
    throw error;
  }
},
  async unstaged() {
    if (!sidebarMode || !selectPrincipalAdmissionContext.select(store.state) || selectWorkspaceItems.select(store.state).length !== 1) throw new Error('Original admitted sidebar workspace required');
    return appClient.files.read(String(selectWorkspaceItems.select(store.state)[0].id), 'unstaged.txt');
  }
};
Object.assign(window,{native:{ui:true},nativeUi:lifetime});
return lifetime;
}
`;
const activeRenderer = uiMode ? uiRenderer : renderer;
// Node/libuv stdio "pipe" is a socketpair. This controller owns a genuine
// anonymous pipe and the original supervisor Child; its wait is not a native receipt.
const pipeController = String.raw`
import hashlib,json,os,pathlib,selectors,stat,subprocess,sys,threading
root=pathlib.Path(sys.argv[2]);child=None;writer=None;waiter=None;failure=None
done=threading.Event();wait_result={};sequence=0;sent_bytes=0
context={'version':1,'runId':sys.argv[3],'descriptorSha256':sys.argv[4],'executableSha256':sys.argv[5]}
os.set_blocking(1,False)

def record(kind,details):
    global sequence,sent_bytes
    value={**context,'kind':kind,'sequence':sequence,'details':details};sequence+=1
    data=(json.dumps(value,separators=(',',':'))+'\n').encode()
    if len(data)>2048 or sent_bytes+len(data)>8192:raise RuntimeError('metadata bound')
    with (root/('controller-'+kind+'.json')).open('xb') as out:
        os.chmod(out.name,0o600);out.write(data);out.flush();os.fsync(out.fileno())
    sent_bytes+=len(data)
    if os.write(1,data)!=len(data):raise RuntimeError('partial metadata output')

def wait_original():
    try:
        code=child.wait()
        wait_result.update(returnCode=code,code=code if code>=0 else None,signal=-code if code<0 else None,waitedOriginalChild=True)
    except BaseException as error:
        wait_result.update(waitedOriginalChild=False,error=type(error).__name__)
    finally:done.set()

selector=selectors.DefaultSelector();selector.register(0,selectors.EVENT_READ)
try:
    data=(root/'descriptor.json').read_bytes()
    if len(data)>8192 or hashlib.sha256(data).hexdigest()!=context['descriptorSha256']:raise RuntimeError('descriptor identity')
    descriptor=json.loads(data)
    if descriptor['runId']!=context['runId'] or descriptor['executableSha256']!=context['executableSha256']:raise RuntimeError('run identity')
    if not selector.select(5) or os.read(0,1)!=b'R':raise RuntimeError('controller bootstrap missing')
    with (root/'driver.log').open('xb') as log:
        os.chmod(log.name,0o600)
        child=subprocess.Popen([sys.argv[1],'--ignored','--exact','native_review_fixture_driver','--nocapture','--test-threads=1'],stdin=subprocess.PIPE,stdout=log,stderr=log,close_fds=True,bufsize=0)
        writer=child.stdin
        waiter=threading.Thread(target=wait_original);waiter.start()
        fifo=stat.S_ISFIFO(os.fstat(writer.fileno()).st_mode)
        inheritable=os.get_inheritable(writer.fileno())
        if not fifo or inheritable:raise RuntimeError('private anonymous pipe unavailable')
        record('allocation',{'supervisorPid':child.pid,'controllerPid':os.getpid(),'writerIsFifo':fifo,'writerInheritable':inheritable})
        if writer.write(b'R')!=1:raise RuntimeError('bootstrap write incomplete')
        while not done.is_set():
            if os.fstat(log.fileno()).st_size>8388608:raise RuntimeError('driver log bound')
            if selector.select(.05):
                value=os.read(0,1)
                if value:raise RuntimeError('unexpected controller lifetime data')
                raise RuntimeError('controller EOF before supervisor wait')
except BaseException as error:
    failure=str(error)[:512]
finally:
    if failure and writer and not writer.closed:
        try:writer.close()
        except OSError as error:failure+='; writer close '+type(error).__name__
    if waiter:
        done.wait();waiter.join()
        try:record('supervisor-wait',{'supervisorPid':child.pid,**wait_result,'failure':failure})
        except OSError as error:failure=failure or 'wait receipt output '+type(error).__name__
    if writer and not writer.closed:
        try:writer.close()
        except OSError as error:failure=failure or 'writer close '+type(error).__name__
    selector.close()
    success=not failure and wait_result.get('waitedOriginalChild') is True and wait_result.get('returnCode')==0
    try:record('helper-result',{'success':success,'failure':failure,'nativeCompletion':'not asserted'})
    except OSError:success=False
sys.exit(0 if success else 1)
`;
const actualFactory = join(root, 'src/features/backend/main/backend-connection.ts');
const socketShim = `import {createBackendSocket as original} from ${JSON.stringify(actualFactory + '?original')};
export * from ${JSON.stringify(actualFactory + '?original')};
export function createBackendSocket(...args) { const socket=Reflect.apply(original,this,args); const result=globalThis.nativeReviewSocketObserver(socket,args[0]); if(result!==socket)throw new Error('Observer replaced original Duplex'); return socket; }`;
const alias = ['shared', 'features', 'lib', 'store'].map((part) => ({
  find: `$${part}`,
  replacement: join(root, 'src', part),
}));
const modules = (label: string): Plugin => ({
  name: 'pin-executed-inputs',
  async generateBundle(_options, output) {
    const ids = new Set(
      Object.values(output).flatMap((chunk) =>
        chunk.type === 'chunk' ? Object.keys(chunk.modules) : [],
      ),
    );
    const inputs = await Promise.all(
      [...ids].sort().map(async (id) => {
        const virtual =
          id === '\0native-renderer'
            ? activeRenderer
            : id === '\0native-socket-observer'
              ? socketShim
              : null;
        if (virtual !== null) return { id, sha256: hash(virtual), source: virtual };
        try {
          return { id, sha256: hash(await readFile(id)) };
        } catch {
          return { id, virtual: id.startsWith('\0') };
        }
      }),
    );
    record(evidence!, `${label}-inputs`, inputs);
    for (const input of inputs) {
      if (!input.sha256) continue;
      const bytes = 'source' in input ? Buffer.from(input.source!) : await readFile(input.id);
      if (hash(bytes) !== input.sha256) throw new Error('Original build input changed');
      await mkdir(join(evidence!, 'source-inputs'), { recursive: true });
      await writeFile(join(evidence!, 'source-inputs', input.sha256), bytes);
    }
    if (uiMode && label === 'renderer') {
      const required = [
        'test/fixtures/native-review-native/ui-renderer.svelte',
        'src/lib/components/workspace/PullRequestCreator.svelte',
        'src/features/accept-changes/components/NativeReviewAttempt.svelte',
        'src/lib/components/patterns/confirm/ConfirmHost.svelte',
        'src/store/renderer/configured-store.ts',
        'src/store/renderer/slices/principal/sagas/principal-saga.ts',
        'src/store/renderer/slices/connections/sagas/connections-saga.ts',
        'src/store/renderer/slices/workspace-events/sagas/daemon-events-saga.ts',
        'src/store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga.ts',
        'src/store/renderer/slices/repository-context/sagas/repository-context-saga.ts',
        'src/store/renderer/slices/repository-context/sagas/native-review-saga.ts',
        'src/lib/client/live/live-workspaces-client.ts',
        'src/lib/client/live/electron-ipc-transport.ts',
      ];
      const proof = required.map((path) => {
        const id = join(root, path);
        const chunk = Object.values(output).find(
          (item) => item.type === 'chunk' && item.modules[id]?.renderedLength > 0,
        );
        if (!chunk || chunk.type !== 'chunk') throw new Error('Missing actual UI path: ' + path);
        return {
          path,
          input: inputs.find((item) => item.id === id),
          renderedLength: chunk.modules[id].renderedLength,
          chunk: chunk.fileName,
        };
      });
      record(evidence!, 'ui-build-preflight', proof);
    }
    if (label === 'main.mjs') {
      const clientId = join(root, 'src/features/backend/main/json-rpc-client.ts');
      const wrapperId = '\0native-socket-observer';
      const client = this.getModuleInfo(clientId);
      const wrapper = this.getModuleInfo(wrapperId);
      const original = this.getModuleInfo(actualFactory);
      const rendered = [clientId, wrapperId, actualFactory].map((id) => {
        const chunk = Object.values(output).find(
          (item) => item.type === 'chunk' && item.modules[id]?.renderedLength > 0,
        );
        if (!chunk || chunk.type !== 'chunk') throw new Error(`Missing rendered module: ${id}`);
        const module = chunk.modules[id];
        if (!module.code) throw new Error(`Rendered module has no code: ${id}`);
        return {
          id,
          chunk: chunk.fileName,
          chunkHash: hash(chunk.code),
          renderedHash: hash(module.code),
          renderedLength: module.renderedLength,
          renderedExports: module.renderedExports,
          ...(id === wrapperId ? { code: module.code } : {}),
        };
      });
      if (
        !client?.isIncluded ||
        !wrapper?.isIncluded ||
        !original?.isIncluded ||
        !client.importedIds.includes(wrapperId) ||
        client.importedIds.includes(actualFactory) ||
        !wrapper.importers.includes(clientId) ||
        !wrapper.importedIds.includes(actualFactory) ||
        wrapper.importedIds.some((id) => id !== actualFactory) ||
        !original.importers.includes(wrapperId) ||
        !rendered[1].renderedExports.includes('createBackendSocket') ||
        !rendered[2].renderedExports.includes('createBackendSocket') ||
        inputs.find((input) => input.id === wrapperId)?.sha256 !== hash(socketShim)
      )
        throw new Error('Original client -> rendered observer -> factory relation missing');
      const wrapperChunk = output[rendered[1].chunk];
      const clientChunk = output[rendered[0].chunk];
      if (wrapperChunk.type !== 'chunk' || clientChunk.type !== 'chunk')
        throw new Error('Rendered client/observer chunks missing');
      const normalize = (node: unknown) =>
        JSON.stringify(node, (key, value) =>
          ['start', 'end', 'loc', 'raw'].includes(key) ? undefined : value,
        );
      const functions = this.parse(rendered[1].code!).body.filter(
        (node) => node.type === 'FunctionDeclaration',
      );
      if (functions.length !== 1 || !functions[0].id)
        throw new Error('Expected one rendered observer function');
      const wrapperFunction = functions[0];
      if (
        !this.parse(wrapperChunk.code).body.some(
          (node) =>
            node.type === 'FunctionDeclaration' &&
            node.id?.name === wrapperFunction.id!.name &&
            normalize(node) === normalize(wrapperFunction),
        )
      )
        throw new Error('Observer function absent from final emitted AST');
      const factoryAssignments = (code: string) => {
        const found: string[] = [];
        let nodes = 0;
        const visit = (node: any) => {
          if (!node || typeof node !== 'object') return;
          if (++nodes > 1_000_000) throw new Error('Emitted AST bound');
          if (
            node.type === 'AssignmentExpression' &&
            node.left?.type === 'MemberExpression' &&
            node.left.object?.type === 'ThisExpression' &&
            node.left.property?.name === 'socketFactory' &&
            node.right?.type === 'LogicalExpression' &&
            node.right.operator === '??' &&
            node.right.right?.name === wrapperFunction.id!.name
          )
            found.push(normalize(node));
          for (const value of Object.values(node))
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        };
        visit(this.parse(code));
        return found;
      };
      const expectedAssignments = factoryAssignments(clientChunk.modules[clientId].code!);
      const emittedAssignments = factoryAssignments(clientChunk.code);
      if (expectedAssignments.length !== 1 || !emittedAssignments.includes(expectedAssignments[0]))
        throw new Error('Original client does not select the emitted observer factory');
      const graph = { client, wrapper, original };
      record(evidence!, 'observer-build-preflight', {
        wrapperSourceHash: hash(socketShim),
        wrapperFunctionAstHash: hash(normalize(wrapperFunction)),
        clientFactoryAssignmentAstHash: hash(expectedAssignments[0]),
        graph: Object.fromEntries(
          Object.entries(graph).map(([name, info]) => [
            name,
            { id: info.id, importedIds: info.importedIds, importers: info.importers },
          ]),
        ),
        rendered,
        qualification: 'Build import relation only; runtime allocation/forwarding still required',
      });
    }
  },
  async writeBundle(options, output) {
    const base = options.dir;
    if (!base) throw new Error('Original output directory required');
    const closure = [];
    for (const [name, emitted] of Object.entries(output)) {
      if (name.split('/').includes('..') || name.startsWith('/'))
        throw new Error('Non-local emitted output');
      const bytes = await readFile(join(base, name));
      const imports =
        emitted.type === 'chunk' ? [...emitted.imports, ...emitted.dynamicImports] : [];
      for (const dependency of imports) {
        if (
          dependency.startsWith('.') &&
          !output[posix.normalize(posix.join(posix.dirname(name), dependency))]
        )
          throw new Error('Missing emitted local import: ' + dependency);
      }
      const artifact = join(evidence!, 'emitted', label, name);
      await mkdir(dirname(artifact), { recursive: true });
      await writeFile(artifact, bytes);
      closure.push({ name, type: emitted.type, sha256: hash(bytes), bytes: bytes.length, imports });
    }
    record(evidence!, label + '-output-closure', closure);
  },
});

/** Source literals for a real, isolated Kit route; no application routes or mock $app modules. */
async function buildKitFixture(application: UserConfig) {
  const scaffold = join(bundle, 'kit-fixture');
  const output = join(bundle, 'ui-assets');
  const routes = join(scaffold, 'src/routes');
  await mkdir(join(routes, '[...fixture]'), { recursive: true });
  await mkdir(join(scaffold, 'static'), { recursive: true });
  const page = `<script lang="ts">
import {onMount} from 'svelte';
onMount(() => {
  let retired = false;
  let startupSettled = false;
  let child: Awaited<ReturnType<typeof import('../../bootstrap').start>> | undefined;
  let closing: Promise<unknown> | undefined;
  const startup = import('../../bootstrap').then(module => {
    if (!retired) child = module.start();
    startupSettled = true;
  });
  const close = () => closing ??= (async () => {
    retired = true;
    await startup;
    if (!child) throw new Error('Original UI bootstrap did not complete');
    const receipt = await child.close();
    return {...receipt, route: {startupSettled, closed: true}};
  })();
  Object.assign(window, {nativeUiRoute: {close}});
  return () => { void close(); };
});
</script>
<div id="ui"></div>
`;
  const aliases = application.resolve!.alias;
  if (!Array.isArray(aliases)) throw new Error('Original application alias list required');
  const aliasSource =
    '[' +
    aliases
      .map(
        (value) =>
          '{find:' +
          (value.find instanceof RegExp ? value.find.toString() : JSON.stringify(value.find)) +
          ',replacement:' +
          JSON.stringify(value.replacement) +
          '}',
      )
      .join(',') +
    ']';
  const config = `import {sveltekit} from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = {name:'actual-kit-fixture-inputs',generateBundle(options,output){
  const side = options.dir.endsWith('/client') ? 'client' : 'server';
  const entries = Object.values(output).filter(item=>item.type==='chunk').flatMap(chunk=>Object.entries(chunk.modules).map(([id,value])=>{
    let sourceSha256=null;try{sourceSha256=hash(fs.readFileSync(id));}catch{}
    if(sourceSha256){fs.mkdirSync(path.join(${JSON.stringify(evidence)},'source-inputs'),{recursive:true});fs.copyFileSync(id,path.join(${JSON.stringify(evidence)},'source-inputs',sourceSha256));}
    const info=this.getModuleInfo(id);return {id,sourceSha256,importedIds:info.importedIds,importers:info.importers,renderedExports:value.renderedExports,renderedLength:value.renderedLength,renderedSha256:value.code ? hash(value.code) : null,chunk:chunk.fileName,chunkSha256:hash(chunk.code)};
  }));
  fs.writeFileSync(path.join(${JSON.stringify(evidence)},'kit-'+side+'-inputs.json'),JSON.stringify(entries,null,2)+'\\n');
},writeBundle(options,output){
  const side=options.dir.endsWith('/client')?'client':'server';const closure=[];
  for(const [name,item] of Object.entries(output)){
    if(name.split('/').includes('..')||name.startsWith('/'))throw Error('Non-local Kit output');
    const bytes=fs.readFileSync(path.join(options.dir,name));const imports=item.type==='chunk'?[...item.imports,...item.dynamicImports]:[];
    for(const dependency of imports)if(dependency.startsWith('.')&&!output[path.posix.normalize(path.posix.join(path.posix.dirname(name),dependency))])throw Error('Missing Kit local output '+dependency);
    const target=path.join(${JSON.stringify(evidence)},'kit-emitted',side,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);closure.push({name,type:item.type,sha256:hash(bytes),bytes:bytes.length,imports});
  }
  fs.writeFileSync(path.join(${JSON.stringify(evidence)},'kit-'+side+'-output-closure.json'),JSON.stringify(closure,null,2)+'\\n');
}};
export default {
  root:${JSON.stringify(scaffold)},
  resolve:{alias:${aliasSource},conditions:['browser','svelte']},
  define:${JSON.stringify(application.define)},
  plugins:[...await sveltekit({
    preprocess:vitePreprocess(),compilerOptions:{compatibility:{componentApi:4}},
    adapter:adapter({pages:${JSON.stringify(output)},assets:${JSON.stringify(output)},fallback:'index.html',precompress:false}),
    outDir:${JSON.stringify(join(scaffold, '.kit'))},
    files:{src:${JSON.stringify(join(scaffold, 'src'))},routes:${JSON.stringify(routes)},assets:${JSON.stringify(join(scaffold, 'static'))},lib:${JSON.stringify(join(root, 'src/lib'))},appTemplate:${JSON.stringify(join(scaffold, 'src/app.html'))},hooks:{client:${JSON.stringify(join(scaffold, 'src/hooks.client'))},server:${JSON.stringify(join(scaffold, 'src/hooks.server'))},universal:${JSON.stringify(join(scaffold, 'src/hooks'))}}},
    env:{dir:${JSON.stringify(scaffold)}},prerender:{entries:[]},paths:{relative:false},version:{name:'native-ui-fixture'},serviceWorker:{register:false}
  }),provenance],
  build:{target:'es2022',minify:false,sourcemap:false},
};
`;
  const buildCode =
    "const {build}=await import('vite');await build({configFile:'vite.config.mjs',logLevel:'error'});";
  const generated: Record<string, string> = {
    'build.mjs': buildCode,
    'package.json': JSON.stringify({ private: true, type: 'module' }),
    'tsconfig.json': JSON.stringify({ extends: './.kit/tsconfig.json' }),
    'src/app.html':
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>',
    'src/routes/+layout.ts': 'export const ssr = false;\nexport const prerender = false;\n',
    'src/routes/[...fixture]/+page.svelte': page,
    'src/bootstrap.ts': uiRenderer,
    'vite.config.mjs': config,
  };
  const inputs = [];
  for (const [name, value] of Object.entries(generated)) {
    await writeFile(join(scaffold, name), value);
    const artifact = join(evidence!, 'kit-generated', name);
    await mkdir(dirname(artifact), { recursive: true });
    await writeFile(artifact, value);
    inputs.push({ name, sha256: hash(value), bytes: Buffer.byteLength(value) });
  }
  record(evidence!, 'kit-generated-inputs', inputs);
  // Kit's post-build workers rediscover Vite config from cwd. The original child
  // owns that cwd for every phase, without changing this worker or the application.
  setupOwner?.admit('kit-child');
  const builder = spawn(process.execPath, [join(scaffold, 'build.mjs')], {
    cwd: scaffold,
    stdio: 'inherit',
  });
  setupOwner?.child(builder);
  const terminal = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      builder.once('error', reject);
      builder.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  record(evidence!, 'kit-build-process', {
    pid: builder.pid,
    cwd: scaffold,
    executable: process.execPath,
    argv: [join(scaffold, 'build.mjs')],
    ...terminal,
    waitedOriginalChild: true,
  });
  if (terminal.code !== 0 || terminal.signal) throw new Error('Original Kit build child failed');
  setupOwner?.observe('kit-child', 'original-wait-fulfilled');
  setupOwner?.observe('kit-final-retention', 'entered');
  // Post-build files may differ from generateBundle graph-stage digests.
  for (const side of ['client', 'server']) {
    const folder = join(scaffold, '.kit/output', side);
    const final: Array<{ name: string; sha256: string; bytes: number }> = [];
    async function retain(directory: string, relative = '') {
      for (const name of await readdir(directory)) {
        const original = join(directory, name),
          local = join(relative, name);
        const stat = await lstat(original);
        if (stat.isDirectory()) await retain(original, local);
        else {
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error('Non-regular final Kit output');
          const bytes = await readFile(original),
            copy = join(evidence!, 'kit-final', side, local);
          await mkdir(dirname(copy), { recursive: true });
          await writeFile(copy, bytes);
          final.push({ name: local, sha256: hash(bytes), bytes: bytes.length });
        }
      }
    }
    await retain(folder);
    const emitted = JSON.parse(
      await readFile(join(evidence!, 'kit-' + side + '-output-closure.json'), 'utf8'),
    ) as Array<{ name: string }>;
    if (emitted.some((item) => !final.some((file) => file.name === item.name)))
      throw new Error('Final Kit closure lost an emitted file');
    record(evidence!, 'kit-' + side + '-final-closure', final);
  }

  setupOwner?.observe('kit-final-retention', 'fulfilled');
  const compiled: Array<{
    id: string;
    renderedLength: number;
    importedIds: string[];
    importers: string[];
    renderedExports: string[];
    sourceSha256: string | null;
    chunk: string;
  }> = JSON.parse(await readFile(join(evidence!, 'kit-client-inputs.json'), 'utf8'));
  const required = [
    join(root, 'test/fixtures/native-review-native/ui-renderer.svelte'),
    ...[
      ...(sidebarMode
        ? [
            'lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
            'lib/components/workspace/sidebar/PRSection.svelte',
            'features/accept-changes/background-git-actions.service.ts',
            'store/renderer/slices/git/sagas/git-read-saga.ts',
            'store/renderer/slices/git/sagas/accept-changes-status-saga.ts',
            'lib/client/live/live-git-client.ts',
            'lib/client/live/live-files-client.ts',
            'features/accept-changes/accept-changes.client.ts',
            'features/file-tracking/file-tracking.client.ts',
          ]
        : []),
      'lib/components/workspace/PullRequestCreator.svelte',
      'features/accept-changes/components/NativeReviewAttempt.svelte',
      'lib/components/patterns/confirm/ConfirmHost.svelte',
      'store/renderer/configured-store.ts',
      'store/renderer/slices/connections/sagas/connections-saga.ts',
      'store/renderer/slices/workspace-events/sagas/daemon-events-saga.ts',
      'store/renderer/slices/principal/sagas/principal-saga.ts',
      'store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga.ts',
      'store/renderer/slices/repository-context/sagas/repository-context-saga.ts',
      'store/renderer/slices/repository-context/sagas/native-review-saga.ts',
      'lib/client/live/live-workspaces-client.ts',
      'lib/client/live/electron-ipc-transport.ts',
      'store/renderer/seeders/workspaces-seeder.ts',
      'store/renderer/slices/workspace/utils/workspace.client.ts',
      'shared/generated/ipc-client.ts',
      'shared/ipc-mock-router.ts',
      'lib/client/index.ts',
      'lib/client/live/live-app-client.ts',
    ].map((p) => join(root, 'src', p)),
    join(scaffold, 'src/bootstrap.ts'),
    join(routes, '[...fixture]/+page.svelte'),
  ];
  const proof = required.map((id) => {
    const item = compiled.find((item) => item.id === id && item.renderedLength > 0);
    if (!item) throw new Error('Missing actual Kit UI module: ' + id);
    return item;
  });
  const kitClient = compiled.find(
    (item) =>
      item.id.includes('/@sveltejs/kit/') &&
      item.id.endsWith('/src/runtime/client/client.js') &&
      item.renderedLength > 0,
  );
  if (!kitClient || !['goto', 'start'].every((name) => kitClient.renderedExports.includes(name)))
    throw new Error('Genuine Kit navigation and startup implementation missing');
  proof.push(kitClient);
  for (const suffix of [
    '/src/runtime/app/stores.js',
    '/src/runtime/app/navigation.js',
    '/src/runtime/client/entry.js',
  ]) {
    const item = compiled.find(
      (item) => item.id.includes('/@sveltejs/kit/') && item.id.endsWith(suffix),
    );
    if (
      !item ||
      item.sourceSha256 !== hash(await readFile(item.id)) ||
      !item.importedIds.includes(kitClient.id)
    )
      throw new Error('Missing original Kit runtime import relation: ' + suffix);
    if (suffix.endsWith('/stores.js') && item.renderedLength <= 0)
      throw new Error('Genuine Kit stores not emitted');
    proof.push(item);
  }
  record(evidence!, 'ui-build-preflight', proof);
  const bridgeRelations = [
    [
      join(scaffold, 'src/bootstrap.ts'),
      join(root, 'src/store/renderer/seeders/workspaces-seeder.ts'),
    ],
    [
      join(root, 'src/store/renderer/slices/workspace-lifecycle/sagas/lifecycle-read-saga.ts'),
      join(root, 'src/store/renderer/slices/workspace/utils/workspace.client.ts'),
    ],
    [
      join(root, 'src/store/renderer/slices/workspace/utils/workspace.client.ts'),
      join(root, 'src/shared/generated/ipc-client.ts'),
    ],
    [join(root, 'src/shared/generated/ipc-client.ts'), join(root, 'src/shared/ipc-mock-router.ts')],
    [
      join(root, 'src/store/renderer/seeders/workspaces-seeder.ts'),
      join(root, 'src/shared/ipc-mock-router.ts'),
    ],
    [
      join(root, 'src/store/renderer/seeders/workspaces-seeder.ts'),
      join(root, 'src/lib/client/index.ts'),
    ],
    [join(root, 'src/lib/client/index.ts'), join(root, 'src/lib/client/live/live-app-client.ts')],
    [
      join(root, 'src/lib/client/live/live-app-client.ts'),
      join(root, 'src/lib/client/live/live-workspaces-client.ts'),
    ],
  ];
  if (sidebarMode)
    bridgeRelations.push(
      ...[
        [
          'test/fixtures/native-review-native/ui-renderer.svelte',
          'src/lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
        ],
        [
          'src/lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
          'src/lib/components/workspace/sidebar/PRSection.svelte',
        ],
        [
          'src/lib/components/workspace/sidebar/PRSection.svelte',
          'src/features/accept-changes/background-git-actions.service.ts',
        ],
        ['src/store/renderer/slices/git/sagas/git-read-saga.ts', 'src/lib/client/index.ts'],
        [
          'src/store/renderer/slices/git/sagas/accept-changes-status-saga.ts',
          'src/features/accept-changes/accept-changes.client.ts',
        ],
        ['src/lib/client/live/live-app-client.ts', 'src/lib/client/live/live-git-client.ts'],
        ['src/lib/client/live/live-app-client.ts', 'src/lib/client/live/live-files-client.ts'],
        [
          'src/lib/components/workspace/sidebar/SidebarChangesPanel.svelte',
          'src/features/file-tracking/file-tracking.client.ts',
        ],
      ].map((edge) => edge.map((name) => join(root, name))),
    );
  for (const [caller, dependency] of bridgeRelations) {
    const from = proof.find((item) => item.id === caller);
    const to = proof.find((item) => item.id === dependency);
    if (
      !from?.importedIds.includes(dependency) ||
      !to?.importers.includes(caller) ||
      from.sourceSha256 !== hash(await readFile(caller)) ||
      to.sourceSha256 !== hash(await readFile(dependency))
    )
      throw new Error('Original workspace bridge import relation missing: ' + caller);
  }
  record(evidence!, 'workspace-bridge-preflight', {
    relations: bridgeRelations,
    modules: proof.filter((item) => bridgeRelations.some((edge) => edge.includes(item.id))),
    qualification:
      'Rendered original bridge and Live import path; actual workspace admission still requires runtime proof',
  });
  const assets: Record<string, { file: string; sha256: string; bytes: number; type: string }> = {};
  let total = 0;
  async function inventory(folder: string) {
    for (const name of await readdir(folder)) {
      const path = join(folder, name),
        stat = await lstat(path);
      if (stat.isDirectory()) {
        await inventory(path);
        continue;
      }
      if (!stat.isFile()) throw new Error('Non-regular generated Kit asset');
      const relative = path.slice(output.length + 1),
        bytes = await readFile(path);
      total += bytes.length;
      if (Object.keys(assets).length >= 4096 || total > 268435456)
        throw new Error('Kit asset bound');
      const extension = relative.split('.').at(-1)!;
      const type =
        (
          {
            html: 'text/html',
            js: 'text/javascript',
            css: 'text/css',
            json: 'application/json',
            woff2: 'font/woff2',
            woff: 'font/woff',
            svg: 'image/svg+xml',
            png: 'image/png',
          } as Record<string, string>
        )[extension] ?? 'application/octet-stream';
      assets['/' + relative] = { file: relative, sha256: hash(bytes), bytes: bytes.length, type };
      const copy = join(evidence!, 'kit-assets', relative);
      await mkdir(dirname(copy), { recursive: true });
      await copyFile(path, copy);
    }
  }
  await inventory(output);
  if (!assets['/index.html']) throw new Error('Generated Kit fallback entry missing');
  const manifest = { version: 1, entry: '/index.html', assets, total };
  record(output, 'asset-manifest', manifest);
  record(evidence!, 'asset-manifest', manifest);
  setupOwner?.observe('kit-served-retention', 'fulfilled');
}

async function prepareNativeFixture() {
  await mkdir(evidence!, { recursive: true, mode: 0o700 });
  setupEvidenceReady = true;
  setupOwner?.admit('identity');
  if (sidebarMode) {
    const info = test.info();
    if (
      !(diagnosticMode
        ? info.title === sidebarGroups[1][0]
        : sidebarGroups.some(([title]) => title === info.title)) ||
      (diagnosticMode &&
        (info.workerIndex !== 0 ||
          info.parallelIndex !== 0 ||
          info.repeatEachIndex !== 0 ||
          !info.config.argv ||
          JSON.stringify(info.config.argv.slice(2)) !== JSON.stringify(originalSelection) ||
          !assertSidebarSelection(process.env, info.config.argv.slice(2)))) ||
      info.config.workers !== 1 ||
      info.project.retries !== 0 ||
      info.project.repeatEach !== 1 ||
      info.retry !== 0
    )
      throw new Error('Actual sidebar title/worker/retry differs from the original CLI selection');
    record(evidence!, 'actual-runner-selection', {
      argv: originalSelection,
      cliGrep: diagnosticMode ? companionDiagnosticGrep : sidebarGrep,
      configuredGrep: String(info.config.grep),
      title: info.title,
      workers: info.config.workers,
      retries: info.project.retries,
      retry: info.retry,
      worker: info.workerIndex,
    });
  }
  if (diagnosticMode)
    record(
      evidence!,
      'companion-identity',
      await assertCompanionDiagnosticIdentity(source!, executable!),
    );
  const artifact = await lstat(executable!);
  expect({
    regular: artifact.isFile(),
    bytes: artifact.size,
    mode: artifact.mode & 0o777,
    sha: hash(await readFile(executable!)),
  }).toEqual({
    regular: true,
    bytes: diagnosticMode ? companionDiagnosticIdentity.bytes : 267481480,
    mode: 0o555,
    sha: executableHash,
  });
  identity.sourceSha256 = hash(
    await readFile(join(source!, 'crates/intentd/tests/e2e_native_review_wire.rs')),
  );
  record(evidence!, 'frozen-cases', {
    pipeControllerHash: hash(pipeController),
    python: {
      path: python,
      resolved: await realpath(python),
      sha256: hash(await readFile(python)),
    },
    groups: sidebarMode ? sidebarGroups : uiMode ? uiGroups : groups,
    workers: 1,
    retries: 0,
    driverLifetimeSeconds: 150,
    groupBudgetMs: 180000,
    identity,
    executable,
    source,
    socketShimHash: hash(socketShim),
    rendererHash: hash(activeRenderer),
  });
  try {
    setupOwner?.admit('allocation');
    bundle = await mkdtemp(join(tmpdir(), 'native-review-electron-code-'));
    setupOwner?.allocated(bundle);
    setupOwner?.admit('bootstrap');
    await symlink(await realpath(join(root, 'node_modules')), join(bundle, 'node_modules'));
    await writeFile(join(bundle, 'pipe-controller.py'), pipeController, { mode: 0o600 });
    await writeFile(join(evidence!, 'pipe-controller.py'), pipeController, { mode: 0o600 });
    const shim: Plugin = {
      name: 'observe-real-factory',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === actualFactory + '?original') return actualFactory;
        if (importer?.endsWith('/json-rpc-client.ts') && id === './backend-connection')
          return '\0native-socket-observer';
      },
      load(id) {
        if (id === '\0native-socket-observer') return socketShim;
      },
    };
    for (const [entry, name] of [
      ['test/fixtures/native-review-native/main.ts', 'main.mjs'],
      ['src/preload/index.ts', 'preload.cjs'],
    ]) {
      setupOwner?.admit(name);
      await build({
        configFile: false,
        logLevel: 'error',
        resolve: { alias },
        plugins: [shim, modules(name)],
        build: {
          target: 'es2022',
          ssr: join(root, entry),
          outDir: bundle,
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            external: ['electron'],
            output: { format: name.endsWith('.cjs') ? 'cjs' : 'es', entryFileNames: name },
          },
        },
      });
      setupOwner?.observe(name, 'build-fulfilled');
      setupOwner?.admit('main-output');
      await copyFile(join(bundle, name), join(evidence!, name));
    }
    // Reuse the application's exact renderer resolution, including its existing
    // icon compatibility mappings; do not replace components or install packages.
    setupOwner?.admit('renderer-config');
    const appConfig = uiMode
      ? await loadConfigFromFile(
          { command: 'build', mode: 'production' },
          join(root, 'vite.config.mjs'),
          root,
          'silent',
        )
      : null;
    if (uiMode && !appConfig?.config.resolve?.alias)
      throw new Error('Original renderer aliases missing');
    if (uiMode)
      record(evidence!, 'renderer-config-input', {
        path: join(root, 'vite.config.mjs'),
        sha256: hash(await readFile(join(root, 'vite.config.mjs'))),
        aliases: appConfig!.config.resolve!.alias,
        qualification:
          'Unchanged application resolution and defines only; fixture owns its build plugins and entry',
      });
    if (uiMode) {
      setupOwner?.admit('kit');
      await buildKitFixture(appConfig!.config);
    } else {
      await build({
        configFile: false,
        logLevel: 'error',
        resolve: { alias, conditions: ['browser', 'svelte'] },
        plugins: [
          modules('renderer'),
          {
            name: 'inline-native-facade',
            resolveId(id) {
              if (id === 'native-renderer') return '\0native-renderer';
            },
            load(id) {
              if (id === '\0native-renderer') return renderer;
            },
          },
        ],
        build: {
          target: 'es2022',
          outDir: bundle,
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            input: 'native-renderer',
            output: {
              format: 'es',
              entryFileNames: 'renderer.js',
              inlineDynamicImports: true,
              assetFileNames: (asset) =>
                asset.names.some((name) => name.endsWith('.css'))
                  ? 'renderer.js.css'
                  : 'assets/[name]-[hash][extname]',
            },
          },
        },
      });
      await copyFile(join(bundle, 'renderer.js'), join(evidence!, 'renderer.js'));
    }
    setupOwner?.admit('compiled');
    record(
      evidence!,
      'compiled',
      await Promise.all(
        [
          'main.mjs',
          'preload.cjs',
          ...(uiMode ? ['ui-assets/asset-manifest.json'] : ['renderer.js']),
        ].map(async (name) => ({
          name,
          sha256: hash(await readFile(join(bundle, name))),
        })),
      ),
    );
    if (uiMode) {
      // Each worker owns a separate build. Keep its actual bytes before a later
      // failed worker can overwrite the shared diagnostic paths.
      setupOwner?.admit('epoch');
      const epoch = join(evidence!, 'build-epochs', basename(bundle));
      await mkdir(epoch, { recursive: true });
      for (const name of [
        'compiled.json',
        'frozen-cases.json',
        'main.mjs',
        'main.mjs-inputs.json',
        'preload.cjs',
        'preload.cjs-inputs.json',
        'pipe-controller.py',
        'renderer-config-input.json',
        'kit-build-process.json',
        'kit-generated-inputs.json',
        'kit-client-inputs.json',
        'kit-server-inputs.json',
        'ui-build-preflight.json',
        'workspace-bridge-preflight.json',
        'observer-build-preflight.json',
        'asset-manifest.json',
        'kit-assets',
        'kit-generated',
        'emitted',
        'source-inputs',
        'main.mjs-output-closure.json',
        'preload.cjs-output-closure.json',
        'kit-emitted',
        'kit-client-output-closure.json',
        'kit-server-output-closure.json',
        'kit-final',
        'kit-client-final-closure.json',
        'kit-server-final-closure.json',
      ])
        await cp(join(evidence!, name), join(epoch, name), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      record(epoch, 'identity', {
        bundle,
        workerPid: process.pid,
        workerIndex: process.env.TEST_WORKER_INDEX ?? null,
        specSha256: hash(await readFile(fileURLToPath(import.meta.url))),
      });
    }
    setupOwner?.publish();
  } catch (error) {
    if (diagnosticMode && bundle) {
      try {
        const archive = () =>
          retainCompanionBundle(bundle, join(evidence!, 'failed-build', basename(bundle)));
        if (setupOwner) await setupOwner.archive(archive);
        else await archive();
      } catch (archiveError) {
        try {
          record(evidence!, 'failed-build-archive-error', String(archiveError));
        } catch {
          /* Preserve the original build exception when evidence storage itself fails. */
        }
      }
    }
    throw error;
  }
}
test.beforeAll(() => {
  if (!diagnosticMode) return prepareNativeFixture();
  const info = test.info();
  setupOwner = createCompanionSetupOwner(
    () => info.status !== 'passed' || info.errors.length > 0,
    (value) => {
      if (setupEvidenceReady) record(evidence!, 'setup-ownership', value);
    },
  );
  return setupOwner.run(prepareNativeFixture);
});
test.afterAll(async () => {
  if (diagnosticMode && setupOwner) {
    await setupOwner.retire((path) => rm(path, { recursive: true, force: true }));
    return;
  }
  if (bundle) await rm(bundle, { recursive: true, force: true });
});

function control(ready: Ready, action: unknown): Promise<any> {
  const request = { version: 1, runId: ready.runId, id: randomUUID(), action };
  const bytes = JSON.stringify(request) + '\n';
  if (Buffer.byteLength(bytes) > 8192) throw new Error('Control frame bound');
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(ready.control);
    let input = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Original control response deadline'));
    }, 10000);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('connect', () => socket.write(bytes));
    socket.on('data', (chunk) => {
      input += chunk.toString();
      if (input.length > 8192) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error('Control reply bound'));
        return;
      }
      if (!input.includes('\n')) return;
      clearTimeout(timer);
      socket.end();
      try {
        const value = JSON.parse(input.slice(0, input.indexOf('\n')));
        if (value.id !== request.id || value.error) throw new Error(JSON.stringify(value));
        resolvePromise(value.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
async function waitFile(path: string, child: ChildProcess) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error('Original driver exited before ready');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('Original driver ready deadline');
}
type Main = Fixture;
const main = <T>(app: ElectronApplication, fn: (fixture: Main) => T) =>
  app.evaluate(({ app: _app }, code) => {
    const fixture = (globalThis as unknown as { nativeReviewFixture: Main }).nativeReviewFixture;
    return (0, eval)(`(${code})`)(fixture);
  }, fn.toString()) as Promise<Awaited<T>>;
const pageFor = async (app: ElectronApplication, key: string) => {
  await expect
    .poll(() =>
      app
        .windows()
        .find((page) => page.url().endsWith('/' + key))
        ?.url(),
    )
    .toContain('/' + key);
  const page = app.windows().find((value) => value.url().endsWith('/' + key))!;
  await page.waitForFunction(() => !!(window as any).native);
  return page;
};
const begin = (
  page: Page,
  key: string,
  input: NativeReviewInput,
): Promise<NativeReviewPreparedView> =>
  page.evaluate(({ key, input }) => (window as any).native.begin(key, input), { key, input });
const confirm = (
  page: Page,
  key: string,
  command: NativeReviewTextCommand = {},
): Promise<NativeReviewObservation> =>
  page.evaluate(({ key, command }) => (window as any).native.confirm(key, command), {
    key,
    command,
  });
const reconcile = (page: Page, key: string): Promise<NativeReviewObservation> =>
  page.evaluate((key) => (window as any).native.reconcile(key), key);
const inputFor = (
  ready: Ready,
  host: number,
  registered = false,
  combined = false,
): NativeReviewInput => ({
  workspaceId: ready.hosts[host].workspaceId,
  action: combined ? 'commit' : 'create-pr',
  ...(combined
    ? { options: { stageUnstaged: false, pushAfterCommit: true, createPRAfterPush: true } }
    : {}),
  review: {
    root: registered
      ? {
          kind: 'registered',
          workspaceId: ready.hosts[host].workspaceId,
          gitRootId: ready.hosts[host].registeredRootId,
        }
      : { kind: 'primary', workspaceId: ready.hosts[host].workspaceId },
    choice: {
      kind: 'explicitTarget',
      target: {
        provider: 'gitlab',
        instanceBaseUrl: ready.hosts[host].instance,
        projectPath: 'group/project',
      },
    },
    targetBranch: 'trunk',
    pushRemote: 'forge',
  },
});
const settled = (value: NativeReviewObservation, expected: 'created' | 'reused' | 'uncertain') => {
  expect(value.execute?.state).toBe('settled');
  expect(value.execute?.reviewExecution?.outcome.status).toBe(expected);
  return value.execute!.reviewExecution!;
};
async function arm(ready: Ready, operationId: string, method: 'GET' | 'POST', mode = 'hold') {
  const status = await control(ready, { command: 'barrierStatus', host: 0 });
  const counts = status.counts ?? {};
  const barrier = {
    id: randomUUID(),
    operationId,
    method,
    route: 'mergeRequests',
    ordinal: (counts[`${method}:mergeRequests`] ?? 0) + 1,
    mode,
    holdSeconds: 30,
  };
  await control(ready, { command: 'armProvider', host: 0, barrier });
  return barrier;
}
async function entered(ready: Ready, id: string) {
  let last: any;
  await expect
    .poll(async () => {
      last = await control(ready, { command: 'barrierStatus', host: 0 });
      return (
        last.barriers?.some((barrier: any) => barrier.id === id && barrier.entered) &&
        last.events?.some((event: any) => event.authenticated && event.phase === 'entered')
      );
    })
    .toBe(true);
  return last;
}

function stopInventory(source: ReturnType<Fixture['evidence']>) {
  if (source.faults.length || source.records.length > 1024)
    throw new Error('Original stop observation missing or overflowed');
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const sameRoot = (a: any, b: any) =>
    a?.workspaceId === b?.workspaceId && a?.kind === b?.kind && a?.gitRootId === b?.gitRootId;
  const issued = source.records.filter(
    (row) => row.direction === 'request' && row.envelope.method === 'accept-changes.execute',
  );
  if (issued.length > 16) throw new Error('Original stop request bound');
  const rows = issued.map((row, index) => {
    const request = {
      host: row.host,
      operationId: row.envelope.params?.review?.operationId,
      socketId: row.socketId,
      requestId: row.envelope.id,
    };
    if (
      ![0, 1].includes(request.host) ||
      typeof request.operationId !== 'string' ||
      !uuid.test(request.operationId) ||
      !uuid.test(request.socketId) ||
      !(
        typeof request.requestId === 'string' ||
        (Number.isSafeInteger(request.requestId) && request.requestId >= 0)
      ) ||
      source.allocations.filter(
        (allocation) =>
          allocation.host === request.host && allocation.socketId === request.socketId,
      ).length !== 1 ||
      issued
        .slice(0, index)
        .some(
          (previous) =>
            (previous.host === request.host &&
              previous.envelope.params?.review?.operationId === request.operationId) ||
            (previous.socketId === request.socketId && previous.envelope.id === request.requestId),
        )
    )
      throw new Error('Original stop request identity missing or duplicated');
    const sameSocket = (candidate: WireRecord) =>
      candidate.host === request.host && candidate.socketId === request.socketId;
    const responses = source.records.filter(
      (candidate) =>
        sameSocket(candidate) &&
        candidate.direction === 'response' &&
        candidate.envelope.id === request.requestId,
    );
    if (responses.length > 1) throw new Error('Ambiguous original stop response');
    const originalResponse = responses[0]?.envelope ?? null;
    // Same strict settled predicate as the pinned driver's driver_completed.
    const settled = (envelope: any) =>
      envelope?.jsonrpc === '2.0' &&
      !Object.hasOwn(envelope, 'error') &&
      envelope.result?.state === 'settled' &&
      envelope.result.operationId === request.operationId &&
      envelope.result.reviewExecution?.requestId === request.operationId;
    const history =
      source.records.findLast(
        (candidate, position) =>
          sameSocket(candidate) &&
          candidate.direction === 'response' &&
          settled(candidate.envelope) &&
          source.records
            .slice(source.records.indexOf(row) + 1, position)
            .some(
              (query) =>
                sameSocket(query) &&
                query.direction === 'request' &&
                query.envelope.id === candidate.envelope.id &&
                query.envelope.method === 'accept-changes.reconcile' &&
                query.envelope.params?.operationId === request.operationId &&
                sameRoot(query.envelope.params?.root, row.envelope.params.review.root),
            ),
      )?.envelope ?? null;
    const preparations = (source.ipcRecords as Record<string, any>[]).filter(
      (ipc) =>
        ipc.channel === 'backend:native-review:prepare' &&
        ipc.main === true &&
        ipc.result?.ok === true &&
        ipc.result.result?.preview?.reviewPreparation?.operationId === request.operationId &&
        sameRoot(ipc.result.result.preview.reviewPreparation.root, row.envelope.params.review.root),
    );
    const preparation = preparations.length === 1 ? preparations[0] : null;
    const handlers = preparation
      ? (source.ipcRecords as Record<string, any>[]).filter(
          (ipc) =>
            ipc.channel === 'backend:native-review:execute' &&
            ipc.main === true &&
            ipc.sender === preparation.sender &&
            ipc.frame === preparation.frame &&
            ipc.args?.[0]?.id === preparation.result.result.id &&
            sameRoot(ipc.args[0].root, row.envelope.params.review.root),
        )
      : [];
    // A retired renderer can receive an unavailable IPC result after a genuine wire settlement.
    // Handler completion proves only the join; the original socket proves native completion.
    const joined =
      source.pending === 0 &&
      handlers.length > 0 &&
      handlers.every((ipc) => Object.hasOwn(ipc, 'result') || Object.hasOwn(ipc, 'rejected'));
    return {
      request,
      originalResponse,
      history,
      joined,
      complete: joined && (settled(originalResponse) || settled(history)),
    };
  });
  return { rows, pending: rows.filter((row) => !row.complete).map((row) => row.request) };
}

async function withDriver(
  index: number,
  body: (context: {
    dir: string;
    ready: Ready;
    app: ElectronApplication;
    a: Page;
    b: Page;
    packet(name: string, value?: unknown): Promise<any>;
  }) => Promise<void>,
) {
  if (diagnosticMode && index !== 9) throw new Error('Diagnostic mode requires only case10');
  if (sidebarMode !== index >= 8 || (index >= 5 && !uiMode) || index < 0 || index > 10)
    throw new Error('Case does not match the selected fixture mode');
  const dir = await mkdtemp(join(tmpdir(), `nrv-${index + 1}-`));
  await chmod(dir, 0o700);
  record(evidence!, `group-${index + 1}-location`, { dir });
  await mkdir(join(dir, 'runtime'), { mode: 0o700 });
  const home = join(dir, 'home');
  await mkdir(home, { mode: 0o700 });
  const runId = randomUUID();
  record(dir, 'descriptor', {
    version: 1,
    runId,
    ...identity,
    lifetimeSeconds: 150,
    scenarios:
      index < 5
        ? groups[index][1]
        : index < 8
          ? uiGroups[index - 5][1]
          : sidebarGroups[index - 8][1],
  });
  const descriptorHash = hash(await readFile(join(dir, 'descriptor.json')));
  const child = spawn(
    python,
    [join(bundle, 'pipe-controller.py'), executable!, dir, runId, descriptorHash, executableHash],
    {
      cwd: source!,
      env: { ...environment(home), INTENT_REVIEW_DRIVER_DESCRIPTOR: join(dir, 'descriptor.json') },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const lifecycle: Array<Record<string, any>> = [];
  let lifecycleFault: string | null = null;
  let metadata = '';
  let metadataBytes = 0;
  let stderr = '';
  const failLifecycle = (reason: string) => {
    lifecycleFault ??= reason;
    child.stdin!.end();
  };
  child.stdout!.on('data', (chunk: Buffer) => {
    metadataBytes += chunk.length;
    if (metadataBytes > 8192) return failLifecycle('controller metadata bound');
    metadata += chunk.toString('utf8');
    while (metadata.includes('\n')) {
      const end = metadata.indexOf('\n');
      const line = metadata.slice(0, end);
      metadata = metadata.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (
          Buffer.byteLength(line) > 2048 ||
          Object.keys(value).sort().join(',') !==
            'descriptorSha256,details,executableSha256,kind,runId,sequence,version' ||
          value.version !== 1 ||
          value.runId !== runId ||
          value.descriptorSha256 !== descriptorHash ||
          value.executableSha256 !== executableHash ||
          value.sequence !== lifecycle.length ||
          value.kind !== ['allocation', 'supervisor-wait', 'helper-result'][lifecycle.length] ||
          !value.details ||
          typeof value.details !== 'object' ||
          Array.isArray(value.details)
        )
          throw new Error('invalid lifecycle message');
        lifecycle.push(value);
      } catch {
        failLifecycle('controller metadata validation');
      }
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    if (Buffer.byteLength(stderr) + chunk.length > 8192)
      return failLifecycle('controller stderr bound');
    stderr += chunk.toString('utf8');
  });
  child.stdin!.on('error', () => failLifecycle('controller channel write failed'));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolvePromise) => {
      child.once('error', () => failLifecycle('controller spawn failed'));
      child.once('close', (code, signal) => resolvePromise({ code, signal }));
    },
  );
  child.stdin!.write('R');
  record(dir, 'allocation', { helperPid: child.pid, runId, executable, descriptorHash });
  let app: ElectronApplication | undefined;
  let ready: Ready | undefined;
  let success = false;
  const packet = async (name: string, value?: unknown) => {
    const result = {
      value,
      source: app ? await main(app, (f) => f.evidence()) : null,
      hosts: ready
        ? await Promise.all([0, 1].map((host) => control(ready!, { command: 'snapshot', host })))
        : null,
    };
    record(dir, name, result);
    return result;
  };
  if (diagnosticMode) {
    const observationErrors: string[] = [];
    let bodyError: unknown;
    let observedMainPid: number | undefined;
    let bodyFailed = false;
    let finalSource: ReturnType<Fixture['evidence']> | undefined;
    await companionPhasesOnce(
      [
        {
          name: 'body',
          run: async () => {
            try {
              ready = await waitFile(join(dir, 'ready.json'), child);
              expect(ready!.identity).toEqual(identity);
              expect(ready!.runId).toBe(runId);
              expect(ready!.hosts[0].workspaceId).toBe(ready!.hosts[1].workspaceId);
              expect(ready!.hosts[0].registeredRootId).toBe(ready!.hosts[1].registeredRootId);
              app = await electron.launch({
                args: [
                  join(bundle, 'main.mjs'),
                  join(dir, 'profile'),
                  join(bundle, 'preload.cjs'),
                  join(dir, 'ready.json'),
                  join(bundle, uiMode ? 'ui-assets/asset-manifest.json' : 'renderer.js'),
                ],
                env: {
                  ...environment(home),
                  NATIVE_REVIEW_COMPANION_DIAGNOSTIC_6328: '1',
                  ...(uiMode
                    ? {
                        NATIVE_REVIEW_UI: '1',
                        NATIVE_REVIEW_UI_ROLE: index === 6 || index === 10 ? 'member' : 'owner',
                        ...(sidebarMode ? { NATIVE_REVIEW_SIDEBAR_UI: '1' } : {}),
                      }
                    : {}),
                  DISPLAY: process.env.DISPLAY!,
                  XDG_RUNTIME_DIR: join(dir, 'runtime'),
                },
                timeout: 20000,
              });
              const logs = createWriteStream(join(dir, 'electron.log'), { mode: 0o600 });
              app.process().stdout?.pipe(logs, { end: false });
              app.process().stderr?.pipe(logs, { end: false });
              await expect
                .poll(() => app!.evaluate(() => !!(globalThis as any).nativeReviewFixture?.ready))
                .toBe(true);
              observedMainPid = app.process().pid;
              const activation = await app.evaluate(observeCompanionMainActivation);
              record(dir, 'electron', {
                outer: { runId, workerPid: process.pid, mainPid: observedMainPid },
                observed: activation,
              });
              assertCompanionMainActivation(activation, observedMainPid ?? 0, process.pid);
              await body({
                dir,
                ready: ready!,
                app,
                a: await pageFor(app, 'host-A'),
                b: await pageFor(app, 'local-B'),
                packet,
              });
            } catch (error) {
              bodyFailed = true;
              bodyError = error;
              try {
                record(dir, 'failure', {
                  error: String(error),
                  stack: error instanceof Error ? error.stack : null,
                });
              } catch (recordError) {
                observationErrors.push('body-record: ' + String(recordError));
              }
              try {
                const rendererEvidence = app
                  ? await Promise.all(
                      app.windows().map(async (page) => {
                        try {
                          return {
                            url: page.url(),
                            evidence: await page.evaluate(() =>
                              (window as any).nativeUi?.snapshot(),
                            ),
                          };
                        } catch {
                          return { unobserved: true };
                        }
                      }),
                    )
                  : null;
                await packet('failure-packet', { rendererEvidence });
              } catch (packetError) {
                try {
                  record(dir, 'failure-packet-error', String(packetError));
                } catch (recordError) {
                  observationErrors.push('packet-record: ' + String(recordError));
                }
              }
              throw error;
            }
          },
        },
        {
          name: 'original-quiesce-and-stop',
          run: async () => {
            if (!app || !ready) throw new Error('Original UI allocation unavailable for stop');
            if (uiMode) record(dir, 'ui-quiescence', await main(app, (f) => f.quiesceUi()));
            await main(app, (f) => f.join());
            const before = await packet('before-stop');
            if (!before.source) throw new Error('Original main observations missing');
            const inventory = stopInventory(before.source);
            record(dir, 'stop-inventory-before', inventory);
            const { pending } = inventory;
            record(
              dir,
              'stop-begin',
              await control(ready!, { command: 'stop', phase: 'begin', pending, envelopes: [] }),
            );
            await main(app, (f) => f.join());
            const after = await main(app, (f) => f.evidence());
            record(dir, 'after-stop', after);
            const finalInventory = stopInventory(after);
            record(dir, 'stop-inventory-after', finalInventory);
            expect(after.records.slice(0, before.source.records.length)).toEqual(
              before.source.records,
            );
            expect(finalInventory.rows.map((row) => row.request)).toEqual(
              inventory.rows.map((row) => row.request),
            );
            expect(after.pending).toBe(0);
            if (uiMode) {
              expect(after.completionFaults).toEqual([]);
              expect(after.outstandingOriginals).toBe(0);
              expect(after.completions).toEqual(before.source.completions);
            }
            const originals = finalInventory.rows.map(({ request, originalResponse, history }) => ({
              request,
              originalResponse,
              history,
            }));
            record(dir, 'original-completions', originals);
            const envelopes = pending.map((request) => {
              const row = finalInventory.rows.find(
                (candidate) => JSON.stringify(candidate.request) === JSON.stringify(request),
              );
              if (!row?.complete)
                throw new Error('Original completion remains unobserved or unjoined');
              return { request, originalResponse: row.originalResponse, history: row.history };
            });
            record(
              dir,
              'stop-finish',
              await control(ready!, { command: 'stop', phase: 'finish', pending: [], envelopes }),
            );
            const result = await exited;
            record(dir, 'controller-helper-exit', result);
            const supervisorWait = JSON.parse(
              await readFile(join(dir, 'controller-supervisor-wait.json'), 'utf8'),
            );
            record(dir, 'original-supervisor-wait-observed', supervisorWait);
            expect(lifecycleFault).toBeNull();
            expect(metadata).toBe('');
            expect(lifecycle).toHaveLength(3);
            expect(supervisorWait).toEqual(lifecycle[1]);
            const allocation = lifecycle[0].details;
            expect(allocation).toEqual({
              supervisorPid: expect.any(Number),
              controllerPid: child.pid,
              writerIsFifo: true,
              writerInheritable: false,
            });
            expect(
              Number.isSafeInteger(allocation.supervisorPid) && allocation.supervisorPid > 0,
            ).toBe(true);
            expect(supervisorWait.details).toEqual({
              supervisorPid: allocation.supervisorPid,
              returnCode: 0,
              code: 0,
              signal: null,
              waitedOriginalChild: true,
              failure: null,
            });
            expect(lifecycle[2].details).toEqual({
              success: true,
              failure: null,
              nativeCompletion: 'not asserted',
            });
            const stopped = JSON.parse(await readFile(join(dir, 'stopped.json'), 'utf8'));
            record(dir, 'final-stop-observed', stopped);
            expect(result).toEqual({ code: 0, signal: null });
            expect(stopped.success).toBe(true);
            expect(stopped.ownership.complete).toBe(true);
            expect(stopped.ownership.failed).toBe(false);
            expect(
              stopped.worker.cleanup.every(
                (row: any) => row.udsClosed && row.tcpClosed && row.reaped,
              ),
            ).toBe(true);
            success = true;
            finalSource = after;
          },
        },
        {
          name: 'partial-before-failure-cleanup',
          run: async () => {
            if (!success)
              await archiveCompanionFiles(
                dir,
                join(evidence!, 'group-10', 'diagnostics'),
                'partial',
              );
          },
        },
        {
          name: 'original-controller-wait',
          run: async () => {
            if (!success) child.stdin!.end();
            const result = await exited;
            record(dir, 'controller-final-wait', { ...result, success });
            record(dir, 'controller-protocol-observed', {
              lifecycle,
              lifecycleFault,
              metadata,
              stderr,
            });
            child.stdin!.end();
            if (!success || result.code !== 0 || result.signal !== null)
              throw new Error('Original owned cleanup failed');
          },
        },
        {
          name: 'original-app-shutdown',
          run: async () => {
            if (app) await main(app, (f) => f.shutdown());
          },
        },
        {
          name: 'original-main-ownership-observation',
          run: async () => {
            if (!app) throw new Error('Original main unavailable for ownership observation');
            record(dir, 'sidebar-main-ownership-final', await main(app, (f) => f.evidence()));
          },
        },
        {
          name: 'original-app-close',
          run: async () => {
            if (app) await app.close();
          },
        },
        {
          name: 'final-original-archive',
          run: async () => {
            await archiveCompanionFiles(dir, join(evidence!, 'group-10', 'diagnostics'), 'final');
          },
        },
        {
          name: 'diagnostic-validation',
          run: async () => {
            const destination = join(evidence!, 'group-10', 'diagnostics');
            let mainCoverage: unknown;
            let coverageFailed = false;
            let coverageError: unknown;
            try {
              const activation = companionMainObject(
                JSON.parse(await readFile(join(destination, 'final-electron.json'), 'utf8')),
                ['outer', 'observed'],
              );
              const outer = companionMainObject(activation.outer, [
                'runId',
                'workerPid',
                'mainPid',
              ]);
              companionMainRequire(
                outer.runId === runId &&
                  outer.workerPid === process.pid &&
                  outer.mainPid === observedMainPid,
                'original activation binding',
              );
              const active = assertCompanionMainActivation(
                activation.observed,
                observedMainPid ?? 0,
                process.pid,
              );
              const ownership = assertCompanionMainOwnership(
                JSON.parse(
                  await readFile(
                    join(destination, 'final-sidebar-main-ownership-final.json'),
                    'utf8',
                  ),
                ),
                JSON.parse(await readFile(join(destination, 'final-ui-quiescence.json'), 'utf8')),
                activation.observed.statusProducers,
              );
              mainCoverage = { activation: active, ownership };
            } catch (error) {
              coverageFailed = true;
              coverageError = error;
              mainCoverage = { complete: false, error: String(error) };
            }
            record(destination, 'main-coverage', mainCoverage);
            const worker = JSON.parse(await readFile(join(dir, 'worker.json'), 'utf8'));
            const supervisor = JSON.parse(await readFile(join(dir, 'supervisor.json'), 'utf8'));
            const owned = (await readFile(join(dir, 'ownership.jsonl'), 'utf8'))
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line));
            if (
              supervisor.runId !== runId ||
              supervisor.pid !== lifecycle[0]?.details.supervisorPid ||
              worker.owner !== 'supervisor' ||
              worker.allocation !== 'pidfd' ||
              owned.filter(
                (row) => row.kind === 'enrolled' && row.role === 'worker' && row.pid === worker.pid,
              ).length !== 1
            )
              throw new Error('Original worker enrollment missing');
            const parsed = readCompanionDiagnostics(
              await readFile(join(destination, 'final-companion-preparation-v1.jsonl')),
              await readFile(join(destination, 'final-companion-preparation-v1-final.json')),
              worker.pid,
            );
            record(destination, 'reader', parsed);
            let correlation: unknown = null;
            try {
              const observed =
                finalSource ??
                JSON.parse(await readFile(join(dir, 'failure-packet.json'), 'utf8')).source;
              const parentPacket = JSON.parse(
                await readFile(join(dir, 'sidebar-held-parent.json'), 'utf8'),
              );
              correlation = correlateCompanionDiagnostics(
                parsed.frames,
                observed,
                parentPacket.value,
              );
              record(destination, 'correlation', correlation);
            } catch (error) {
              record(destination, 'correlation-failure', String(error));
              throw error;
            }
            record(destination, 'disposition', {
              bodyFailed,
              mainCoverage,
              ownedCleanup: success,
              readerValid: parsed.valid,
              readerComplete: parsed.complete,
              correlated: !!correlation,
              nativeCompletion: 'original stop inventory only',
              historicalCause: false,
            });
            if (coverageFailed) throw coverageError;
            if (!parsed.complete || !success)
              throw new Error('Diagnostic trace or original lifecycle incomplete');
          },
        },
      ],
      (rows) =>
        record(evidence!, 'group-10-diagnostic-outcomes', {
          rows,
          bodyFailed,
          primaryError: bodyFailed ? String(bodyError) : null,
          observationErrors,
        }),
    );
    return;
  } else {
    try {
      ready = await waitFile(join(dir, 'ready.json'), child);
      expect(ready!.identity).toEqual(identity);
      expect(ready!.runId).toBe(runId);
      expect(ready!.hosts[0].workspaceId).toBe(ready!.hosts[1].workspaceId);
      expect(ready!.hosts[0].registeredRootId).toBe(ready!.hosts[1].registeredRootId);
      app = await electron.launch({
        args: [
          join(bundle, 'main.mjs'),
          join(dir, 'profile'),
          join(bundle, 'preload.cjs'),
          join(dir, 'ready.json'),
          join(bundle, uiMode ? 'ui-assets/asset-manifest.json' : 'renderer.js'),
        ],
        env: {
          ...environment(home),
          ...(uiMode
            ? {
                NATIVE_REVIEW_UI: '1',
                NATIVE_REVIEW_UI_ROLE: index === 6 || index === 10 ? 'member' : 'owner',
                ...(sidebarMode ? { NATIVE_REVIEW_SIDEBAR_UI: '1' } : {}),
              }
            : {}),
          DISPLAY: process.env.DISPLAY!,
          XDG_RUNTIME_DIR: join(dir, 'runtime'),
        },
        timeout: 20000,
      });
      const logs = createWriteStream(join(dir, 'electron.log'), { mode: 0o600 });
      app.process().stdout?.pipe(logs, { end: false });
      app.process().stderr?.pipe(logs, { end: false });
      await expect
        .poll(() => app!.evaluate(() => !!(globalThis as any).nativeReviewFixture?.ready))
        .toBe(true);
      await body({
        dir,
        ready: ready!,
        app,
        a: await pageFor(app, 'host-A'),
        b: await pageFor(app, 'local-B'),
        packet,
      });
      if (uiMode) record(dir, 'ui-quiescence', await main(app, (f) => f.quiesceUi()));
      await main(app, (f) => f.join());
      const before = await packet('before-stop');
      if (!before.source) throw new Error('Original main observations missing');
      const inventory = stopInventory(before.source);
      record(dir, 'stop-inventory-before', inventory);
      const { pending } = inventory;
      record(
        dir,
        'stop-begin',
        await control(ready!, { command: 'stop', phase: 'begin', pending, envelopes: [] }),
      );
      await main(app, (f) => f.join());
      const after = await main(app, (f) => f.evidence());
      record(dir, 'after-stop', after);
      const finalInventory = stopInventory(after);
      record(dir, 'stop-inventory-after', finalInventory);
      expect(after.records.slice(0, before.source.records.length)).toEqual(before.source.records);
      expect(finalInventory.rows.map((row) => row.request)).toEqual(
        inventory.rows.map((row) => row.request),
      );
      expect(after.pending).toBe(0);
      if (uiMode) {
        expect(after.completionFaults).toEqual([]);
        expect(after.outstandingOriginals).toBe(0);
        expect(after.completions).toEqual(before.source.completions);
      }
      const originals = finalInventory.rows.map(({ request, originalResponse, history }) => ({
        request,
        originalResponse,
        history,
      }));
      record(dir, 'original-completions', originals);
      const envelopes = pending.map((request) => {
        const row = finalInventory.rows.find(
          (candidate) => JSON.stringify(candidate.request) === JSON.stringify(request),
        );
        if (!row?.complete) throw new Error('Original completion remains unobserved or unjoined');
        return { request, originalResponse: row.originalResponse, history: row.history };
      });
      record(
        dir,
        'stop-finish',
        await control(ready!, { command: 'stop', phase: 'finish', pending: [], envelopes }),
      );
      const result = await exited;
      record(dir, 'controller-helper-exit', result);
      const supervisorWait = JSON.parse(
        await readFile(join(dir, 'controller-supervisor-wait.json'), 'utf8'),
      );
      record(dir, 'original-supervisor-wait-observed', supervisorWait);
      expect(lifecycleFault).toBeNull();
      expect(metadata).toBe('');
      expect(lifecycle).toHaveLength(3);
      expect(supervisorWait).toEqual(lifecycle[1]);
      const allocation = lifecycle[0].details;
      expect(allocation).toEqual({
        supervisorPid: expect.any(Number),
        controllerPid: child.pid,
        writerIsFifo: true,
        writerInheritable: false,
      });
      expect(Number.isSafeInteger(allocation.supervisorPid) && allocation.supervisorPid > 0).toBe(
        true,
      );
      expect(supervisorWait.details).toEqual({
        supervisorPid: allocation.supervisorPid,
        returnCode: 0,
        code: 0,
        signal: null,
        waitedOriginalChild: true,
        failure: null,
      });
      expect(lifecycle[2].details).toEqual({
        success: true,
        failure: null,
        nativeCompletion: 'not asserted',
      });
      const stopped = JSON.parse(await readFile(join(dir, 'stopped.json'), 'utf8'));
      record(dir, 'final-stop-observed', stopped);
      expect(result).toEqual({ code: 0, signal: null });
      expect(stopped.success).toBe(true);
      expect(stopped.ownership.complete).toBe(true);
      expect(stopped.ownership.failed).toBe(false);
      expect(
        stopped.worker.cleanup.every((row: any) => row.udsClosed && row.tcpClosed && row.reaped),
      ).toBe(true);
      success = true;
    } catch (error) {
      record(dir, 'failure', {
        error: String(error),
        stack: error instanceof Error ? error.stack : null,
      });
      try {
        await packet('failure-packet');
      } catch (packetError) {
        record(dir, 'failure-packet-error', String(packetError));
      }
      throw error;
    } finally {
      // EOF is failure cleanup, never success or a native receipt. Await this original allocation.
      if (!success) child.stdin!.end();
      const result = await exited;
      record(dir, 'controller-final-wait', { ...result, success });
      record(dir, 'controller-protocol-observed', { lifecycle, lifecycleFault, metadata, stderr });
      child.stdin!.end();
      if (app) {
        try {
          await main(app, (f) => f.shutdown());
        } finally {
          await app.close();
        }
      }
      const destination = join(evidence!, `group-${index + 1}`);
      await mkdir(destination, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(dir, { withFileTypes: true }))
        if (entry.isFile() && /\.(json|jsonl|log)$/.test(entry.name))
          await copyFile(join(dir, entry.name), join(destination, entry.name));
    }
  }
}

test(groups[0][0], async () =>
  withDriver(0, async ({ ready, a, b, packet }) => {
    const baseline = await packet('baseline');
    await a.evaluate((id) => (window as any).native.read(id), ready.hosts[0].workspaceId);
    const prepared = await begin(a, 'a-create', inputFor(ready, 0));
    const created = await confirm(a, 'a-create', {
      prTitle: 'Owned primary create',
      prBody: 'fixture',
    });
    const first = await packet('primary-create', { prepared, created });
    expect(settled(created, 'created').gitReceipts).toEqual([]);
    expect(first.hosts[0].effects.pushes).toBe(baseline.hosts[0].effects.pushes);
    for (const key of ['primaryHead', 'registeredHead', 'index', 'worktree'])
      expect(first.hosts[0][key]).toEqual(baseline.hosts[0][key]);
    expect(first.hosts[1]).toEqual(baseline.hosts[1]);
    const combined = await begin(b, 'b-combined', inputFor(ready, 1, true, true));
    const completed = await confirm(b, 'b-combined', {
      commitMessage: 'Owned staged commit',
      prTitle: 'Owned combined review',
    });
    const second = await packet('registered-combined', { combined, completed });
    const receipts = settled(completed, 'created').gitReceipts;
    expect(receipts.map((row) => row.stage)).toEqual(['commit', 'push']);
    expect(second.hosts[1].registeredHead).not.toBe(baseline.hosts[1].registeredHead);
    expect(second.hosts[1].remoteHead).toBe(second.hosts[1].registeredHead);
    expect(second.hosts[0]).toEqual(first.hosts[0]);
    const registeredDir = join(dirname(ready.hosts[1].uds), 'secondary');
    expect(await readFile(join(registeredDir, 'unstaged.txt'), 'utf8')).toContain('unstaged');
    await begin(a, 'a-reused', inputFor(ready, 0));
    const reused = await confirm(a, 'a-reused');
    const final = await packet('create-reused', reused);
    expect(settled(reused, 'reused').gitReceipts).toEqual([]);
    expect(final.hosts[0].effects).toEqual(first.hosts[0].effects);
  }),
);

test(groups[1][0], async () =>
  withDriver(1, async ({ ready, app, a, packet }) => {
    await main(app, (f) => f.role('member'));
    const prepared = await begin(a, 'member', inputFor(ready, 0));
    await packet('member-prepared', prepared);
    expect(prepared.reviewPreparation.source.connection ?? null).toBeNull();
    expect(prepared.reviewPreparation.target.connection ?? null).toBeNull();
    const barrier = await arm(ready, prepared.reviewPreparation.operationId, 'GET');
    await a.evaluate(() => (window as any).native.start('member', { prTitle: 'Existing review' }));
    const admitted = await entered(ready, barrier.id);
    await packet('member-admitted', admitted);
    const duplicate = confirm(a, 'member', { prTitle: 'Existing review' });
    await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
    const value = await duplicate;
    await packet('member-result', value);
    settled(value, 'reused');
    expect((await confirm(a, 'member', { prTitle: 'Existing review' })).execute).toEqual(
      value.execute,
    );
    await expect(confirm(a, 'member', { prTitle: 'changed' })).rejects.toThrow();
    const handle = await main(app, (f) => f.handle('host-A'));
    expect(handle).toBeDefined();
    await main(app, (f) => f.duplicateWindow());
    const other = await pageFor(app, 'other-A');
    const forged = await other.evaluate(
      (handle) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: handle!.input.review.root,
          command: {},
        }),
      handle,
    );
    const wrongRoot = await a.evaluate(
      ({ handle, gitRootId }) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: { ...handle!.input.review.root, kind: 'registered', gitRootId },
          command: {},
        }),
      { handle, gitRootId: ready.hosts[0].registeredRootId },
    );
    const frame = a.frames().find((value) => value !== a.mainFrame())!;
    const subframe = await frame.evaluate(
      (handle) =>
        (window as any).electronAPI.invoke('backend:native-review:execute', {
          id: handle!.id,
          root: handle!.input.review.root,
          command: {},
        }),
      handle,
    );
    await packet('wrong-owners', { forged, wrongRoot, subframe });
    expect(forged.ok).toBe(false);
    expect(wrongRoot.ok).toBe(false);
    expect(subframe.ok).toBe(false);
    await main(app, (f) => f.role('guest'));
    const read = await a.evaluate(
      (id) => (window as any).native.read(id),
      ready.hosts[0].workspaceId,
    );
    await packet('guest-local-read', read);
    expect(JSON.stringify(read)).not.toContain('accountId');
    await expect(begin(a, 'guest-denied', inputFor(ready, 0))).rejects.toThrow();
    const final = await packet('guest-native-denied');
    expect(
      final.source.records.filter(
        (row: WireRecord) =>
          row.direction === 'request' && row.envelope.method === 'accept-changes.execute',
      ),
    ).toHaveLength(1);
  }),
);

test(groups[2][0], async () =>
  withDriver(2, async ({ ready, app, a, packet }) => {
    await main(app, (f) => f.role('member'));
    await begin(a, 'known', inputFor(ready, 0));
    const known = await confirm(a, 'known');
    await packet('known-before-revoke', known);
    settled(known, 'reused');
    await control(ready, { command: 'revokeMember', host: 0 });
    const retained = await reconcile(a, 'known');
    await packet('history-after-revoke', retained);
    expect(retained.execute).toEqual(known.execute);
    expect(retained.current).toBe(false);
    await main(app, (f) => f.role('owner'));
    await begin(a, 'primary-before-delete', inputFor(ready, 0));
    await begin(a, 'registered-before-delete', inputFor(ready, 0, true));
    const scheduled = await main(app, (f) => f.pendingDelete(false));
    let cancelled: unknown;
    try {
      await expect
        .poll(() =>
          a.evaluate(
            () =>
              (window as any).native.retirements.filter((row: any) =>
                row.key.endsWith('before-delete'),
              ).length,
          ),
        )
        .toBe(2);
    } finally {
      cancelled = await main(app, (f) => f.pendingDelete(true));
    }
    await packet('pending-delete-cancel', { scheduled, cancelled });
    expect(cancelled).toEqual({ cancelled: true });
    await expect(confirm(a, 'primary-before-delete')).rejects.toThrow();
    await expect(confirm(a, 'registered-before-delete')).rejects.toThrow();
    await packet('old-roots-remain-retired');
  }),
);

test(groups[3][0], async () =>
  withDriver(3, async ({ ready, app, a, packet }) => {
    const prepared = await begin(a, 'held', inputFor(ready, 0));
    const barrier = await arm(ready, prepared.reviewPreparation.operationId, 'GET');
    await a.evaluate(() => (window as any).native.start('held'));
    await packet('held-entered', await entered(ready, barrier.id));
    await main(app, (f) => f.navigate());
    await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
    await main(app, (f) => f.join());
    const next = app.windows().find((page) => page.url().endsWith('/host-A-next'))!;
    await next.waitForFunction(() => !!(window as any).native);
    const history = await packet('late-original-after-navigation');
    expect(await next.evaluate(() => (window as any).native.results)).toEqual({});
    expect(
      history.source.records.some(
        (row: WireRecord) =>
          row.direction === 'response' &&
          row.envelope.result?.reviewExecution?.outcome.status === 'reused',
      ),
    ).toBe(true);
    await begin(next, 'completed-before-reconnect', inputFor(ready, 0));
    const known = await confirm(next, 'completed-before-reconnect');
    await packet('known-before-reconnect', known);
    settled(known, 'reused');
    await main(app, (f) => f.reconnect());
    await expect(reconcile(next, 'completed-before-reconnect')).rejects.toThrow();
    const retained = await next.evaluate(
      () => (window as any).native.results['completed-before-reconnect'],
    );
    await packet('known-after-reconnect', retained);
    expect(retained.execute).toEqual(known.execute);
    await begin(next, 'unexecuted', inputFor(ready, 0));
    await main(app, (f) => f.destroy());
    await packet('destroyed-unexecuted');
  }),
);

test(groups[4][0], async () =>
  withDriver(4, async ({ ready, a, packet }) => {
    const prepared = await begin(a, 'lost-post', inputFor(ready, 0));
    const barrier = await arm(
      ready,
      prepared.reviewPreparation.operationId,
      'POST',
      'loseAfterPost',
    );
    const value = await confirm(a, 'lost-post', { prTitle: 'Uncertain original write' });
    const first = await packet('lost-post-original', { barrier, value });
    expect(settled(value, 'uncertain').gitReceipts).toEqual([]);
    expect(first.hosts[0].effects.posts).toBe(1);
    expect(first.hosts[0].effects.pushes).toBe(0);
    const history = await reconcile(a, 'lost-post');
    expect(history.reconciliation?.reviewExecution?.outcome.status).toBe('uncertain');
    await confirm(a, 'lost-post', { prTitle: 'Uncertain original write' });
    const final = await packet('lost-post-retained', history);
    expect(final.hosts[0].effects).toEqual(first.hosts[0].effects);
  }),
);

const uiSnapshot = (page: Page) => page.evaluate(() => (window as any).nativeUi.snapshot());
async function uiReady(page: Page, role: string) {
  if (!uiMode) throw new Error('UI cases require the actual component renderer');
  await expect.poll(async () => (await uiSnapshot(page)).role).toBe(role);
  await expect.poll(async () => (await uiSnapshot(page)).hasReceivedList).toBe(true);
  await expect.poll(async () => (await uiSnapshot(page)).subscriptionGeneration).toBeTruthy();
  await expect.poll(async () => (await uiSnapshot(page)).admission).toBeTruthy();
  const value = await uiSnapshot(page);
  expect(value.hasReceivedList).toBe(true);
  expect(value.subscriptionGeneration).toBeTruthy();
  expect(value.admission).toBeTruthy();
  expect(value.faults).toEqual([]);
  if (role !== 'guest') {
    await expect
      .poll(async () => (await uiSnapshot(page)).workspaceAdmission)
      .toBe(value.admission);
    await expect(page.getByRole('button', { name: 'Start a review', exact: true })).toBeVisible();
  }
}
async function uiPrepare(page: Page, title: string) {
  await page.getByRole('button', { name: 'Start a review', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare merge request', exact: true }).click();
  await expect
    .poll(async () => (await uiSnapshot(page)).attempts.at(-1)?.publicView?.status)
    .toBe('ready');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Text retained by the actual standalone form');
  return (await uiSnapshot(page)).attempts.at(-1).publicView.preview as NativeReviewPreparedView;
}
async function uiConfirmation(page: Page, prepared: NativeReviewPreparedView, title: string) {
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create this merge request?' });
  await expect(dialog).toBeVisible();
  for (const value of [
    title,
    prepared.reviewPreparation.target.repository.projectPath,
    prepared.reviewPreparation.target.repository.instanceBaseUrl,
    prepared.reviewPreparation.source.branch,
    prepared.reviewPreparation.target.branch,
  ])
    await expect(dialog).toContainText(value);
  return dialog;
}
async function uiOutcome(page: Page, status: 'created' | 'reused' | 'uncertain') {
  await expect
    .poll(
      async () =>
        (await uiSnapshot(page)).attempts.at(-1)?.publicView?.observation?.execute?.reviewExecution
          ?.outcome.status,
    )
    .toBe(status);
  const observation = (await uiSnapshot(page)).attempts.at(-1).publicView
    .observation as NativeReviewObservation;
  const execution = settled(observation, status);
  await expect(page.locator('[data-native-outcome]').first()).toHaveAttribute(
    'data-native-outcome',
    status,
  );
  await expect(page.locator('[data-native-publication]').first()).toHaveAttribute(
    'data-native-publication',
    execution.publication.state,
  );
  expect(execution.gitReceipts).toEqual([]);
  if (execution.outcome.status === 'created' || execution.outcome.status === 'reused') {
    const review = execution.outcome.review;
    await expect(page.getByRole('link', { name: review.title, exact: true })).toHaveAttribute(
      'href',
      review.url,
    );
    for (const value of [
      review.resource.repository.projectPath,
      review.resource.repository.instanceBaseUrl,
      review.headSha ?? 'Unknown',
    ])
      await expect(
        page.getByRole('region', { name: 'Original execution', exact: true }),
      ).toContainText(value);
  }
  return observation;
}
function nativeRequests(packet: any, method: string) {
  return packet.source.records.filter(
    (row: WireRecord) =>
      row.direction === 'request' && row.envelope.method === 'accept-changes.' + method,
  );
}
function noGitChanges(before: any, after: any) {
  for (const host of [0, 1]) {
    for (const key of ['primaryHead', 'registeredHead', 'index', 'worktree'])
      expect(after.hosts[host][key]).toEqual(before.hosts[host][key]);
    expect(after.hosts[host].effects.pushes).toBe(before.hosts[host].effects.pushes);
  }
}

test(uiGroups[0][0], async () =>
  withDriver(5, async ({ a, b, ready, packet }) => {
    await uiReady(a, 'owner');
    await uiReady(b, 'owner');
    const baseline = await packet('ui-owner-before-action', await uiSnapshot(a));
    expect(nativeRequests(baseline, 'prepare')).toEqual([]);
    expect(nativeRequests(baseline, 'execute')).toEqual([]);
    const title = 'Explicit standalone Owner request';
    const prepared = await uiPrepare(a, title);
    expect(prepared.reviewPreparation.root).toEqual({
      kind: 'primary',
      workspaceId: ready.hosts[0].workspaceId,
    });
    const dialog = await uiConfirmation(a, prepared, title);
    await a.screenshot({ path: join(evidence!, 'ui-owner-confirmation.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(a.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    const cancelled = await packet('ui-owner-cancelled', await uiSnapshot(a));
    expect(nativeRequests(cancelled, 'execute')).toEqual([]);
    for (const host of [0, 1])
      expect(cancelled.hosts[host].effects).toEqual(baseline.hosts[host].effects);
    noGitChanges(baseline, cancelled);
    await (
      await uiConfirmation(a, prepared, title)
    )
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    const observation = await uiOutcome(a, 'created');
    const after = await packet('ui-owner-created', {
      prepared,
      observation,
      renderer: await uiSnapshot(a),
    });
    expect(nativeRequests(after, 'execute')).toHaveLength(1);
    expect(after.hosts[0].effects.posts).toBe(1);
    expect(after.hosts[1].effects).toEqual(baseline.hosts[1].effects);
    noGitChanges(baseline, after);
    await expect(a.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await a.screenshot({ path: join(evidence!, 'ui-owner-created.png') });
  }),
);

test(uiGroups[1][0], async () =>
  withDriver(6, async ({ app, a, b, ready, packet }) => {
    await uiReady(a, 'member');
    await uiReady(b, 'owner');
    const baseline = await packet('ui-member-before-action', await uiSnapshot(a));
    const prepared = await uiPrepare(a, 'Member submitted suggestion');
    expect(prepared.reviewPreparation.source.connection ?? null).toBeNull();
    expect(prepared.reviewPreparation.target.connection ?? null).toBeNull();
    await (
      await uiConfirmation(a, prepared, 'Member submitted suggestion')
    )
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    const observation = await uiOutcome(a, 'reused');
    await packet('ui-member-reused', { prepared, observation, renderer: await uiSnapshot(a) });
    await a.screenshot({ path: join(evidence!, 'ui-member-reused.png') });
    // A new explicit lifetime, not a retry of the completed operation.
    const held = await uiPrepare(a, 'Separate Member lifetime');
    expect(held.reviewPreparation.operationId).not.toBe(prepared.reviewPreparation.operationId);
    const barrier = await arm(ready, held.reviewPreparation.operationId, 'GET');
    await (
      await uiConfirmation(a, held, 'Separate Member lifetime')
    )
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    await packet('ui-member-admitted', await entered(ready, barrier.id));
    const closed = await a.evaluate(() => (window as any).nativeUi.dismiss());
    expect(closed.attempts.every((row: any) => row.publicView === null)).toBe(true);
    await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
    await main(app, (f) => f.join());
    const finished = await packet('ui-member-original-after-unmount', await uiSnapshot(a));
    expect(stopInventory(finished.source).rows.every((row) => row.complete)).toBe(true);
    expect((await uiSnapshot(a)).attempts.every((row: any) => row.publicView === null)).toBe(true);
    noGitChanges(baseline, finished);
    record(evidence!, 'ui-member-retired-producers', await main(app, (f) => f.quiesceUi(false)));
    await main(app, (f) => f.role('guest'));
    await main(app, (f) => f.navigate());
    await a.waitForFunction(() => !!(window as any).nativeUi);
    await uiReady(a, 'guest');
    const beforeGuest = await packet('ui-guest-before-action', await uiSnapshot(a));
    const start = a.getByRole('button', { name: 'Start a review', exact: true });
    await expect(start).toBeVisible();
    if (await start.count()) {
      await start.click();
    }
    const refusal = a.getByRole('status');
    await expect(refusal).toHaveText(
      'This review cannot be prepared with the current repository and access.',
    );
    await expect(refusal).toBeVisible();
    await expect(a.getByRole('button', { name: 'Prepare merge request', exact: true })).toHaveCount(
      0,
    );
    await expect(a.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0);
    const denied = await packet('ui-guest-denied', await uiSnapshot(a));
    expect(nativeRequests(denied, 'prepare')).toEqual(nativeRequests(beforeGuest, 'prepare'));
    expect(nativeRequests(denied, 'execute')).toEqual(nativeRequests(beforeGuest, 'execute'));
    for (const host of [0, 1])
      expect(denied.hosts[host].effects).toEqual(beforeGuest.hosts[host].effects);
    noGitChanges(beforeGuest, denied);
    await a.screenshot({ path: join(evidence!, 'ui-guest-denied.png') });
  }),
);

test(uiGroups[2][0], async () =>
  withDriver(7, async ({ a, ready, packet }) => {
    await uiReady(a, 'owner');
    const baseline = await packet('ui-uncertain-before-action');
    const title = 'Uncertain standalone request';
    const prepared = await uiPrepare(a, title);
    const barrier = await arm(
      ready,
      prepared.reviewPreparation.operationId,
      'POST',
      'loseAfterPost',
    );
    await (
      await uiConfirmation(a, prepared, title)
    )
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    const observation = await uiOutcome(a, 'uncertain');
    const first = await packet('ui-uncertain-original', { prepared, barrier, observation });
    expect(first.hosts[0].effects.posts).toBe(1);
    expect(nativeRequests(first, 'execute')).toHaveLength(1);
    await expect(a.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
    await a.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(
      a.getByRole('region', { name: 'Original result check', exact: true }),
    ).toBeVisible();
    const checked = (await uiSnapshot(a)).attempts.at(-1).publicView
      .observation as NativeReviewObservation;
    expect(checked.execute).toEqual(observation.execute);
    expect(checked.reconciliation?.reviewExecution?.outcome.status).toBe('uncertain');
    const after = await packet('ui-uncertain-original-check', checked);
    expect(nativeRequests(after, 'execute')).toEqual(nativeRequests(first, 'execute'));
    expect(after.hosts[0].effects).toEqual(first.hosts[0].effects);
    noGitChanges(baseline, after);
    await a.screenshot({ path: join(evidence!, 'ui-uncertain-check.png') });
  }),
);

async function sidebarReady(page: Page, role: 'owner' | 'member' | 'guest') {
  if (!sidebarMode) throw new Error('Sidebar case requires its actual renderer');
  await expect.poll(async () => (await uiSnapshot(page)).role).toBe(role);
  await expect.poll(async () => (await uiSnapshot(page)).admission).toBeTruthy();
  await expect
    .poll(async () => {
      const state = await uiSnapshot(page);
      return state.workspaceAdmission === state.admission && state.workspaces.length === 1;
    })
    .toBe(true);
  await expect.poll(async () => (await uiSnapshot(page)).subscriptionGeneration).toBeTruthy();
  if (role !== 'guest') {
    await expect
      .poll(async () =>
        (await uiSnapshot(page)).sidebar[0].changes.some(
          (row: any) => row.stage === 'staged' && row.file.endsWith('staged.txt'),
        ),
      )
      .toBe(true);
    await expect(page.getByTestId('pr-create-button')).toBeVisible();
  }
  expect((await uiSnapshot(page)).faults).toEqual([]);
}
const sidebarRegion = (page: Page) =>
  page.getByRole('region', { name: 'Create a merge request', exact: true });
const sidebarUnstaged = (page: Page) => page.evaluate(() => (window as any).nativeUi.unstaged());
async function sidebarDrafts(page: Page, title: string) {
  await page.getByTestId('pr-create-button').click();
  const branch = page.getByRole('textbox', { name: 'Target branch', exact: true });
  await expect(branch).toHaveValue('trunk');
  await page
    .getByRole('textbox', { name: 'Commit Message', exact: true })
    .fill('Original staged sidebar commit');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Original separately confirmed sidebar review');
}
async function sidebarCommitDialog(page: Page) {
  await sidebarRegion(page).getByRole('button', { name: 'Commit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Commit', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Original staged sidebar commit');
  const state = await uiSnapshot(page);
  const parent = state.attempts.at(-1);
  expect(parent.publicView.status).toBe('ready');
  expect(parent.publicView.preview.filesCount).toBe(1);
  expect(parent.publicView.preview.files).toEqual([
    expect.objectContaining({ path: 'staged.txt', staged: true }),
  ]);
  for (const value of [
    parent.publicView.preview.reviewPreparation.target.repository.projectPath,
    parent.publicView.preview.reviewPreparation.target.repository.instanceBaseUrl,
    'trunk',
  ])
    await expect(dialog).toContainText(value);
  const queued = state.queueObservations.find(
    (row: any) =>
      row.input?.type === 'changes/setPendingAutoAction' &&
      row.input.payload[1]?.action === 'native-review',
  );
  expect(queued.input.payload[1].intent.owner).toEqual(parent.owner);
  expect(queued.input.payload[1].intent.targetBranch).toBe('trunk');
  return { dialog, parent };
}
async function sidebarParent(page: Page, dialog: Awaited<ReturnType<typeof sidebarCommitDialog>>) {
  await dialog.dialog.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await uiSnapshot(page)).attempts.find(
          (row: any) => row.attemptId === dialog.parent.attemptId,
        )?.retained?.execute?.state,
    )
    .toBe('settled');
  const row = (await uiSnapshot(page)).attempts.find(
    (row: any) => row.attemptId === dialog.parent.attemptId,
  );
  expect(row.retained.execute.success).toBe(true);
  expect(row.retained.execute.reviewExecution.outcome.status).toBe('not-attempted');
  expect(row.retained.execute.reviewExecution.gitReceipts).toEqual([
    expect.objectContaining({ stage: 'commit', commitHash: expect.any(String) }),
  ]);
  await expect(
    page.getByText(
      'Completed commit: ' + row.retained.execute.reviewExecution.gitReceipts[0].commitHash,
      { exact: true },
    ),
  ).toBeVisible();
  return row;
}
async function sidebarChild(page: Page, parent: any, title: string) {
  await page.getByRole('button', { name: 'Prepare merge request', exact: true }).click();
  await expect
    .poll(async () => (await uiSnapshot(page)).attempts.at(-1)?.publicView?.status)
    .toBe('ready');
  const state = await uiSnapshot(page),
    child = state.attempts.at(-1);
  expect(child.owner.attemptId).not.toBe(parent.owner.attemptId);
  expect(child.owner.root).toEqual(parent.owner.root);
  expect(child.owner.admission).toBe(parent.owner.admission);
  expect(child.owner.hostContext).toBe(parent.owner.hostContext);
  const continuation = state.queueObservations.find(
    (row: any) => row.input?.type === 'repositoryContext/nativeReviewCompanionRequested',
  );
  expect(continuation.input.payload).toEqual([parent.owner, child.owner]);
  const dialog = await uiConfirmation(page, child.publicView.preview, title);
  return { child, dialog };
}
function stagedCommitOnly(before: any, after: any, parent: any) {
  const receipt = parent.retained.execute.reviewExecution.gitReceipts[0];
  expect(after.hosts[0].primaryHead).toBe(receipt.commitHash);
  expect(after.hosts[0].primaryHead).not.toBe(before.hosts[0].primaryHead);
  expect(
    after.hosts[0].status.split('\n').some((line: string) => line.slice(3) === 'staged.txt'),
  ).toBe(false);
  expect(after.hosts[0].status).toContain('?? unstaged.txt');
  for (const key of ['registeredHead', 'remoteHead'])
    expect(after.hosts[0][key]).toEqual(before.hosts[0][key]);
  expect(after.hosts[0].effects.pushes).toBe(0);
  expect(after.hosts[1]).toEqual(before.hosts[1]);
}
function sidebarOriginals(packet: any, parent: any, child?: any) {
  const prepares = nativeRequests(packet, 'prepare').map((row: WireRecord) => row.envelope.params);
  expect(prepares).toHaveLength(child ? 2 : 1);
  expect(prepares[0]).toMatchObject({
    workspaceId: parent.owner.root.workspaceId,
    action: 'commit',
    review: {
      root: parent.owner.root,
      choice: { kind: 'saved' },
      targetBranch: 'trunk',
      companion: { kind: 'create-pr' },
    },
  });
  for (const key of ['files', 'options']) expect(Object.hasOwn(prepares[0], key)).toBe(false);
  expect(Object.hasOwn(prepares[0].review, 'pushRemote')).toBe(false);
  if (child) {
    expect(prepares[1].action).toBe('create-pr');
    expect(prepares[1].review.root).toEqual(parent.owner.root);
    expect(prepares[1].review.choice).toEqual({
      kind: 'afterCommit',
      operationId: parent.retained.execute.reviewExecution.preparation.operationId,
      captureId: expect.any(String),
    });
  }
}
async function sidebarChildOutcome(page: Page, child: any, status: 'created' | 'reused') {
  await expect
    .poll(
      async () =>
        (await uiSnapshot(page)).attempts.find((row: any) => row.attemptId === child.attemptId)
          ?.retained?.execute?.reviewExecution?.outcome.status,
    )
    .toBe(status);
  const row = (await uiSnapshot(page)).attempts.find(
    (row: any) => row.attemptId === child.attemptId,
  );
  const execution = settled(row.retained, status);
  expect(execution.gitReceipts).toEqual([]);
  if (execution.outcome.status !== 'created' && execution.outcome.status !== 'reused')
    throw new Error('Original review outcome missing');
  const review = execution.outcome.review;
  await expect(page.getByRole('link', { name: review.title, exact: true })).toHaveAttribute(
    'href',
    review.url,
  );
  expect(execution.publication.state).toBe('local-ahead');
  expect(execution.publication.localHeadSha).toBe(child.preview.reviewPreparation.localHeadSha);
  return row;
}

if (sidebarMode) {
  test(sidebarGroups[0][0], async () =>
    withDriver(8, async ({ a, b, ready, packet }) => {
      await sidebarReady(a, 'owner');
      await sidebarReady(b, 'owner');
      const unstaged = await sidebarUnstaged(a);
      expect(unstaged?.localContent).toBe('owned unstaged change\n');
      expect(unstaged.truncated).toBe(false);
      const baseline = await packet('sidebar-owner-before', {
        renderer: await uiSnapshot(a),
        unstaged,
      });
      const title = 'Explicit sidebar created review';
      await sidebarDrafts(a, title);
      const first = await sidebarCommitDialog(a);
      const prepared = await packet('sidebar-owner-first-confirmation', await uiSnapshot(a));
      sidebarOriginals(prepared, first.parent);
      expect(nativeRequests(prepared, 'execute')).toEqual([]);
      noGitChanges(baseline, prepared);
      await first.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      const cancelled = await packet('sidebar-owner-cancelled', await uiSnapshot(a));
      expect(nativeRequests(cancelled, 'execute')).toEqual([]);
      for (const host of [0, 1])
        expect(cancelled.hosts[host].effects).toEqual(baseline.hosts[host].effects);
      noGitChanges(baseline, cancelled);
      const again = await sidebarCommitDialog(a);
      expect(again.parent.owner).toEqual(first.parent.owner);
      const parent = await sidebarParent(a, again);
      const committed = await packet('sidebar-owner-committed', {
        parent,
        renderer: await uiSnapshot(a),
      });
      stagedCommitOnly(baseline, committed, parent);
      await a.locator('[data-changes-refresh]').click();
      await expect
        .poll(async () =>
          (await uiSnapshot(a)).sidebar[0].changes.some((row: any) => row.stage === 'staged'),
        )
        .toBe(false);
      const { child, dialog } = await sidebarChild(a, parent, title);
      const second = await packet('sidebar-owner-second-confirmation', {
        parent,
        child,
        renderer: await uiSnapshot(a),
      });
      sidebarOriginals(second, parent, child);
      expect(nativeRequests(second, 'execute')).toHaveLength(1);
      noGitChanges(committed, second);
      await a.screenshot({ path: join(evidence!, 'sidebar-owner-second-confirmation.png') });
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      const result = await sidebarChildOutcome(a, child, 'created');
      const after = await packet('sidebar-owner-created', {
        parent,
        result,
        renderer: await uiSnapshot(a),
        unstaged: await sidebarUnstaged(a),
      });
      expect(after.value.unstaged.localContent).toBe(unstaged.localContent);
      expect(after.value.unstaged.truncated).toBe(false);
      expect(nativeRequests(after, 'execute')).toHaveLength(2);
      expect(after.hosts[0].effects.posts).toBe(1);
      noGitChanges(committed, after);
      expect(after.hosts[0].remoteHead).toBe(baseline.hosts[0].remoteHead);
      expect(
        (await uiSnapshot(a)).attempts.find((row: any) => row.attemptId === parent.attemptId)
          .retained.execute,
      ).toEqual(parent.retained.execute);
      expect(parent.owner.root).toEqual({
        kind: 'primary',
        workspaceId: ready.hosts[0].workspaceId,
      });
      await a.screenshot({ path: join(evidence!, 'sidebar-owner-created.png') });
    }),
  );

  test(sidebarGroups[1][0], async () =>
    withDriver(9, async ({ app, a, b, ready, packet }) => {
      await sidebarReady(a, 'owner');
      await sidebarReady(b, 'owner');
      const unstaged = await sidebarUnstaged(a);
      expect(unstaged?.localContent).toBe('owned unstaged change\n');
      const baseline = await packet('sidebar-held-before');
      const title = 'Original held sidebar child';
      await sidebarDrafts(a, title);
      const parent = await sidebarParent(a, await sidebarCommitDialog(a));
      const committed = await packet('sidebar-held-parent', parent);
      stagedCommitOnly(baseline, committed, parent);
      const { child, dialog } = await sidebarChild(a, parent, title);
      const barrier = await arm(ready, child.preview.reviewPreparation.operationId, 'GET');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await packet('sidebar-child-admitted', await entered(ready, barrier.id));
      await a.screenshot({ path: join(evidence!, 'sidebar-child-held.png') });
      const closed = await a.evaluate(() => (window as any).nativeUi.dismiss());
      expect(closed.attempts.every((row: any) => row.publicView === null)).toBe(true);
      await control(ready, { command: 'releaseBarrier', host: 0, barrierId: barrier.id });
      await main(app, (f) => f.join());
      await expect
        .poll(
          async () =>
            (await uiSnapshot(a)).attempts.find((row: any) => row.attemptId === child.attemptId)
              ?.retained?.execute?.state,
        )
        .toBe('settled');
      const final = await packet('sidebar-child-original-after-close', {
        renderer: await uiSnapshot(a),
        unstaged: await sidebarUnstaged(a),
      });
      sidebarOriginals(final, parent, child);
      const rows = final.value.renderer.attempts;
      expect(rows).toHaveLength(2);
      expect(rows.every((row: any) => row.closed && row.publicView === null)).toBe(true);
      expect(rows.find((row: any) => row.attemptId === parent.attemptId).retained.execute).toEqual(
        parent.retained.execute,
      );
      expect(
        rows.find((row: any) => row.attemptId === child.attemptId).retained.execute.reviewExecution
          .outcome.status,
      ).toBe('reused');
      expect(stopInventory(final.source).rows.every((row) => row.complete)).toBe(true);
      expect(nativeRequests(final, 'execute')).toHaveLength(2);
      expect(final.hosts[0].effects.posts).toBe(0);
      noGitChanges(committed, final);
      expect(final.value.unstaged.localContent).toBe(unstaged.localContent);
    }),
  );

  test(sidebarGroups[2][0], async () =>
    withDriver(10, async ({ app, a, b, packet }) => {
      await sidebarReady(a, 'member');
      await sidebarReady(b, 'owner');
      const unstaged = await sidebarUnstaged(a);
      expect(unstaged?.localContent).toBe('owned unstaged change\n');
      const baseline = await packet('sidebar-member-before');
      const title = 'Member sidebar review';
      await sidebarDrafts(a, title);
      const first = await sidebarCommitDialog(a);
      for (const target of ['source', 'target'])
        expect(first.parent.preview.reviewPreparation[target].connection ?? null).toBeNull();
      const parent = await sidebarParent(a, first);
      const committed = await packet('sidebar-member-parent', parent);
      stagedCommitOnly(baseline, committed, parent);
      const { child, dialog } = await sidebarChild(a, parent, title);
      for (const target of ['source', 'target'])
        expect(child.preview.reviewPreparation[target].connection ?? null).toBeNull();
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      const result = await sidebarChildOutcome(a, child, 'reused');
      const reused = await packet('sidebar-member-reused', {
        parent,
        result,
        renderer: await uiSnapshot(a),
        unstaged: await sidebarUnstaged(a),
      });
      sidebarOriginals(reused, parent, child);
      expect(reused.hosts[0].effects.posts).toBe(0);
      noGitChanges(committed, reused);
      expect(reused.value.unstaged.localContent).toBe(unstaged.localContent);
      await a.screenshot({ path: join(evidence!, 'sidebar-member-reused.png') });
      record(
        evidence!,
        'sidebar-member-original-disposal',
        await main(app, (f) => f.quiesceUi(false)),
      );
      await main(app, (f) => f.role('guest'));
      await main(app, (f) => f.navigate());
      await a.waitForFunction(() => !!(window as any).nativeUi);
      await sidebarReady(a, 'guest');
      const before = await packet('sidebar-guest-before', await uiSnapshot(a));
      const refusal = a.getByText(
        'This review cannot be prepared with the current repository and access.',
        { exact: true },
      );
      await expect(refusal).toBeVisible();
      await expect(
        sidebarRegion(a).getByRole('button', { name: 'Commit', exact: true }),
      ).toHaveCount(0);
      await expect(
        a.getByRole('button', { name: 'Prepare merge request', exact: true }),
      ).toHaveCount(0);
      await expect(a.getByRole('button', { name: 'Create', exact: true })).toHaveCount(0);
      const denied = await packet('sidebar-guest-denied', await uiSnapshot(a));
      for (const method of ['prepare', 'execute', 'reconcile'])
        expect(nativeRequests(denied, method)).toEqual(nativeRequests(before, method));
      for (const host of [0, 1])
        expect(denied.hosts[host].effects).toEqual(before.hosts[host].effects);
      noGitChanges(before, denied);
      await a.screenshot({ path: join(evidence!, 'sidebar-guest-denied.png') });
    }),
  );
}
