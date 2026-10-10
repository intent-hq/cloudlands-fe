import type { NotePageSession, NoteLocalPointSaveRecord } from './note-pages-types';
import type { NoteResourceLedger } from '$features/notes/virtualized/note-resource-ledger';

export const pointUploadControlCost = Object.freeze({
  payloadBytes: 65536,
  stringUnits: 65536,
  objectNodes: 8192,
  physicalReads: 0,
  assemblies: 1,
  domNodes: 0,
});
const brand = Symbol('local point publication');
export interface LocalPointSavePublication {
  readonly [brand]: true;
}
type Prepared = {
  before: NotePageSession;
  after?: NoteLocalPointSaveRecord;
  controlOwner: string;
  controlResource: string;
  resource: NoteResourceLedger['resources'][string];
  pins: ReadonlyArray<{
    object: object;
    prototype: object | null;
    fields: ReadonlyArray<readonly [PropertyKey, unknown]>;
  }>;
};
const proofs = new WeakMap<object, Readonly<Prepared>>();
/** Consumes a private issuer intent OUTSIDE reduction. No structural record can mint it. */
export async function loadLocalPointSavePublication() {
  const { takeLocalPointPublicationIntent } =
    await import('$features/notes/virtualized/editing/note-local-point-staged-save');
  return (intent: unknown): LocalPointSavePublication => {
    const data = takeLocalPointPublicationIntent(intent);
    const note = data.before;
    const objects: object[] = [
      note,
      note.document,
      note.document?.selection,
      note.document?.scope,
      note.document?.history,
      note.document?.dirty,
      note.document?.replay,
      note.state,
      note.state?.scope,
      note.panels,
      note.drafts,
      note.history,
      data.resource,
      data.resource.cost,
    ].filter((v) => v != null);
    // Only the sole local journal/group DATA is traversed. This is a bounded
    // mutation snapshot for CAS, never a replay or editing credential.
    const seen = new Set<object>();
    let fields = 0;
    const nested = (value: unknown, depth = 0) => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      if (depth > 12 || seen.size >= 128) throw new Error('Publication nested bound');
      seen.add(value);
      if (!objects.includes(value)) objects.push(value);
      const keys = Reflect.ownKeys(value);
      fields += keys.length;
      if (fields > 512) throw new Error('Publication nested field bound');
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d || !('value' in d)) throw new Error('Publication nested accessor');
        nested(d.value, depth + 1);
      }
    };
    for (const value of [
      note.document?.history,
      note.document?.dirty,
      note.document?.replay,
      note.drafts,
      note.history,
    ])
      nested(value);
    let pinnedFields = 0;
    if (objects.length > 128) throw new Error('Publication object bound');
    const pins = Object.freeze(
      objects.map((object) => {
        const keys = Reflect.ownKeys(object);
        pinnedFields += keys.length;
        if (keys.length > 64 || pinnedFields > 512) throw new Error('Publication field bound');
        const fields = Object.freeze(
          keys.map((key) => {
            const d = Object.getOwnPropertyDescriptor(object, key);
            if (!d || !('value' in d)) throw new Error('Publication accessor');
            return Object.freeze([key, d.value] as const);
          }),
        );
        return Object.freeze({ object, prototype: Object.getPrototypeOf(object), fields });
      }),
    );
    const proof = Object.freeze({ [brand]: true as const });
    proofs.set(proof, Object.freeze({ ...data, pins }));
    return proof;
  };
}
/** Pure deterministic CAS. Replaying the same state/action never consumes registry state. */
export function applyLocalPointSavePublication(
  proof: LocalPointSavePublication,
  note: NotePageSession,
  ledger: NoteResourceLedger,
): NotePageSession | undefined {
  const p = proofs.get(proof);
  if (
    !p ||
    note !== p.before ||
    note.pending ||
    !p.pins.every(
      (pin) =>
        Object.getPrototypeOf(pin.object) === pin.prototype &&
        Reflect.ownKeys(pin.object).length === pin.fields.length &&
        pin.fields.every(([key, value]) => {
          const d = Object.getOwnPropertyDescriptor(pin.object, key);
          return !!d && 'value' in d && d.value === value;
        }),
    ) ||
    ledger.owners[p.controlOwner]?.length !== 1 ||
    ledger.owners[p.controlOwner][0] !== p.controlResource ||
    ledger.resources[p.controlResource] !== p.resource ||
    !Object.entries(pointUploadControlCost).every(([key, value]) => {
      const d = Object.getOwnPropertyDescriptor(p.resource.cost, key);
      return !!d && 'value' in d && d.value === value;
    })
  )
    return undefined;
  return {
    ...note,
    localPointSave: p.after,
    needsReconcile: note.needsReconcile || !!p.after?.receipt,
  };
}
