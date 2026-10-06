/** @vitest-environment jsdom */
// Test-only internal Services adapter. The live test never runs without explicit opt-in.
import { afterEach, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { runSaga, stdChannel } from 'redux-saga';
import { notePagesSaga } from '$store/renderer/slices/note-pages/sagas/note-pages-saga';
import { appClient } from '$lib/client';
import { MockNotePagesClient } from '$lib/client/mock/mock-note-pages-client';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest, NoteReadPage } from '$lib/client/note-pages';
import recordedAb from './__fixtures__/note-local-point/plain-paragraph-ab.json';
import { LiveNotePagesClient } from '$lib/client/live/live-note-pages-client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { NoteCommitReceipt, NotePageState, NoteScope } from '$lib/client/note-pages';
import type { Workspace } from '$shared/types';
import * as a from '$store/renderer/slices/note-pages/note-pages-slice';
import { noteAssemblyResources } from '../note-assembly-reservation';
import { readNoteWindow } from '../note-window-reader';
import { NoteWindowView } from '../note-window-view';
import { prepareNoteLocalPointViewEditing } from './note-local-point-view-editing';
import { stageNoteDocumentSave } from './note-staged-save';
import { createNoteStagedSaveOperation, stageTextDigest } from '$lib/client/note-source-operation';
import { reserveNoteReceiptTranscript } from './note-receipt-transcript';
import type { Transaction } from '@tiptap/pm/state';
import type { NoteReceiptPage } from '$lib/client/note-receipt-reader';
import type { NoteTransactionOwner } from '../note-transaction-relay';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
const originalPages = appClient.notes.pages;
const pointId = '00000000-0000-4000-8000-000000000001';
const literal = `<!--anchor:${pointId}:point-->`;
const contractHash = '943ac9cd2086865fb4df7446eb079c3bf833d3374f6576f176072dda0e68eeb4';
const dataPrefix = '{"jsonrpc":"2.0",';
const controlPrefix = '{"control":';
const allowed = new Set([
  'note.get',
  'note.operation.begin',
  'note.operation.append',
  'note.operation.seal',
  'note.operation.commit',
  'note.operationStatus',
  'note.operation.cancel',
  'note.operation.read',
]);
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected record');
  return value as Record<string, unknown>;
};

/** Test-only own-data bound before serialization; no getter/toJSON callbacks. */
type SummaryAdmission = { fields: number; units: number; bytes: number };
function encode(value: unknown, max: number, total?: SummaryAdmission): Buffer {
  let fields = 0,
    units = 0,
    bytes = 0;
  const seen = new Set<object>();
  const charge = (n: number) => {
    bytes += n;
    if (bytes > max) throw new Error('JSON exceeds admission');
  };
  const string = (s: string) => {
    units += s.length;
    if (units > 131072) throw new Error('String admission');
    charge(2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 32) charge([8, 9, 10, 12, 13].includes(c) ? 2 : 6);
      else if (c === 34 || c === 92) charge(2);
      else if (c < 128) charge(1);
      else if (c < 2048) charge(2);
      else if (
        c >= 0xd800 &&
        c <= 0xdbff &&
        s.charCodeAt(i + 1) >= 0xdc00 &&
        s.charCodeAt(i + 1) <= 0xdfff
      ) {
        charge(4);
        i++;
      } else if (c >= 0xd800 && c <= 0xdfff) charge(6);
      else charge(3);
    }
  };
  const walk = (v: unknown, depth: number) => {
    if (++fields > 8192 || depth > 32) throw new Error('Object admission');
    if (v === null) {
      charge(4);
      return;
    }
    if (typeof v === 'string') {
      string(v);
      return;
    }
    if (typeof v === 'boolean') {
      charge(v ? 4 : 5);
      return;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      charge(String(v).length);
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v)) throw new Error('Unsupported JSON');
    const array = Array.isArray(v);
    if (Object.getPrototypeOf(v) !== (array ? Array.prototype : Object.prototype))
      throw new Error('Nonplain JSON');
    seen.add(v);
    if (
      Object.getOwnPropertyDescriptor(v, 'toJSON') ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(v), 'toJSON')
    )
      throw new Error('Callback JSON');
    const keys = Object.keys(v);
    if (keys.length + fields > 8192 || (array && keys.length !== v.length))
      throw new Error('Object admission');
    charge(2);
    keys.forEach((key, i) => {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !('value' in d) || key === 'toJSON' || (array && key !== String(i)))
        throw new Error('Callback JSON');
      if (i) charge(1);
      if (!array) {
        string(key);
        charge(1);
      }
      walk(d.value, depth + 1);
    });
    seen.delete(v);
  };
  walk(value, 0);
  if (total) {
    if (
      total.fields + fields > 8192 ||
      total.units + units > 131072 ||
      total.bytes + bytes > 131072
    )
      throw new Error('Aggregate summary admission');
    total.fields += fields;
    total.units += units;
    total.bytes += bytes;
  }
  const raw = Buffer.from(JSON.stringify(value) + '\n');
  if (raw.length !== bytes + 1) throw new Error('JSON sizing mismatch');
  return raw;
}

/** Fixed storage, prefix classification before parse, exactly one expected frame. */
class Frame {
  private bytes = Buffer.alloc(8193);
  private length = 0;
  private kind: 'data' | 'control' | undefined;
  private done = false;
  push(chunk: Uint8Array): { raw: Buffer; value: Record<string, unknown> } | undefined {
    if (this.done) throw new Error('Unsolicited frame');
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (this.length >= (this.kind === 'control' ? 4097 : 8193))
        throw new Error('Frame exceeds admission');
      this.bytes[this.length++] = byte;
      if (!this.kind) {
        const prefix = this.bytes.subarray(0, this.length).toString('ascii');
        if (prefix === dataPrefix) this.kind = 'data';
        else if (prefix === controlPrefix) this.kind = 'control';
        else if (!dataPrefix.startsWith(prefix) && !controlPrefix.startsWith(prefix))
          throw new Error('Invalid frame prefix');
      }
      const maximum = this.kind === 'control' ? 4096 : 8192;
      if (byte !== 10 && this.length > maximum) throw new Error('Frame exceeds admission');
      if (byte === 10) {
        if (i !== chunk.length - 1) throw new Error('Pipelined response');
        this.done = true;
        const raw = Buffer.from(this.bytes.subarray(0, this.length));
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(0, -1));
        return { raw, value: object(JSON.parse(text)) };
      }
    }
    return undefined;
  }
  eof() {
    if (!this.done) throw new Error('Partial or missing frame');
  }
}

