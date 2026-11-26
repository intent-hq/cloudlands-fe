/**
 * A reference-counted lease that stays held for `holdMs` after its last holder
 * drops it, so a holder that comes back soon (a page change and back) reuses
 * the lease instead of releasing and re-acquiring it on the wire.
 */
export function createHeldLease(options: {
  acquire: () => void;
  release: () => void;
  holdMs: number;
}): { hold(): () => void } {
  let holders = 0;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    hold() {
      holders += 1;
      if (releaseTimer !== undefined) {
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
      } else if (holders === 1) {
        options.acquire();
      }
      let dropped = false;
      return () => {
        if (dropped) return;
        dropped = true;
        if (--holders > 0) return;
        releaseTimer = setTimeout(() => {
          releaseTimer = undefined;
          options.release();
        }, options.holdMs);
      };
    },
  };
}
