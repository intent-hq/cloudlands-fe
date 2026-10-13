import type { NoteResourceCost } from './note-resource-ledger';

/** Retained JSON payload/string/node counts, not JS heap. Reads already reserve
 * the complete bounded wire/decode allowance before this inspection can run.
 * No full JSON serialization or UTF-8 copy is allocated for measurement.
 */
export function measureNotePageCost(value: unknown, allowance: NoteResourceCost): NoteResourceCost {
  const cost: NoteResourceCost = {
    payloadBytes: 0,
    stringUnits: 0,
    objectNodes: 0,
    domNodes: 0,
    physicalReads: 0,
    assemblies: 0,
  };
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();
  const fail = () => {
    throw new Error('Decoded note page exceeds reserved allowance');
  };
  function text(value: string) {
    cost.stringUnits += value.length;
    if (cost.stringUnits > allowance.stringUnits) fail();
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code < 0x80) cost.payloadBytes++;
      else if (code < 0x800) cost.payloadBytes += 2;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        i + 1 < value.length &&
        value.charCodeAt(i + 1) >= 0xdc00 &&
        value.charCodeAt(i + 1) <= 0xdfff
      ) {
        cost.payloadBytes += 4;
        i++;
      } else cost.payloadBytes += 3;
      if (cost.payloadBytes > allowance.payloadBytes) fail();
    }
  }
  function push(value: unknown) {
    if (cost.objectNodes + stack.length + 1 > allowance.objectNodes) fail();
    stack.push(value);
  }
  while (stack.length) {
    const item = stack.pop();
    if (item && typeof item === 'object') {
      if (seen.has(item)) continue;
      seen.add(item);
    }
    if (++cost.objectNodes > allowance.objectNodes) fail();
    if (typeof item === 'string') text(item);
    else if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) push(item[i]);
    } else if (item && typeof item === 'object') {
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        text(key);
        push((item as Record<string, unknown>)[key]);
      }
    } else if (item !== null && typeof item !== 'number' && typeof item !== 'boolean') {
      throw new Error('Non-JSON note page value');
    }
  }
  return cost;
}
