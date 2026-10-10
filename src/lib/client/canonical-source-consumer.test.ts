import { describe, expect, it } from 'vitest';
import { consumeCanonicalSource } from './canonical-source-consumer';
import { NotePageReader } from './note-page-reader';
import type {
  PreparedSourceDelivery,
  PreparedSourceIdentity,
  PreparedSourceRead,
  PreparedSourceRelease,
  PreparedSourceSession,
} from '../../shared/source-session-ipc';

// Controlled local facade only. These tests do not execute Electron IPC, authenticate
// a caller, or prove main/daemon transport retirement. Native/Store captures are separate.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('Controlled continuation did not reach its checkpoint');
}
function fixture(
  parts = ['graph LR; A[🙂]-->B', '\n'],
  expiresAt = '2099-01-01T00:00:00.000000001Z',
) {
  const stamp = {
    ownerId: 'local-owner',
    daemonIncarnation: 'root',
    connectionEpoch: '1',
    navigationGeneration: 1,
    documentGeneration: 1,
  };
  const identity: PreparedSourceIdentity = {
    ...stamp,
    binding: {
      scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
      snapshotId: 'snapshot',
      sourceRevision: 'revision',
      primitive: 'mermaid',
      nativeId: 'atom',
      ownerRef: 'owner',
      sourceRef: 'value0',
      sourceExpiresAt: expiresAt,
    },
  };
  const controller = new AbortController();
  const calls: PreparedSourceRead[] = [];
  const releases: Array<{ index: number; disposition: string }> = [];
  let active = true,
    generation = true,
    held = false,
    maxHeld = 0,
    cancels = 0;
  let now = 0,
    offset = 0;
  const knobs: {
    readIndex?: number;
    readGate?: ReturnType<typeof deferred>;
    releaseIndex?: number;
    releaseGate?: ReturnType<typeof deferred>;
    mutate?: (page: any, index: number) => void;
    delivery?: (identity: PreparedSourceIdentity, index: number) => PreparedSourceIdentity;
    sequence?: (index: number) => number;
    ack?: (ack: PreparedSourceRelease) => PreparedSourceRelease;
  } = {};
  const session: PreparedSourceSession = {
    identity,
    current: () => active,
    cancel: () => {
      active = false;
      cancels++;
    },
    async read(request) {
      if (held) throw new Error('One controlled delivery already owned');
      held = true;
      maxHeld = Math.max(maxHeld, Number(held));
      const index = calls.length;
      calls.push(request);
      if (index === knobs.readIndex) await knobs.readGate!.promise;
      const common = {
        scope: identity.binding.scope,
        snapshotId: identity.binding.snapshotId,
        sourceRevision: identity.binding.sourceRevision,
        expiresAt: identity.binding.sourceExpiresAt,
        nextCursor: null,
      };
      let value: any;
      if (index === 0)
        value = {
          ...common,
          kind: 'noteContextPage',
          items: [
            {
              kind: 'nativeNode',
              id: 'atom',
              nativeRef: 'owner',
              nodeType: 'mermaidBlock',
              nodeClass: 'atom',
              profile: 'canonicalNote',
              profileVersion: 1,
              parentRef: 'doc',
              childIndex: 0,
              sourceRange: { start: 0, end: 2 },
              provenance: 'explicit',
              attributesRef: 'attributes',
            },
          ],
        };
      else if (index === 1)
        value = {
          ...common,
          kind: 'noteMetadataPage',
          items: [{ id: 'attrs', parentId: null, type: 'object', childrenRef: 'fields' }],
        };
      else if (index === 2)
        value = {
          ...common,
          kind: 'noteMetadataPage',
          items: [
            { id: 'code', parentId: 'attrs', key: 'code', type: 'string', valueRef: 'value0' },
          ],
        };
      else {
        const n = index - 3;
        if (n >= parts.length) throw new Error('Reader exceeded complete source');
        const next = n + 1 < parts.length ? `value${n + 1}` : null;
        value = {
          ...common,
          kind: 'noteContextPage',
          nextCursor: next ? `cursor${n}` : null,
          items: [
            {
              kind: 'fragment',
              id: 'value',
              field: 'value',
              offset,
              text: parts[n],
              nextRef: next,
            },
          ],
        };
        offset += parts[n].length;
      }
      knobs.mutate?.(value, index);
      let released = false,
        ack: Promise<PreparedSourceRelease> | undefined;
      return {
        identity: knobs.delivery?.(identity, index) ?? identity,
        sequence: knobs.sequence?.(index) ?? index,
        page: value,
        current: () => active && !released,
        release(disposition) {
          if (ack) return ack;
          released = true;
          releases.push({ index, disposition });
          ack = (async () => {
            if (index === knobs.releaseIndex) await knobs.releaseGate!.promise;
            const result: PreparedSourceRelease = {
              ...stamp,
              kind: 'released',
              sequence: index,
              disposition,
            };
            held = false;
            return knobs.ack?.(result) ?? result;
          })();
          return ack;
        },
      } satisfies PreparedSourceDelivery;
    },
  };
  return {
    session,
    stamp,
    knobs,
    calls,
    releases,
    controller,
    lifetime: { signal: controller.signal, isCurrent: () => generation, now: () => now },
    inspect: () => ({ held, maxHeld, cancels }),
    replace: () => {
      generation = false;
      controller.abort();
    },
    now: (value: number) => {
      now = value;
    },
  };
}

