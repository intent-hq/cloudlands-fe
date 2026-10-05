import { SourceProjection } from './source-projection';

export interface ExactSourceMapping {
  readonly pm: number;
  readonly source: number;
  readonly affinity: -1 | 1;
}

const sourceAt = SourceProjection.prototype.sourceAt;
const pmAt = SourceProjection.prototype.pmAt;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapForEach = Map.prototype.forEach;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get;
const uint = (value: number) => Number.isSafeInteger(value) && value >= 0;

function ordinaryMaps(projection: SourceProjection): Map<number, number>[] | undefined {
  // Refuse executable accessors before deciding whether this is ordinary map
  // dispatch. Callers keep custom methods at their original scalar call sites.
  for (const key of ['sourceAt', 'pmAt', 'table', 'mixed'] as const) {
    const own = Object.getOwnPropertyDescriptor(projection, key);
    const inherited = Object.getOwnPropertyDescriptor(SourceProjection.prototype, key);
    if ((own && !('value' in own)) || (inherited && !('value' in inherited))) return undefined;
  }
  if (
    Object.getPrototypeOf(projection) !== SourceProjection.prototype ||
    projection.sourceAt !== sourceAt ||
    projection.pmAt !== pmAt ||
    projection.table ||
    projection.mixed
  )
    return undefined;
  const maps: Map<number, number>[] = [];
  for (const key of ['positions', 'ends', 'boundaries'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(projection, key);
    if (!descriptor || !('value' in descriptor)) return undefined;
    const map = descriptor.value;
    if (
      !(map instanceof Map) ||
      Object.getPrototypeOf(map) !== Map.prototype ||
      Reflect.ownKeys(map).length
    )
      return undefined;
    maps.push(map);
  }
  return maps;
}

/** Eligibility only, never an authority or a reusable proof. Callers must keep
 * scalar checks inline if false. A later strict batch cannot switch to fallback. */
export function canBatchExactSourceMappings(projection: SourceProjection): boolean {
  return ordinaryMaps(projection) !== undefined;
}

/** One synchronous phase over owner-admitted native data and internally built
 * points. No index escapes or survives a callback. The caller must invoke a
 * fresh phase after callbacks, even when the maps retain their identity/size.
 * Temporary storage is O(cap); ordinary exact checks are O(entries + points).
 * Refuses other dispatch: callback-capable methods must retain their original
 * per-boundary validation order in the caller, never run as a deferred batch. */
export function verifyExactSourceMappings(
  projection: SourceProjection,
  points: readonly ExactSourceMapping[],
  cap: number,
): boolean {
  if (
    !uint(cap) ||
    cap > 32768 ||
    points.length > cap ||
    points.some(
      ({ pm, source, affinity }) =>
        !uint(pm) || !uint(source) || (affinity !== -1 && affinity !== 1),
    )
  )
    return false;
  const maps = ordinaryMaps(projection);
  if (!maps || !mapSize) return false;
  for (const map of maps) {
    if (mapSize.call(map) > cap) return false;
    let valid = true;
    mapForEach.call(map, (value: number, key: number) => {
      if (!uint(key) || !uint(value)) valid = false;
    });
    if (!valid) return false;
  }
  const [positions, ends, boundaries] = maps;
  const first = new Map<number, number>(),
    last = new Map<number, number>();
  mapForEach.call(positions, (offset: number, pm: number) => {
    if (mapGet.call(first, offset) === undefined) mapSet.call(first, offset, pm);
    mapSet.call(last, offset, pm);
  });
  // Intrinsics avoid executing map get/iterator overrides while checking.
  // Exact duplicate offsets choose insertion order, not numeric PM order.
  return points.every(({ pm, source, affinity }) => {
    const forward =
      (affinity < 0 ? mapGet.call(ends, pm) : undefined) ??
      mapGet.call(positions, pm) ??
      mapGet.call(boundaries, pm);
    const inverse = mapGet.call(affinity < 0 ? first : last, source);
    return forward === source && inverse === pm;
  });
}
