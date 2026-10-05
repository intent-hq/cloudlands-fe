import { ReplaceStep, StepMap } from '@tiptap/pm/transform';
import { Fragment, Slice, Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { sameNoteScope, type NoteScope, type NoteSplice } from '$lib/client/note-pages';
import type { NoteSourceSelection } from '../note-source-selection';
import { SourceProjection } from '../projection/source-projection';
import {
  verifyExactSourceMappings,
  type ExactSourceMapping,
} from '../projection/exact-source-mappings';
import { NoteEditAuthority } from './note-edit-authority';
import type { NoteSelectionMarkdownIdentity } from './note-selection-markdown-capture';

export const noteLocalPointLimits = Object.freeze({
  parentUnits: 4096,
  sourceBytes: 16384,
  recipeBytes: 65536,
  nativeNodes: 8192,
  mappingEntries: 32768,
  steps: 2,
  replayOutputs: 2,
} as const);
export interface NoteLocalPointRecipe {
  readonly kind: 'point-insertion-v1';
  readonly identity: Readonly<NoteSelectionMarkdownIdentity>;
  readonly baseLength: number;
  readonly beforeLength: number;
  readonly afterLength: number;
  readonly parent: Readonly<{
    sourceRange: Readonly<{ start: number; end: number }>;
    nativeRange: Readonly<{ from: number; to: number }>;
  }>;
  readonly insertion: Readonly<{
    sourceAt: number;
    nativeAt: number;
    text: 'X';
    point: Readonly<{
      attributes: Readonly<{ id: string; type: 'point'; commentId: string }>;
      literal: string;
      sourceRange: Readonly<{ start: number; end: number }>;
      nativeRange: Readonly<{ from: number; to: number }>;
    }>;
  }>;
  readonly forward: readonly [Readonly<NoteSplice>];
  readonly inverse: readonly [Readonly<NoteSplice>];
  readonly before: Readonly<NoteSourceSelection>;
  readonly after: Readonly<NoteSourceSelection>;
}
// Private nominal identity in implementation. Descriptor alone is not proof.
const localPointProof = Symbol('local point proof');
export interface NoteLocalPointProof {
  readonly [localPointProof]: true;
  current(): boolean;
  /** Idempotent: drops heavyweight native/base/projection references and callback.
   * Owner keeps physical IO/borrow debt until settlement; release is not ledger IO. */
  release(): void;
}
interface NoteLocalPointAdmission {
  readonly allowance: Readonly<{
    recipeBytes: number;
    nativeNodes: number;
    mappingEntries: number;
    sourceBytes: number;
  }>;
  /** Session-level retained DATA/original lease eligibility; false permanently retires proof.
   * Must permit supported local undo/redo, not be an exact active view-state predicate. */
  current(): boolean;
}
export interface NoteLocalPointInput {
  /** Exact owner origin-session reference; no identity is authenticated from arbitrary data. */
  readonly origin: object;
  readonly base: NoteEditAuthority;
  readonly beforeState: EditorState;
  readonly candidateTransaction: Transaction;
  readonly selection: NoteSourceSelection;
  readonly identity: NoteSelectionMarkdownIdentity;
  readonly admission: NoteLocalPointAdmission;
  readonly now?: () => number;
}
export interface NoteLocalPointCurrent {
  readonly origin: object;
  readonly doc: PMNode;
  readonly source: string;
  readonly scope: NoteScope;
  readonly sourceRevision: string;
  readonly snapshotId: string;
  readonly generation: number;
}

const encoder = new TextEncoder();
const uint = (n: number) => Number.isSafeInteger(n) && n >= 0;
// i18n-ignore (internal refusal diagnostic, never displayed as user copy)
const unsupported = () => new Error('Unsupported local point history');
const baseMethods = {
  sourceAt: NoteEditAuthority.prototype.sourceAt,
  pmAt: NoteEditAuthority.prototype.pmAt,
  replace: NoteEditAuthority.prototype.replace,
};
const nodeEq = PMNode.prototype.eq;
const nodeChild = PMNode.prototype.child;
const nodeAt = PMNode.prototype.nodeAt;
const stepMapForEach = StepMap.prototype.forEach;
const fragmentChild = Fragment.prototype.child;
const mapGet = Map.prototype.get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const mapForEach = Map.prototype.forEach;
const arrayFind = Array.prototype.find;

function ownData(object: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (!field || !('value' in field)) throw unsupported();
  return field.value;
}
function nativeMethods(node: PMNode) {
  for (const [object, key] of [
    [node, 'eq'],
    [node, 'child'],
    [node, 'nodeAt'],
    [node.content, 'child'],
  ] as const) {
    const field = Object.getOwnPropertyDescriptor(object, key);
    if (field) throw unsupported();
  }
  if (
    (!node.isText && node.eq !== nodeEq) ||
    node.child !== nodeChild ||
    node.nodeAt !== nodeAt ||
    node.content.child !== fragmentChild
  )
    throw unsupported();
}
function ordinaryMap(object: object, key: string): Map<number, number> {
  const map = ownData(object, key);
  if (
    !(map instanceof Map) ||
    Object.getPrototypeOf(map) !== Map.prototype ||
    Reflect.ownKeys(map).length ||
    !mapSize ||
    mapSize.call(map) > noteLocalPointLimits.mappingEntries
  )
    throw unsupported();
  mapForEach.call(map, (value: number, key: number) => {
    if (!uint(value) || !uint(key)) throw unsupported();
  });
  return map;
}

/** This lane admits only the unchanged complete ASCII paragraph authority made
 * by the existing paragraph factory. Its bounded scalar lexical tokens cover
 * every source endpoint, so reverse navigation never needs a fallback. Inspect
 * own data before using that invariant; no private navigation callback runs in
 * the final proof. Changes to the authority's internal layout fail closed. */
function lexicalData(base: NoteEditAuthority, source: string) {
  const tokens = ownData(base, 'lexical');
  if (
    !Array.isArray(tokens) ||
    Object.getPrototypeOf(tokens) !== Array.prototype ||
    tokens.length !== source.length ||
    tokens.find !== arrayFind ||
    Reflect.ownKeys(tokens).length !== tokens.length + 1
  )
    throw unsupported();
  let owner: string | undefined;
  const refs: object[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = ownData(tokens, String(i));
    if (!token || typeof token !== 'object') throw unsupported();
    fields(token, ['pm', 'start', 'end', 'text', 'owner', 'encoding', 'construct']);
    if (
      ownData(token, 'pm') !== i + 1 ||
      ownData(token, 'start') !== i ||
      ownData(token, 'end') !== i + 1 ||
      ownData(token, 'text') !== source[i] ||
      ownData(token, 'encoding') !== 'markdown' ||
      ownData(token, 'construct') !== 'paragraph'
    )
      throw unsupported();
    const currentOwner = ownData(token, 'owner');
    if (
      typeof currentOwner !== 'string' ||
      !currentOwner ||
      currentOwner.length > 1024 ||
      (owner !== undefined && owner !== currentOwner)
    )
      throw unsupported();
    owner = currentOwner;
    refs.push(token);
  }
  const navigation = ownData(base, 'navigation');
  if (!navigation || typeof navigation !== 'object') throw unsupported();
  fields(navigation, ['original', 'changes', 'forward', 'backward']);
  const changes = ownData(navigation, 'changes');
  if (
    !Array.isArray(changes) ||
    changes.length ||
    Object.getPrototypeOf(changes) !== Array.prototype ||
    Reflect.ownKeys(changes).length !== 1
  )
    throw unsupported();
  return [tokens, ...refs];
}

// Only trusted, already admitted configured native graphs are inputs. Reflecting
// keys is not a bounded allocator for hostile arbitrary objects or proxies.
function fields(object: object, keys: readonly string[]) {
  const proto = Object.getPrototypeOf(object);
  const own = Reflect.ownKeys(object);
  if (
    (proto !== null && proto !== Object.prototype) ||
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    throw unsupported();
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    if (!d?.enumerable || !('value' in d)) throw unsupported();
  }
}
function empty(node: PMNode) {
  fields(node.attrs, []);
  const spec = Object.getOwnPropertyDescriptor(node.type.spec, 'attrs');
  if (spec) {
    if (!('value' in spec) || !spec.value || typeof spec.value !== 'object') throw unsupported();
    fields(spec.value, []);
  }
  if (node.marks.length) throw unsupported();
}
function identity(input: NoteSelectionMarkdownIdentity) {
  for (const value of [
    input.scope.backendId,
    input.scope.workspaceId,
    input.scope.noteId,
    input.scope.noteInstanceId,
    input.sourceRevision,
    input.snapshotId,
    input.expiresAt,
  ])
    if (typeof value !== 'string' || !value || value.length > 1024) throw unsupported();
  if (![input.documentGeneration, input.liveGeneration, input.selectionGeneration].every(uint))
    throw unsupported();
  return Object.freeze({
    scope: Object.freeze({ ...input.scope }),
    sourceRevision: input.sourceRevision,
    snapshotId: input.snapshotId,
    documentGeneration: input.documentGeneration,
    liveGeneration: input.liveGeneration,
    selectionGeneration: input.selectionGeneration,
    expiresAt: input.expiresAt,
  });
}
function sameIdentity(a: NoteSelectionMarkdownIdentity, b: NoteSelectionMarkdownIdentity) {
  for (const key of [
    'scope',
    'sourceRevision',
    'snapshotId',
    'documentGeneration',
    'liveGeneration',
    'selectionGeneration',
    'expiresAt',
  ])
    ownData(a, key);
  fields(a.scope, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
  return (
    sameNoteScope(a.scope, b.scope) &&
    a.sourceRevision === b.sourceRevision &&
    a.snapshotId === b.snapshotId &&
    a.documentGeneration === b.documentGeneration &&
    a.liveGeneration === b.liveGeneration &&
    a.selectionGeneration === b.selectionGeneration &&
    a.expiresAt === b.expiresAt
  );
}
function selection(value: NoteSourceSelection) {
  if (
    !uint(value.anchor) ||
    value.anchor !== value.head ||
    ![-1, 1].includes(value.anchorAffinity) ||
    ![-1, 1].includes(value.headAffinity)
  )
    throw unsupported();
  return Object.freeze({
    anchor: value.anchor,
    head: value.head,
    anchorAffinity: value.anchorAffinity,
    headAffinity: value.headAffinity,
  });
}

type NativeShape = readonly unknown[];
function shape(doc: PMNode, text: string, point?: NoteLocalPointRecipe['insertion']['point']) {
  nativeMethods(doc);
  if (doc.type !== doc.type.schema.nodes.doc || doc.childCount !== 1) throw unsupported();
  empty(doc);
  const p = doc.child(0);
  nativeMethods(p);
  if (p.type !== doc.type.schema.nodes.paragraph || p.childCount !== (point ? 3 : 1))
    throw unsupported();
  empty(p);
  const refs: unknown[] = [
    doc,
    doc.type,
    doc.type.spec,
    doc.attrs,
    doc.content,
    p,
    p.type,
    p.type.spec,
    p.attrs,
    p.content,
  ];
  for (let i = 0; i < p.childCount; i++) {
    const child = p.child(i);
    nativeMethods(child);
    refs.push(child, child.type, child.type.spec, child.attrs, child.content, child.text);
    if (point && i === 1) {
      if (
        child.type !== doc.type.schema.nodes.commentAnchor ||
        !child.isAtom ||
        !child.isInline ||
        child.nodeSize !== 1 ||
        child.childCount ||
        child.marks.length
      )
        throw unsupported();
      fields(child.attrs, ['id', 'type', 'commentId']);
      for (const key of ['id', 'type', 'commentId'] as const)
        if (child.attrs[key] !== point.attributes[key]) throw unsupported();
    } else {
      empty(child);
      const expected = !point
        ? text
        : i === 0
          ? text.slice(0, point.sourceRange.start)
          : text.slice(point.sourceRange.end);
      if (
        !child.isText ||
        child.type !== doc.type.schema.nodes.text ||
        child.text !== expected ||
        !expected.length
      )
        throw unsupported();
    }
  }
  return refs;
}
function sameShape(actual: NativeShape, expected: NativeShape) {
  if (actual.length !== expected.length || actual.some((value, i) => value !== expected[i]))
    throw unsupported();
}

type ContentWitness = Array<{
  object: object;
  prototype: object | null;
  fields: Array<readonly [string, unknown, boolean]>;
}>;
// Snapshot only the newly built, bounded plain JSON graph, before it is exposed
// to the configured schema callback. Neither toJSON nor a getter is executed.
function contentWitness(root: object): ContentWitness {
  const witness: ContentWitness = [],
    pending = [root],
    seen = new Set<object>();
  let count = 0,
    units = 0;
  while (pending.length) {
    const object = pending.pop();
    if (!object || seen.has(object)) continue;
    seen.add(object);
    if (seen.size > noteLocalPointLimits.nativeNodes) throw unsupported();
    const prototype = Object.getPrototypeOf(object);
    if (
      prototype !== null &&
      prototype !== Object.prototype &&
      !(Array.isArray(object) && prototype === Array.prototype)
    )
      throw unsupported();
    const keys = Reflect.ownKeys(object);
    count += keys.length;
    if (count > noteLocalPointLimits.mappingEntries) throw unsupported();
    const captured: Array<readonly [string, unknown, boolean]> = [];
    for (const key of keys) {
      if (typeof key !== 'string') throw unsupported();
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor || !('value' in descriptor)) throw unsupported();
      const value: unknown = descriptor.value;
      if (value && typeof value === 'object') pending.push(value);
      else if (typeof value === 'string') units += value.length;
      else if (
        value !== null &&
        typeof value !== 'boolean' &&
        typeof value !== 'undefined' &&
        !(typeof value === 'number' && Number.isFinite(value))
      )
        throw unsupported();
      if (units > noteLocalPointLimits.sourceBytes * 2) throw unsupported();
      captured.push([key, value, descriptor.enumerable === true]);
    }
    witness.push({ object, prototype, fields: captured });
  }
  return witness;
}
function currentContent(witness: ContentWitness) {
  for (const entry of witness) {
    if (
      Object.getPrototypeOf(entry.object) !== entry.prototype ||
      Reflect.ownKeys(entry.object).length !== entry.fields.length
    )
      throw unsupported();
    for (const [key, value, enumerable] of entry.fields) {
      const descriptor = Object.getOwnPropertyDescriptor(entry.object, key);
      if (
        !descriptor ||
        !('value' in descriptor) ||
        descriptor.value !== value ||
        (descriptor.enumerable === true) !== enumerable
      )
        throw unsupported();
    }
  }
}
function exactStep(step: ReplaceStep, from: number, text?: string, point?: PMNode) {
  if (
    Object.getPrototypeOf(step) !== ReplaceStep.prototype ||
    step.from !== from ||
    step.to !== from ||
    step.apply !== ReplaceStep.prototype.apply ||
    step.invert !== ReplaceStep.prototype.invert ||
    step.getMap !== ReplaceStep.prototype.getMap ||
    Object.getPrototypeOf(step.slice) !== Slice.prototype ||
    step.slice.openStart ||
    step.slice.openEnd ||
    step.slice.content.childCount !== 1
  )
    throw unsupported();
  const node = step.slice.content.child(0);
  if (point ? node !== point : !node.isText || node.text !== text) throw unsupported();
  if (!point) empty(node);
}
function exactMap(map: StepMap, from: number, size: number) {
  if (Object.getPrototypeOf(map) !== StepMap.prototype || map.forEach !== stepMapForEach)
    throw unsupported();
  let count = 0;
  stepMapForEach.call(map, (a, b, c, d) => {
    if (a !== from || b !== from || c !== from || d !== from + size) throw unsupported();
    count++;
  });
  if (count !== 1) throw unsupported();
}

interface Held {
  input: NoteLocalPointInput;
  origin: object;
  base: NoteEditAuthority;
  beforeState: EditorState;
  transaction: Transaction;
  admission: NoteLocalPointAdmission;
  ownerCurrent: () => boolean;
  now: () => number;
  originalNow: NoteLocalPointInput['now'];
  recipe: NoteLocalPointRecipe;
  source: string;
  caller: string;
  before: PMNode;
  intermediate: PMNode;
  after: PMNode;
  shapes: readonly NativeShape[];
  steps: readonly [ReplaceStep, ReplaceStep];
  slices: readonly [Slice, Slice];
  maps: readonly [StepMap, StepMap];
  inverse: readonly [ReplaceStep, ReplaceStep];
  positions: NoteEditAuthority['positions'];
  ends: NoteEditAuthority['ends'];
  nativeBefore: number;
  nativeAfter: number;
  lexical: readonly unknown[];
  atom: PMNode;
}

/** Recheck after all owner/clock callbacks. No projection parsed from source can
 * provide this initial authority; the caller must supply its genuine grant. */
function verify(h: Held) {
  const { input, base, recipe: r, transaction: tr, beforeState } = h;
  const positions = ordinaryMap(base, 'positions'),
    ends = ordinaryMap(base, 'ends');
  ordinaryMap(base, 'boundaries');
  for (const key of ['sourceAt', 'pmAt', 'replace', 'table', 'mixed'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(base, key);
    if (descriptor && !('value' in descriptor)) throw unsupported();
  }
  if (
    input.origin !== h.origin ||
    input.base !== base ||
    input.beforeState !== beforeState ||
    input.candidateTransaction !== tr ||
    input.admission !== h.admission ||
    input.admission.current !== h.ownerCurrent ||
    input.now !== h.originalNow ||
    !sameIdentity(input.identity, r.identity) ||
    base.doc !== h.before ||
    beforeState.doc !== h.before ||
    beforeState.schema !== h.before.type.schema ||
    base.source !== h.source ||
    base.start !== 0 ||
    base.baseLength !== h.source.length ||
    base.generation !== r.identity.documentGeneration ||
    base.snapshotId !== r.identity.snapshotId ||
    base.sourceRevision !== r.identity.sourceRevision ||
    !sameNoteScope(base.scope, r.identity.scope) ||
    base.sourceAt !== baseMethods.sourceAt ||
    base.pmAt !== baseMethods.pmAt ||
    base.replace !== baseMethods.replace ||
    base.positions !== h.positions ||
    base.ends !== h.ends ||
    !(beforeState.selection instanceof TextSelection) ||
    beforeState.selection.anchor !== h.nativeBefore ||
    beforeState.selection.head !== h.nativeBefore ||
    input.selection.anchor !== r.before.anchor ||
    input.selection.head !== r.before.head ||
    input.selection.anchorAffinity !== r.before.anchorAffinity ||
    input.selection.headAffinity !== r.before.headAffinity ||
    tr.before !== h.before ||
    tr.doc !== h.after ||
    tr.docs.length !== 2 ||
    tr.docs[0] !== h.before ||
    tr.docs[1] !== h.intermediate ||
    tr.steps.length !== 2 ||
    tr.steps[0] !== h.steps[0] ||
    tr.steps[1] !== h.steps[1] ||
    h.steps[0].slice !== h.slices[0] ||
    h.steps[1].slice !== h.slices[1] ||
    tr.mapping.maps.length !== 2 ||
    tr.mapping.maps[0] !== h.maps[0] ||
    tr.mapping.maps[1] !== h.maps[1] ||
    !(tr.selection instanceof TextSelection) ||
    tr.selection.anchor !== h.nativeAfter ||
    tr.selection.head !== h.nativeAfter ||
    tr.storedMarks?.length
  )
    throw unsupported();
  for (const [key, ceiling] of Object.entries(noteLocalPointLimits)) {
    if (
      key === 'recipeBytes' ||
      key === 'nativeNodes' ||
      key === 'mappingEntries' ||
      key === 'sourceBytes'
    ) {
      const limit = h.admission.allowance[key];
      if (!uint(limit) || limit < ceiling) throw unsupported();
    }
  }
  sameShape(lexicalData(base, h.source), h.lexical);
  if (base.table || base.mixed) throw unsupported();
  exactStep(h.steps[0], h.nativeBefore, 'X');
  exactStep(h.steps[1], h.nativeBefore + 1, undefined, h.atom);
  exactMap(h.maps[0], h.nativeBefore, 1);
  exactMap(h.maps[1], h.nativeBefore + 1, 1);
  for (const [index, inverse] of h.inverse.entries()) {
    const from = h.nativeBefore + (index === 0 ? 1 : 0);
    if (
      Object.getPrototypeOf(inverse) !== ReplaceStep.prototype ||
      inverse.from !== from ||
      inverse.to !== from + 1 ||
      inverse.slice.openStart ||
      inverse.slice.openEnd ||
      inverse.slice.content.size ||
      inverse.apply !== ReplaceStep.prototype.apply
    )
      throw unsupported();
  }
  sameShape(shape(h.before, h.source), h.shapes[0]);
  sameShape(
    shape(
      h.intermediate,
      h.source.slice(0, r.insertion.sourceAt) + 'X' + h.source.slice(r.insertion.sourceAt),
    ),
    h.shapes[1],
  );
  sameShape(shape(h.after, h.caller, r.insertion.point), h.shapes[2]);
  for (let at = 0; at <= h.source.length; at++)
    if (
      mapGet.call(positions, at + 1) !== at ||
      (mapGet.call(ends, at + 1) ?? mapGet.call(positions, at + 1)) !== at
    )
      throw unsupported();
}

// Each output retains at most one bounded input/output witness. The session
// owner admits both slots before replay and releases an obsolete endpoint only
// after CAS, or a rejected candidate on cancellation. No unbounded history of
// output closures is retained here.
type OutputRecord = { check: () => void; doc: PMNode; projection: SourceProjection };
type Slot = { held?: Held; outputs: Map<object, OutputRecord> };
// Keys are the frozen emitted objects. Values retain only revocable indirection,
// so keeping a public credential alive cannot pin released hidden native proof.
const outputCredentials = new WeakMap<object, { slot: Slot; key: object }>();
function retire(slot: Slot) {
  slot.held = undefined;
  slot.outputs.clear();
}
// This factory must not share replayLocalPoint's lexical scope: retained public
// current/release functions hold only a revocable slot and an opaque key, never
// the native graph, original authority, or current-input snapshot directly.
function validateOutput(slot: Slot, key: object) {
  const check = slot.outputs.get(key),
    h = slot.held;
  if (!check || !h) return false;
  try {
    verify(h);
    check.check();
    return slot.outputs.get(key) === check && slot.held === h;
  } catch {
    retire(slot);
    return false;
  }
}
function outputLifetime(slot: Slot, key: object) {
  return {
    current: () => {
      if (!slot.outputs.has(key) || !live(slot)) return false;
      return validateOutput(slot, key);
    },
    validate: () => validateOutput(slot, key),
    release: () => {
      slot.outputs.delete(key);
    },
  };
}
/** Trusted final check for the dedicated relay lane. Never invokes a method
 * supplied by an owner or a structurally similar object. The optional original
 * root command is required by the initial insertion owner; local history uses
 * the exact retained endpoint credential and separate session CAS. Lifetime
 * admission/expiry must have been refreshed before this callback-free check. */
export function validateLocalPointOutput(
  output: unknown,
  candidate: { readonly doc: PMNode; readonly projection: SourceProjection },
  transaction?: Transaction,
): boolean {
  if (!output || typeof output !== 'object') return false;
  const credential = outputCredentials.get(output);
  if (!credential) return false;
  const { slot, key } = credential;
  const record = slot.outputs.get(key),
    h = slot.held;
  if (!record || !h) return false;
  try {
    if (
      ownData(candidate, 'doc') !== record.doc ||
      ownData(candidate, 'projection') !== record.projection ||
      (transaction !== undefined && transaction !== h.transaction)
    )
      return false;
    return validateOutput(slot, key);
  } catch {
    return false;
  }
}
const proofs = new WeakMap<NoteLocalPointProof, Slot>();
function live(slot: Slot) {
  const h = slot.held;
  if (!h) return undefined;
  try {
    if (!h.ownerCurrent()) throw unsupported();
    const time = h.now();
    if (!Number.isFinite(time) || !(time < Date.parse(h.recipe.identity.expiresAt)))
      throw unsupported();
    verify(h);
    if (slot.held !== h) throw unsupported();
    return h;
  } catch {
    retire(slot);
    return undefined;
  }
}
function proofFor(slot: Slot): NoteLocalPointProof {
  const proof = Object.freeze({
    [localPointProof]: true as const,
    current: () => !!live(slot),
    release: () => {
      retire(slot);
    },
  });
  proofs.set(proof, slot);
  return proof;
}

export function prepareLocalPointInsertion(input: NoteLocalPointInput): {
  readonly recipe: NoteLocalPointRecipe;
  readonly proof: NoteLocalPointProof;
} {
  const { base, beforeState, candidateTransaction: tr, admission } = input;
  // Admission and cheap lengths precede graph traversal, Slice work and parsing.
  for (const key of ['recipeBytes', 'nativeNodes', 'mappingEntries', 'sourceBytes'] as const)
    if (!uint(admission.allowance[key]) || admission.allowance[key] < noteLocalPointLimits[key])
      throw unsupported();
  const ownerCurrent = admission.current,
    originalNow = input.now,
    now = originalNow ?? Date.now;
  if (!ownerCurrent()) throw unsupported();
  const time = now();
  if (
    !Number.isFinite(time) ||
    !(time < Date.parse(input.identity.expiresAt)) ||
    input.base !== base ||
    input.beforeState !== beforeState ||
    input.candidateTransaction !== tr ||
    input.admission !== admission ||
    admission.current !== ownerCurrent ||
    input.now !== originalNow
  )
    throw unsupported();
  if (
    !(base instanceof NoteEditAuthority) ||
    typeof base.source !== 'string' ||
    !base.source.length ||
    base.source.length > noteLocalPointLimits.parentUnits ||
    tr.steps.length !== 2 ||
    tr.docs.length !== 2 ||
    base.doc.content.size > noteLocalPointLimits.parentUnits + 2 ||
    !/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(base.source)
  )
    throw unsupported();
  const i = identity(input.identity),
    before = selection(input.selection);
  const source = base.source,
    at = before.anchor,
    pm = beforeState.selection.anchor;
  if (at <= 0 || at >= source.length || pm !== at + 1) throw unsupported();
  const first = tr.steps[0],
    second = tr.steps[1];
  if (!(first instanceof ReplaceStep) || !(second instanceof ReplaceStep)) throw unsupported();
  exactStep(first, pm, 'X');
  if (second.slice.content.childCount !== 1) throw unsupported();
  const atom = second.slice.content.child(0);
  fields(atom.attrs, ['id', 'type', 'commentId']);
  const { commentId, type, id } = atom.attrs;
  if (
    typeof commentId !== 'string' ||
    !commentId ||
    commentId.length > 1024 ||
    /[:<>\u0000-\u0020\u007f]/.test(commentId) ||
    type !== 'point' ||
    id !== `${commentId}:point`
  )
    throw unsupported();
  for (const c of commentId)
    if (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)
      throw unsupported();
  const literal = `<!--anchor:${commentId}:point-->`,
    text = `X${literal}`;
  const caller = source.slice(0, at) + text + source.slice(at);
  if (
    caller.length > noteLocalPointLimits.parentUnits ||
    encoder.encode(caller).length > noteLocalPointLimits.sourceBytes
  )
    throw unsupported();
  exactStep(second, pm + 1, undefined, atom);
  const point = Object.freeze({
    attributes: Object.freeze({ id: id as string, type: 'point' as const, commentId }),
    literal,
    sourceRange: Object.freeze({ start: at + 1, end: at + text.length }),
    nativeRange: Object.freeze({ from: pm + 1, to: pm + 2 }),
  });
  const forward = Object.freeze([Object.freeze({ start: at, end: at, text })] as const);
  const inverse = Object.freeze([
    Object.freeze({ start: at, end: at + text.length, text: '' }),
  ] as const);
  const recipe: NoteLocalPointRecipe = Object.freeze({
    kind: 'point-insertion-v1',
    identity: i,
    baseLength: source.length,
    beforeLength: source.length,
    afterLength: caller.length,
    parent: Object.freeze({
      sourceRange: Object.freeze({ start: 0, end: source.length }),
      nativeRange: Object.freeze({ from: 0, to: source.length + 2 }),
    }),
    insertion: Object.freeze({ sourceAt: at, nativeAt: pm, text: 'X', point }),
    forward,
    inverse,
    before,
    after: Object.freeze({
      anchor: at + text.length,
      head: at + text.length,
      anchorAffinity: 1,
      headAffinity: 1,
    }),
  });
  if (encoder.encode(JSON.stringify(recipe)).length > noteLocalPointLimits.recipeBytes)
    throw unsupported();
  const h: Held = {
    input,
    origin: input.origin,
    base,
    beforeState,
    transaction: tr,
    admission,
    ownerCurrent,
    originalNow,
    now,
    recipe,
    source,
    caller,
    before: beforeState.doc,
    intermediate: tr.docs[1],
    after: tr.doc,
    shapes: [
      shape(beforeState.doc, source),
      shape(tr.docs[1], source.slice(0, at) + 'X' + source.slice(at)),
      shape(tr.doc, caller, point),
    ],
    steps: [first, second],
    slices: [first.slice, second.slice],
    maps: [tr.mapping.maps[0], tr.mapping.maps[1]],
    inverse: [second.invert(tr.docs[1]), first.invert(beforeState.doc)],
    positions: base.positions,
    ends: base.ends,
    nativeBefore: pm,
    nativeAfter: pm + 2,
    lexical: lexicalData(base, source),
    atom,
  };
  const slot: Slot = { held: h, outputs: new Map() };
  if (!live(slot)) throw unsupported();
  // Independently execute actual steps against their original inputs; raw source
  // equality is never substituted for the command's real native shape.
  const middle = first.apply(h.before).doc;
  if (!middle?.eq(h.intermediate) || !second.apply(middle).doc?.eq(h.after)) throw unsupported();
  // Exercise original lexical authority for the supported first text step.
  const lexical = base.replace(first, h.before);
  if (
    !lexical.authority.doc.eq(h.intermediate) ||
    lexical.splice.start !== at ||
    lexical.splice.end !== at ||
    lexical.splice.text !== 'X'
  )
    throw unsupported();
  if (!live(slot)) throw unsupported();
  return Object.freeze({ recipe, proof: proofFor(slot) });
}

export function validateLocalPoint(
  proof: NoteLocalPointProof,
  recipe: NoteLocalPointRecipe,
  origin: object,
) {
  const slot = proofs.get(proof),
    h = slot && live(slot);
  return !!h && h.recipe === recipe && h.origin === origin;
}

export function replayLocalPoint(
  proof: NoteLocalPointProof,
  recipe: NoteLocalPointRecipe,
  direction: 'undo' | 'redo',
  current: NoteLocalPointCurrent,
): {
  readonly doc: PMNode;
  readonly projection: SourceProjection;
  readonly splices: readonly Readonly<NoteSplice>[];
  readonly selection: Readonly<NoteSourceSelection>;
  /** Rechecks this exact endpoint after owner/clock callbacks; any observed loss
   * is permanent. Caller must use LAST before publication, without an await. */
  current(): boolean;
  /** Callback-free final correspondence check. Does not refresh expiry or owner
   * admission: call current() first, then validate LAST after owner callbacks. */
  validate(): boolean;
  /** Drops this output's hidden native witnesses, idempotently. Visible doc and
   * projection references remain caller-owned and charged until discarded. */
  release(): void;
} {
  const slot = proofs.get(proof);
  if (!slot || slot.outputs.size >= noteLocalPointLimits.replayOutputs) throw unsupported();
  const h = live(slot);
  if (
    !slot ||
    !h ||
    h.recipe !== recipe ||
    h.origin !== current.origin ||
    !['undo', 'redo'].includes(direction)
  )
    throw unsupported();
  const source = direction === 'undo' ? h.caller : h.source;
  const pinnedDoc = current.doc,
    pinnedGeneration = current.generation;
  const currentShape = shape(
    pinnedDoc,
    source,
    direction === 'undo' ? recipe.insertion.point : undefined,
  );
  const check = () => {
    fields(current, [
      'origin',
      'doc',
      'source',
      'scope',
      'sourceRevision',
      'snapshotId',
      'generation',
    ]);
    fields(current.scope, ['backendId', 'workspaceId', 'noteId', 'noteInstanceId']);
    if (
      current.doc !== pinnedDoc ||
      current.generation !== pinnedGeneration ||
      current.origin !== h.origin ||
      current.doc.type.schema !== h.before.type.schema ||
      current.source !== source ||
      !sameNoteScope(current.scope, recipe.identity.scope) ||
      current.sourceRevision !== recipe.identity.sourceRevision ||
      current.snapshotId !== recipe.identity.snapshotId ||
      !uint(current.generation) ||
      current.generation < recipe.identity.documentGeneration ||
      (current.generation === recipe.identity.documentGeneration &&
        (direction === 'undo' || current.doc !== h.before))
    )
      throw unsupported();
    sameShape(
      shape(current.doc, source, direction === 'undo' ? recipe.insertion.point : undefined),
      currentShape,
    );
  };
  check();
  let doc = current.doc;
  for (const step of direction === 'undo' ? h.inverse : h.steps) {
    const applied = step.apply(doc);
    if (!applied.doc) throw unsupported();
    doc = applied.doc;
  }
  const target = direction === 'undo' ? h.before : h.after;
  const targetSource = direction === 'undo' ? h.source : h.caller;
  if (!doc.eq(target)) throw unsupported();
  const projection = new SourceProjection(targetSource, 0);
  const projectionFields = [
    'source',
    'start',
    'content',
    'positions',
    'ends',
    'boundaries',
  ] as const;
  const projectionValues = projectionFields.map((key) => ownData(projection, key));
  const content = projection.content,
    witness = contentWitness(content);
  if (!doc.eq(doc.type.schema.nodeFromJSON(content))) throw unsupported();
  const outputShape = shape(
    doc,
    targetSource,
    direction === 'redo' ? recipe.insertion.point : undefined,
  );
  if (live(slot) !== h) throw unsupported();
  check();
  sameShape(
    shape(doc, targetSource, direction === 'redo' ? recipe.insertion.point : undefined),
    outputShape,
  );
  const points: ExactSourceMapping[] = [];
  for (let pm = 1; pm < doc.content.size; pm++) {
    const source =
      direction === 'undo' || pm <= recipe.insertion.point.nativeRange.from
        ? pm - 1
        : pm - 2 + recipe.insertion.point.literal.length;
    points.push({ pm, source, affinity: -1 }, { pm, source, affinity: 1 });
  }
  const endpointCheck = () => {
    // Guard every consumed own property before reads; a returned projection is
    // exposed to callbacks, so pointer equality alone cannot exclude accessors.
    for (let i = 0; i < projectionFields.length; i++)
      if (ownData(projection, projectionFields[i]) !== projectionValues[i]) throw unsupported();
    check();
    sameShape(
      shape(doc, targetSource, direction === 'redo' ? recipe.insertion.point : undefined),
      outputShape,
    );
    if (
      projection.source !== targetSource ||
      projection.start !== 0 ||
      !verifyExactSourceMappings(projection, points, noteLocalPointLimits.mappingEntries)
    )
      throw unsupported();
    if (projection.content !== content) throw unsupported();
    currentContent(witness);
  };
  endpointCheck();
  // Executable callbacks may have acquired other outputs reentrantly. Enforce
  // the slot ceiling again immediately before publishing this witness.
  if (slot.held !== h || slot.outputs.size >= noteLocalPointLimits.replayOutputs)
    throw unsupported();
  const key = {};
  slot.outputs.set(key, { check: endpointCheck, doc, projection });
  const output = Object.freeze({
    doc,
    projection,
    splices: direction === 'undo' ? recipe.inverse : recipe.forward,
    selection: direction === 'undo' ? recipe.before : recipe.after,
    ...outputLifetime(slot, key),
  });
  outputCredentials.set(output, { slot, key });
  return output;
}