class Quota {
  total = 0;
  bytes = 0;
  private counts = { source: 0, root: 0, detail: 0, inverse: 0, stage: 0 };
  reserve(method: string, params: Record<string, unknown>) {
    if (!allowed.has(method)) throw new Error('Method outside contract');
    let category: keyof Quota['counts'] = 'stage';
    if (method === 'note.get') category = 'source';
    if (method === 'note.operation.read') {
      if (['mapping', 'effects', 'inverse'].includes(String(params.kind))) category = 'root';
      else if (params.kind === 'detail') category = 'detail';
      else if (params.kind === 'inverseText') category = 'inverse';
      else throw new Error('Unsupported receipt kind');
    }
    const cap = { source: 64, root: 64, detail: 512, inverse: 16, stage: 16 }[category];
    if (this.total >= 768 || this.counts[category] >= cap) throw new Error('Call quota exceeded');
    this.total++;
    this.counts[category]++;
  }
  disk(bytes: number, terminal = false) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      this.bytes + bytes > 8 * 1024 * 1024 - (terminal ? 0 : 65536)
    )
      throw new Error('Artifact quota exceeded');
    this.bytes += bytes;
  }
}

/** No response history: exact frames stream to disk before the next request. */
class Peer {
  readonly quota = new Quota();
  private socket: Socket;
  private frame: Frame | undefined;
  private waiter:
    | {
        resolve(value: { raw: Buffer; value: Record<string, unknown> }): void;
        reject(error: Error): void;
      }
    | undefined;
  private busy = false;
  private lost = false;
  private nextId = 1;
  private remoteUnsettled = false;
  get settlementKnown() {
    return !this.remoteUnsettled;
  }
  private started = performance.now();
  private ioStop = Infinity;
  private chain = '0'.repeat(64);
  private closed: Promise<void>;
  private constructor(
    path: string,
    private spool: FileHandle,
    private admitted: () => boolean,
    private timeout = 30000,
  ) {
    this.socket = createConnection({ path, highWaterMark: 8193 });
    this.socket.pause();
    this.closed = new Promise((resolve) =>
      this.socket.once('close', () => {
        if (this.waiter) this.fail(new Error('Closed with outstanding request'));
        resolve();
      }),
    );
    this.socket.on('data', (chunk: Buffer) => {
      try {
        if (!this.frame || !this.waiter) throw new Error('Unsolicited response');
        const result = this.frame.push(chunk);
        if (result) {
          this.socket.pause();
          const waiter = this.waiter;
          this.waiter = undefined;
          this.frame = undefined;
          waiter.resolve(result);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error('Frame failure'));
      }
    });
    this.socket.on('error', (error) => this.fail(error));
    this.socket.on('end', () => {
      if (this.waiter) this.fail(new Error('EOF with outstanding request'));
    });
  }
  private fail(error: Error) {
    this.lost = true;
    const waiter = this.waiter;
    this.waiter = undefined;
    this.frame = undefined;
    waiter?.reject(error);
    this.socket.destroy();
  }
  private read() {
    if (this.waiter) throw new Error('Concurrent receive');
    this.frame = new Frame();
    const result = new Promise<{ raw: Buffer; value: Record<string, unknown> }>(
      (resolve, reject) => {
        this.waiter = { resolve, reject };
      },
    );
    this.socket.resume();
    return result;
  }
  private async exchange(raw: Buffer) {
    const pending = this.read();
    const write = new Promise<void>((resolve, reject) => {
      try {
        this.socket.write(raw, (error) => {
          if (error) {
            this.fail(error);
            reject(error);
          } else resolve();
        });
      } catch (error) {
        const e = error instanceof Error ? error : new Error('Socket write failed');
        this.fail(e);
        reject(e);
      }
    });
    const result = await Promise.allSettled([pending, write]);
    if (result[0].status === 'rejected') throw result[0].reason;
    if (result[1].status === 'rejected') throw result[1].reason;
    return result[0].value;
  }
  private async record(direction: string, raw: Buffer) {
    const digest = sha(raw);
    this.chain = sha(`${this.chain}:${direction}:${digest}`);
    const line = encode(
      { direction, digest, chain: this.chain, frame: raw.toString('utf8') },
      131072,
    );
    this.quota.disk(line.length);
    await this.spool.writeFile(line);
  }
  private clockCurrent() {
    if (this.lost || performance.now() >= Math.min(this.ioStop, this.started + 120000)) {
      this.lost = true;
      throw new Error('Driver admission lost');
    }
  }
  private current() {
    this.clockCurrent();
    if (!this.admitted()) {
      this.lost = true;
      throw new Error('Driver admission lost');
    }
    this.clockCurrent();
  }
  static async connect(path: string, spool: FileHandle, admitted: () => boolean, timeout = 30000) {
    const peer = new Peer(path, spool, admitted, timeout);
    peer.ioStop = performance.now() + timeout;
    const timer = setTimeout(() => peer.fail(new Error('Handshake timeout')), timeout);
    try {
      const received = await peer.read();
      await peer.record('received', received.raw);
      const ready = received.value;
      if (
        ready.control !== 'ready' ||
        ready.contractHash !== contractHash ||
        ready.principal !== 'daemon'
      )
        throw new Error('Foreign driver handshake');
      peer.started = performance.now();
      peer.current();
      return { peer, ready };
    } catch (error) {
      peer.fail(new Error('Driver handshake failed'));
      await peer.closed;
      await spool.close();
      throw error;
    } finally {
      clearTimeout(timer);
      peer.ioStop = Infinity;
    }
  }
  async request(
    method: string,
    params: Record<string, unknown>,
    beforeDispatch: () => boolean = () => true,
  ): Promise<unknown> {
    if (this.busy) throw new Error('Concurrent request');
    this.busy = true;
    this.ioStop = Math.min(this.started + 120000, performance.now() + this.timeout);
    const timer = setTimeout(
      () => {
        this.lost = true;
      },
      Math.max(0, Math.min(this.timeout, this.started + 120000 - performance.now())),
    );
    try {
      this.current();
      this.quota.reserve(method, params);
      const id = this.nextId++;
      const raw = encode({ jsonrpc: '2.0', id, method, params }, 65536);
      await this.record('sent', raw);
      this.current();
      if (!beforeDispatch()) throw new Error('Producer lost before dispatch');
      this.clockCurrent();
      this.remoteUnsettled = true;
      const received = await this.exchange(raw);
      await this.record('received', received.raw);
      const response = received.value;
      if (response.control === 'failure') throw new Error('Harness failure (not Services error)');
      if (response.jsonrpc !== '2.0' || response.id !== id)
        throw new Error('RPC identity mismatch');
      if ('error' in response) {
        const error = object(response.error);
        if (typeof error.code !== 'number' || typeof error.message !== 'string')
          throw new Error('Invalid Services error');
        this.remoteUnsettled = false;
        throw new Error(`Services ${error.code}: ${error.message}`);
      }
      if (!('result' in response)) throw new Error('Missing result');
      this.remoteUnsettled = false;
      this.current();
      return response.result;
    } catch (error) {
      this.lost = true;
      throw error;
    } finally {
      clearTimeout(timer);
      this.ioStop = Infinity;
      this.busy = false;
    }
  }
  async finish() {
    if (this.busy) throw new Error('Outstanding request');
    this.busy = true;
    this.ioStop = Math.min(this.started + 120000, performance.now() + this.timeout);
    const timer = setTimeout(
      () => {
        this.lost = true;
      },
      Math.max(0, Math.min(this.timeout, this.started + 120000 - performance.now())),
    );
    try {
      this.current();
      const raw = Buffer.from(JSON.stringify({ control: 'finish', contractHash }) + '\n');
      await this.record('sent', raw);
      this.current();
      this.remoteUnsettled = true;
      const received = await this.exchange(raw);
      await this.record('received', received.raw);
      if (received.value.control !== 'finish' || received.value.contractHash !== contractHash)
        throw new Error('Foreign finish control');
      const summary = object(received.value.summary);
      this.remoteUnsettled = false;
      this.current();
      return summary;
    } catch (error) {
      this.lost = true;
      throw error;
    } finally {
      clearTimeout(timer);
      this.ioStop = Infinity;
      this.busy = false;
    }
  }
  async evidence(value: unknown) {
    if (this.busy) throw new Error('Outstanding request');
    this.busy = true;
    this.ioStop = Math.min(this.started + 120000, performance.now() + this.timeout);
    const timer = setTimeout(
      () => {
        this.lost = true;
      },
      Math.max(0, Math.min(this.timeout, this.started + 120000 - performance.now())),
    );
    try {
      this.current();
      await this.record('bounded-test-evidence', encode(value, 32768));
      this.current();
    } finally {
      clearTimeout(timer);
      this.ioStop = Infinity;
      this.busy = false;
    }
  }
  async close() {
    this.lost = true;
    if (this.busy) throw new Error('Cannot release an outstanding read');
    const stop = performance.now() + this.timeout;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
    }, this.timeout);
    try {
      this.socket.end();
      await this.closed;
      await this.spool.close();
      if (expired || performance.now() >= stop || this.remoteUnsettled)
        throw new Error('Remote or physical settlement unproven');
    } finally {
      clearTimeout(timer);
    }
  }
}

