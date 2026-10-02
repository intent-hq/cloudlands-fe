import type { ComputedLayout } from './types';

function sameFields(left: object, right: object, nested: readonly PropertyKey[] = []): boolean {
  const keys = Reflect.ownKeys(left);
  return (
    keys.length === Reflect.ownKeys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        (nested.includes(key) || Object.is(Reflect.get(left, key), Reflect.get(right, key))),
    )
  );
}

function sameItems<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  equal: (a: T, b: T) => boolean,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.length === right.length &&
      left.every((item, i) => equal(item, right[i])))
  );
}

/**
 * Compare the records and geometry arrays owned by the layout engine. Model-owned
 * objects (including arbitrary metadata and bindings) retain reference semantics:
 * replacing one always publishes, without serializing or interpreting its contents.
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
        (a.size === b.size || (!!a.size && !!b.size && sameFields(a.size, b.size))),
    ) &&
    sameItems(
      previous.edges,
      next.edges,
      (a, b) => sameFields(a, b, ['points']) && sameItems(a.points, b.points, sameFields),
    ) &&
    sameItems(
      previous.groups,
      next.groups,
      (a, b) => sameFields(a, b, ['nodeIds']) && sameItems(a.nodeIds, b.nodeIds, Object.is),
    )
  );
}