it.each([[''], ['raw 🙂\n'], ['Z3JhcGggTFI7IEEtLT5C'], ['titled raw π']])(
  'consumes exact predecoder fragments %j without source reconstruction',
  async (text) => {
    const f = fixture([text]);
    let calls = 0;
    const result = await consumeCanonicalSource(
      f.session,
      (part) => {
        expect(part).toEqual({ text, offset: 0 });
        calls++;
      },
      f.lifetime,
    );
    expect(calls).toBe(1);
    expect(result).toEqual({
      kind: 'sourceTraversed',
      fragments: 1,
      utf16Length: text.length,
      lastRelease: { ...f.stamp, kind: 'released', sequence: 3, disposition: 'consume' },
    });
    expect(result).not.toHaveProperty('settled');
    expect(f.inspect()).toEqual({ held: false, maxHeld: 1, cancels: 1 });
    expect(f.calls).toEqual([
      { kind: 'context', contextRef: 'owner', maxItems: 1, maxWireBytes: 8192 },
      { kind: 'metadata', ref: 'attributes', maxItems: 1, maxWireBytes: 8192 },
      { kind: 'metadata', ref: 'fields', maxItems: 1, maxWireBytes: 8192 },
      { kind: 'context', contextRef: 'value0', maxItems: 1, maxWireBytes: 8192 },
    ]);
  },
);

it('streams beyond old replay limits with one page and no joined result', async () => {
  const text = 'π🙂'.repeat(400);
  const f = fixture(Array(300).fill(text)); // Test oracle only, not consumer storage.
  let seen = 0;
  const result = await consumeCanonicalSource(
    f.session,
    (part) => {
      expect(part.text).toBe(text);
      expect(part.offset).toBe(seen * text.length);
      seen++;
    },
    f.lifetime,
  );
  expect(result.utf16Length).toBe(300 * text.length);
  expect(result.fragments).toBe(300);
  expect(f.calls).toHaveLength(303);
  expect(f.inspect().maxHeld).toBe(1);
  expect(result).not.toHaveProperty('text');
});

it('stops at authorized code even when further metadata exists', async () => {
  const f = fixture(['x']);
  f.knobs.mutate = (page, index) => {
    if (index === 2) page.nextCursor = 'unrelated-field';
  };
  await consumeCanonicalSource(f.session, () => {}, f.lifetime);
  expect(f.calls[3]).toEqual({
    kind: 'context',
    contextRef: 'value0',
    maxItems: 1,
    maxWireBytes: 8192,
  });
});

