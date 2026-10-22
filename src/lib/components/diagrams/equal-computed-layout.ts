import type { ComputedLayout } from './types';

function sameScalar(left: unknown, right: unknown): boolean {
  return (
    (left === null || (typeof left !== 'object' && typeof left !== 'function')) &&
    Object.is(left, right)
  );
}

function sameFields(left: object, right: object, nested: readonly PropertyKey[] = []): boolean {
  const keys = Reflect.ownKeys(left);
  return (
    keys.length === Reflect.ownKeys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        (nested.includes(key) || sameScalar(Reflect.get(left, key), Reflect.get(right, key))),
    )
  );
}

function sameItems<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  equal: (a: T, b: T) => boolean,
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (!!left &&
      !!right &&
      left.length === right.length &&
      left.every((item, i) => equal(item, right[i])))
  );
}

/**
 * Compare computed records, bounds and route points. Model-owned member arrays,
 * metadata and bindings always require publication: comparing their mutated contents
 * can conceal stale values behind an existing Svelte proxy. Authored node.size may
 * also alias the model, but consumers use the separately computed width/height scalars;
 * nested size is only an input to the next layout computation.
 * Do not serialize or interpret opaque model values.
 */
export function equalComputedLayout(
  previous: ComputedLayout | null,
  next: ComputedLayout,
): boolean {
  return (
    previous !== null &&
    sameFields(previous, next, ['nodes', 'edges', 'groups', 'bounds']) &&
    sameFields(previous.bounds, next.bounds) &&
    sameItems(
      previous.nodes,
      next.nodes,
      (a, b) =>
        sameFields(a, b, ['size']) &&
        ((a.size === undefined && b.size === undefined) ||
          (!!a.size && !!b.size && sameFields(a.size, b.size))),
    ) &&
    sameItems(
      previous.edges,
      next.edges,
      (a, b) => sameFields(a, b, ['points']) && sameItems(a.points, b.points, sameFields),
    ) &&
    sameItems(previous.groups, next.groups, sameFields)
  );
}
