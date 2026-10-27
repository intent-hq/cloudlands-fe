import { readable, type Readable } from 'svelte/store';

import { store as appStore } from '../store';

type ReadableOrValue<ARGS extends unknown[]> = { [K in keyof ARGS]: ARGS[K] | Readable<ARGS[K]> };

/** The parts of a Themis selector this helper needs: the readable factory and its pure `select`. */
interface DirectSelectable<R, ARGS extends unknown[]> {
  (...args: ReadableOrValue<ARGS>): Readable<R>;
  select?: (state: never, ...args: ARGS) => R;
}

const isReadable = (value: unknown): value is Readable<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { subscribe?: unknown }).subscribe === 'function';

/**
 * A Themis selector projected on every dispatch instead of on the animation-frame cadence.
 *
 * Themis selector readables deliver updates after subscribe on a
 * `requestAnimationFrame` cadence. A renderer whose frames are suspended
 * (occluded or throttled window) keeps reducing actions while those readables
 * stay frozen on their last value (intent-hq/intent#4622). Use this only for
 * safety-critical projections that must follow Redux even without frames —
 * the blocking disconnect overlay and the native window title. Everything else
 * should keep the frame-cadenced selector readable.
 *
 * Subscribes to the configured store's direct readable (`getReadableState`)
 * and to any readable arguments, re-runs `selector.select` synchronously, and
 * notifies only when the result changes by `Object.is`, so callers should
 * project to primitives or stable references. The store subscription lives
 * exactly as long as the returned readable has subscribers. When the store
 * offers no direct readable (component tests with a stub store), the regular
 * selector readable is returned unchanged.
 */
export function directSelectorReadable<R, ARGS extends unknown[]>(
  selector: DirectSelectable<R, ARGS>,
  ...args: ReadableOrValue<ARGS>
): Readable<R> {
  const select = selector.select as ((state: unknown, ...args: ARGS) => R) | undefined;
  if (typeof appStore.getReadableState !== 'function' || typeof select !== 'function') {
    return selector(...args);
  }
  const state$ = appStore.getReadableState();

  return readable<R>(undefined as R, (set) => {
    let state: unknown;
    const values = args.map((arg) => (isReadable(arg) ? undefined : arg)) as ARGS;
    let started = false;
    let hasValue = false;
    let current: R;
    const update = () => {
      if (!started) return;
      const next = select(state, ...values);
      if (hasValue && Object.is(next, current)) return;
      hasValue = true;
      current = next;
      set(next);
    };
    const unsubscribers = args.map((arg, index) =>
      isReadable(arg)
        ? arg.subscribe((value) => {
            values[index] = value;
            update();
          })
        : undefined,
    );
    unsubscribers.push(
      state$.subscribe((value) => {
        state = value;
        update();
      }),
    );
    started = true;
    update();
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  });
}
