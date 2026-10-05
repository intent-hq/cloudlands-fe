import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { consumeCanonicalSource } from './canonical-source-consumer';
import type {
  PreparedSourceIdentity,
  PreparedSourceRelease,
  PreparedSourceSession,
} from '../../shared/source-session-ipc';

// Immutable real Store pages inside a CONTROLLED local facade. Historical clock
// and fixture identity do not authenticate a new session or exercise Electron IPC.
const directory = resolve(
  import.meta.dirname,
  '../../features/notes/virtualized/primitives/mermaid/__tests__/fixtures/canonical-source/',
);
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const oracles = JSON.parse(readFileSync(resolve(directory, 'note_primitive_native.json'), 'utf8'));
const normalized = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(),
    ),
  );

it.each(Object.entries(manifest.artifacts))(
  'streams original Store/native predecoder witness %s',
  async (name, evidence: any) => {
    const bytes = readFileSync(resolve(directory, name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.sha256);
    const capture = JSON.parse(bytes.toString('utf8'));
    const native = oracles
      .flatMap((group: any) => group.cases)
      .find((item: any) => item.id === capture.caseId);
    expect(capture.source).toBe(native.source);
    for (const source of capture.sources) {
      const first = capture.calls[0].response;
      const stamp = {
        ownerId: `replay-${source.header.primitive}`,
        daemonIncarnation: 'historical-local-control',
        connectionEpoch: '1',
        navigationGeneration: 1,
        documentGeneration: 1,
      };
      const identity: PreparedSourceIdentity = {
        ...stamp,
        binding: {
          scope: first.scope,
          snapshotId: first.snapshotId,
          sourceRevision: first.sourceRevision,
          primitive: source.header.primitive,
          nativeId: source.node.id,
          ownerRef: source.header.source.ownerRef,
          sourceRef: source.header.source.sourceRef,
          sourceExpiresAt: first.expiresAt,
        },
      };
      let active = true,
        held = false,
        calls = 0,
        releases = 0;
      const session: PreparedSourceSession = {
        identity,
        current: () => active,
        cancel: () => {
          active = false;
        },
        async read(request) {
          expect(held).toBe(false);
          held = true;
          const sequence = calls++;
          const entry = capture.calls.find(
            (call: any) => normalized(call.request) === normalized(request),
          );
          if (!entry) throw new Error('Uncaptured Store request: ' + JSON.stringify(request));
          let release: Promise<PreparedSourceRelease> | undefined;
          return {
            identity,
            sequence,
            page: entry.response,
            current: () => active && !release,
            release(disposition) {
              if (!release) {
                releases++;
                held = false;
                release = Promise.resolve({ ...stamp, kind: 'released', sequence, disposition });
              }
              return release;
            },
          };
        },
      };
      const expected = native.atoms.find(
        (atom: any) => atom.type === `${source.header.primitive}Block`,
      ).code;
      expect(source.code).toBe(expected);
      let offset = 0;
      const result = await consumeCanonicalSource(
        session,
        (fragment) => {
          expect(fragment.offset).toBe(offset);
          expect(fragment.text).toBe(expected.slice(offset, offset + fragment.text.length));
          offset += fragment.text.length;
        },
        {
          signal: new AbortController().signal,
          isCurrent: () => true,
          now: () => Date.parse(manifest.startedAt),
        },
      );
      expect(offset).toBe(expected.length);
      expect(result.utf16Length).toBe(expected.length);
      expect(result.kind).toBe('sourceTraversed');
      expect(calls).toBe(4);
      expect(releases).toBe(calls);
      expect(held).toBe(false);
      expect(active).toBe(false);
    }
  },
);