const temporary: string[] = [];
afterEach(async () => {
  appClient.notes.pages = originalPages;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
it('classifies segmented control prefixes before parse and preserves exact UTF8 bytes', () => {
  const raw = Buffer.from(JSON.stringify({ control: 'ready', value: 'é' }) + '\n');
  const frame = new Frame();
  let result: ReturnType<Frame['push']>;
  for (const byte of raw) result = frame.push(Buffer.of(byte));
  expect(result!.raw).toEqual(raw);
  expect(result!.value.value).toBe('é');
  frame.eof();
});
it('refuses oversized control before parsing and refuses unsolicited or partial frames', () => {
  const frame = new Frame();
  expect(() => frame.push(Buffer.from(controlPrefix + '"' + 'x'.repeat(4096)))).toThrow(
    'admission',
  );
  expect(() => new Frame().push(Buffer.from(' {"control":'))).toThrow('prefix');
  expect(() => new Frame().push(Buffer.from('{"jsonrpc":"2.0","id":1}\n{}\n'))).toThrow(
    'Pipelined',
  );
  const partial = new Frame();
  partial.push(Buffer.from('{"jsonrpc":"2.0",'));
  expect(() => partial.eof()).toThrow('Partial');
});
it('admits exactly8192 envelope bytes plus newline and rejects the next data byte', () => {
  const base = JSON.stringify({ jsonrpc: '2.0', id: 1, result: '' });
  const raw = Buffer.from(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(8192 - base.length) }) + '\n',
  );
  expect(raw.length).toBe(8193);
  expect(new Frame().push(raw)?.raw).toEqual(raw);
  expect(() => new Frame().push(Buffer.concat([raw.subarray(0, -1), Buffer.from('x\n')]))).toThrow(
    'admission',
  );
});
it('bounds method categories and streamed disk bytes without widening on overflow', () => {
  const quota = new Quota();
  for (let i = 0; i < 16; i++) quota.reserve('note.operationStatus', {});
  expect(() => quota.reserve('note.operationStatus', {})).toThrow('quota');
  expect(() => quota.reserve('note.operation.status', {})).toThrow('contract');
  expect(() => quota.reserve('note.operation.read', { kind: 'source' })).toThrow('kind');
  quota.disk(8 * 1024 * 1024 - 65536);
  expect(() => quota.disk(1)).toThrow('quota');
});
it('uses actual UDS framing and original RPC IDs without contacting Services', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-point-guard-'));
  temporary.push(directory);
  const path = join(directory, 'guard.sock');
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
    socket.on('data', (bytes) => {
      const request = JSON.parse(bytes.toString()) as Record<string, unknown>;
      expect(request.method).toBe('note.operationStatus');
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { observed: true } }) + '\n',
      );
    });
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const spool = await open(join(directory, 'guard.jsonl'), 'wx');
    const { peer } = await Peer.connect(path, spool, () => true);
    try {
      expect(await peer.request('note.operationStatus', {})).toEqual({ observed: true });
    } finally {
      await peer.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('admits bounded own-data JSON before serialization and never invokes accessors', () => {
  const getter = vi.fn(() => 'wrong');
  const value = Object.defineProperty({}, 'text', { enumerable: true, get: getter });
  expect(() => encode(value, 65536)).toThrow('Callback');
  expect(getter).not.toHaveBeenCalled();
  expect(() => encode({ text: 'x'.repeat(65536) }, 65536)).toThrow('admission');
  const v = { text: '\u0000\né😀\ud800', a: [true, null, 3] };
  expect(encode(v, 8192).toString()).toBe(JSON.stringify(v) + '\n');
});

/** DTO validation supplies no native authority. Values originate in actual Services. */
function state(value: unknown, scope?: NoteScope): NotePageState {
  const v = object(value),
    s = object(v.scope);
  for (const key of ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']) {
    if (typeof s[key] !== 'string' || !s[key] || String(s[key]).length > 256)
      throw new Error('State scope');
  }
  if (scope) expect(s).toEqual(scope);
  for (const key of [
    'stateGeneration',
    'sourceRevision',
    'attributionGeneration',
    'commentRevision',
  ]) {
    if (typeof v[key] !== 'string' || !v[key] || String(v[key]).length > 256)
      throw new Error('State identity');
  }
  if (
    v.kind !== 'notePageState' ||
    v.invalidation !== 'all' ||
    typeof v.deleted !== 'boolean' ||
    !['pending', 'ready'].includes(String(v.attributionState))
  )
    throw new Error('Invalid actual state');
  return value as NotePageState;
}

function receipt(
  value: unknown,
  sealed: ReturnType<ReturnType<typeof createNoteStagedSaveOperation>['sealedSave']>,
): NoteCommitReceipt {
  const v = object(value);
  expect(v.scope).toEqual(sealed.scope);
  expect(v.kind).toBe('noteCommitReceipt');
  expect(v.outcome).toBe('committed');
  expect(v.operationId).toBe(sealed.operationId);
  expect(v.headerDigest).toBe(sealed.headerDigest);
  expect(v.payloadDigest).toBe(sealed.payloadDigest);
  expect(v.beforeRevision).toBe(sealed.baseRevision);
  expect(v.sourceLength).toBe(3);
  expect(v.invalidation).toBe('all');
  for (const key of [
    'afterRevision',
    'mappingRef',
    'effectsRef',
    'inverseRef',
    'viewId',
    'receiptExpiresAt',
  ]) {
    if (typeof v[key] !== 'string' || !v[key] || String(v[key]).length > 256)
      throw new Error('Receipt identity');
  }
  if (!(Date.now() < Date.parse(String(v.receiptExpiresAt)))) throw new Error('Expired receipt');
  return value as NoteCommitReceipt;
}

/** A tiny fixed fixture tree, not a general receipt framework. No valueRef fallback. */
async function receiptOracle(
  client: Pick<LiveNotePagesClient, 'readReceipt'>,
  r: NoteCommitReceipt,
  group: number,
  transcript: Awaited<ReturnType<typeof reserveNoteReceiptTranscript>['ready']>,
) {
  const admission: SummaryAdmission = { fields: 0, units: 0, bytes: 0 };
  const roots: Record<'mapping' | 'effects' | 'inverse', Record<string, unknown>[]> = {
    mapping: [],
    effects: [],
    inverse: [],
  };
  const check = () => {
    if (!transcript.current()) throw new Error('Receipt observer lost');
  };
  const ids = new Set<string>(),
    refs = new Set<string>();
  let fields = 0,
    retainedBytes = 0;
  const tree = async (
    ref: string,
    parent: string | null,
    depth: number,
  ): Promise<Record<string, unknown>[]> => {
    if (refs.has(ref) || refs.size >= 32 || depth > 4) throw new Error('Fixture detail admission');
    refs.add(ref);
    const entries: Record<string, unknown>[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      check();
      const page = await client.readReceipt(r, {
        kind: 'detail',
        ref,
        baseLength: 2,
        maxItems: 16,
        maxWireBytes: 8192,
        ...(cursor ? { cursor } : {}),
      });
      check();
      for (const raw of page.items) {
        if (++fields > 32) throw new Error('Fixture detail nodes');
        // Fixed two-field entry and array slot are admitted before reconstruction.
        if (admission.fields + 3 > 8192) throw new Error('Tree entry admission');
        admission.fields += 3;
        retainedBytes += encode(raw, 8192, admission).length;
        if (retainedBytes > 65536) throw new Error('Fixture semantic allowance');
        const node = object(raw);
        if (
          typeof node.id !== 'string' ||
          ids.has(node.id) ||
          node.parentId !== parent ||
          'valueRef' in node
        )
          throw new Error('Fixture detail identity');
        ids.add(node.id);
        if (node.type === 'object') {
          if (typeof node.childrenRef !== 'string') throw new Error('Fixture children reference');
          const children = await tree(node.childrenRef, node.id, depth + 1);
          if (admission.fields + children.length + 3 > 8192)
            throw new Error('Tree reconstruction admission');
          admission.fields += children.length + 3;
          const value: Record<string, unknown> = {};
          for (const child of children) {
            if (typeof child.key !== 'string' || Object.hasOwn(value, child.key))
              throw new Error('Duplicate fixture field');
            Object.defineProperty(value, child.key, { value: child.value, enumerable: true });
          }
          entries.push({ key: node.key ?? null, value });
        } else {
          if (!['number', 'string'].includes(String(node.type)) || typeof node.value !== node.type)
            throw new Error('Fixture scalar');
          entries.push({ key: node.key ?? null, value: node.value });
        }
      }
      if (page.nextCursor !== null && (cursors.has(page.nextCursor) || cursors.size >= 32))
        throw new Error('Fixture cursor');
      if (page.nextCursor !== null) cursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    encode(entries, 131072, admission); // Charges every simultaneous rebuilt tree, no raw response history.
    return entries;
  };
  let effectTree: Record<string, unknown>[] | undefined;
  let provenance: Record<string, unknown>[] | undefined;
  for (const kind of ['mapping', 'effects', 'inverse'] as const) {
    let count = 0;
    while (
      !(await transcript.consumeNext(kind, async (page) => {
        if (++count > 64 || roots[kind].length + page.items.length > (kind === 'effects' ? 2 : 1))
          throw new Error('Fixture root admission');
        if (page.outputKind === 'effects') expect(page.convertedCount).toBe(0);
        for (const raw of page.items) {
          const row = object(JSON.parse(encode(raw, 8192, admission).toString()));
          roots[kind].push(row);
          if (kind === 'effects' && row.kind === 'sourceEffect') {
            if (typeof row.detailRef !== 'string') throw new Error('Effect reference');
            effectTree = await tree(row.detailRef, null, 0);
          }
          if (kind === 'inverse') {
            if (typeof row.provenanceRef !== 'string') throw new Error('Inverse reference');
            provenance = await tree(row.provenanceRef, null, 0);
            const replacement = object(row.replacement);
            if (typeof replacement.textId !== 'string') throw new Error('Inverse text reference');
            check();
            const empty = await client.readReceipt(r, {
              kind: 'inverseText',
              textId: replacement.textId,
              offset: 0,
              baseLength: 2,
              maxItems: 1,
              maxWireBytes: 8192,
              maxSourceBytes: 4096,
            });
            check();
            expect(empty.sourceLength).toBe(3);
            expect(empty.nextCursor).toBeNull();
            expect(empty.items).toEqual([{ textId: replacement.textId, offset: 0, text: '' }]);
          }
        }
        check();
      }))
    )
      check();
  }

  expect(roots.mapping).toEqual([{ start: 1, end: 1, insertedLength: 1 }]);
  const [effect, annotation] = roots.effects;
  expect(effect).toEqual({
    kind: 'sourceEffect',
    reason: 'phantom-scrub',
    inputState: expect.any(String),
    outputState: expect.any(String),
    range: { start: 2, end: 58 },
    insertedLength: 0,
    beforeDigest: sha(literal),
    afterDigest: sha(''),
    detailRef: expect.any(String),
  });
  expect(effect.inputState).not.toBe(effect.outputState);
  expect(annotation).toEqual({
    kind: 'annotationInvalidation',
    sourceRevision: r.afterRevision,
    attributionGeneration: expect.any(String),
    commentRevision: expect.any(String),
  });
  const [inverse] = roots.inverse;
  expect(inverse).toEqual({
    ordinal: 0,
    historyGroup: String(group),
    inputState: r.afterRevision,
    outputState: r.beforeRevision,
    start: 1,
    end: 2,
    replacement: { textId: expect.any(String), length: 0, utf8Bytes: 0, sha256: sha('') },
    provenanceRef: expect.any(String),
  });

  expect(effectTree).toEqual([
    {
      key: null,
      value: {
        inputState: effect.inputState,
        outputState: effect.outputState,
        range: { start: 2, end: 58 },
        removed: literal,
        inserted: '',
      },
    },
  ]);
  expect(provenance).toEqual([
    {
      key: null,
      value: {
        kind: 'sourceProvenance',
        inputState: inverse.inputState,
        outputState: inverse.outputState,
        baseRange: { start: 1, end: 1 },
        finalRange: { start: 1, end: 2 },
        replacement: inverse.replacement,
      },
    },
  ]);
  return {
    group,
    mapping: roots.mapping,
    effects: roots.effects,
    inverse: roots.inverse,
    effectTree,
    provenance,
  };
}

const captureEnabled = process.env.NOTE_LINKED_CAPTURE_ENABLE === 'coordinated-live-capture';
it.skipIf(!captureEnabled)(
  'links an actual admitted native group to same-Services canonical receipt without adopting it',
  async () => {
    // This test is prepared, but a fresh run requires separate coordinator selection.
    expect(process.env.NOTE_LINKED_CONTRACT_SHA256).toBe(contractHash);
    const socket = process.env.NOTE_LINKED_SOCKET;
    const directory = process.env.NOTE_LINKED_FE_DIR;
    if (!socket || !directory) throw new Error('Missing isolated capture paths');
    let pages = a.notePagesReducer(
      undefined,
      a.pageResourceLimitsConfigured({
        payloadBytes: 16 * 1024 * 1024,
        stringUnits: 16 * 1024 * 1024,
        objectNodes: 1024 * 1024,
        domNodes: 10000,
        physicalReads: 16,
        assemblies: 16,
      }),
    );
    const listeners = new Set<() => void>();
    const channel = stdChannel();
    const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
      pages = a.notePagesReducer(pages, action);
      for (const listener of listeners) listener();
      channel.put(action);
    };
    const port = {
      read: () => pages,
      dispatch,
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    let saga: ReturnType<typeof runSaga> | undefined;
    let live = true;
    let connected: Peer | undefined;
    let offer: ReturnType<typeof prepareNoteLocalPointViewEditing> | undefined;
    let view: NoteWindowView | undefined;
    let releaseNative: (() => void) | undefined;
    let transcriptOffer: ReturnType<typeof reserveNoteReceiptTranscript> | undefined;
    const scratch = 'linked-test-scratch';
    try {
      dispatch(
        a.pageResourcesRequested(
          scratch,
          [
            {
              id: scratch,
              cost: {
                payloadBytes: 1671168,
                stringUnits: 1671168,
                objectNodes: 8192,
                domNodes: 0,
                physicalReads: 1,
                assemblies: 1,
              },
            },
          ],
          12,
        ),
      );
      expect(pages.resourceLedger.owners[scratch]).toBeDefined();
      const { peer, ready } = await Peer.connect(
        socket,
        await open(join(directory, 'frontend-transcript.jsonl'), 'wx'),
        () => live && !!pages.resourceLedger.owners[scratch],
      );
      connected = peer;
      const initial = state(ready.initialState);
      expect(initial.scope.workspaceId).toBe(ready.workspaceId);
      expect(initial.scope.noteId).toBe(ready.noteId);
      const ws = initial.scope.workspaceId,
        id = initial.scope.noteId;
      vi.mocked(backendRequest).mockImplementation(
        (method, params) =>
          peer.request(method, object(params)) as ReturnType<typeof backendRequest>,
      );
      const client = new LiveNotePagesClient();
      appClient.notes.pages = client;
      dispatch(a.pagePanelOpened(ws, id, 'panel'));
      dispatch(a.pageStateReceived(ws, id, 0, initial));
      const first = await client.read(ws, id, {
        kind: 'source',
        at: 0,
        maxSourceBytes: 4096,
        maxWireBytes: 8192,
        maxItems: 64,
      });
      if (first.kind !== 'noteSourcePage') throw new Error('No genuine source');
      expect(first.text).toBe('ab');
      expect(first.sourceLength).toBe(2);
      expect(first.scope).toEqual(initial.scope);
      expect(first.sourceRevision).toBe(initial.sourceRevision);
      const window = await readNoteWindow((q) => client.read(ws, id, q), { ...first, at: 0 });
      const note = () => pages.byWorkspaceId[ws].notes[id];
      dispatch(a.pageWindowRequested(ws, id, 'panel', 0));
      const seed = {
        owner: 'linked-seed',
        data: 'linked-seed-data',
        control: 'linked-seed-control',
      };
      dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
      dispatch(
        a.pageWindowSettled(
          ws,
          id,
          'panel',
          note().generation,
          note().windows.panel.request,
          window,
          null,
          { sponsor: seed.owner, resource: seed.data, owner: 'linked-window' },
        ),
      );
      dispatch(a.pageResourcesReleased(seed.owner));
      const base = note().document!;
      dispatch(
        a.pageDocumentSelectionChanged(ws, id, note().generation, base, {
          anchor: 1,
          head: 1,
          anchorAffinity: 1,
          headAffinity: 1,
        }),
      );
      const origin = note().document!;
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
      // Bootstrap was explicitly consumed above. Start only the real context-read
      // workers now: no synthetic hello/subscription and no duplicate window assembly.
      saga = runSaga({ channel, dispatch, getState: () => ({ notePages: pages }) }, notePagesSaga);
      offer = prepareNoteLocalPointViewEditing([port, window, 'panel', undefined, Date.now]);
      const editing = await offer.ready;
      let boundOwner: NoteTransactionOwner | undefined;
      const observedEditing: typeof editing = {
        ...editing,
        borrow(target) {
          const lease = editing.borrow!(target);
          return {
            ...lease,
            bind(...args) {
              const owner = lease.bind(...args);
              if (boundOwner || !owner) throw new Error('Genuine binding missing or duplicated');
              boundOwner = owner;
              return owner;
            },
          };
        },
      };
      const host = document.createElement('div');
      document.body.append(host);
      view = new NoteWindowView(host, {
        workspace: { id: ws } as Workspace,
        editing: observedEditing,
        seek: vi.fn(),
        fullOperation: vi.fn(),
        selectionChanged(selection) {
          const n = note();
          if (n.document)
            dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document, selection));
        },
      });
      expect(view.show(window)).toBe(true);
      const editor = view.editor!;
      const beforeState = editor.state;
      let root: Transaction | undefined;
      editor.on('transaction', ({ transaction }) => {
        if (transaction.docChanged) {
          if (root) throw new Error('More than one native root');
          root = transaction;
        }
      });
      expect(editor.chain().insertContent('X').insertPointAnchor(pointId).run()).toBe(true);
      const accepted = note().document!,
        callerState = editor.state,
        projection = view.projection!;
      expect(root?.before).toBe(beforeState.doc);
      expect(root?.doc).toBe(callerState.doc);
      expect(root?.steps).toHaveLength(2);
      // Borrow existing admitted documents only; no new PM document/history construction.
      const nativeDocs = new Set([beforeState.doc, callerState.doc, ...root!.docs]);
      if (nativeDocs.size > 4 || root!.steps.length + root!.mapping.maps.length > 8)
        throw new Error('Native evidence admission');
      let nativeNodes = 0;
      for (const doc of nativeDocs) {
        nativeNodes++;
        doc.descendants(() => {
          if (++nativeNodes > 64) throw new Error('Native nodes admission');
        });
      }
      // Source maps are borrowed from the charged original owner, never copied here.
      expect(accepted.history).toHaveLength(1);
      const group = accepted.history[0];
      if (group.kind !== 'local-point') throw new Error('No admitted typed group');
      expect(group.id).toBe(origin.generation + 1);
      expect(accepted.length).toBe(59);
      expect(accepted.baseLength).toBe(2);
      expect(projection.source).toBe(`aX${literal}b`);
      expect(callerState.doc.nodeAt(3)?.type.name).toBe('commentAnchor');
      expect(projection.sourceAt(3, -1)).toBe(2);
      expect(projection.sourceAt(4, 1)).toBe(58);
      const sessionId = randomUUID();
      const calls = peer.quota.total;
      await expect(
        stageNoteDocumentSave(port, client, ws, id, {
          editorSessionId: sessionId,
          selectionGeneration: group.recipe.identity.selectionGeneration,
          panelId: 'panel',
        }),
      ).rejects.toThrow('unavailable');
      expect(peer.quota.total).toBe(calls);
      let revoked = false;
      const producerCurrent = () => {
        const ownerCurrent = boundOwner?.current() === true;
        revoked ||=
          !ownerCurrent ||
          !pages.resourceLedger.owners[scratch] ||
          !live ||
          note().document !== accepted ||
          note().needsReconcile ||
          note().state?.sourceRevision !== accepted.baseRevision ||
          view?.editor !== editor ||
          editor.state !== callerState ||
          view.projection !== projection ||
          Date.now() >= Date.parse(first.expiresAt);
        return !revoked;
      };
      expect(producerCurrent()).toBe(true);
      releaseNative = offer.retain();
      const stage = createNoteStagedSaveOperation(
        (method, params) => peer.request(method, params, producerCurrent),
        {
          scope: accepted.scope,
          operationId: randomUUID(),
          expiresAt: first.expiresAt,
          header: {
            baseRevision: accepted.baseRevision,
            editorSessionId: sessionId,
            localEditSequence: group.id,
            liveGeneration: accepted.generation,
            selectionGeneration: group.recipe.identity.selectionGeneration,
            action: 'mutate',
            output: 'source',
            selection: 'all',
          },
        },
        producerCurrent,
      );
      const insertion = group.forward[0];
      expect(group.forward).toEqual([{ start: 1, end: 1, text: `X${literal}` }]);
      await stage.begin();
      const textId = `group:${group.id}:0`;
      await stage.append('text', [{ kind: 'text', id: textId, offset: 0, text: insertion.text }]);
      await stage.append('dirty', [
        {
          kind: 'splice',
          localSequence: group.id,
          ordinal: 0,
          start: 1,
          end: 1,
          replacement: {
            textId,
            length: 57,
            utf8Bytes: 57,
            sha256: await stageTextDigest(insertion.text),
          },
        },
      ]);
      await stage.seal();
      const sealed = stage.sealedSave();
      expect(sealed.viewLength).toBe(59);
      expect(sealed.manifest.map((m) => [m.stream, m.records])).toEqual([
        ['text', 1],
        ['dirty', 1],
        ['selection', 0],
        ['mutation', 0],
        ['live', 0],
      ]);
      expect(producerCurrent()).toBe(true);
      // Deliberate test-only commit seam: no cast to the unsupported native save witness.
      const committed = receipt(
        await peer.request(
          'note.operation.commit',
          {
            ...sealed.scope,
            operationId: sealed.operationId,
            headerDigest: sealed.headerDigest,
            payloadDigest: sealed.payloadDigest,
          },
          producerCurrent,
        ),
        sealed,
      );
      // Explicitly retire original producer after commit. Native docs retained below are
      // unprivileged detached oracle inputs; this does not synthesize a state notification.
      revoked = true;
      offer.retire();
      expect(producerCurrent()).toBe(false);
      // Receipt IO belongs to this test observer, not to the now potentially invalidated edit grant.
      transcriptOffer = reserveNoteReceiptTranscript(
        port,
        client,
        committed,
        2,
        () => live,
        undefined,
        Date.now,
        262144,
      );
      const transcript = await transcriptOffer.ready;
      const evidence = await receiptOracle(client, committed, group.id, transcript);
      await peer.evidence({
        contractHash,
        scope: accepted.scope,
        operationId: sealed.operationId,
        headerDigest: sealed.headerDigest,
        payloadDigest: sealed.payloadDigest,
        group: group.id,
        lengths: [2, 59, 3],
        nativeSteps: root?.steps.length,
        identity: group.recipe.identity,
        beforeSelection: origin.selection,
        callerSelection: accepted.selection,
        sourceRange: [2, 58],
        nativeRange: [3, 4],
        evidence,
      });
      const final = await peer.finish();
      const finalState = state(final.finalState, accepted.scope);
      expect(finalState.sourceRevision).toBe(committed.afterRevision);
      // Actual state control through existing invalidation, explicitly not a WSS notification.
      dispatch(a.pageStateReceived(ws, id, note().generation, finalState));
      expect(producerCurrent()).toBe(false);
      expect(note().needsReconcile).toBe(true);
      expect(note().document?.history).toEqual(accepted.history);
      await expect(
        stageNoteDocumentSave(port, client, ws, id, {
          editorSessionId: sessionId,
          selectionGeneration: group.recipe.identity.selectionGeneration,
          panelId: 'panel',
        }),
      ).rejects.toThrow();
      // Receipt-derived inverse is DATA proof only. Configured view has no PM undoRedo.
      // Retain genuine domain G unchanged; canonical native/domain adoption is Unsupported.
      expect(view.history('undo')).toBe(false);
      expect(note().document?.history).toEqual(accepted.history);
    } finally {
      live = false;
      // Every known borrower gets its cleanup attempt. Failed cleanup keeps DATA charged.
      const cleanup = await Promise.allSettled([
        transcriptOffer?.release(),
        (async () => {
          offer?.retire();
          view?.destroy();
          if (connected && !connected.settlementKnown)
            throw new Error('Native borrower held for unknown remote settlement');
          releaseNative?.();
          releaseNative = undefined;
          await offer?.release();
        })(),
        connected?.close(), // BE owns cancellation/unknown commit/Store settlement after EOF.
      ]);
      saga?.cancel();
      await saga?.toPromise();
      const failures = cleanup.filter((result) => result.status === 'rejected');
      if (connected) {
        const terminal = encode(
          {
            contractHash,
            cleanupKnown: !failures.length,
            remoteSettlementKnown: connected.settlementKnown,
            artifactBytesBeforeTerminal: connected.quota.bytes,
            dataCalls: connected.quota.total,
          },
          4096,
        );
        connected.quota.disk(terminal.length, true);
        const handle = await open(join(directory, 'frontend-terminal.json'), 'wx');
        try {
          await handle.writeFile(terminal);
        } finally {
          await handle.close();
        }
      }
      if (failures.length)
        throw new AggregateError(
          failures.map((result) => result.reason),
          'Physical cleanup unproven',
        );
      dispatch(a.pageResourcesReleased(scratch));
    }
  },
  150000,
);