it('holds the page until an aborted asynchronous sink actually settles', async () => {
  const f = fixture();
  const gate = deferred();
  let started = false,
    signal!: AbortSignal;
  const result = consumeCanonicalSource(
    f.session,
    async (_part, s) => {
      started = true;
      signal = s;
      await gate.promise;
    },
    f.lifetime,
  );
  const failure = expect(result).rejects.toThrow();
  await until(() => started);
  f.replace();
  expect(signal.aborted).toBe(true);
  expect(f.inspect().held).toBe(true);
  expect(f.calls).toHaveLength(4);
  expect(f.releases).toHaveLength(3);
  gate.resolve();
  await failure;
  expect(f.releases.at(-1)).toEqual({ index: 3, disposition: 'discard' });
  expect(f.inspect().held).toBe(false);
});

it('discards a late held-read result after document replacement without adopting it', async () => {
  const f = fixture();
  f.knobs.readIndex = 3;
  f.knobs.readGate = deferred();
  let adopted = 0;
  const result = consumeCanonicalSource(
    f.session,
    () => {
      adopted++;
    },
    f.lifetime,
  );
  const failure = expect(result).rejects.toThrow();
  await until(() => f.calls.length === 4);
  f.replace();
  expect(f.inspect().held).toBe(true);
  f.knobs.readGate.resolve();
  await failure;
  expect(adopted).toBe(0);
  expect(f.releases.at(-1)?.disposition).toBe('discard');
});

it('does not request another page before local release ACK or retry an ambiguous ACK', async () => {
  const f = fixture();
  f.knobs.releaseIndex = 3;
  f.knobs.releaseGate = deferred();
  const result = consumeCanonicalSource(f.session, () => {}, f.lifetime);
  const failure = expect(result).rejects.toThrow('lost acknowledgement');
  await until(() => f.releases.length === 4);
  expect(f.calls).toHaveLength(4);
  f.knobs.releaseGate.reject(new Error('lost acknowledgement'));
  await failure;
  expect(f.releases.filter((r) => r.index === 3)).toHaveLength(1);
  expect(f.inspect().held).toBe(true); // Controlled unresolved ownership, not a refund.
  expect(f.session.current()).toBe(false);
});

it('checks exact nanosecond expiry and raw timestamp identity', async () => {
  const f = fixture(['x']);
  f.now(Date.parse('2099-01-01T00:00:00Z'));
  await consumeCanonicalSource(f.session, () => {}, f.lifetime); // One ns remains.
  const expired = fixture(['x']);
  expired.now(Date.parse('2099-01-01T00:00:00Z') + 1);
  await expect(consumeCanonicalSource(expired.session, () => {}, expired.lifetime)).rejects.toThrow(
    'no longer current',
  );
  expect(expired.calls).toHaveLength(0);
  const normalized = fixture(['x']);
  normalized.knobs.mutate = (page) => {
    page.expiresAt = '2099-01-01T00:00:00.000000001+00:00';
  };
  await expect(
    consumeCanonicalSource(normalized.session, () => {}, normalized.lifetime),
  ).rejects.toThrow('Mismatched');
});

it.each(['2099-01-31T23:59:60Z', '2099-01-01x00:00:00.000000001-00:00'])(
  'uses the shared daemon expiry grammar through complete canonical traversal: %s',
  async (expiry) => {
    const f = fixture(['exact 🙂'], expiry);
    let seen = false;
    const result = await consumeCanonicalSource(
      f.session,
      (fragment) => {
        expect(fragment.text).toBe('exact 🙂');
        seen = true;
      },
      f.lifetime,
    );
    expect(seen).toBe(true);
    expect(result.kind).toBe('sourceTraversed');
    expect(f.calls).toHaveLength(4);
    expect(f.releases.every((release) => release.disposition === 'consume')).toBe(true);
  },
);

it.each(['2099-02-30T00:00:00Z', '2099-01-30T23:59:60Z'])(
  'rejects malformed canonical expiry before reads: %s',
  async (expiry) => {
    const f = fixture(['x'], expiry);
    await expect(consumeCanonicalSource(f.session, () => {}, f.lifetime)).rejects.toThrow(
      'Invalid artifact deadline',
    );
    expect(f.calls).toHaveLength(0);
    expect(f.session.current()).toBe(false);
  },
);

