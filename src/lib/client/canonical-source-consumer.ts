import type {
  PreparedSourceDelivery,
  PreparedSourceIdentity,
  PreparedSourceRead,
  PreparedSourceRelease,
  PreparedSourceSession,
  PreparedSourceStamp,
} from '../../shared/source-session-ipc';
import { beforeSourceDeadline, parseSourceDeadline } from '../../shared/source-session-expiry';
import { validateCanonicalSourcePage } from './note-page-reader';
import type { NoteReadPage } from './note-pages';

type SourcePage = Extract<NoteReadPage, { kind: 'noteContextPage' | 'noteMetadataPage' }>;
export interface CanonicalSourceLifetime {
  readonly signal: AbortSignal;
  /** Captured document/view generation, never the mutable currently focused document. */
  isCurrent(): boolean;
  now(): number;
}
export interface CanonicalSourceFragment {
  readonly text: string;
  readonly offset: number;
}

function sameStamp(a: PreparedSourceStamp, b: PreparedSourceStamp): boolean {
  return (
    [
      'ownerId',
      'daemonIncarnation',
      'connectionEpoch',
      'navigationGeneration',
      'documentGeneration',
    ] as const
  ).every((key) => a[key] === b[key]);
}
function sameIdentity(a: PreparedSourceIdentity, b: PreparedSourceIdentity): boolean {
  return (
    sameStamp(a, b) &&
    [
      'snapshotId',
      'sourceRevision',
      'primitive',
      'nativeId',
      'ownerRef',
      'sourceRef',
      'sourceExpiresAt',
    ].every(
      (key) =>
        a.binding[key as keyof typeof a.binding] === b.binding[key as keyof typeof b.binding],
    ) &&
    (Object.keys(a.binding.scope) as Array<keyof typeof a.binding.scope>).every(
      (key) => a.binding.scope[key] === b.binding.scope[key],
    )
  );
}

/** Unregistered consumer of an explicitly supplied prepared session, not a grant issuer.
 * The sink borrows one fragment until its Promise settles, including after abort.
 * It must consume/discard that fragment before returning, not retain a source cache.
 * Completion proves traversal and local release acknowledgements only. Main owns
 * the independent transport/remote cleanup obligation after cancel, including EOF. */