it('retains an outstanding read past timeout, refuses overlap, and rejects late delivery permanently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-point-debt-'));
  temporary.push(directory);
  const path = join(directory, 'guard.sock');
  let deliver!: () => void;
  let observed!: () => void;
  const received = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
    socket.on('data', (bytes) => {
      const request = object(JSON.parse(bytes.toString()));
      deliver = () =>
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: true }) + '\n');
      observed();
    });
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const { peer } = await Peer.connect(
      path,
      await open(join(directory, 'guard.jsonl'), 'wx'),
      () => true,
      20,
    );
    let settled = false;
    const pending = peer.request('note.operationStatus', {}).finally(() => {
      settled = true;
    });
    const refused = expect(pending).rejects.toThrow('admission');
    await received;
    await expect(peer.request('note.operationStatus', {})).rejects.toThrow('Concurrent');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    await expect(peer.close()).rejects.toThrow('outstanding');
    expect(settled).toBe(false);
    deliver();
    await refused;
    await expect(peer.request('note.operationStatus', {})).rejects.toThrow('admission');
    await peer.close();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(['foreign-root', 'services-error', 'harness-failure'] as const)(
  'keeps %s distinct from a successful matching Services response',
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'local-point-error-'));
    temporary.push(directory);
    const path = join(directory, 'guard.sock');
    const server = createServer((socket) => {
      socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
      socket.on('data', (bytes) => {
        const request = object(JSON.parse(bytes.toString()));
        const response =
          kind === 'harness-failure'
            ? { control: 'failure', contractHash, kind: 'harness' }
            : kind === 'services-error'
              ? {
                  jsonrpc: '2.0',
                  id: request.id,
                  error: { code: -32000, message: 'actual test error' },
                }
              : { jsonrpc: '2.0', id: 999, result: true };
        socket.write(JSON.stringify(response) + '\n');
      });
      socket.on('end', () => socket.end());
    });
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      const { peer } = await Peer.connect(
        path,
        await open(join(directory, 'guard.jsonl'), 'wx'),
        () => true,
      );
      try {
        await expect(peer.request('note.operationStatus', {})).rejects.toThrow(
          kind === 'foreign-root'
            ? 'identity'
            : kind === 'services-error'
              ? 'Services -32000: actual test error'
              : 'Harness failure',
        );
        await expect(peer.request('note.operationStatus', {})).rejects.toThrow('admission');
      } finally {
        if (kind === 'services-error') await peer.close();
        else await expect(peer.close()).rejects.toThrow('settlement unproven');
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('rechecks producer after awaited spool before commit bytes reach the socket', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-point-dispatch-'));
  temporary.push(directory);
  const path = join(directory, 'guard.sock');
  const received = vi.fn();
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
    socket.on('data', received);
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const spool = await open(join(directory, 'guard.jsonl'), 'wx');
    const { peer } = await Peer.connect(path, spool, () => true);
    let producer = true;
    const write = spool.writeFile.bind(spool);
    vi.spyOn(spool, 'writeFile').mockImplementation(async (...args) => {
      await write(...args);
      producer = false;
    });
    try {
      await expect(peer.request('note.operation.commit', {}, () => producer)).rejects.toThrow(
        'Producer lost',
      );
      expect(received).not.toHaveBeenCalled();
    } finally {
      await peer.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(['value', 'get'] as const)(
  'refuses nonenumerable own toJSON %s without executing it',
  (kind) => {
    const callback = vi.fn(() => ({ forged: true }));
    const value = Object.defineProperty({}, 'toJSON', { [kind]: callback, enumerable: false });
    expect(() => encode(value, 8192)).toThrow('Callback');
    expect(callback).not.toHaveBeenCalled();
  },
);

it('admits aggregate retained summaries before the next serialization', () => {
  const admission: SummaryAdmission = { fields: 0, units: 0, bytes: 0 };
  encode({ text: 'a'.repeat(65000) }, 65536, admission);
  encode({ text: 'b'.repeat(65000) }, 65536, admission);
  const before = { ...admission };
  expect(() => encode({ text: 'c'.repeat(2000) }, 65536, admission)).toThrow('Aggregate');
  expect(admission).toEqual(before);
});

it('keeps receipt DATA and IO charged through a cancelled held nested detail', async () => {
  let pages = a.notePagesReducer(
    undefined,
    a.pageResourceLimitsConfigured({
      payloadBytes: 8000000,
      stringUnits: 8000000,
      objectNodes: 1000000,
      domNodes: 0,
      physicalReads: 2,
      assemblies: 2,
    }),
  );
  const listeners = new Set<() => void>();
  const port = {
    read: () => pages,
    dispatch(action: Parameters<typeof a.notePagesReducer>[1]) {
      pages = a.notePagesReducer(pages, action);
      for (const fn of listeners) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const r: NoteCommitReceipt = {
    kind: 'noteCommitReceipt',
    outcome: 'committed',
    scope: { backendId: 'guard', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    operationId: 'op',
    payloadDigest: sha('payload'),
    headerDigest: sha('header'),
    beforeRevision: 'before',
    afterRevision: 'after',
    sourceLength: 3,
    mappingRef: 'mapping',
    effectsRef: 'effects',
    inverseRef: 'inverse',
    viewId: 'view',
    receiptExpiresAt: '2099-01-01T00:00:00Z',
    invalidation: 'all',
  };
  let entered!: () => void, settle!: () => void;
  const entering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const client: Pick<LiveNotePagesClient, 'readReceipt'> = {
    async readReceipt(_receipt, request): Promise<NoteReceiptPage> {
      const common = {
        kind: 'noteOperationPage' as const,
        scope: r.scope,
        operationId: r.operationId,
        payloadDigest: r.payloadDigest,
        headerDigest: r.headerDigest!,
        viewId: r.viewId!,
        sourceLength: 2,
        nextCursor: null,
        expiresAt: r.receiptExpiresAt,
      };
      if (request.kind === 'mapping')
        return {
          ...common,
          outputKind: 'mapping',
          items: [{ start: 1, end: 1, insertedLength: 1 }],
        };
      if (request.kind === 'effects')
        return {
          ...common,
          outputKind: 'effects',
          convertedCount: 0,
          items: [{ kind: 'sourceEffect', detailRef: 'detail' }],
        };
      if (request.kind !== 'detail') throw new Error('Unexpected guard request');
      entered();
      await held;
      return { ...common, outputKind: 'detail', items: [] };
    },
  };
  const lease = reserveNoteReceiptTranscript(
    port,
    client,
    r,
    2,
    () => true,
    undefined,
    Date.now,
    262144,
  );
  const transcript = await lease.ready;
  const reading = receiptOracle(client, r, 1, transcript);
  const rejected = expect(reading).rejects.toThrow();
  await entering;
  const before = Object.keys(pages.resourceLedger.owners);
  expect(before.length).toBeGreaterThan(0);
  let released = false;
  const release = lease.release().then(() => {
    released = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(released).toBe(false);
  expect(Object.keys(pages.resourceLedger.owners)).toEqual(before);
  settle();
  await rejected;
  await release;
  expect(Object.keys(pages.resourceLedger.owners)).toEqual([]);
});

it('retains unknown finish settlement after a foreign completion control', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-point-finish-'));
  temporary.push(directory);
  const path = join(directory, 'guard.sock');
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
    socket.on('data', () =>
      socket.write(
        JSON.stringify({ control: 'finish', contractHash: 'foreign', summary: {} }) + '\n',
      ),
    );
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const { peer } = await Peer.connect(
      path,
      await open(join(directory, 'guard.jsonl'), 'wx'),
      () => true,
    );
    await expect(peer.finish()).rejects.toThrow('Foreign finish');
    expect(peer.settlementKnown).toBe(false);
    await expect(peer.close()).rejects.toThrow('settlement unproven');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('checks the absolute IO deadline after synchronous producer callbacks without timer delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'local-point-clock-'));
  temporary.push(directory);
  const path = join(directory, 'guard.sock');
  const received = vi.fn();
  const server = createServer((socket) => {
    socket.write(JSON.stringify({ control: 'ready', contractHash, principal: 'daemon' }) + '\n');
    socket.on('data', received);
    socket.on('end', () => socket.end());
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    const { peer } = await Peer.connect(
      path,
      await open(join(directory, 'guard.jsonl'), 'wx'),
      () => true,
    );
    let time = performance.now();
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
    try {
      await expect(
        peer.request('note.operation.commit', {}, () => {
          time += 30001;
          return true;
        }),
      ).rejects.toThrow('admission');
      expect(received).not.toHaveBeenCalled();
      expect(peer.settlementKnown).toBe(true);
    } finally {
      clock.mockRestore();
      await peer.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each([false, true])(
  'holds genuine local native DATA and cleans setup failure=%s',
  async (refuseContext) => {
    // Original recorded clock/source only; this is not a linked Services capture.
    vi.spyOn(Date, 'now').mockReturnValue(recordedAb.capturedAtMs);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const calls = recordedAb.calls as unknown as Array<{
      request: NotePageRequest;
      response: NoteReadPage;
    }>;
    const identity = calls[0].response;
    if (identity.kind !== 'noteSourcePage') throw new Error('Missing recorded source');
    const reader = new NotePageReader(async (_method, params) => {
      const q = params.page as NotePageRequest;
      const found = calls.find(
        ({ request: r }) =>
          r.kind === q.kind &&
          r.cursor === q.cursor &&
          r.maxItems === q.maxItems &&
          r.maxWireBytes === q.maxWireBytes &&
          ('contextRef' in q
            ? 'contextRef' in r && r.contextRef === q.contextRef
            : 'ref' in q
              ? 'ref' in r && r.ref === q.ref
              : q.kind === 'source' &&
                r.kind === 'source' &&
                r.at === q.at &&
                r.maxSourceBytes === q.maxSourceBytes),
      );
      if (!found) throw new Error('Uncaptured request');
      return found.response;
    });
    const readPage = (q: NotePageRequest) =>
      reader.read(identity.scope.workspaceId, identity.scope.noteId, q);
    const window = await readNoteWindow(readPage, { ...identity, at: 0 });
    const ws = identity.scope.workspaceId,
      id = identity.scope.noteId;
    let pages = a.notePagesReducer(undefined, a.pagePanelOpened(ws, id, 'panel'));
    const listeners = new Set<() => void>();
    const channel = stdChannel();
    const dispatch = (action: Parameters<typeof a.notePagesReducer>[1]) => {
      pages = a.notePagesReducer(pages, action);
      for (const fn of listeners) fn();
      channel.put(action);
    };
    dispatch(
      a.pageResourceLimitsConfigured({
        payloadBytes: 100000000,
        stringUnits: 100000000,
        objectNodes: 100000000,
        domNodes: 10000,
        physicalReads: 16,
        assemblies: 16,
      }),
    );
    // Synthetic client-state initialization for this isolated borrower guard only.
    dispatch(
      a.pageStateReceived(ws, id, 0, {
        kind: 'notePageState',
        scope: identity.scope,
        stateGeneration: '1',
        sourceRevision: identity.sourceRevision,
        attributionGeneration: '1',
        attributionState: 'ready',
        commentRevision: '1',
        deleted: false,
        invalidation: 'all',
      }),
    );
    dispatch(a.pageWindowRequested(ws, id, 'panel', 0));
    const note = () => pages.byWorkspaceId[ws].notes[id];
    const seed = { owner: 'hold-seed', data: 'hold-data', control: 'hold-control' };
    dispatch(a.pageResourcesRequested(seed.owner, noteAssemblyResources(seed), 12));
    dispatch(
      a.pageWindowSettled(
        ws,
        id,
        'panel',
        note().generation,
        note().windows.panel.request,
        window,
        null,
        { sponsor: seed.owner, resource: seed.data, owner: 'hold-window' },
      ),
    );
    dispatch(a.pageResourcesReleased(seed.owner));
    dispatch(
      a.pageDocumentSelectionChanged(ws, id, note().generation, note().document!, {
        anchor: 1,
        head: 1,
        anchorAffinity: 1,
        headAffinity: 1,
      }),
    );
    const port = {
      read: () => pages,
      dispatch,
      subscribe(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    appClient.notes.pages = new MockNotePagesClient({
      capabilities: { backendId: identity.scope.backendId, annotations: false },
      read: (_w, _n, q) => {
        if (refuseContext) return Promise.reject(new Error('Controlled context read failure'));
        return readPage(q);
      },
    });
    let saga: ReturnType<typeof runSaga> | undefined;
    let offer: ReturnType<typeof prepareNoteLocalPointViewEditing> | undefined;
    let view: NoteWindowView | undefined;
    let dependent: (() => void) | undefined;
    const capabilities = vi.spyOn(appClient.notes.pages, 'capabilities');
    try {
      saga = runSaga({ channel, dispatch, getState: () => ({ notePages: pages }) }, notePagesSaga);
      offer = prepareNoteLocalPointViewEditing([port, window, 'panel', undefined, Date.now]);
      if (refuseContext) {
        await expect(offer.ready).rejects.toThrow();
        expect(capabilities).not.toHaveBeenCalled();
        expect(note().document?.history).toHaveLength(0);
        return;
      }
      const editing = await offer.ready;
      const host = document.createElement('div');
      document.body.append(host);
      view = new NoteWindowView(host, {
        workspace: { id: ws } as Workspace,
        editing,
        seek: vi.fn(),
        fullOperation: vi.fn(),
        selectionChanged(selection) {
          const n = note();
          if (n.document)
            dispatch(a.pageDocumentSelectionChanged(ws, id, n.generation, n.document, selection));
        },
      });

      expect(capabilities).not.toHaveBeenCalled();
      expect(view.show(window)).toBe(true);
      const editor = view.editor!;
      expect(editor.chain().insertContent('X').insertPointAnchor(pointId).run()).toBe(true);
      expect(note().document?.history.at(-1)?.kind).toBe('local-point');
      dependent = offer.retain();
      const heldOwners = Object.keys(pages.resourceLedger.owners).filter((key) =>
        key.startsWith('local-point:'),
      );
      expect(heldOwners).toHaveLength(1);
      offer.retire();
      view.destroy();
      let settled = false;
      const release = Promise.resolve(offer.release()).then(() => {
        settled = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      for (const key of heldOwners) expect(pages.resourceLedger.owners[key]).toBeDefined();
      dependent();
      dependent = undefined;
      await release;
      expect(settled).toBe(true);
      for (const key of heldOwners) expect(pages.resourceLedger.owners[key]).toBeUndefined();
      expect(note().document?.history.at(-1)?.kind).toBe('local-point');
    } finally {
      dependent?.();
      view?.destroy();
      await offer?.release();
      saga?.cancel();
      await saga?.toPromise();
    }
  },
);