it('rejects malformed page expiry and retains generic legacy reader grammar', async () => {
  const malformed = fixture(['x']);
  malformed.knobs.mutate = (page) => {
    page.expiresAt = '2099-02-30T00:00:00Z';
  };
  await expect(
    consumeCanonicalSource(malformed.session, () => {}, malformed.lifetime),
  ).rejects.toThrow('Invalid note snapshot');
  expect(malformed.releases).toEqual([{ index: 0, disposition: 'discard' }]);
  const legacy = fixture(['x'], '2099-01-31T23:59:60Z');
  const request = {
    kind: 'context',
    contextRef: 'owner',
    maxItems: 1,
    maxWireBytes: 8192,
  } as const;
  const delivery = await legacy.session.read(request);
  await expect(
    new NotePageReader(async () => delivery.page).read('w', 'n', request),
  ).rejects.toThrow('Invalid note snapshot');
  await delivery.release('discard');
  legacy.session.cancel();
});

describe('semantic failures discard their owned page and stop traversal', () => {
  it.each([
    [
      'foreign snapshot',
      0,
      (p: any) => {
        p.snapshotId = 'another';
      },
    ],
    [
      'foreign nativeRef',
      0,
      (p: any) => {
        p.items[0].nativeRef = 'other';
      },
    ],
    [
      'wrong primitive',
      0,
      (p: any) => {
        p.items[0].nodeType = 'diffBlock';
      },
    ],
    [
      'root parent',
      1,
      (p: any) => {
        p.items[0].parentId = 'foreign';
      },
    ],
    [
      'field parent',
      2,
      (p: any) => {
        p.items[0].parentId = 'foreign';
      },
    ],
    [
      'forged value',
      2,
      (p: any) => {
        p.items[0].valueRef = 'other';
      },
    ],
    [
      'inline only code',
      2,
      (p: any) => {
        delete p.items[0].valueRef;
        p.items[0].value = '';
      },
    ],
    [
      'offset gap',
      3,
      (p: any) => {
        p.items[0].offset = 1;
      },
    ],
    [
      'broken scalar',
      3,
      (p: any) => {
        p.items[0].text = '\ud800';
      },
    ],
    [
      'self continuation',
      3,
      (p: any) => {
        p.items[0].nextRef = 'value0';
      },
    ],
    [
      'missing cursor',
      3,
      (p: any) => {
        p.nextCursor = null;
      },
    ],
  ] as const)('%s', async (_label, at, mutate) => {
    const f = fixture();
    f.knobs.mutate = (p, index) => {
      if (index === at) mutate(p);
    };
    await expect(consumeCanonicalSource(f.session, () => {}, f.lifetime)).rejects.toThrow();
    expect(f.calls).toHaveLength(at + 1);
    expect(f.releases.at(-1)).toEqual({ index: at, disposition: 'discard' });
    expect(f.session.current()).toBe(false);
  });
});

it.each(['owner', 'generation', 'sequence'] as const)(
  'never releases a foreign/stale %s delivery',
  async (kind) => {
    const f = fixture();
    if (kind === 'sequence') f.knobs.sequence = () => 1;
    else
      f.knobs.delivery = (id) => ({
        ...id,
        ...(kind === 'owner' ? { ownerId: 'foreign' } : { documentGeneration: 2 }),
      });
    await expect(consumeCanonicalSource(f.session, () => {}, f.lifetime)).rejects.toThrow(
      'Foreign or reordered',
    );
    expect(f.releases).toHaveLength(0);
    expect(f.inspect().held).toBe(true);
    expect(f.session.current()).toBe(false);
  },
);

it.each(['ownerId', 'sequence', 'disposition', 'connectionEpoch', 'documentGeneration'] as const)(
  'rejects mismatched release ACK %s without retiring successor',
  async (key) => {
    const f = fixture();
    f.knobs.ack = (ack) => ({ ...ack, [key]: key === 'sequence' ? 9 : 'foreign' });
    await expect(consumeCanonicalSource(f.session, () => {}, f.lifetime)).rejects.toThrow(
      'release acknowledgement',
    );
    expect(f.calls).toHaveLength(1);
    expect(f.releases).toHaveLength(1);
  },
);
