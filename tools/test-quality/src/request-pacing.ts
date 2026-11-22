export function createRequestPacer(intervalMs: number, inputTokensPerSecond = 0) {
  let nextStart = 0;
  let queue = Promise.resolve();
  let reservations: Array<{ started: number; tokens: number }> = [];
  return {
    defer(delayMs: number): void {
      nextStart = Math.max(nextStart, Date.now() + delayMs);
    },
    wait(tokens = 0): Promise<(actualTokens: number) => void> {
      if (inputTokensPerSecond && tokens > inputTokensPerSecond)
        return Promise.reject(new Error('Request exceeds the input token rate budget'));
      const pending = queue.then(async () => {
        for (;;) {
          const now = Date.now();
          reservations = reservations.filter((entry) => entry.started + 1000 > now);
          const oldest = reservations[0];
          const tokenDelay =
            inputTokensPerSecond &&
            oldest &&
            reservations.reduce((sum, entry) => sum + entry.tokens, 0) + tokens >
              inputTokensPerSecond
              ? oldest.started + 1000 - now
              : 0;
          const delay = Math.max(nextStart - now, tokenDelay);
          if (delay <= 0) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 60_000)));
        }
        nextStart = Date.now() + intervalMs;
        const entry = { started: Date.now(), tokens };
        if (inputTokensPerSecond) reservations.push(entry);
        return (actualTokens: number) => {
          if (inputTokensPerSecond && actualTokens > tokens)
            throw new Error('Jev input usage exceeded the reserved context limit');
          entry.tokens = actualTokens;
        };
      });
      queue = pending.then(
        () => {},
        () => {},
      );
      return pending;
    },
  };
}
