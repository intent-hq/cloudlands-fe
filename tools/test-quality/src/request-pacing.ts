export function createRequestPacer(intervalMs: number) {
  let nextStart = 0;
  let queue = Promise.resolve();
  return {
    defer(delayMs: number): void {
      nextStart = Math.max(nextStart, Date.now() + delayMs);
    },
    wait(): Promise<void> {
      const pending = queue.then(async () => {
        while (nextStart > Date.now())
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(nextStart - Date.now(), 60_000)),
          );
        nextStart = Date.now() + intervalMs;
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
}
