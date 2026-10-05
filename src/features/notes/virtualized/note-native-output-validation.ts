import { Mark, type Schema, type Node as PMNode, type AttributeSpec } from '@tiptap/pm/model';
import { NOTE_VIEW_LIMITS } from './note-view-cost';

const limits = { ...NOTE_VIEW_LIMITS, depth: 64, marks: 32, attributes: 64 } as const;

/** A schema-owned value domain is required for nondefault attributes. This is
 * distinct from malformed input and never grants server reference/ID authority. */
export class UnsupportedNoteNativeOutput extends Error {}

/** Strict supported output validation within an ALREADY admitted view/adapter
 * borrower. The caller retains that reservation through adoption or disposal.
 * No schema is invented here: pass the actual configured editor's schema.
 * Unvalidated nondefault attributes fail closed; parseHTML/renderHTML are not
 * validators. The ordinary read-only renderer is not widened or narrowed here. */
export function validateNoteNativeOutput(
  schema: Schema,
  input: unknown,
  admission: { current(): boolean },
): PMNode {
  const current = () => {
    if (!admission.current()) throw new Error('Stale native output admission');
  };
  current();
  // Snapshot only own enumerable string-keyed data (the JSON transport domain).
  // Symbols/nonenumerable properties are inert: never inspected or copied. This
  // avoids eagerly materializing an unbounded own-key array. Producers supply
  // ordinary data records, not executable Proxy objects. The snapshot is frozen
  // before schema callbacks run; callbacks cannot change later input via closures.
  const seen = new Set<object>();
  let bytes = 0,
    entries = 0;
  const encoder = new TextEncoder();
  const textBytes = (value: string) => {
    if (value.length > limits.derivedBytes) throw new Error('Native output byte budget');
    bytes += encoder.encode(value).length;
    if (bytes > limits.derivedBytes) throw new Error('Native output byte budget');
  };
  const snapshot = (value: unknown, depth: number): unknown => {
    if (++entries > limits.derivedObjects || depth > limits.depth)
      throw new Error('Native output graph budget');
    if (typeof value === 'string') {
      textBytes(value);
      return value;
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      bytes += 8;
      if (bytes > limits.derivedBytes) throw new Error('Native output byte budget');
      return value;
    }
    if (!value || typeof value !== 'object') throw new Error('Non-JSON native output');
    if (seen.has(value)) throw new Error('Native output must be a tree');
    seen.add(value);
    const array = Array.isArray(value);
    if (array && value.length > limits.derivedObjects)
      throw new Error('Native output graph budget');
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error('Invalid native output object');
    const copy: Record<string, unknown> = array
      ? ([] as unknown as Record<string, unknown>)
      : Object.create(null);
    let count = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) throw new Error('Inherited native output property');
      if (++count > (array ? limits.derivedObjects : limits.attributes))
        throw new Error('Native output property budget');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
        throw new Error('Invalid native output array');
      if (key === '__proto__' || key === 'constructor' || key === 'prototype')
        throw new Error('Invalid native output key');
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !('value' in property) || !property.enumerable)
        throw new Error('Invalid native output property');
      textBytes(key);
      copy[key] = snapshot(property.value, depth + 1);
    }
    if (array && count !== value.length) throw new Error('Sparse native output array');
    return Object.freeze(copy);
  };
  const captured = snapshot(input, 0);
  current();
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid native output record');
    return value as Record<string, unknown>;
  };
  const keys = (record: Record<string, unknown>, allowed: readonly string[]) => {
    if (Object.keys(record).some((k) => !allowed.includes(k)))
      throw new Error('Unknown native output field');
  };
  const attrs = (raw: unknown, specs: Record<string, AttributeSpec> = {}) => {
    const supplied = raw === undefined ? {} : object(raw);
    if (
      Object.keys(supplied).length > limits.attributes ||
      Object.keys(specs).length > limits.attributes
    )
      throw new Error('Native attribute budget');
    if (Object.keys(supplied).some((k) => !Object.hasOwn(specs, k)))
      throw new Error('Unknown native attribute');
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, spec] of Object.entries(specs)) {
      const present = Object.hasOwn(supplied, key);
      if (!present && !Object.hasOwn(spec, 'default')) throw new Error('Missing native attribute');
      const value: unknown = present ? supplied[key] : spec.default;
      if (!present) {
        // Schema defaults are trusted configuration, but are still charged. An
        // opaque structured default needs a separate bounded adapter policy.
        if (!(value === null || ['string', 'boolean', 'number'].includes(typeof value)))
          throw new UnsupportedNoteNativeOutput('Unsupported structured native default');
        if (typeof value === 'string') textBytes(value);
        else bytes += 8;
        if (bytes > limits.derivedBytes) throw new Error('Native output byte budget');
      }
      if (typeof spec.validate === 'string') {
        if (!spec.validate.split('|').includes(value === null ? 'null' : typeof value))
          throw new Error('Invalid native attribute type');
      } else if (typeof spec.validate === 'function') {
        // Copy bounded attribute data so a trusted schema validator cannot mutate
        // caller-owned input while deciding whether to admit it.
        const outcome: unknown = spec.validate(structuredClone(value));
        if (outcome && typeof outcome === 'object' && 'then' in outcome)
          throw new UnsupportedNoteNativeOutput('Asynchronous native attribute validator');
        current();
      } else if (
        !(value === null || ['string', 'boolean', 'number'].includes(typeof value)) ||
        !Object.hasOwn(spec, 'default') ||
        !Object.is(value, spec.default)
      ) {
        throw new UnsupportedNoteNativeOutput('Native attribute has no configured validator');
      }
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('Invalid native attribute');
      result[key] = structuredClone(value);
    }
    return result;
  };
  let nodes = 0;
  const build = (raw: unknown): PMNode => {
    current();
    if (++nodes > limits.nodes) throw new Error('Native output node budget');
    const value = object(raw);
    keys(value, ['type', 'attrs', 'marks', 'content', 'text']);
    if (typeof value.type !== 'string' || !Object.hasOwn(schema.nodes, value.type))
      throw new UnsupportedNoteNativeOutput('Unknown configured native node');
    const type = schema.nodes[value.type];
    const marks: Mark[] = [];
    let canonical: readonly Mark[] = [];
    if (value.marks !== undefined) {
      if (!Array.isArray(value.marks) || value.marks.length > limits.marks)
        throw new Error('Native mark budget');
      for (const rawMark of value.marks) {
        const mark = object(rawMark);
        keys(mark, ['type', 'attrs']);
        if (typeof mark.type !== 'string' || !Object.hasOwn(schema.marks, mark.type))
          throw new UnsupportedNoteNativeOutput('Unknown configured native mark');
        const markType = schema.marks[mark.type];
        const instance = markType.create(attrs(mark.attrs, markType.spec.attrs));
        canonical = instance.addToSet(canonical);
        marks.push(instance);
        if (canonical.length !== marks.length)
          throw new Error('Duplicate or excluded native marks');
      }
      if (!Mark.sameSet(canonical, marks)) throw new Error('Noncanonical native mark order');
    }
    const attributes = attrs(value.attrs, type.spec.attrs);
    if (type.isText) {
      if (
        value.content !== undefined ||
        typeof value.text !== 'string' ||
        !value.text.length ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value.text)
      )
        throw new Error('Invalid native text');
      return schema.text(value.text, marks);
    }
    if (value.text !== undefined || (value.content !== undefined && !Array.isArray(value.content)))
      throw new Error('Invalid native content');
    const children = ((value.content ?? []) as unknown[]).map(build);
    // createChecked checks content expressions and the parent node's mark policy;
    // attribute domains and mark exclusion were explicitly checked above.
    return type.createChecked(attributes, children, marks);
  };
  const result = build(captured);
  if (result.type !== schema.topNodeType || result.marks.length)
    throw new Error('Invalid native root');
  current();
  return result;
}
