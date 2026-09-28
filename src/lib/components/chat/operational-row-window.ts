/** One actual emitted row, not one source block. Multi-title reasoning must be
 * split before admission; a group header grants no admission to its children.
 * `content` entries account for prose/layout gaps and stay outside this budget.
 * Supply one ordered list for the entire panel, including offscreen messages.
 */
export interface OperationalRowDescriptor {
  key: string;
  scopeId: string;
  kind: 'tool' | 'reasoning' | 'group' | 'content';
  estimatedHeight: number;
}

export interface OperationalRowViewport {
  top: number;
  bottom: number;
}

type OperationalRowSegment = {
  type: 'row' | 'content' | 'spacer';
  scopeId: string;
  key: string;
  start: number;
  end: number;
  top: number;
  height: number;
};

export interface OperationalRowSnapshot {
  visibleKeys: string[];
  pinnedKeys: string[];
  mountedKeys: string[];
  pendingKeys: string[];
  totalHeight: number;
  segments: OperationalRowSegment[];
}

/** Use canonical message/block IDs and an emitted-row identity (e.g. title ordinal).
 * Never include a parent group, mutable tool status, or index in a regrouped list.
 */
export function operationalRowKey(scopeId: string, blockId: string, rowId: string): string {
  return JSON.stringify(['row', scopeId, blockId, rowId]);
}

const OVERSCAN_PER_SIDE = 12;
const MAX_OFFSCREEN_PINS = 2;
const MAX_ADMISSIONS_PER_FRAME = 4;

function validateHeight(height: number): void {
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('Row height must be finite and positive');
  }
}

function validateViewport(viewport: OperationalRowViewport): void {
  if (!Number.isFinite(viewport.top) || !Number.isFinite(viewport.bottom)) {
    throw new Error('Viewport coordinates must be finite');
  }
}

