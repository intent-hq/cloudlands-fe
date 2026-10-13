import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotePageReader } from '$lib/client/note-page-reader';
import type { NotePageRequest } from '$lib/client/note-pages';
import { resolveCapturedMermaidSource } from './canonical-source-replay';

const directory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/canonical-source');
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const nativeOracles = JSON.parse(
  readFileSync(join(directory, 'note_primitive_native.json'), 'utf8'),
);
const captureTime = Date.parse(manifest.startedAt);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const normalize = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(),
    ),
  );

function replay(
  capture: any,
  calls = capture.calls,
  selected = capture.sources.find((s: any) => s.header.primitive === 'mermaid'),
) {
  const requests: NotePageRequest[] = [];
  const reader = new NotePageReader(async (_method, params) => {
    const request = params.page as NotePageRequest;
    requests.push(request);
    const entry = calls.find((call: any) => normalize(call.request) === normalize(request));
    if (!entry) throw new Error('Uncaptured Store request: ' + JSON.stringify(request));
    return entry.response;
  });
  const identity = calls[0].response;
  return {
    selected,
    requests,
    resolve: () =>
      resolveCapturedMermaidSource(
        {
          scope: identity.scope,
          snapshotId: identity.snapshotId,
          sourceRevision: identity.sourceRevision,
          expiresAt: identity.expiresAt,
          ownerRef: selected.header.source.ownerRef,
          nativeId: selected.node.id,
        },
        (q) => reader.read(identity.scope.workspaceId, identity.scope.noteId, q),
        {
          signal: new AbortController().signal,
          isCurrent: () => true,
          // Historical replay clock only: this does not renew or authenticate a grant.
          now: () => captureTime,
        },
      ),
  };
}

it.each(Object.entries(manifest.artifacts))(
  'replays exact real Store predecoder source %s',
  async (file, evidence: any) => {
    const bytes = readFileSync(join(directory, file));
    expect(hash(bytes)).toBe(evidence.sha256);
    const capture = JSON.parse(bytes.toString('utf8'));
    const oracle = nativeOracles
      .flatMap((group: any) => group.cases)
      .find((c: any) => c.id === capture.caseId);
    expect(capture.source).toBe(oracle.source);
    const expected = oracle.atoms.find((atom: any) => atom.type === 'mermaidBlock').code;
    const r = replay(capture);
    const source = await r.resolve();
    expect(source.binding.sourceRef).toBe(r.selected.codeField.valueRef);
    expect(source.binding.sourceRef).toBe(r.selected.header.source.sourceRef);
    expect(source.binding.ownerRef).toBe(r.selected.node.nativeRef);
    expect(source.binding.attributesRef).toBe(r.selected.node.attributesRef);
    let offset = 0;
    for await (const text of source.fragments()) {
      // Compare each untouched fragment at its native effective-code offset; the
      // resolver never concatenates, trims, decodes or reconstructs a fence body.
      expect(text).toBe(expected.slice(offset, offset + text.length));
      offset += text.length;
    }
    expect(offset).toBe(expected.length);
    expect(source.inspect().sourceBytes).toBe(evidence.codeUtf8Bytes);
    expect(r.requests).toHaveLength(4);
    expect(r.requests.every((q) => q.kind === 'context' || q.kind === 'metadata')).toBe(true);
    expect(source.binding.evidence).toBe('captured-source-binding-only');
  },
);

it('keeps actual internal grant invalidations separate from page response replay', async () => {
  const capture = JSON.parse(
    readFileSync(join(directory, 'mermaid-adjacentHtmlPlainWithoutArrow.json'), 'utf8'),
  );
  expect(capture.internalInvalidationChecks.map((c: any) => c.mutation)).toEqual([
    'metadata-title',
    'canonical-code-value',
    'delete-recreate-same-note-id',
  ]);
  for (const check of capture.internalInvalidationChecks) {
    expect(check.oldGrant.header.primitive).toBe('mermaid');
    expect(check.oldRead.internalStoreError).toBe('NotePage(Stale)');
    expect(check.oldGrant.internalStoreError).toBe('NotePage(Stale)');
    expect(check.oldRead).not.toHaveProperty('response');
    if (check.mutation === 'delete-recreate-same-note-id') {
      expect(check.newSourcePage.scope.noteInstanceId).not.toBe(
        capture.calls[0].response.scope.noteInstanceId,
      );
      continue; // This capture contains the new source page, not a new resource closure.
    }
    // Retained Store errors are not invented JSON-RPC frames or runtime grants.
    const selected = check.sources.find((s: any) => s.header.primitive === 'mermaid');
    const r = replay(capture, check.calls, selected);
    const source = await r.resolve();
    let offset = 0;
    for await (const text of source.fragments()) {
      expect(text).toBe(selected.code.slice(offset, offset + text.length));
      offset += text.length;
    }
    expect(offset).toBe(selected.code.length);
    expect(source.binding.snapshotId).not.toBe(capture.sources[1].header.source.snapshotId);
    expect(source.binding.sourceRevision).not.toBe(capture.sources[1].header.source.sourceRevision);
  }
});
