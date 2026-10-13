import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NoteReadPage } from '$lib/client/note-pages';
import { resolveCapturedMermaidSource } from './canonical-source-replay';

// Synthetic transport controls only. The exact effective strings below come from
// frozen 2797061/e6d6bb999 native entry oracles; tokens are NOT Store authority.
function fixture(parts: string[]) {
  const identity = {
    scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
    snapshotId: 'snapshot',
    sourceRevision: 'revision',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const owner = { ...identity, ownerRef: 'owner-ref', nativeId: 'native-id' };
  const pages: Record<string, NoteReadPage> = {
    'owner-ref': {
      ...identity,
      kind: 'noteContextPage',
      nextCursor: null,
      items: [
        {
          kind: 'nativeNode',
          id: 'native-id',
          profile: 'canonicalNote',
          profileVersion: 1,
          nodeType: 'mermaidBlock',
          nodeClass: 'atom',
          parentRef: 'doc-ref',
          childIndex: 0,
          sourceRange: { start: 0, end: 100 },
          provenance: 'explicit',
          attributesRef: 'attrs-ref',
        },
      ],
    },
    'attrs-ref': {
      ...identity,
      kind: 'noteMetadataPage',
      nextCursor: null,
      items: [{ id: 'attrs', parentId: null, type: 'object', childrenRef: 'fields-ref' }],
    },
    'fields-ref': {
      ...identity,
      kind: 'noteMetadataPage',
      nextCursor: null,
      items: [{ id: 'code', parentId: 'attrs', key: 'code', type: 'string', valueRef: 'value-0' }],
    },
  };
  let offset = 0;
  for (const [index, text] of parts.entries()) {
    const next = index + 1 < parts.length ? `value-${index + 1}` : null;
    pages[`value-${index}`] = {
      ...identity,
      kind: 'noteContextPage',
      nextCursor: next ? `cursor-${index}` : null,
      items: [{ kind: 'fragment', id: 'code-value', field: 'value', offset, text, nextRef: next }],
    };
    offset += text.length;
  }
  const calls: string[] = [];
  const controller = new AbortController();
  let current = true;
  const reader = new NotePageReader(async (_method, params) => {
    const q = params.page as { contextRef?: string; ref?: string };
    const ref = q.contextRef ?? q.ref!;
    calls.push(ref);
    if (!pages[ref]) throw new Error('Uncaptured synthetic resource');
    return pages[ref];
  });
  return {
    pages,
    calls,
    controller,
    invalidate: () => {
      current = false;
    },
    resolve: () =>
      resolveCapturedMermaidSource(owner, (q) => reader.read('w', 'n', q), {
        signal: controller.signal,
        isCurrent: () => current,
        now: () => 0,
      }),
  };
}

async function collect(stream: AsyncIterable<string>) {
  const parts: string[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

it.each([
  ['plain', 'graph TD\n A[Alpha]'],
  ['titled', 'flowchart LR\n A["café & 世界"] --> B'],
  ['base64', 'Zmxvd2NoYXJ0IExSCiBBWyJjYWbDqSAmIOS4lueVjCJdIC0tPiBCCg=='],
  ['sanitized-empty', ''],
])('retains the exact %s predecoder field and real binding shape', async (_name, code) => {
  const f = fixture([code]);
  const source = await f.resolve();
  expect(source.binding.sourceRef).toBe('value-0');
  expect(source.binding.ownerRef).toBe('owner-ref');
  expect(source.binding.evidence).toBe('captured-source-binding-only');
  expect(await collect(source.fragments())).toEqual([code]);
  expect(f.calls).toEqual(['owner-ref', 'attrs-ref', 'fields-ref', 'value-0']);
  await expect(collect(source.fragments())).rejects.toThrow('already opened');
});

it('streams scalar-safe fragments once through nextRef, preserving exact offsets', async () => {
  const f = fixture(['graph TD\n A[', '😀 café 世界', ']']);
  const source = await f.resolve();
  expect(await collect(source.fragments())).toEqual(['graph TD\n A[', '😀 café 世界', ']']);
  expect(source.inspect().requests).toBe(6);
  expect(f.calls.filter((ref) => ref.startsWith('cursor'))).toEqual([]);
});

it('rejects a foreign atom, wrong attribute parent and missing code handle', async () => {
  for (const mutation of ['atom', 'parent', 'handle']) {
    const f = fixture(['graph TD']);
    const node = (f.pages['owner-ref'] as any).items[0];
    const field = (f.pages['fields-ref'] as any).items[0];
    if (mutation === 'atom') node.nodeType = 'diffBlock';
    if (mutation === 'parent') field.parentId = 'another-atom';
    if (mutation === 'handle') {
      delete field.valueRef;
      field.value = 'graph TD';
    }
    await expect(f.resolve()).rejects.toThrow();
    expect(f.calls).not.toContain('value-0');
  }
});

it('rejects mixed snapshot/code revision or a fragment gap before yielding that fragment', async () => {
  for (const mutation of ['snapshotId', 'sourceRevision', 'offset']) {
    const f = fixture(['first', 'second']);
    const page = f.pages['value-1'] as any;
    if (mutation === 'offset') page.items[0].offset++;
    else page[mutation] = 'other';
    const source = await f.resolve();
    const stream = source.fragments();
    expect((await stream.next()).value).toBe('first');
    await expect(stream.next()).rejects.toThrow();
  }
});

it('checks invalidation and cancellation before the next resource read', async () => {
  for (const abort of [false, true]) {
    const f = fixture(['first', 'second']);
    const source = await f.resolve();
    const stream = source.fragments();
    await stream.next();
    if (abort) f.controller.abort();
    else f.invalidate();
    await expect(stream.next()).rejects.toThrow();
    expect(f.calls).not.toContain('value-1');
  }
});