/** First index for which predicate is true in a false-then-true sorted array. */
function lowerBound(length: number, predicate: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (predicate(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Pure, component-owned panel policy: no DOM, observers, timers or title parsing.
 * Call advanceFrame with the SHARED requestAnimationFrame timestamp, then publish
 * one snapshot to both renderers. Repeated calls with that timestamp share the
 * remaining allowance, even after scrolling, appending or releasing a scope.
 * Only `row` segments may instantiate operational components. A pending row is
 * part of a spacer just like any other hidden row. Cancel the caller's RAF and
 * dispose on panel teardown; do not create a policy per message/group.
 */
export function createOperationalRowWindow() {
  let entries: OperationalRowDescriptor[] = [];
  let positions = new Map<string, number>();
  let offsets = [0];
  let operationalIndices: number[] = [];
  const measured = new Map<string, number>();
  const mounted = new Set<string>();
  let viewport: OperationalRowViewport = { top: 0, bottom: 0 };
  let requestedPins: string[] = [];
  let visibleKeys: string[] = [];
  let pinnedKeys: string[] = [];
  let candidates: string[] = [];
  let frame = -Infinity;
  let remainingAdmissions = 0;
  let disposed = false;

  function reconcile(): void {
    visibleKeys = [];
    pinnedKeys = [];
    candidates = [];
    if (viewport.bottom > viewport.top) {
      const start = lowerBound(
        operationalIndices.length,
        (i) => offsets[operationalIndices[i] + 1] > viewport.top,
      );
      const end = lowerBound(
        operationalIndices.length,
        (i) => offsets[operationalIndices[i]] >= viewport.bottom,
      );
      visibleKeys = operationalIndices.slice(start, end).map((i) => entries[i].key);
      const visible = new Set(visibleKeys);
      pinnedKeys = requestedPins
        .filter((key) => {
          const index = positions.get(key);
          return index !== undefined && entries[index].kind !== 'content' && !visible.has(key);
        })
        .slice(0, MAX_OFFSCREEN_PINS);
      const priority = new Set([...visibleKeys, ...pinnedKeys]);
      for (let distance = 1; distance <= OVERSCAN_PER_SIDE; distance += 1) {
        const before = operationalIndices[start - distance];
        const after = operationalIndices[end + distance - 1];
        if (before !== undefined) priority.add(entries[before].key);
        if (after !== undefined) priority.add(entries[after].key);
      }
      candidates = [...priority];
    }
    const desired = new Set(candidates);
    for (const key of mounted) if (!desired.has(key)) mounted.delete(key);
  }

  // Rebuild once per descriptor/measurement batch; viewport updates binary-search
  // this height index without scanning the whole transcript.
  function rebuildIndex(): void {
    offsets = [0];
    operationalIndices = [];
    entries.forEach((entry, index) => {
      offsets.push(offsets[index] + (measured.get(entry.key) ?? entry.estimatedHeight));
      if (entry.kind !== 'content') operationalIndices.push(index);
    });
    reconcile();
  }

  function setEntries(
    next: readonly OperationalRowDescriptor[],
    nextViewport?: OperationalRowViewport,
  ): void {
    if (disposed) return;
    if (nextViewport) validateViewport(nextViewport);
    const nextPositions = new Map<string, number>();
    next.forEach((entry, index) => {
      validateHeight(entry.estimatedHeight);
      if (nextPositions.has(entry.key)) throw new Error(`Duplicate row key: ${entry.key}`);
      nextPositions.set(entry.key, index);
    });
    entries = next.map((entry) => ({ ...entry }));
    positions = nextPositions;
    for (const key of measured.keys()) if (!positions.has(key)) measured.delete(key);
    for (const key of mounted) if (!positions.has(key)) mounted.delete(key);
    requestedPins = requestedPins.filter((key) => positions.has(key));
    if (nextViewport) viewport = { ...nextViewport };
    rebuildIndex();
  }

  return {
    /** Pass the adjusted viewport atomically when restoring a prepend anchor. */
    setEntries,
    setViewport(next: OperationalRowViewport): void {
      if (disposed) return;
      validateViewport(next);
      viewport = { ...next };
      reconcile();
    },
    /** Priority ordered interaction targets, at most two offscreen. No force path. */
    setPins(keys: readonly string[]): void {
      if (disposed) return;
      requestedPins = [...new Set(keys)];
      reconcile();
    },
    /** Batch measurements of mounted rows/content only; stale keys are ignored. */
    measure(measurements: readonly { key: string; height: number }[]): void {
      if (disposed) return;
      const live = measurements.filter(({ key }) => positions.has(key));
      for (const { height } of live) validateHeight(height);
      for (const { key, height } of live) measured.set(key, height);
      rebuildIndex();
    },
    /**
     * Forget physical mounts torn down by an outer message/group/renderer while
     * retaining row identity and measured geometry. The owner must invalidate
     * affected keys before publishing a replacement renderer, then render the
     * fresh snapshot. Re-created components need new admissions; invalidation
     * never refunds the frame's already-used allowance. Batch at the owner
     * boundary rather than registering per-offscreen-row lifecycle observers.
     */
    invalidateMounts(keys: readonly string[]): void {
      if (disposed) return;
      for (const key of keys) mounted.delete(key);
    },
    releaseScope(scopeId: string): void {
      if (disposed) return;
      setEntries(entries.filter((entry) => entry.scopeId !== scopeId));
    },
    /** Navigation can target an unmounted row without mounting it to measure. */
    locate(key: string): { index: number; top: number; height: number } | undefined {
      const index = positions.get(key);
      if (index === undefined) return undefined;
      return { index, top: offsets[index], height: offsets[index + 1] - offsets[index] };
    },
    /** Returns newly admitted keys only; no more than four across this RAF. */
    advanceFrame(timestamp: number): string[] {
      if (disposed) return [];
      if (!Number.isFinite(timestamp)) throw new Error('Frame timestamp must be finite');
      if (timestamp < frame) return [];
      if (timestamp > frame) {
        frame = timestamp;
        remainingAdmissions = MAX_ADMISSIONS_PER_FRAME;
      }
      const admitted: string[] = [];
      for (const key of candidates) {
        if (!remainingAdmissions) break;
        if (mounted.has(key)) continue;
        mounted.add(key);
        admitted.push(key);
        remainingAdmissions -= 1;
      }
      return admitted;
    },
    snapshot(): OperationalRowSnapshot {
      const segments: OperationalRowSegment[] = [];
      const mountedKeys: string[] = [];
      let index = 0;
      while (index < entries.length) {
        const entry = entries[index];
        const start = index;
        const type =
          entry.kind === 'content' ? 'content' : mounted.has(entry.key) ? 'row' : 'spacer';
        index += 1;
        if (type === 'spacer') {
          while (
            index < entries.length &&
            entries[index].scopeId === entry.scopeId &&
            entries[index].kind !== 'content' &&
            !mounted.has(entries[index].key)
          )
            index += 1;
        } else if (type === 'row') mountedKeys.push(entry.key);
        segments.push({
          type,
          scopeId: entry.scopeId,
          key:
            type === 'spacer'
              ? JSON.stringify(['spacer', entry.key, entries[index - 1].key])
              : entry.key,
          start,
          end: index,
          top: offsets[start],
          height: offsets[index] - offsets[start],
        });
      }
      return {
        visibleKeys: [...visibleKeys],
        pinnedKeys: [...pinnedKeys],
        mountedKeys,
        pendingKeys: candidates.filter((key) => !mounted.has(key)),
        totalHeight: offsets.at(-1) ?? 0,
        segments,
      };
    },
    dispose(): void {
      if (disposed) return;
      setEntries([]);
      requestedPins = [];
      disposed = true;
    },
  };
}