export async function consumeCanonicalSource(
  session: PreparedSourceSession,
  sink: (fragment: CanonicalSourceFragment, signal: AbortSignal) => void | Promise<void>,
  lifetime: CanonicalSourceLifetime,
) {
  const identity: PreparedSourceIdentity = Object.freeze({
    ...session.identity,
    binding: Object.freeze({
      ...session.identity.binding,
      scope: Object.freeze({ ...session.identity.binding.scope }),
    }),
  });
  const binding = identity.binding;
  const controller = new AbortController();
  const cancel = () => {
    if (!controller.signal.aborted) {
      controller.abort();
      session.cancel();
    }
  };
  lifetime.signal.addEventListener('abort', cancel, { once: true });
  let sequence = 0;
  let deadline: bigint;
  let lastRelease: PreparedSourceRelease | undefined;
  function current() {
    lifetime.signal.throwIfAborted();
    controller.signal.throwIfAborted();
    if (
      !lifetime.isCurrent() ||
      !session.current() ||
      !sameIdentity(identity, session.identity) ||
      !beforeSourceDeadline(lifetime.now(), deadline)
    )
      throw new Error('Canonical source consumer is no longer current');
  }
  async function page(
    request: PreparedSourceRead,
    consume: (page: SourcePage) => void | Promise<void>,
  ) {
    current();
    if (!Number.isSafeInteger(sequence + 1)) throw new Error('Source delivery sequence exhausted');
    const delivery: PreparedSourceDelivery = await session.read(request);
    // Never release a foreign/stale wrapper: that could retire another owner's
    // successor. Cancel our own session and leave its cleanup with main instead.
    if (!sameIdentity(identity, delivery.identity) || delivery.sequence !== sequence)
      throw new Error('Foreign or reordered canonical source delivery');
    let disposition: 'consume' | 'discard' = 'discard';
    try {
      current();
      if (!delivery.current()) throw new Error('Canonical source delivery revoked');
      await consumeValidatedPage(delivery.page, request, consume);
      current();
      if (!delivery.current()) throw new Error('Canonical source delivery revoked');
      disposition = 'consume';
    } catch (error) {
      cancel();
      throw error;
    } finally {
      // consumeValidatedPage has settled; no consumer page reference survives in
      // this frame. A cancelled sink is drained before even a discard release.
      const ack = await delivery.release(disposition);
      if (
        ack.kind !== 'released' ||
        !sameStamp(ack, identity) ||
        ack.sequence !== sequence ||
        ack.disposition !== disposition
      )
        throw new Error('Mismatched canonical source release acknowledgement');
      lastRelease = Object.freeze({ ...ack });
    }
    current();
    sequence++;
  }
  async function consumeValidatedPage(
    value: unknown,
    request: PreparedSourceRead,
    consume: (page: SourcePage) => void | Promise<void>,
  ) {
    const response = validateCanonicalSourcePage(
      value,
      binding.scope.workspaceId,
      binding.scope.noteId,
      request,
    );
    if (
      (response.kind !== 'noteContextPage' && response.kind !== 'noteMetadataPage') ||
      response.snapshotId !== binding.snapshotId ||
      response.sourceRevision !== binding.sourceRevision ||
      response.expiresAt !== binding.sourceExpiresAt ||
      response.scope.backendId !== binding.scope.backendId ||
      response.scope.noteInstanceId !== binding.scope.noteInstanceId ||
      response.items.length !== 1
    )
      throw new Error('Mismatched canonical source page');
    await consume(response);
  }
  const context = (ref: string): PreparedSourceRead => ({
    kind: 'context',
    contextRef: ref,
    maxItems: 1,
    maxWireBytes: 8192,
  });
  const metadata = (ref: string, cursor?: string): PreparedSourceRead => ({
    kind: 'metadata',
    ref,
    ...(cursor === undefined ? {} : { cursor }),
    maxItems: 1,
    maxWireBytes: 8192,
  });
  try {
    deadline = parseSourceDeadline(binding.sourceExpiresAt);
    if (lifetime.signal.aborted) cancel();
    let attributesRef = '';
    await page(context(binding.ownerRef), (response) => {
      const atom = response.items[0];
      if (
        response.kind !== 'noteContextPage' ||
        !('kind' in atom) ||
        atom.kind !== 'nativeNode' ||
        atom.id !== binding.nativeId ||
        !('nativeRef' in atom) ||
        atom.nativeRef !== binding.ownerRef ||
        atom.nodeType !== `${binding.primitive}Block` ||
        atom.nodeClass !== 'atom' ||
        atom.profile !== 'canonicalNote' ||
        atom.profileVersion !== 1 ||
        response.nextCursor !== null
      )
        throw new Error('Invalid canonical primitive owner');
      attributesRef = atom.attributesRef;
    });
    let fieldsRef = '',
      attributesId = '';
    await page(metadata(attributesRef), (response) => {
      const root = response.items[0];
      if (
        response.kind !== 'noteMetadataPage' ||
        !('type' in root) ||
        root.type !== 'object' ||
        root.parentId !== null ||
        !root.childrenRef ||
        response.nextCursor !== null
      )
        throw new Error('Invalid canonical attributes root');
      fieldsRef = root.childrenRef;
      attributesId = root.id;
    });
    let found = false,
      cursor: string | undefined;
    while (!found) {
      await page(metadata(fieldsRef, cursor), (response) => {
        const field = response.items[0];
        if (
          response.kind !== 'noteMetadataPage' ||
          !('parentId' in field) ||
          field.parentId !== attributesId ||
          field.keyRef !== undefined ||
          typeof field.key !== 'string'
        )
          throw new Error('Invalid canonical attribute parent');
        if (field.key === 'code') {
          if (field.type !== 'string' || field.valueRef !== binding.sourceRef)
            throw new Error('Canonical code does not match the authorized valueRef');
          found = true; // Services advances here; do not drain unrelated attributes.
        } else {
          if (!response.nextCursor || response.nextCursor === cursor)
            throw new Error('Canonical code field missing or metadata stalled');
          cursor = response.nextCursor;
        }
      });
    }
    let next: string | null = binding.sourceRef;
    let offset = 0,
      fragments = 0;
    while (next !== null) {
      const ref = next;
      await page(context(ref), async (response) => {
        const fragment = response.items[0];
        if (
          response.kind !== 'noteContextPage' ||
          !('kind' in fragment) ||
          fragment.kind !== 'fragment' ||
          fragment.field !== 'value' ||
          fragment.offset !== offset ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            fragment.text,
          ) ||
          (response.nextCursor === null) !== (fragment.nextRef === null) ||
          (fragment.nextRef !== null && (!fragment.text || fragment.nextRef === ref)) ||
          !Number.isSafeInteger(offset + fragment.text.length) ||
          !Number.isSafeInteger(fragments + 1)
        )
          throw new Error('Invalid canonical code fragment');
        current();
        await sink(Object.freeze({ text: fragment.text, offset }), controller.signal);
        current();
        offset += fragment.text.length;
        fragments++;
        next = fragment.nextRef;
      });
    }
    current();
    return Object.freeze({
      kind: 'sourceTraversed' as const,
      fragments,
      utf16Length: offset,
      lastRelease,
    });
  } finally {
    lifetime.signal.removeEventListener('abort', cancel);
    cancel();
  }
}
